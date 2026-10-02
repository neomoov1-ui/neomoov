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

# Un seul déploiement à la fois (revue du 2 octobre 2026, constat web 6) : le second attend ou abandonne après 15 minutes.
LOCK_FILE="$ROOT/infra/.deploy.lock"
exec 9>"$LOCK_FILE"
if ! flock -w 900 9; then
  log "un autre déploiement est en cours depuis plus de 15 minutes : abandon"
  exit 3
fi

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
  # Images tierces (Caddy, Redis, ClamAV) mises à jour à chaque déploiement, même en mode construction (constat web 12).
  compose pull --quiet --ignore-buildable || log "images tierces : mise à jour impossible, versions locales conservées"
  compose build --pull
fi

# Version affichée par /v1/health et envoyée à Sentry : le commit déployé (12 caractères).
export APP_VERSION="${NEW_REF:0:12}"

log "migrations"
# Une résolution DNS ou une connexion passagère en échec (EAI_AGAIN vers le pooler Supabase, 2 octobre 2026) ne doit pas
# arrêter un déploiement : trois tentatives espacées, la version en service reste intacte si elles échouent toutes.
migrated=0
for attempt in 1 2 3; do
  if compose run --rm --no-deps api node ../../packages/db/dist/migrate.js; then migrated=1; break; fi
  log "migrations : échec (tentative $attempt sur 3), nouvel essai dans 15 s"
  sleep 15
done
if [ "$migrated" != 1 ]; then
  log "migrations impossibles : déploiement arrêté, version en service intacte"
  exit 1
fi

# Conteneurs remplacés un par un (COMPOSE_PARALLEL_LIMIT=1) : avec deux instances de l'API et les réessais de Caddy,
# une instance répond pendant que l'autre redémarre (constat web 7).
log "démarrage"
COMPOSE_PARALLEL_LIMIT=1 compose up -d --remove-orphans

healthy() {
  local ids status
  ids="$(compose ps -q api)"
  [ -n "$ids" ] || return 1
  for id in $ids; do
    status="$(docker inspect --format '{{.State.Health.Status}}' "$id" 2>/dev/null || echo "inconnu")"
    [ "$status" = "healthy" ] || return 1
  done
  # La version servie doit être celle que l'on déploie : un conteneur sain d'une ancienne version ne compte pas (constat web 5).
  for id in $ids; do
    version="$(docker exec "$id" node -e 'fetch("http://127.0.0.1:4000/v1/health").then(r=>r.json()).then(j=>console.log(j.version||"")).catch(()=>console.log(""))' 2>/dev/null || echo "")"
    [ "$version" = "$APP_VERSION" ] || return 1
  done
  return 0
}

log "vérification de santé et de version (jusqu'à 120 s)"
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
