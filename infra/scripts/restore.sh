#!/usr/bin/env bash
# Restauration d'une sauvegarde chiffrée (prompt 15, tâche 8) dans une base CIBLE, jamais la production par défaut.
#   infra/scripts/restore.sh /var/backups/neomoov/neomoov-20260926T073000Z.dump.enc
# Variables : BACKUP_PASSPHRASE, TARGET_DATABASE_URL (base vierge ou de secours). Restaurer la production exige en plus
# RESTORE_INTO_PRODUCTION=oui et TARGET_DATABASE_URL identique à DATABASE_URL : décision humaine, service arrêté.
# Contrôles avant restauration : empreinte authentifiée (`.mac`, revue du 2 octobre 2026, constat web 22) ou, pour une
# sauvegarde plus ancienne, simple empreinte SHA-256. Avant la restauration, la cible reçoit ce que le dump suppose sans
# le contenir : extensions (PostGIS dans le même schéma que la source, d'après la fiche `.meta`) et rôle des
# politiques d'isolation (`neomoov_scoped`).
set -euo pipefail

FILE="${1:?Chemin de la sauvegarde attendu}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE absente}"
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL absente (base où restaurer)}"
# Réseau des conteneurs clients : « host » par défaut, pour joindre une base de secours publiée sur le serveur
# (ex. conteneur postgis sur 127.0.0.1:5433) aussi bien qu'une base distante.
DOCKER_NET="${RESTORE_DOCKER_NETWORK:-host}"
PG_IMAGE="${BACKUP_PG_IMAGE:-postgres:17-alpine}"

if [ -n "${DATABASE_URL:-}" ] && [ "$TARGET_DATABASE_URL" = "$DATABASE_URL" ] && [ "${RESTORE_INTO_PRODUCTION:-non}" != "oui" ]; then
  echo "Refus : la cible est la base de production. Définir RESTORE_INTO_PRODUCTION=oui après avoir arrêté l'API et le worker." >&2
  exit 1
fi

# Même calcul que backup.sh : la phrase secrète ne passe que par un tube.
backup_mac() {
  local digest
  digest="$(sha256sum "$1" | cut -d' ' -f1)"
  { printf 'neomoov-backup-mac-v1:%s\n' "$BACKUP_PASSPHRASE"; printf '%s' "$digest"; } | sha256sum | cut -d' ' -f1
}

if [ -f "$FILE.mac" ]; then
  echo "Contrôle de l'empreinte authentifiée"
  expected="$(cut -d' ' -f1 "$FILE.mac")"
  if [ "$(backup_mac "$FILE")" != "$expected" ]; then
    echo "Refus : empreinte authentifiée différente (fichier modifié, ou autre phrase secrète)" >&2
    exit 1
  fi
elif [ -f "$FILE.sha256" ]; then
  echo "Contrôle de l'empreinte (sauvegarde antérieure aux empreintes authentifiées)"
  (cd "$(dirname "$FILE")" && sha256sum --check "$(basename "$FILE").sha256")
fi

POSTGIS_SCHEMA="public"
if [ -f "$FILE.meta" ]; then
  POSTGIS_SCHEMA="$(sed -n 's/^postgis_schema=\([a-z_][a-z0-9_]*\)$/\1/p' "$FILE.meta" | head -n 1)"
  POSTGIS_SCHEMA="${POSTGIS_SCHEMA:-public}"
fi

echo "Préparation de la cible : extensions (PostGIS dans le schéma « $POSTGIS_SCHEMA ») et rôle des politiques"
# shellcheck disable=SC2016 # variables développées dans le conteneur
docker run --rm --network "$DOCKER_NET" -e TARGET_DATABASE_URL -e POSTGIS_SCHEMA="$POSTGIS_SCHEMA" "$PG_IMAGE" sh -c 'psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -v schema="$POSTGIS_SCHEMA" <<'"'"'SQL'"'"'
CREATE SCHEMA IF NOT EXISTS :"schema";
CREATE EXTENSION IF NOT EXISTS postgis SCHEMA :"schema";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '"'"'neomoov_scoped'"'"') THEN CREATE ROLE neomoov_scoped NOLOGIN NOBYPASSRLS; END IF;
END $$;
SQL'

echo "Restauration dans la cible"
# shellcheck disable=SC2016 # variables développées dans le conteneur
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$FILE" \
  | docker run --rm -i --network "$DOCKER_NET" -e TARGET_DATABASE_URL "$PG_IMAGE" sh -c 'pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error -d "$TARGET_DATABASE_URL"'

echo "Contrôles après restauration"
# shellcheck disable=SC2016 # variables développées dans le conteneur
docker run --rm --network "$DOCKER_NET" -e TARGET_DATABASE_URL "$PG_IMAGE" sh -c 'psql "$TARGET_DATABASE_URL" -At -v ON_ERROR_STOP=1 -c "
  SELECT '"'"'utilisateurs : '"'"' || count(*) FROM users;
  SELECT '"'"'courses : '"'"' || count(*) FROM rides;
  SELECT '"'"'factures : '"'"' || count(*) FROM invoices;
  SELECT '"'"'migrations : '"'"' || count(*) FROM drizzle.__drizzle_migrations;"'
echo "Restauration terminée."
