#!/usr/bin/env bash
# Déploiement sur le VPS LWS (décision D48). S'exécute sur le serveur, dans /opt/neomoov :
#   infra/deploy.sh build [nouvelle-ref] [ancienne-ref]   construit les images depuis l'arbre de travail (défaut)
#   infra/deploy.sh pull <tag> [ancien-tag]               tire les images publiées sur GHCR (IMAGE_PREFIX requis dans .env)
# Étapes : images, migrations (une seule fois, hors des instances), démarrage, vérification de santé, retour arrière
# automatique sur la version précédente si l'API n'est pas saine.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
MODE="${1:-build}"
NEW_REF="${2:-}"
OLD_REF="${3:-}"
STATE_FILE="$ROOT/infra/.deploy-state"
GIT_DIR="${GIT_DIR:-$ROOT/.git}"
[ -d "$GIT_DIR" ] || GIT_DIR="/opt/neomoov.git"

log() { printf '[deploy %s] %s\n' "$(date +%H:%M:%S)" "$*"; }

set -a
# shellcheck disable=SC1091
[ -f "$ROOT/.env" ] && . "$ROOT/.env"
set +a
export IMAGE_PREFIX="${IMAGE_PREFIX:-neomoov}"

compose() { docker compose -f "$ROOT/infra/compose.prod.yml" "$@"; }

current_ref() { git --git-dir="$GIT_DIR" --work-tree="$ROOT" rev-parse HEAD 2>/dev/null || echo "inconnu"; }
checkout_ref() { git --git-dir="$GIT_DIR" --work-tree="$ROOT" checkout -f --quiet "$1"; }

if [ "$MODE" = "pull" ]; then
  [ -n "$NEW_REF" ] || { echo "usage : deploy.sh pull <tag> [ancien-tag]"; exit 2; }
  export IMAGE_TAG="$NEW_REF"
  PREVIOUS="${OLD_REF:-$(cat "$STATE_FILE" 2>/dev/null || true)}"
  log "images ${IMAGE_PREFIX}-*:${IMAGE_TAG} (précédent : ${PREVIOUS:-aucun})"
  compose pull --quiet
else
  export IMAGE_TAG="local"
  PREVIOUS="${OLD_REF:-$(cat "$STATE_FILE" 2>/dev/null || true)}"
  NEW_REF="${NEW_REF:-$(current_ref)}"
  log "construction depuis ${NEW_REF} (précédent : ${PREVIOUS:-aucun})"
  compose build --pull
fi

# Version affichée par /v1/health et envoyée à Sentry : le commit déployé (12 caractères).
export APP_VERSION="${NEW_REF:0:12}"

log "migrations"
compose run --rm --no-deps api node ../../packages/db/dist/migrate.js

log "démarrage"
compose up -d --remove-orphans

healthy() {
  local ids status
  ids="$(compose ps -q api)"
  [ -n "$ids" ] || return 1
  for id in $ids; do
    status="$(docker inspect --format '{{.State.Health.Status}}' "$id" 2>/dev/null || echo "inconnu")"
    [ "$status" = "healthy" ] || return 1
  done
  return 0
}

log "vérification de santé (jusqu'à 120 s)"
ok=0
for _ in $(seq 1 24); do
  if healthy; then ok=1; break; fi
  sleep 5
done

if [ "$ok" = "1" ]; then
  echo "$NEW_REF" > "$STATE_FILE"
  log "déployé : $NEW_REF"
  compose ps
  docker image prune -f --filter "until=72h" >/dev/null 2>&1 || true
  exit 0
fi

log "API non saine : retour arrière"
compose logs --tail=80 api || true
if [ -z "$PREVIOUS" ] || [ "$PREVIOUS" = "$NEW_REF" ]; then
  log "aucune version précédente connue : conteneurs laissés en l'état pour diagnostic"
  exit 1
fi
if [ "$MODE" = "pull" ]; then
  export IMAGE_TAG="$PREVIOUS"
  compose pull --quiet
else
  checkout_ref "$PREVIOUS"
  compose build
fi
compose up -d --remove-orphans
log "version précédente relancée : $PREVIOUS (les migrations ne sont pas annulées ; voir docs/runbooks/base-de-donnees.md)"
exit 1
