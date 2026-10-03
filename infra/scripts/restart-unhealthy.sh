#!/usr/bin/env bash
# Relance les conteneurs Neomoov marqués « unhealthy » (Docker Compose ne le fait pas seul). Tâche planifiée du serveur,
# toutes les 5 minutes (root) :
#   */5 * * * * /opt/neomoov/infra/scripts/restart-unhealthy.sh >> /var/log/neomoov-restart.log 2>&1
# Pendant un déploiement (verrou infra/.deploy.lock tenu par deploy.sh jusqu'à la fin de sa vérification de santé), rien
# n'est relancé : un conteneur qui démarre, ou que le retour arrière remplace, n'est pas redémarré sous ses pieds (revue
# du 2 octobre 2026, constat web 23).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec 9>"$ROOT/infra/.deploy.lock"
if ! flock -n 9; then
  printf '[%s] déploiement en cours : aucune relance\n' "$(date -Is)"
  exit 0
fi
for id in $(docker ps -q --filter "label=com.docker.compose.project=neomoov" --filter "health=unhealthy"); do
  name="$(docker inspect --format '{{.Name}}' "$id")"
  printf '[%s] relance de %s (sonde de santé en échec)\n' "$(date -Is)" "${name#/}"
  docker restart "$id" >/dev/null
done
