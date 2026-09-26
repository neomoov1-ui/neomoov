#!/usr/bin/env bash
# Sauvegarde logique chiffrée de la base (prompt 15, tâche 8), en plus des sauvegardes de Supabase.
#   - pg_dump au format personnalisé (compressé), par l'image officielle PostgreSQL (aucun client à installer) ;
#   - chiffrement AES-256 (openssl, dérivation PBKDF2) avec BACKUP_PASSPHRASE, empreinte SHA-256 à côté ;
#   - vérification : le fichier est déchiffré et relu par pg_restore --list (sans rien restaurer) ;
#   - conservation locale BACKUP_KEEP_DAYS jours (35, section 10 du cahier des charges) ; copie vers le stockage objet si BACKUP_REMOTE est défini (rclone).
# Usage (sur le serveur, variables lues dans /opt/neomoov/.env) :
#   set -a; . /opt/neomoov/.env; set +a; infra/scripts/backup.sh
# Cron quotidien (3 h 30, avant la passe de conservation du lendemain) : voir docs/runbooks/sauvegardes.md.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL absente}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE absente : la sauvegarde doit être chiffrée}"
DEST="${BACKUP_DIR:-/var/backups/neomoov}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-35}"
PG_IMAGE="${BACKUP_PG_IMAGE:-postgres:17-alpine}"

mkdir -p "$DEST"
chmod 700 "$DEST"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$DEST/neomoov-$STAMP.dump.enc"

echo "Sauvegarde vers $FILE"
docker run --rm -e DATABASE_URL "$PG_IMAGE" sh -c 'pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL"' \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -out "$FILE"
chmod 600 "$FILE"
sha256sum "$FILE" > "$FILE.sha256"

echo "Vérification (déchiffrement et lecture de la table des matières)"
ENTRIES="$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$FILE" \
  | docker run --rm -i "$PG_IMAGE" pg_restore --list | grep -c 'TABLE DATA' || true)"
if [ "${ENTRIES:-0}" -lt 20 ]; then
  echo "Sauvegarde invalide : seulement ${ENTRIES:-0} tables lues" >&2
  exit 1
fi
echo "Sauvegarde vérifiée : $ENTRIES tables"

find "$DEST" -name 'neomoov-*.dump.enc*' -mtime +"$KEEP_DAYS" -delete

if [ -n "${BACKUP_REMOTE:-}" ]; then
  echo "Copie vers $BACKUP_REMOTE"
  rclone copy "$FILE" "$BACKUP_REMOTE/" && rclone copy "$FILE.sha256" "$BACKUP_REMOTE/"
fi

echo "Terminé. Pour autoriser les purges de conservation, confirmer la sauvegarde vérifiée dans My Hub (Conservation) ou par POST /v1/admin/retention/backup-verified."
