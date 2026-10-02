#!/usr/bin/env bash
# Pose une variable dans le fichier .env du serveur sans jamais afficher sa valeur, puis (option) recrée les services
# qui la lisent. Usage, depuis le poste (la clé SSH est déjà sur le poste) :
#   ssh -t root@<ip> /opt/neomoov/infra/scripts/env-set.sh TWILIO_ACCOUNT_SID                # demande la valeur, saisie masquée
#   ssh -t root@<ip> /opt/neomoov/infra/scripts/env-set.sh TWILIO_FROM_NUMBER --recreate api worker
#   ssh -t root@<ip> /opt/neomoov/infra/scripts/env-set.sh VAPI_WEBHOOK_SECRET --generate       # 32 caractères aléatoires
#   ssh -t root@<ip> /opt/neomoov/infra/scripts/env-set.sh NEXT_PUBLIC_SENTRY_DSN --build        # variable figée dans l'image du web
#   printf '%s\n' "$valeur" | ssh root@<ip> /opt/neomoov/infra/scripts/env-set.sh NOM            # valeur lue sur l'entrée standard
# La valeur peut contenir n'importe quel caractère sauf un saut de ligne. Le fichier garde les droits 600.
set -euo pipefail

file=/opt/neomoov/.env
name=''
generate=0
build=0
recreate=()
while [ $# -gt 0 ]; do
  case "$1" in
    --file) file=$2; shift 2 ;;
    --generate) generate=1; shift ;;
    --build) build=1; shift ;;
    --recreate)
      shift
      while [ $# -gt 0 ] && [[ "$1" != --* ]]; do recreate+=("$1"); shift; done
      ;;
    --*) echo "option inconnue : $1" >&2; exit 2 ;;
    *) name=$1; shift ;;
  esac
done
if ! [[ "$name" =~ ^[A-Z_][A-Z0-9_]*$ ]]; then
  echo "usage : env-set.sh NOM_DE_VARIABLE [--generate] [--recreate api worker web] [--build] [--file chemin]" >&2
  exit 2
fi
[ -f "$file" ] || { echo "fichier introuvable : $file" >&2; exit 2; }

if [ "$generate" = 1 ]; then
  value=$(openssl rand -hex 16)
elif [ -t 0 ]; then
  read -rs -p "Valeur de $name (rien ne s'affiche ; Entrée pour terminer) : " value
  echo >&2
else
  IFS= read -r value || true
fi
value=${value%$'\r'}
if [ -z "$value" ]; then
  echo "valeur vide : $file n'est pas modifié" >&2
  exit 3
fi

# Remplacement de la ligne NOM=… (ou ajout en fin de fichier) par awk, la valeur passée par l'environnement : aucun
# caractère n'est interprété, rien n'apparaît dans la liste des processus.
export NEOMOOV_ENV_VALUE="$value"
tmp=$(mktemp "${file}.XXXXXX")
awk -v key="$name" '
  BEGIN { v = ENVIRON["NEOMOOV_ENV_VALUE"]; done = 0 }
  index($0, key "=") == 1 { if (!done) { print key "=" v; done = 1 } ; next }
  { print }
  END { if (!done) print key "=" v }
' "$file" > "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$file"
unset NEOMOOV_ENV_VALUE
echo "$name : posée dans $file (${#value} caractères, valeur non affichée)."

if [ "${#recreate[@]}" -gt 0 ]; then
  cd "$(dirname "$file")"
  # Même environnement que infra/deploy.sh : variables du .env (le web reçoit les siennes par interpolation), préfixe et
  # étiquette des images en cours (celle du conteneur de l'API qui tourne), version affichée par /v1/health.
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
  export IMAGE_PREFIX="${IMAGE_PREFIX:-neomoov}"
  running="$(docker ps --filter "label=com.docker.compose.project=neomoov" --filter "label=com.docker.compose.service=api" --format '{{.Image}}' | head -1)"
  export IMAGE_TAG="${running##*:}"
  [ -n "$IMAGE_TAG" ] && [ "$IMAGE_TAG" != "$running" ] || export IMAGE_TAG="local"
  export APP_VERSION="$(cut -c1-12 infra/.deploy-state 2>/dev/null || true)"
  echo "Recréation : ${recreate[*]} (images ${IMAGE_PREFIX}-*:${IMAGE_TAG})…"
  COMPOSE_PARALLEL_LIMIT=1 docker compose -f infra/compose.prod.yml up -d --force-recreate --no-deps "${recreate[@]}"
  for _ in $(seq 1 12); do
    if curl -fsS -m 10 https://api.neomoov.net/v1/health >/dev/null 2>&1; then echo "API saine."; exit 0; fi
    sleep 5
  done
  echo "ATTENTION : /v1/health ne répond pas encore ; vérifier dans une minute : docker compose -f infra/compose.prod.yml logs --tail=50 api" >&2
  exit 4
fi
if [ "$build" = 1 ]; then
  cd "$(dirname "$file")"
  chmod +x infra/deploy.sh
  GIT_DIR=/opt/neomoov.git infra/deploy.sh build
fi
