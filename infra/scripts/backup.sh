#!/usr/bin/env bash
# Sauvegarde logique chiffrée de la base (prompt 15, tâche 8), en plus des sauvegardes de Supabase.
#   - pg_dump au format personnalisé (compressé), par l'image officielle PostgreSQL (aucun client à installer), limité aux
#     schémas de Neomoov (`public`, `drizzle`) : les schémas propres à Supabase (`auth`, `storage`, `realtime`, `vault`…)
#     ne se restaurent pas dans une base vierge (revue du 2 octobre 2026, constat web 1) ;
#   - chiffrement AES-256 (openssl, dérivation PBKDF2) avec BACKUP_PASSPHRASE, écrit d'abord dans un fichier `.part`
#     renommé seulement une fois vérifié (constat web 22) ;
#   - vérification : le fichier est déchiffré et relu par pg_restore --list (sans rien restaurer) ;
#   - empreinte SHA-256 (`.sha256`) et empreinte authentifiée par la phrase secrète (`.mac`), contrôlées par restore.sh ;
#     fiche `.meta` sans secret (schéma de PostGIS, version du serveur) pour recréer les extensions au même endroit ;
#   - copie hors site vers BACKUP_REMOTE (rclone), obligatoire en production (constat web 2) : la purge locale des
#     sauvegardes de plus de BACKUP_KEEP_DAYS jours (35, section 10 du cahier des charges) n'a lieu qu'après une copie
#     réussie ;
#   - alerte : battement Better Stack si BACKUP_HEARTBEAT_URL existe, appel `/fail` sur toute erreur (constat web 11).
# Usage (sur le serveur, variables lues dans /opt/neomoov/.env) :
#   set -a; . /opt/neomoov/.env; set +a; infra/scripts/backup.sh
# Cron quotidien (3 h 30, avant la passe de conservation du lendemain) : voir docs/runbooks/sauvegardes.md.
# Codes de sortie : 0 tout est fait ; 1 sauvegarde en échec ; 4 sauvegarde locale vérifiée mais copie hors site absente
# ou en échec (rien n'est purgé).
set -Eeuo pipefail

: "${DATABASE_URL:?DATABASE_URL absente}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE absente : la sauvegarde doit être chiffrée}"
DEST="${BACKUP_DIR:-/var/backups/neomoov}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-35}"
PG_IMAGE="${BACKUP_PG_IMAGE:-postgres:17-alpine}"
# Schémas sauvegardés : ceux de Neomoov seulement (tables, fonctions, journal des migrations de Drizzle).
SCHEMAS="${BACKUP_SCHEMAS:-public drizzle}"

# Battement de surveillance (Better Stack « heartbeat ») : l'adresse passe par l'entrée standard de curl, jamais par sa
# ligne de commande ; sans adresse, rien n'est envoyé.
heartbeat() {
  [ -n "${BACKUP_HEARTBEAT_URL:-}" ] || return 0
  printf 'url = "%s%s"\n' "${BACKUP_HEARTBEAT_URL%/}" "$1" | curl -fsS -m 10 --retry 3 -o /dev/null -K - || echo "Battement de surveillance non envoyé" >&2
}

PART=""
on_error() {
  local status=$?
  trap - ERR
  [ -n "$PART" ] && rm -f "$PART"
  echo "Sauvegarde en échec (code $status)" >&2
  heartbeat /fail
  exit "$status"
}
trap on_error ERR

# Empreinte authentifiée : SHA-256 d'une clé dérivée de la phrase secrète suivie du SHA-256 du fichier (message de longueur
# fixe, donc sans extension de longueur possible). La phrase passe par un tube (printf est interne au shell) : elle
# n'apparaît jamais dans la liste des processus. Même calcul dans restore.sh.
backup_mac() {
  local digest
  digest="$(sha256sum "$1" | cut -d' ' -f1)"
  { printf 'neomoov-backup-mac-v1:%s\n' "$BACKUP_PASSPHRASE"; printf '%s' "$digest"; } | sha256sum | cut -d' ' -f1
}

