#!/usr/bin/env bash
# Relance les conteneurs Neomoov marqués « unhealthy » (Docker Compose ne le fait pas seul). Tâche planifiée du serveur,
# toutes les 5 minutes (root) :
#   */5 * * * * /opt/neomoov/infra/scripts/restart-unhealthy.sh >> /var/log/neomoov-restart.log 2>&1
set -euo pipefail
for id in $(docker ps -q --filter "label=com.docker.compose.project=neomoov" --filter "health=unhealthy"); do
  name="$(docker inspect --format '{{.Name}}' "$id")"
  printf '[%s] relance de %s (sonde de santé en échec)\n' "$(date -Is)" "${name#/}"
  docker restart "$id" >/dev/null
done
