#!/usr/bin/env bash
# Essai de restauration (revue du 2 octobre 2026, constat web 1 ; cahier des charges, sections 8 et 10.4) : la dernière
# sauvegarde (ou celle donnée) est restaurée dans un conteneur PostGIS jetable, publié sur 127.0.0.1 seulement, puis
# comparée à la production (comptes en lecture seule) ; le conteneur est supprimé à la fin, même en cas d'erreur. Rien
# n'est écrit dans la production.
#   set -a; . /opt/neomoov/.env; set +a; infra/scripts/restore-test.sh [fichier.dump.enc]
# Variables : BACKUP_PASSPHRASE (obligatoire), DATABASE_URL (facultative : comparaison avec la production), BACKUP_DIR,
# RESTORE_TEST_IMAGE (postgis/postgis:17-3.5 par défaut, même version majeure que l'outil pg_restore), RESTORE_TEST_PORT.
# Tâche planifiée mensuelle posée par infra/server-setup.sh ; la ligne finale « ESSAI | … » est à reporter dans le
# tableau de docs/runbooks/sauvegardes.md. Battement Better Stack facultatif : RESTORE_TEST_HEARTBEAT_URL.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE absente}"
DEST="${BACKUP_DIR:-/var/backups/neomoov}"
IMAGE="${RESTORE_TEST_IMAGE:-postgis/postgis:17-3.5}"
PORT="${RESTORE_TEST_PORT:-5433}"
PG_IMAGE="${BACKUP_PG_IMAGE:-postgres:17-alpine}"
NAME="neomoov-essai-restauration"

FILE="${1:-}"
if [ -z "$FILE" ]; then
  FILE="$(find "$DEST" -maxdepth 1 -name 'neomoov-*.dump.enc' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n 1 | cut -d' ' -f2- || true)"
fi
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Aucune sauvegarde à essayer (dossier $DEST)" >&2
  exit 2
fi

heartbeat() {
  [ -n "${RESTORE_TEST_HEARTBEAT_URL:-}" ] || return 0
  printf 'url = "%s%s"\n' "${RESTORE_TEST_HEARTBEAT_URL%/}" "$1" | curl -fsS -m 10 --retry 3 -o /dev/null -K - || echo "Battement de surveillance non envoyé" >&2
}

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
on_error() {
  local status=$?
  trap - ERR
  echo "ESSAI | $(date -u +%Y-%m-%d) | $(basename "$FILE") | conteneur jetable | — | — | ÉCHEC (code $status)" >&2
  heartbeat /fail
  exit "$status"
}
trap cleanup EXIT
trap on_error ERR

# Mot de passe jetable du conteneur d'essai (jamais réutilisé, supprimé avec le conteneur).
TEST_PASSWORD="$(openssl rand -hex 16)"
cleanup
echo "Conteneur jetable $IMAGE sur 127.0.0.1:$PORT"
docker run -d --name "$NAME" -e POSTGRES_PASSWORD="$TEST_PASSWORD" -p "127.0.0.1:$PORT:5432" "$IMAGE" >/dev/null
# Prêt seulement quand le serveur définitif écoute en TCP (le serveur d'initialisation n'écoute que sur le socket local).
ready=0
for _ in $(seq 1 60); do
  if docker exec "$NAME" pg_isready -h 127.0.0.1 -p 5432 -U postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[ "$ready" = 1 ] || { echo "Le conteneur d'essai ne répond pas" >&2; false; }

started="$(date +%s)"
# La production n'est jamais la cible : TARGET_DATABASE_URL vise le conteneur jetable.
TARGET_DATABASE_URL="postgresql://postgres:${TEST_PASSWORD}@127.0.0.1:${PORT}/postgres" RESTORE_INTO_PRODUCTION=non \
  "$ROOT/infra/scripts/restore.sh" "$FILE"
duration=$(( $(date +%s) - started ))

count_sql="SELECT count(*) FROM users; SELECT count(*) FROM rides; SELECT count(*) FROM invoices; SELECT count(*) FROM drizzle.__drizzle_migrations;"
restored="$(docker exec "$NAME" psql -U postgres -At -v ON_ERROR_STOP=1 -c "$count_sql" | paste -sd, -)"
source_counts="non comparé"
if [ -n "${DATABASE_URL:-}" ]; then
  # Lecture seule : transaction en lecture seule, aucun verrou d'écriture sur la production.
  # shellcheck disable=SC2016 # variables développées dans le conteneur
  source_counts="$(docker run --rm -e DATABASE_URL -e COUNT_SQL="$count_sql" "$PG_IMAGE" sh -c 'PGOPTIONS="-c default_transaction_read_only=on" psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 -c "$COUNT_SQL"' | paste -sd, - || echo "lecture impossible")"
fi

trap - ERR
echo "Comptes restaurés (utilisateurs, courses, factures, migrations) : $restored ; production au moment de l'essai : $source_counts"
echo "ESSAI | $(date -u +%Y-%m-%d) | $(basename "$FILE") | conteneur jetable $IMAGE | ${duration} s | $restored | réussi"
heartbeat ""
