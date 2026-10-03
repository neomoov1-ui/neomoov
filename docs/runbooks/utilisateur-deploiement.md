# Utilisateur de déploiement non root

Revue du 2 octobre 2026, constat web 16 : aujourd'hui, GitHub Actions et le poste déploient en se connectant au serveur en `root` (`git push` vers `/opt/neomoov.git`). Ce manuel remplace cette connexion par un utilisateur `deploy` dont la clé ne sert qu'à pousser. Rien n'est changé tant que le fondateur ne lance pas les étapes ci-dessous ; le déploiement actuel reste valable jusque-là. Aucun secret ici.

## Ce que l'on gagne, ce qui ne change pas

- La clé de GitHub (`DEPLOY_SSH_KEY`) n'ouvre plus de terminal `root` : le shell de `deploy` est `git-shell` (seulement `git push` et `git fetch`), et chaque clé porte l'option `restrict` (ni redirection de port, ni agent, ni pseudo-terminal).
- `deploy` est membre du groupe `docker`, nécessaire à `infra/deploy.sh` (construction, migrations, démarrage). Ce groupe équivaut à `root` sur l'hôte : une personne qui pousse du code peut toujours tout faire sur le serveur, comme aujourd'hui. Le gain porte sur la clé elle-même (aucun shell, aucune connexion `root` depuis GitHub, journal SSH distinct), pas sur le contenu déployé.
- Aucun `sudo` n'est donné à `deploy`. Les tâches planifiées (sauvegarde, essai de restauration, relance des conteneurs) restent en `root`. `/opt/neomoov/.env` reste au nom de `root`, lisible par le groupe `deploy` (lecture nécessaire au déploiement), jamais modifiable par lui.

## Mise en place (une fois, 15 minutes)

1. Sur le poste, créer une clé dédiée à GitHub si ce n'est pas déjà fait (`ssh-keygen -t ed25519 -f neomoov-deploy -C github-deploy`), puis copier la **clé publique** (`neomoov-deploy.pub`) et celle du poste du fondateur sur le serveur, par exemple dans `/root/` (`scp neomoov-deploy.pub root@<ip>:/root/`).
2. Sur le serveur, en `root`, depuis `/opt/neomoov` :

   ```
   infra/scripts/deploy-user.sh /root/neomoov-deploy.pub /root/id_ed25519.pub
   ```

   Le script crée `deploy`, pose les clés avec `restrict`, donne le dépôt nu et l'arbre de déploiement à `deploy`, passe `.env` en `root:deploy` 640, garde le crochet `post-receive` au nom de `root` et déclare les deux dépôts sûrs pour `root` (retour arrière à la main). Il se relance sans effet de bord.
3. Essai depuis le poste, sans rien changer d'autre : `git push ssh://deploy@<ip>/opt/neomoov.git main`. Le crochet doit déployer comme avant (`[deploy …] déployé : <sha>`). Vérifier aussi qu'un terminal est refusé : `ssh deploy@<ip>` doit répondre « fatal: Interactive git shell is not enabled ».
4. Basculer :
   - poste : `git remote set-url lws ssh://deploy@<ip>/opt/neomoov.git` ;
   - GitHub, environnements `production` et `staging` : variable `DEPLOY_USER` = `deploy` (le workflow `deploy.yml` la lit déjà ; absente, il garde `root`) ; le secret `DEPLOY_SSH_KEY` ne change pas si la même clé est utilisée.
5. Lancer un déploiement par GitHub Actions et vérifier qu'il finit en vert.
6. Retirer la clé de GitHub de `/root/.ssh/authorized_keys` (garder celle du fondateur pour l'administration).

## Revenir en arrière

Supprimer la variable `DEPLOY_USER` dans GitHub et remettre `ssh://root@<ip>/opt/neomoov.git` comme dépôt distant du poste (la clé de GitHub doit alors être de nouveau dans `/root/.ssh/authorized_keys`). Les fichiers au nom de `deploy` ne gênent pas un déploiement par `root`.

## Pièges

- Une clé publique qui contient déjà des options (`from=…`) n'est pas lue : passer le fichier `.pub` brut.
- Après un `git clone` manuel ou un `git checkout` lancé en `root` dans `/opt/neomoov`, des fichiers peuvent repasser au nom de `root` : relancer `infra/scripts/deploy-user.sh` (sans effet sur le reste).
- `infra/.deploy.lock` est partagé par `deploy.sh` (utilisateur `deploy`) et `restart-unhealthy.sh` (`root`) : le script le donne à `deploy`, `root` peut toujours l'ouvrir.
