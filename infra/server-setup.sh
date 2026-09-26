#!/usr/bin/env bash
# Préparation du VPS LWS (Ubuntu 24.04 ou Debian 12+), à exécuter une seule fois en root, après avoir déposé la clé
# SSH du poste dans /root/.ssh/authorized_keys :
#   ssh root@<ip> 'bash -s' < infra/server-setup.sh
# Fait : mises à jour, Docker et Compose, pare-feu (22, 80, 443), fail2ban, mises à jour automatiques, SSH par clé
# seulement, fuseau America/Toronto, mémoire d'échange, dépôt Git de déploiement (/opt/neomoov.git → /opt/neomoov),
# fichier .env de production avec des secrets générés (les clés externes restent à remplir).
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

log() { printf '\n== %s ==\n' "$*"; }

log "paquets"
apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl git ufw fail2ban unattended-upgrades openssl

log "Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker
docker compose version

log "pare-feu"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

log "fail2ban (SSH)"
cat > /etc/fail2ban/jail.d/sshd.local <<'EOF'
[sshd]
enabled = true
maxretry = 5
findtime = 10m
bantime = 1h
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

log "mises à jour automatiques de sécurité"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

log "SSH : clé seulement (si une clé est déjà déposée)"
if [ -s /root/.ssh/authorized_keys ]; then
  cat > /etc/ssh/sshd_config.d/90-neomoov.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
MaxAuthTries 4
EOF
  systemctl reload ssh 2>/dev/null || systemctl reload sshd
else
  echo "ATTENTION : /root/.ssh/authorized_keys vide, connexion par mot de passe conservée"
fi

log "fuseau horaire et mémoire d'échange"
timedatectl set-timezone America/Toronto || true
if ! swapon --show | grep -q '^'; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

log "dépôt de déploiement"
install -d /opt/neomoov /opt/neomoov/infra
if [ ! -d /opt/neomoov.git ]; then
  git init --bare --quiet -b main /opt/neomoov.git
fi
cat > /opt/neomoov.git/hooks/post-receive <<'EOF'
#!/usr/bin/env bash
# Chaque `git push lws main` depuis le poste déploie : extraction dans /opt/neomoov puis infra/deploy.sh.
set -euo pipefail
while read -r oldrev newrev ref; do
  [ "$ref" = "refs/heads/main" ] || continue
  git --git-dir=/opt/neomoov.git --work-tree=/opt/neomoov checkout -f --quiet main
  chmod +x /opt/neomoov/infra/deploy.sh
  GIT_DIR=/opt/neomoov.git /opt/neomoov/infra/deploy.sh build "$newrev" "$oldrev"
done
EOF
chmod +x /opt/neomoov.git/hooks/post-receive

log "relance automatique des conteneurs malades (toutes les 5 minutes)"
cat > /etc/cron.d/neomoov-restart-unhealthy <<'EOF'
*/5 * * * * root [ -x /opt/neomoov/infra/scripts/restart-unhealthy.sh ] && /opt/neomoov/infra/scripts/restart-unhealthy.sh >> /var/log/neomoov-restart.log 2>&1
EOF
chmod 644 /etc/cron.d/neomoov-restart-unhealthy

log "fichier .env de production"
if [ ! -f /opt/neomoov/.env ]; then
  cat > /opt/neomoov/.env <<EOF
# Production Neomoov (VPS LWS). Jamais dans Git. Compléter DATABASE_URL puis les clés au fur et à mesure.
NODE_ENV=production
APP_BASE_URL=https://api.neomoov.net
WEB_BASE_URL=https://hub.neomoov.net
CORS_ORIGINS=https://hub.neomoov.net,https://reserver.neomoov.net
NEXT_PUBLIC_API_BASE_URL=https://api.neomoov.net
LOG_LEVEL=info
TIMEZONE=America/Toronto
DATABASE_URL=
JWT_ACCESS_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
PAYMENT_PROVIDER=mock
MAPS_PROVIDER=mock
SMS_PROVIDER=mock
EMAIL_PROVIDER=mock
PUSH_PROVIDER=mock
WHATSAPP_PROVIDER=mock
VOICE_PROVIDER=mock
LLM_PROVIDER=mock
SEV_PROVIDER=mock
STORAGE_PROVIDER=mock
# Connexion Apple et Google : jamais le mode simule en production (refuse au demarrage) ; audiences a remplir.
SOCIAL_LOGIN_PROVIDER=real
APPLE_CLIENT_IDS=
GOOGLE_CLIENT_IDS=
IMAGE_PREFIX=neomoov
EOF
  chmod 600 /opt/neomoov/.env
  echo "/opt/neomoov/.env créé avec des secrets générés ; DATABASE_URL à remplir"
else
  echo "/opt/neomoov/.env existe, conservé"
fi

log "terminé"
docker --version
ufw status | head -3
