# Secrets et clés : où ils vivent, qui y accède, rotation

Étape 16 (cahier des charges, section 8 : « Secrets : aucun secret dans le code ni dans les images ; rotation documentée ; accès restreint aux variables de production »). Ce manuel ne contient aucune valeur.

## 1. Où vivent les secrets

| Lieu | Contenu | Accès |
|---|---|---|
| `/opt/neomoov/.env` sur le serveur de production (droits `600`, propriétaire `root`) | Tous les secrets d'exécution : base, Redis, jetons, `ENCRYPTION_KEY`, clés des fournisseurs, `BACKUP_PASSPHRASE` | Fondateur par SSH ; Claude par sa clé SSH déposée, avec l'accord du fondateur |
| Même fichier sur le serveur de staging (quand il existera) | Clés de test des fournisseurs, secrets propres au staging (jamais ceux de la production) | Idem |
| `C:\Users\PC\code\neomoov\.env` (poste) | Développement et tests seulement | Fondateur ; le code le lit, Claude ne l'affiche jamais |
| Bitwarden, dossier `Neomoov` | Copie des secrets irremplaçables (`ENCRYPTION_KEY`, `BACKUP_PASSPHRASE`, anciennes clés encore utiles), mots de passe des comptes, codes de secours | Fondateur |
| `C:\Users\PC\cles-neomoov\` | Fichiers : clé `.p8` d'Apple, JSON du compte de service Google Play, notes du serveur | Fondateur |
| Expo, projet, « Environment variables » | Clés Google Maps iOS et Android lues au build (`GOOGLE_MAPS_IOS_KEY`, `GOOGLE_MAPS_ANDROID_KEY`), identifiant du projet (`EAS_PROJECT_ID`, public), DSN Sentry des mobiles (`EXPO_PUBLIC_SENTRY_DSN`, public) | Fondateur, jeton `EXPO_TOKEN` |
| GitHub, environnement `production` (secrets et variables) | Secrets `DEPLOY_SSH_KEY` (clé privée dédiée au déploiement) et `DEPLOY_KNOWN_HOSTS` ; variable `PRODUCTION_HOST` (et `DEPLOY_USER`, facultative) ; lus par `deploy.yml` après l'approbation du fondateur | Administrateurs du dépôt ; les valeurs des secrets ne se relisent pas |
| GitHub, dépôt (secrets et variables) | Secret `EXPO_TOKEN` (jeton dédié à GitHub, lu par `release.yml`) ; variables publiques `EAS_PROJECT_ID_CLIENT`, `EAS_PROJECT_ID_DRIVER`, `EAS_AUTO_SUBMIT`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT` (`images.yml`) ; le jeton `GITHUB_TOKEN` est fourni par GitHub | Idem |

Liste complète, avec où créer chaque valeur : `docs/operations/acces-a-fournir.md`, section 4.

Vérifier le contenu d'un `.env` sans afficher une valeur : `pnpm env:check` sur le poste (affiche `OK` ou `--` par variable).

Règles : aucune valeur dans le dépôt, un message, un courriel, un ticket ou une capture d'écran ; aucune clé de production sur le poste ; au départ d'une personne qui avait accès, faire tourner ce qu'elle a pu voir ; retirer sa clé SSH du serveur (`/root/.ssh/authorized_keys`, une ligne par clé).

## 2. Procédure générale (clé d'un fournisseur)

1. Créer la nouvelle clé chez le fournisseur, en laissant l'ancienne active.
2. Remplacer la valeur dans `/opt/neomoov/.env` (`nano /opt/neomoov/.env`).
3. Recréer les services qui la lisent : `docker compose -f infra/compose.prod.yml up -d --force-recreate api worker` (ajouter `web` pour `NEOMOOV_PUBLIC_API_KEY`).
4. Vérifier : `curl -s https://api.neomoov.net/v1/health`, puis une action réelle qui utilise la clé (texto de connexion, devis, courriel de test).
5. Révoquer l'ancienne clé chez le fournisseur.
6. Mettre à jour Bitwarden et noter la rotation dans le registre d'exploitation (`docs/operations/daily.md`).

## 3. Particularités par secret

