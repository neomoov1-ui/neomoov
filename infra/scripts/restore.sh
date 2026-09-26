#!/usr/bin/env bash
# Restauration d'une sauvegarde chiffrée (prompt 15, tâche 8) dans une base CIBLE, jamais la production par défaut.
#   infra/scripts/restore.sh /var/backups/neomoov/neomoov-20260926T073000Z.dump.enc
# Variables : BACKUP_PASSPHRASE, TARGET_DATABASE_URL (base vierge ou de secours). Restaurer la production exige en plus
# RESTORE_INTO_PRODUCTION=oui et TARGET_DATABASE_URL identique à DATABASE_URL : décision humaine, service arrêté.
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

if [ -f "$FILE.sha256" ]; then
  echo "Contrôle de l'empreinte"
  sha256sum --check "$FILE.sha256"
fi

echo "Extensions requises (PostGIS) sur la cible"
docker run --rm --network "$DOCKER_NET" -e TARGET_DATABASE_URL "$PG_IMAGE" sh -c 'psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pgcrypto;"'

echo "Restauration dans la cible"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$FILE" \
  | docker run --rm -i --network "$DOCKER_NET" -e TARGET_DATABASE_URL "$PG_IMAGE" sh -c 'pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error -d "$TARGET_DATABASE_URL"'

echo "Contrôles après restauration"
docker run --rm --network "$DOCKER_NET" -e TARGET_DATABASE_URL "$PG_IMAGE" sh -c 'psql "$TARGET_DATABASE_URL" -At -v ON_ERROR_STOP=1 -c "
  SELECT '"'"'utilisateurs : '"'"' || count(*) FROM users;
  SELECT '"'"'courses : '"'"' || count(*) FROM rides;
  SELECT '"'"'factures : '"'"' || count(*) FROM invoices;
  SELECT '"'"'migrations : '"'"' || count(*) FROM drizzle.__drizzle_migrations;"'
echo "Restauration terminée."