mkdir -p "$DEST"
chmod 700 "$DEST"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$DEST/neomoov-$STAMP.dump.enc"
PART="$FILE.part"
SCHEMA_ARGS=""
for s in $SCHEMAS; do SCHEMA_ARGS="$SCHEMA_ARGS --schema=$s"; done

echo "Sauvegarde vers $FILE (schémas : $SCHEMAS)"
# shellcheck disable=SC2016 # variables développées dans le conteneur
docker run --rm -e DATABASE_URL -e SCHEMA_ARGS="$SCHEMA_ARGS" "$PG_IMAGE" \
  sh -c 'pg_dump --format=custom --no-owner --no-privileges $SCHEMA_ARGS "$DATABASE_URL"' \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -out "$PART"
chmod 600 "$PART"

echo "Vérification (déchiffrement et lecture de la table des matières)"
ENTRIES="$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$PART" \
  | docker run --rm -i "$PG_IMAGE" pg_restore --list | grep -c 'TABLE DATA' || true)"
if [ "${ENTRIES:-0}" -lt 20 ]; then
  echo "Sauvegarde invalide : seulement ${ENTRIES:-0} tables lues" >&2
  false
fi
mv "$PART" "$FILE"
PART=""
echo "Sauvegarde vérifiée : $ENTRIES tables"

# Empreintes par nom de fichier (et non chemin complet) : contrôlables aussi sur une copie rapatriée ailleurs.
(cd "$DEST" && sha256sum "$(basename "$FILE")") > "$FILE.sha256"
printf '%s  %s\n' "$(backup_mac "$FILE")" "$(basename "$FILE")" > "$FILE.mac"
# Fiche sans secret : où vit PostGIS dans la source (`public`, ou `extensions` chez Supabase), version du serveur.
# shellcheck disable=SC2016 # variables développées dans le conteneur
if ! docker run --rm -e DATABASE_URL "$PG_IMAGE" sh -c 'psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 -c "SELECT '"'"'postgis_schema='"'"' || COALESCE((SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = '"'"'postgis'"'"'), '"'"'public'"'"')" -c "SELECT '"'"'server_version='"'"' || current_setting('"'"'server_version_num'"'"')"' > "$FILE.meta"; then
  echo "Fiche .meta incomplète (PostGIS supposé dans public)" >&2
  printf 'postgis_schema=public\n' > "$FILE.meta"
fi
printf 'schemas=%s\ntables=%s\n' "$SCHEMAS" "$ENTRIES" >> "$FILE.meta"
chmod 600 "$FILE.sha256" "$FILE.mac" "$FILE.meta"

STATUS=0
if [ -n "${BACKUP_REMOTE:-}" ]; then
  echo "Copie hors site vers $BACKUP_REMOTE"
  if rclone copy "$DEST" "$BACKUP_REMOTE/" --include "$(basename "$FILE")*"; then
    echo "Copie hors site réussie ; purge des sauvegardes de plus de $KEEP_DAYS jours"
    find "$DEST" -name 'neomoov-*.dump.enc*' -mtime +"$KEEP_DAYS" -delete
    rclone delete "$BACKUP_REMOTE/" --min-age "${KEEP_DAYS}d" --include 'neomoov-*.dump.enc*' || echo "Purge hors site impossible (les copies anciennes restent)" >&2
  else
    echo "ÉCHEC de la copie hors site : la sauvegarde reste sur le serveur, aucune purge" >&2
    STATUS=4
  fi
elif [ "${NODE_ENV:-}" = "production" ]; then
  echo "ATTENTION : BACKUP_REMOTE absent en production : sauvegarde gardée sur le serveur seulement, aucune purge (docs/runbooks/sauvegardes.md)" >&2
  STATUS=4
else
  find "$DEST" -name 'neomoov-*.dump.enc*' -mtime +"$KEEP_DAYS" -delete
fi

trap - ERR
if [ "$STATUS" -ne 0 ]; then
  heartbeat /fail
  exit "$STATUS"
fi
heartbeat ""
echo "Terminé. Pour autoriser les purges de conservation, confirmer la sauvegarde vérifiée dans My Hub (Conservation) ou par POST /v1/admin/retention/backup-verified."
