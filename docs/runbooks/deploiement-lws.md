# Déploiement sur le VPS LWS

Décision D48 du 24 septembre 2026. Un serveur VPS KVM chez LWS (Ubuntu 24.04, Docker), Caddy pour le TLS, deux instances de l'API, un worker, le web, Redis. La base reste chez Supabase (Canada central). Rien ici ne contient de secret.

## 1. DNS (une fois, panel LWS, domaine neomoov.net, zone DNS)

| Type | Nom | Valeur |
|---|---|---|
| A | `api` | adresse IP du VPS |
| A | `hub` | adresse IP du VPS |
| A | `reserver` | adresse IP du VPS |

Le site vitrine `neomoov.net` (WordPress, hébergement mutualisé) ne change pas. Vérifier : `nslookup api.neomoov.net`.

## 2. Préparer le serveur (une fois)

Depuis le poste, après avoir déposé la clé publique SSH dans `/root/.ssh/authorized_keys` du serveur :

```
ssh root@<ip> 'bash -s' < infra/server-setup.sh
```

Le script installe Docker, le pare-feu (22, 80, 443), fail2ban, les mises à jour automatiques, passe SSH en clé seulement, crée le dépôt de déploiement `/opt/neomoov.git` (crochet `post-receive`), `/opt/neomoov/.env` avec des secrets générés, et deux tâches planifiées : la sauvegarde quotidienne chiffrée (`/etc/cron.d/neomoov-backup`, 3 h 30, active dès que `BACKUP_PASSPHRASE` est dans `.env`, `sauvegardes.md`) et la relance des conteneurs malades (`/etc/cron.d/neomoov-restart-unhealthy`, toutes les 5 minutes, `redemarrer-un-service.md`).

Puis compléter `/opt/neomoov/.env` sur le serveur :

- `DATABASE_URL` (Supabase, session pooler, projet de production) ;
- `BACKUP_PASSPHRASE` (`openssl rand -base64 30`, copie dans Bitwarden) ;
- `ALLOW_MOCK_PROVIDERS` : le fichier créé met les fournisseurs à `mock`, et l'API refuse de démarrer en production avec un fournisseur simulé non déclaré. Pour un premier démarrage technique sans clé : `ALLOW_MOCK_PROVIDERS=payment,maps,sms,email,push,whatsapp,voice,llm,sev,storage,antivirus` ; ensuite, chaque fournisseur passe à `real` avec ses clés et son nom sort de la liste (bêta proposée : `payment,sev,whatsapp,voice`). Détail : `docs/operations/acces-a-fournir.md`, « Démarrage de l'API en production ».

Si l'API ne démarre pas après un changement de `.env`, le motif est dans son journal : `docker compose -f infra/compose.prod.yml logs --tail=50 api` (« Configuration invalide… » nomme la variable à corriger).

## 3. Déployer (à chaque version)

Depuis le poste, une fois pour ajouter le dépôt distant :

```
git remote add lws ssh://root@<ip>/opt/neomoov.git
```

Puis à chaque déploiement :

```
git push lws main
```

Le crochet extrait le code dans `/opt/neomoov` et lance `infra/deploy.sh build`, qui : construit les trois images sur le serveur, applique les migrations (une seule fois, hors des instances), démarre les conteneurs, attend que les deux instances de l'API soient saines (120 s au plus), et revient automatiquement à la version précédente si ce n'est pas le cas.

Variante avec images publiées par GitHub Actions sur GHCR (`.github/workflows/images.yml`) : sur le serveur, `docker login ghcr.io` avec un jeton de lecture des paquets, `IMAGE_PREFIX=ghcr.io/neomoov1-ui/neomoov` dans `.env`, puis `infra/deploy.sh pull <sha>`. Les images du web publiées ainsi reçoivent la clé Turnstile et le DSN Sentry des variables GitHub, pas de `/opt/neomoov/.env` (`docs/operations/acces-a-fournir.md`, section 4). Avec cette voie, avant toute commande `docker compose` tapée à la main (qui ne lit pas `.env` pour choisir les images), taper `set -a; . ./.env; set +a; export IMAGE_TAG=$(cat infra/.deploy-state)` dans `/opt/neomoov` : sinon Compose cherche les images `neomoov-*:local` et les reconstruit.

### Par GitHub Actions (`.github/workflows/deploy.yml`)

Même chemin que depuis le poste : le workflow pousse la version dans `/opt/neomoov.git`, dont le crochet lance `infra/deploy.sh build` (migrations, démarrage, santé, retour arrière automatique).

Prérequis, une fois (détail : `docs/operations/acces-a-fournir.md`, section 4) : environnement GitHub `production` avec le fondateur comme approbateur ; dans cet environnement, les secrets `DEPLOY_SSH_KEY` (clé privée dédiée, sa clé publique dans `/root/.ssh/authorized_keys` du serveur) et `DEPLOY_KNOWN_HOSTS`, et la variable `PRODUCTION_HOST`.

À chaque version :

1. La version est sur `main` et son intégration continue est verte (le workflow le vérifie et refuse sinon).
2. GitHub, onglet « Actions », workflow « Déploiement », « Run workflow » : saisir le `sha` complet du commit (`git rev-parse origin/main` sur le poste).
3. Approuver le travail « Production » (« Review deployments »).
4. Le travail se termine par la santé de `https://api.neomoov.net/v1/health` ; le journal du serveur reste lisible par `ssh` (section 5).

Préproduction : automatique à chaque poussée sur `main`, seulement si la variable `STAGING_HOST` existe (aucun serveur de staging en V1).

## 4. Vérifier

```
curl -s https://api.neomoov.net/v1/health
curl -sI https://hub.neomoov.net | head -1
ssh root@<ip> 'cd /opt/neomoov && docker compose -f infra/compose.prod.yml ps'
```

## 5. Journaux et opérations courantes

```
ssh root@<ip>
cd /opt/neomoov
docker compose -f infra/compose.prod.yml logs -f --tail=200 api
docker compose -f infra/compose.prod.yml logs -f --tail=200 worker
docker compose -f infra/compose.prod.yml restart api
docker compose -f infra/compose.prod.yml run --rm --no-deps api node ../../packages/db/dist/seed/index.js   # données de départ, une fois
```

Les données de départ lancées depuis l'image chargent aussi les prompts des agents (`docs/agents`, copié dans l'image de l'API depuis le 26 septembre 2026) ; en production, elles ne créent aucun compte de démonstration (`base-de-donnees.md`, section 4).

## 6. Retour arrière manuel

```
cd /opt/neomoov
git --git-dir=/opt/neomoov.git --work-tree=/opt/neomoov checkout -f <ref précédente>
GIT_DIR=/opt/neomoov.git infra/deploy.sh build <ref précédente>
```

Par GitHub Actions : relancer le workflow « Déploiement » avec le `sha` de la version précédente (elle est sur `main` et son intégration continue était verte).

Les migrations ne sont pas annulées automatiquement : `pnpm db:rollback` depuis le poste (avec la `DATABASE_URL` de production) si une migration doit être retirée.

## 7. Résidence des données

Les centres de données LWS sont en France. La base et les documents restent au Canada (Supabase). La résidence des serveurs applicatifs est une décision à prendre avec l'avocat avant le lancement commercial (section 10.3 du cahier des charges) ; `infra/compose.prod.yml` fonctionne à l'identique sur un hôte canadien (OVHcloud Beauharnois, AWS ou Google Cloud Montréal) : mêmes étapes 2 et 3.