| Variable | Où la refaire | Effet de la rotation, précautions |
|---|---|---|
| `JWT_ACCESS_SECRET` | `openssl rand -hex 32` sur le serveur | Les jetons d'accès (15 minutes) deviennent invalides ; les applications se renouvellent seules avec leur jeton de rafraîchissement (non signé par ce secret) : aucune déconnexion visible |
| `JWT_REFRESH_SECRET` | `openssl rand -hex 32` | Ne signe que les jetons de passage courts (second facteur, liaison Apple ou Google) : une connexion en cours doit être recommencée |
| `ENCRYPTION_KEY` | Section 4 | Lourd : fenêtre de maintenance, réinscription du second facteur du personnel, conséquences sur les factures |
| `DATABASE_URL` (mot de passe) | Supabase, projet, « Database », « Reset database password » | Coupure jusqu'au remplacement dans `.env` : préparer la commande avant de réinitialiser. La sauvegarde de la nuit lit le même fichier |
| `STRIPE_SECRET_KEY` | Stripe, Développeurs, Clés d'API, « Renouveler la clé » (Stripe propose de garder l'ancienne active quelques heures) | Aucune coupure si l'ancienne reste active pendant le remplacement |
| `STRIPE_WEBHOOK_SECRET` | Stripe, Webhooks, le point `…/v1/webhooks/stripe`, « Renouveler le secret » avec expiration différée de l'ancien | Pendant le chevauchement, Stripe signe avec les deux secrets ; l'API accepte toute signature `v1` valide. Un webhook refusé est renvoyé par Stripe |
| `TWILIO_AUTH_TOKEN` | Twilio, Account, « API keys & tokens », jeton secondaire puis « Promote » | Le même jeton a été saisi chez Vapi pour le numéro importé : le mettre à jour aussi chez Vapi |
| `VAPI_API_KEY` | Vapi, Organization, API Keys | Procédure générale |
| `VAPI_WEBHOOK_SECRET` | `openssl rand -hex 16`, puis Vapi, assistant, « Server URL Secret » | Les deux côtés doivent changer ensemble : quelques appels peuvent être refusés pendant la minute du changement ; le faire la nuit |
| `WHATSAPP_TOKEN` | Meta, utilisateurs système, `neomoov-api`, « Générer un nouveau jeton » | Procédure générale |
| `WHATSAPP_APP_SECRET` | Meta, application `Neomoov`, Paramètres, De base, « Réinitialiser » la clé secrète | Signature des webhooks entrants : remplacer tout de suite après la réinitialisation |
| `WHATSAPP_VERIFY_TOKEN` | `openssl rand -hex 16`, puis Meta, WhatsApp, Configuration, Webhook | Ne sert qu'à l'abonnement du webhook |
| `RESEND_API_KEY` | Resend, API Keys | Procédure générale |
| `ANTHROPIC_API_KEY` | Console Anthropic, Clés d'API | Procédure générale |
| `GOOGLE_MAPS_SERVER_KEY` | Google Cloud, Identifiants | Garder les restrictions (API, adresse IP du serveur) sur la nouvelle clé |
| `GOOGLE_MAPS_IOS_KEY`, `GOOGLE_MAPS_ANDROID_KEY` | Google Cloud, puis variables d'environnement du projet Expo | Exigent un nouveau build des applications (`publication-mobile.md`) : la clé est compilée dans l'application |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Supabase, Storage, Settings, S3 Access Keys | Procédure générale (recréer `api` et `worker`, qui lisent tous deux le stockage), puis contrôle par l'ouverture d'un document dans My Hub (**Documents**) ; supprimer l'ancienne clé ensuite. Même chose pour `R2_ACCESS_KEY_ID` et `R2_SECRET_ACCESS_KEY` si Cloudflare R2 est utilisé |
| `TURNSTILE_SECRET_KEY` | Cloudflare, Turnstile, le site, « Rotate secret key » | Procédure générale |
| `NEOMOOV_PUBLIC_API_KEY` (clé de service `nmk_…`) | My Hub, Administration, **Clés de service** (administrateur) : **Créer une clé** (portée `public:write`), puis **Révoquer** l'ancienne ; ou `POST /v1/admin/api-keys` et `DELETE /v1/admin/api-keys/{id}` (`personnel-my-hub.md`, section 5) | Le secret n'est affiché qu'une fois : le copier aussitôt dans `.env`, recréer `web`, puis mettre à jour le site WordPress qui l'utilise avant de révoquer l'ancienne |
| Autres clés de service (agents, métriques `metrics:read`) | Même écran | Procédure générale ; l'écran montre le dernier usage de chaque clé |
| `REVIEW_OTP_CODE` (code fixe des comptes d'examen des magasins) | Choisir un nouveau code de 6 chiffres (ni chiffres répétés, ni `123456`, ni `654321` : refusés au démarrage) | Mettre à jour en même temps les informations de connexion dans App Store Connect et Google Play ; vider `REVIEW_PHONES` et `REVIEW_OTP_CODE` après la publication |
| `BACKUP_PASSPHRASE` | `openssl rand -base64 30` | Les nouvelles sauvegardes utilisent la nouvelle phrase ; garder l'ancienne dans Bitwarden tant qu'une sauvegarde chiffrée avec elle existe (local et copie distante) |
| `EXPO_TOKEN` | expo.dev, organisation, Access tokens | Deux jetons distincts : celui du poste, et le secret du dépôt GitHub (`release.yml`) ; remplacer l'un puis révoquer l'ancien chez Expo |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_SENTRY_DSN` | Sentry, projet, « Client Keys (DSN) » | Publics (ils ne permettent que d'envoyer des événements) : rotation seulement en cas d'abus. Le DSN du web exige un nouveau build (`infra/deploy.sh build`), celui des mobiles un nouveau build ou une mise à jour à la volée |
| `BETTERSTACK_HEARTBEAT_URL` | Better Stack, moniteur du worker | Procédure générale ; recréer `worker` |
| Mots de passe et second facteur du personnel | `personnel-my-hub.md` | |
| Clé SSH d'accès au serveur | `/root/.ssh/authorized_keys` | Ajouter la nouvelle clé, vérifier la connexion, retirer l'ancienne ligne |
| Clé SSH de déploiement de GitHub (`DEPLOY_SSH_KEY`) | Nouvelle paire sur le poste (`ssh-keygen -t ed25519 -N "" -C github-deploy-neomoov -f deploy_neomoov`) | Ajouter la nouvelle clé publique à `/root/.ssh/authorized_keys`, remplacer le secret de l'environnement `production` par la nouvelle clé privée, lancer un déploiement, retirer l'ancienne ligne du serveur, supprimer le fichier privé du poste. Au départ d'un administrateur du dépôt, faire tourner cette clé |
| `DEPLOY_KNOWN_HOSTS` | `ssh-keyscan -t ed25519 <adresse IP du VPS>` | Seulement si la clé d'hôte du serveur change (réinstallation, migration) : sinon le déploiement échoue sur un hôte inconnu |

## 4. Rotation de `ENCRYPTION_KEY`

Décision « Chiffrement applicatif des champs sensibles » (26 septembre 2026). `ENCRYPTION_KEY` sert à la fois :

- au chiffrement AES-256-GCM des champs sensibles (numéros de TPS et TVQ des chauffeurs, numéros de leurs documents, numéro extrait par l'agent recrutement), par une clé dérivée ;
- au chiffrement du secret du second facteur (TOTP) du personnel de My Hub ;
- à l'empreinte des codes SMS en cours de validité (5 minutes) ;
- à la signature des codes QR de vérification des factures, par une clé dérivée ;
- aux pseudonymes de l'export mensuel de géolocalisation, par une clé dérivée.

### À savoir avant de décider

- **Codes QR des factures et pseudonymes de géolocalisation** : ils dérivent de `DERIVATION_KEY` si elle existe, sinon d'`ENCRYPTION_KEY`. Pour les garder valides, poser `DERIVATION_KEY` égale à l'**ancienne** `ENCRYPTION_KEY` avant la rotation (étape 5 ci-dessous) : les codes QR des factures déjà émises continuent de fonctionner et un chauffeur garde le même pseudonyme. Sans cela, la vérification publique des factures antérieures est perdue et les pseudonymes changent.
- Les sauvegardes antérieures contiennent des champs chiffrés avec l'ancienne clé : garder l'ancienne clé dans Bitwarden tant que ces sauvegardes existent.
- En conséquence : **ne faire tourner cette clé que sur soupçon de compromission**, pas par calendrier, et d'abord sur staging.

### Déroulé (fenêtre de 30 minutes, la nuit, hors de 3 h à 4 h où tournent la conservation et la sauvegarde)

Prérequis : aucune course en cours ni réservée dans la fenêtre (My Hub, **Courses**) ; annonce aux chauffeurs actifs.

1. Copier la valeur actuelle dans Bitwarden (élément « ENCRYPTION_KEY, ancienne, remplacée le AAAA-MM-JJ »), sur son propre écran :

```
ssh root@<adresse IP du VPS>
cd /opt/neomoov
grep '^ENCRYPTION_KEY=' .env
```

2. Sauvegarde fraîche :

```
set -a; . ./.env; set +a; infra/scripts/backup.sh
```

3. Arrêter l'API et le worker (le web affichera des erreurs pendant la fenêtre) :

```
docker compose -f infra/compose.prod.yml stop api worker
```

4. Remettre les champs en clair avec l'**ancienne** clé et noter les deux nombres affichés :

```
docker compose -f infra/compose.prod.yml run --rm --no-deps api node dist/scripts/encrypt-fields.js --decrypt
```

5. Garder l'ancienne clé pour les dérivations durables (une seule fois : si `DERIVATION_KEY` existe déjà, ne pas y toucher), puis remplacer la clé sans l'afficher :

```
grep -q '^DERIVATION_KEY=.' .env || sed -n 's/^ENCRYPTION_KEY=/DERIVATION_KEY=/p' .env >> .env
NEW_KEY=$(openssl rand -hex 32)
sed -i "s/^ENCRYPTION_KEY=.*/ENCRYPTION_KEY=${NEW_KEY}/" /opt/neomoov/.env
unset NEW_KEY
```

6. Rechiffrer avec la **nouvelle** clé ; les deux nombres doivent être égaux à ceux de l'étape 4 :

```
docker compose -f infra/compose.prod.yml run --rm --no-deps api node dist/scripts/encrypt-fields.js
```

7. Redémarrer : `docker compose -f infra/compose.prod.yml up -d --force-recreate api worker`, puis vérifier `/v1/health`.
8. Copier la nouvelle valeur dans Bitwarden (`grep '^ENCRYPTION_KEY=' .env`, sur son propre écran).
9. Second facteur du personnel : les secrets TOTP chiffrés avec l'ancienne clé sont illisibles. Réinitialiser toutes les inscriptions, dans Supabase, projet de production, « SQL Editor » :

```
UPDATE staff_credentials
SET totp_secret_encrypted = NULL, totp_pending_secret_encrypted = NULL, totp_enabled_at = NULL,
    backup_code_hashes = '[]'::jsonb, failed_attempts = 0, locked_until = NULL;
```

C'est l'équivalent de « réinitialiser le second facteur » pour chaque membre (My Hub, **Équipe**, **Réinitialiser le second facteur** ; ou `POST /v1/admin/staff/{id}/mfa/reset`). À la connexion suivante, chacun saisit son mot de passe, scanne le nouveau code QR et range ses dix nouveaux codes de secours (`personnel-my-hub.md`, section 2). Supprimer l'ancienne entrée « Neomoov My Hub » de l'application d'authentification.
10. Contrôles : ouvrir la fiche d'un chauffeur dans My Hub (numéros de TPS et TVQ masqués mais présents), vérifier une facture récente sur `/verifier-facture` (voir la limite ci-dessus), se connecter par code SMS dans une application.
11. Noter la rotation au registre d'exploitation ; supprimer l'ancienne clé de Bitwarden quand la dernière sauvegarde qui en dépend a expiré.

Retour arrière si l'étape 6 échoue : remettre l'ancienne valeur dans `.env` (depuis Bitwarden), relancer l'étape 6 (rechiffrement avec l'ancienne clé), redémarrer.
