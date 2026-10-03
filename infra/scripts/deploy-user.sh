#!/usr/bin/env bash
# Utilisateur de déploiement non root (revue du 2 octobre 2026, constat web 16). À lancer UNE fois, en root, sur le
# serveur, quand le fondateur le décide (docs/runbooks/utilisateur-deploiement.md) ; le déploiement actuel par root
# continue de fonctionner tant que la variable GitHub DEPLOY_USER et le dépôt distant du poste ne sont pas changés.
#   infra/scripts/deploy-user.sh /root/cle-deploiement-github.pub [/root/cle-poste-fondateur.pub]
# Fait : utilisateur système `deploy` dont le shell est git-shell (la clé ne sert qu'à pousser, aucun terminal), clés
# publiques avec l'option `restrict` (ni redirection de port, ni agent, ni pseudo-terminal), membre du groupe docker
# (nécessaire à infra/deploy.sh : ce groupe équivaut à root sur l'hôte, le gain est l'absence de shell et de connexion
# root depuis GitHub), propriétaire du dépôt nu et de l'arbre de déploiement, lecture seule de .env (groupe deploy).
# Les tâches planifiées (sauvegarde, essai de restauration, relance des conteneurs) restent en root. Rejouable.
set -euo pipefail

GITHUB_KEY="${1:?Clé publique de déploiement de GitHub attendue (fichier .pub)}"
FOUNDER_KEY="${2:-}"
USER_NAME="deploy"
REPO=/opt/neomoov.git
TREE=/opt/neomoov

[ "$(id -u)" = 0 ] || { echo "À lancer en root" >&2; exit 1; }
for key in "$GITHUB_KEY" ${FOUNDER_KEY:+"$FOUNDER_KEY"}; do
  [ -f "$key" ] || { echo "Fichier absent : $key" >&2; exit 1; }
  grep -qE '^(ssh-ed25519|ssh-rsa|ecdsa-sha2-[a-z0-9-]+) [A-Za-z0-9+/=]+' "$key" || { echo "Clé publique illisible : $key" >&2; exit 1; }
done
[ -d "$REPO" ] && [ -d "$TREE" ] || { echo "Serveur non préparé (infra/server-setup.sh d'abord)" >&2; exit 1; }

GIT_SHELL="$(command -v git-shell)"
grep -qx "$GIT_SHELL" /etc/shells || echo "$GIT_SHELL" >> /etc/shells

if ! id "$USER_NAME" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "/home/$USER_NAME" --shell "$GIT_SHELL" "$USER_NAME"
fi
usermod --shell "$GIT_SHELL" "$USER_NAME"
usermod -aG docker "$USER_NAME"

install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" "/home/$USER_NAME/.ssh"
{
  for key in "$GITHUB_KEY" ${FOUNDER_KEY:+"$FOUNDER_KEY"}; do
    printf 'restrict %s\n' "$(head -n 1 "$key")"
  done
} > "/home/$USER_NAME/.ssh/authorized_keys"
chown "$USER_NAME:$USER_NAME" "/home/$USER_NAME/.ssh/authorized_keys"
chmod 600 "/home/$USER_NAME/.ssh/authorized_keys"

# Dépôt nu et arbre de déploiement au nom de deploy ; .env lisible par le groupe deploy, jamais modifiable par lui.
chown -R "$USER_NAME:$USER_NAME" "$REPO" "$TREE"
if [ -f "$TREE/.env" ]; then
  chown "root:$USER_NAME" "$TREE/.env"
  chmod 640 "$TREE/.env"
fi
# Le crochet reste au nom de root, non modifiable par deploy (seul git-receive-pack le déclenche).
chown root:root "$REPO/hooks/post-receive"
chmod 755 "$REPO/hooks/post-receive"
# root lit encore les dépôts (retour arrière à la main, deploy.sh lancé par root) malgré le changement de propriétaire.
git config --system --get-all safe.directory | grep -qx "$REPO" || git config --system --add safe.directory "$REPO"
git config --system --get-all safe.directory | grep -qx "$TREE" || git config --system --add safe.directory "$TREE"

echo "Utilisateur $USER_NAME prêt. Essai depuis le poste : git push ssh://$USER_NAME@<ip>/opt/neomoov.git main"
echo "Puis : variable GitHub DEPLOY_USER=$USER_NAME (environnements production et staging), et retrait de la clé de GitHub de /root/.ssh/authorized_keys."
