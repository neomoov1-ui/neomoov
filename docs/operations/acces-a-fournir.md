# Accès à fournir pour la mise en ligne

Étape 16, mis à jour à la revue finale de la V1 (étape 17, 26 septembre 2026) pour correspondre au code. Liste exacte, par service, de ce que le fondateur doit ouvrir, créer ou fournir pour mettre la V1 en ligne (bêta puis lancement). Construite à partir de `.env.example`, du schéma de configuration de l'API (`apps/api/src/config/env.ts`), de `infra/` (préparation du serveur, composition, déploiement), des workflows `.github/workflows/` et de `docs/cles-comptes-externes.md` (qui dit où cliquer, compte par compte). Aucune valeur ici.

État : « au 25 septembre » renvoie au bilan de `docs/cles-comptes-externes.md` ; tout est à revérifier au moment de la mise en ligne.

## Où déposer une valeur

| Lieu | Contenu | Prise en compte |
|---|---|---|
| `/opt/neomoov/.env` sur le serveur (`nano /opt/neomoov/.env`, une ligne `NOM=valeur`) | Toutes les clés de production de l'API, du worker et du web | `docker compose -f infra/compose.prod.yml up -d --force-recreate api worker` (ajouter `web` pour `NEOMOOV_PUBLIC_API_KEY`), `docs/runbooks/redemarrer-un-service.md`, section 7. Les variables `NEXT_PUBLIC_*` sont figées dans l'image du web : `cd /opt/neomoov && infra/deploy.sh build` (le script relit `.env`) |
| GitHub, dépôt `neomoov1-ui/neomoov`, « Settings », « Secrets and variables », « Actions » (onglets « Secrets » et « Variables ») | Secrets et variables du dépôt, lus par `release.yml` et `images.yml` | Au prochain lancement du workflow |
| GitHub, « Settings », « Environments », `production` | Secrets et variables de l'environnement, lus seulement par le travail de déploiement qui l'utilise (`deploy.yml`), après approbation | Au prochain déploiement |
| Expo, projet EAS de chaque application, « Environment variables » (ou `npx eas-cli@latest env:create`) | Variables lues au build sur les serveurs d'Expo | Au prochain build (une clé compilée exige un nouveau build) |
| `C:\Users\PC\code\neomoov\.env` (poste) | Clés de test et de développement seulement ; bilan sans affichage par `pnpm env:check` | Au prochain lancement local |
| `C:\Users\PC\cles-neomoov\` (poste) | Fichiers : clé `.p8` d'Apple, JSON du compte de service Google Play, notes du serveur | |
| My Hub, Administration, **Paramètres** | Réglages non secrets (assistance, dénomination, numéros de taxes, numéros d'alerte) | Une minute au plus |
| Bitwarden, dossier `Neomoov` | Copie des secrets irremplaçables (`ENCRYPTION_KEY`, `BACKUP_PASSPHRASE`), mots de passe des comptes | |

Jamais une valeur dans le dépôt, un message, un courriel ou une capture d'écran.

## Démarrage de l'API en production : fournisseurs réels ou simulés déclarés

Chaque fournisseur a une variable `<SERVICE>_PROVIDER` qui vaut `mock` (simulé) par défaut, ou `real`. En production (`NODE_ENV=production`), `apps/api/src/config/env.ts` refuse de démarrer :

- si un fournisseur est en `real` sans sa clé (message `PROVIDER_NOT_CONFIGURED` qui nomme la variable manquante) ;
- si un fournisseur est laissé en `mock` sans être déclaré, par son nom court, dans `ALLOW_MOCK_PROVIDERS` (liste séparée par des virgules). Le message nomme les variables à corriger.

| Variable | Nom court dans `ALLOW_MOCK_PROVIDERS` | Proposition pour la bêta |
|---|---|---|
| `PAYMENT_PROVIDER` | `payment` | Simulé (bêta en paiement au chauffeur, section 9) |
| `MAPS_PROVIDER` | `maps` | Réel |
| `SMS_PROVIDER` | `sms` | Réel (sans lui, personne ne se connecte) |
| `EMAIL_PROVIDER` | `email` | Réel |
| `PUSH_PROVIDER` | `push` | Réel |
| `WHATSAPP_PROVIDER` | `whatsapp` | Simulé |
| `VOICE_PROVIDER` | `voice` | Simulé |
| `LLM_PROVIDER` | `llm` | Réel |
| `SEV_PROVIDER` | `sev` | Simulé pendant toute la V1 : l'adaptateur réel n'est pas écrit (section 15) |
| `STORAGE_PROVIDER` | `storage` | Réel |
| `VIRUS_SCANNER_PROVIDER` | `antivirus` | Réel (section 12) |

Soit, pour la bêta : `ALLOW_MOCK_PROVIDERS=payment,sev,whatsapp,voice`, et `real` partout ailleurs avec les clés des sections suivantes.

Point de départ : le `.env` créé par `infra/server-setup.sh` met dix fournisseurs à `mock` (l'antivirus l'est par défaut) et ne contient pas `ALLOW_MOCK_PROVIDERS`. Tel quel, l'API refuse de démarrer. Pour un premier essai technique sans aucune clé (jamais avec des testeurs), poser `ALLOW_MOCK_PROVIDERS=payment,maps,sms,email,push,whatsapp,voice,llm,sev,storage,antivirus`, puis retirer chaque nom de la liste au moment où son fournisseur passe à `real`. `SOCIAL_LOGIN_PROVIDER` n'entre pas dans cette liste : `real` est obligatoire en production (déjà posé par le script).

## 1. Serveur, domaine et adresses (LWS)

| Élément | Où le créer | Où le déposer | Bloqué tant qu'il manque | État |
|---|---|---|---|---|
| Accès SSH au VPS par clé | Panel LWS, puis `/root/.ssh/authorized_keys` du serveur (une ligne par clé) | Serveur | Tout déploiement | Clé de Claude déposée le 25 septembre ; exécution du déploiement par Claude refusée ce jour-là, commandes remises au fondateur |
| Enregistrements DNS `api`, `hub`, `reserver` vers l'adresse IP du VPS | Panel LWS, `neomoov.net`, Zone DNS | Zone DNS | Certificats TLS, toute connexion aux applications et à My Hub | Posés le 25 septembre ; vérifier `nslookup api.neomoov.net` |
| Préparation du serveur : `ssh root@<adresse IP du VPS> 'bash -s' < infra/server-setup.sh` | Poste, une fois | Crée `/opt/neomoov/.env` avec `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY` générés, et les tâches planifiées de sauvegarde (`/etc/cron.d/neomoov-backup`) et de relance des conteneurs malades (`/etc/cron.d/neomoov-restart-unhealthy`) | Démarrage de l'API | À confirmer |
| `ALLOW_MOCK_PROVIDERS` | Section précédente | `/opt/neomoov/.env` | Démarrage de l'API en production | À poser |
| Adresses `assistance@`, `comptes@`, `beta@`, `operations@`, `contact@neomoov.net` (boîtes ou redirections) | Panel LWS, Emails | Réglage `support.email` (assistance) ; comptes du personnel (`docs/beta/comptes-de-test.md`) | Courriel affiché dans les applications et recours de la page de suppression de compte (`assistance@`), retours de la bêta (`beta@`), comptes du personnel, avis de Let's Encrypt sur les certificats (`contact@`, `infra/Caddyfile`) | `assistance@` et `comptes@` à faire au 25 septembre ; les autres nouvelles |

## 2. Base de données et stockage (Supabase, Canada central)

| Élément | Où le créer | Où le déposer | Bloqué tant qu'il manque | État |
|---|---|---|---|---|
| Projet de **production** (plan Pro), région Canada (Central) | supabase.com, New project | `DATABASE_URL` (adresse « Session pooler ») dans `/opt/neomoov/.env` | L'API ne démarre pas | À créer (seul `neomoov-dev` existe) |
| Projet de **staging** | Idem | `DATABASE_URL` d'un serveur de staging ; `TEST_DATABASE_URL` sur le poste si les tests doivent quitter la base de développement | Répétitions, tests de charge, essai d'une migration sur une copie, restauration d'essai de secours | À créer |
| Bucket privé `documents` dans le projet de production | Storage, New bucket (privé, 10 Mo) ; ou, une fois l'API déployée, `docker compose -f infra/compose.prod.yml run --rm --no-deps api node ../../packages/db/dist/storage-bucket.js` sur le serveur | `S3_BUCKET=documents` | Documents des chauffeurs, PDF, exports Loi 25 | Existe dans `neomoov-dev` seulement |
| Accès S3 du projet de production : protocole S3 activé, clé d'accès | Storage, Settings, « S3 Connection » (activer, noter l'Endpoint et la région), « S3 Access Keys », New access key | `S3_ENDPOINT`, `S3_REGION` (facultative : `ca-central-1` par défaut), `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `STORAGE_PROVIDER=real` ; retirer `storage` d'`ALLOW_MOCK_PROVIDERS` | Stockage réel (`apps/api/src/adapters/real/s3.ts`, livré le 26 septembre). Sans ces clés, l'API refuse de démarrer, sauf si `storage` est déclaré simulé : les fichiers restent alors dans la mémoire de chaque processus, perdus au redémarrage et non partagés entre les deux instances de l'API et le worker (inutilisable en production) | À faire |
| Autre voie, hors décision D49 : Cloudflare R2 | dash.cloudflare.com, R2 | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (lues seulement si `S3_ACCESS_KEY` est vide) | Rien si Supabase Storage est utilisé | Non retenu |
| Option de restauration à un instant donné (PITR, 7 jours) | Projet de production, Add-ons | | Objectif de 1 heure de perte au plus avant le lancement commercial (section 2.1) | Décision du fondateur (coût : `migration-canada.md`, section 7) |

## 3. Secrets internes et variables du serveur (générés, pas créés chez un fournisseur)

| Élément | Où le créer | Où le déposer | Bloqué tant qu'il manque | État |
|---|---|---|---|---|
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY` | Générés par `infra/server-setup.sh` | `/opt/neomoov/.env` ; copie de `ENCRYPTION_KEY` dans Bitwarden | L'API refuse de démarrer en production | Au passage du script |
| `BACKUP_PASSPHRASE` | `openssl rand -base64 30` sur le serveur (le script de préparation ne la génère pas) | `/opt/neomoov/.env` et Bitwarden | Sauvegarde quotidienne : la tâche planifiée ne fait rien tant qu'elle manque ; donc purges de conservation bloquées (elles exigent une sauvegarde vérifiée) | À faire |
| `BACKUP_REMOTE` (facultatif) | `apt-get install -y rclone` puis `rclone config` vers un seau de stockage au Canada | `/opt/neomoov/.env` | Copie des sauvegardes hors du serveur | À faire |
| `BACKUP_KEEP_DAYS` (facultatif) | | `/opt/neomoov/.env` | Rien : 35 jours par défaut (`infra/scripts/backup.sh`), conforme au cahier des charges | Aucun geste |
| `VAPI_WEBHOOK_SECRET`, `WHATSAPP_VERIFY_TOKEN` | `openssl rand -hex 16`, puis saisis chez Vapi et Meta | `/opt/neomoov/.env` | Agent vocal, abonnement WhatsApp (section 13) | Avec ces services |
| Premier administrateur de My Hub | `create-staff` dans le conteneur de l'API (`docs/runbooks/personnel-my-hub.md`, section 1) : les données de départ ne créent aucun compte en production | Base ; mot de passe et codes de secours dans Bitwarden | Toute connexion à My Hub | Après le premier déploiement |
| Clé de service publique `NEOMOOV_PUBLIC_API_KEY` (portée `public:write`) | My Hub, Administration, **Clés de service**, **Créer une clé** (ou `POST /v1/admin/api-keys`) | `/opt/neomoov/.env` (lue par le web, recréer `web`) et réglage du site WordPress | Devis et adresses de la réservation web, préinscription des chauffeurs | Après le premier déploiement |
| `DERIVATION_KEY` (facultative) | Seulement lors d'une rotation d'`ENCRYPTION_KEY` (`docs/runbooks/secrets-et-cles.md`, section 4) | `/opt/neomoov/.env` | Rien à la mise en service (repli sur `ENCRYPTION_KEY`) | Aucun geste |

À ne pas poser en production : `SEED_DEMO=on` (comptes de démonstration, `docs/runbooks/base-de-donnees.md`, section 4), `CARD_PAYMENTS=on` (section 9), les drapeaux `FEATURE_*` (tous `off` en V1, `docs/runbooks/drapeaux-et-reglages.md`).

## 4. Déploiement et builds par GitHub Actions

`deploy.yml` (déploiement du serveur), `release.yml` (notes de version et builds EAS sur étiquette `v*`) et `images.yml` (images Docker sur GHCR) lisent ces valeurs ; rien n'est dans le code. Sans elles, le déploiement se fait depuis le poste (`git push lws main`, `docs/runbooks/deploiement-lws.md`, section 3).

| Élément | Où le créer | Où le déposer | Bloqué tant qu'il manque | État |
|---|---|---|---|---|
| Environnement `production` avec approbation | GitHub, « Settings », « Environments », « New environment » `production` ; « Required reviewers » : le fondateur ; « Deployment branches » : `main` | | Déploiement de production par GitHub Actions (le travail attend l'approbation du fondateur) | À créer |
| `DEPLOY_SSH_KEY` (secret) | Paire de clés dédiée, sur le poste : `ssh-keygen -t ed25519 -N "" -C github-deploy-neomoov -f deploy_neomoov` ; la ligne de `deploy_neomoov.pub` ajoutée à `/root/.ssh/authorized_keys` du serveur | Secret de l'environnement `production` : contenu complet du fichier privé `deploy_neomoov`, qui est ensuite supprimé du poste | Étape « Clé SSH » du déploiement | À créer |
| `DEPLOY_KNOWN_HOSTS` (secret) | Sur le poste : `ssh-keyscan -t ed25519 <adresse IP du VPS>` ; contrôler l'empreinte (`ssh-keyscan -t ed25519 <adresse IP du VPS> \| ssh-keygen -lf -`) contre celle lue sur le serveur (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`) | Secret de l'environnement `production` (la ligne complète) | Connexion SSH refusée (hôte inconnu) | À créer |
| `PRODUCTION_HOST` (variable) | Adresse du VPS | Variable de l'environnement `production` | Le travail s'arrête (« Variable PRODUCTION_HOST absente ») | À créer |
| `DEPLOY_USER` (variable, facultative) | | Variable de l'environnement | Rien : `root` par défaut | Aucun geste |
| Environnement `staging`, variables `STAGING_HOST` et `STAGING_API_URL`, les deux secrets SSH | Idem, pour un serveur de préproduction | Environnement `staging` | Déploiement automatique de préproduction à chaque poussée sur `main` (inactif tant que `STAGING_HOST` n'existe pas) | Sans objet en V1 (un seul VPS, D48) |
| `EXPO_TOKEN` (secret) | expo.dev, organisation `neomoov`, Access tokens (jeton dédié à GitHub, distinct de celui du poste) | Secret du **dépôt** (le travail de `release.yml` n'a pas d'environnement : un secret d'environnement ne lui parvient pas) | Builds EAS lancés par une étiquette `v*` (sans lui, notes de version seulement) | À créer |
| `EAS_PROJECT_ID_CLIENT`, `EAS_PROJECT_ID_DRIVER` (variables) | Identifiants (UUID) des projets EAS (section 7) | Variables du dépôt | Builds de `release.yml` sans projet lié : ni notifications push ni mises à jour à la volée | Après la création des projets EAS |
| `EAS_AUTO_SUBMIT` (variable) | Valeur `oui` | Variable du dépôt | Soumission automatique aux magasins après les builds de `release.yml` ; absente : builds seulement | Après les comptes Apple et Google. À vérifier au premier essai : la soumission Android de `eas.json` pointe vers un fichier du poste (`serviceAccountKeyPath`), absent des machines de GitHub ; à défaut, soumettre depuis le poste |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT` (variables) | Clé de site Turnstile (section 11), DSN du projet Sentry `web` (section 14) | Variables du dépôt | Images du web publiées sur GHCR par `images.yml` : sans la clé de site, widget vide et préinscription des chauffeurs refusée. La voie `git push` (construction sur le serveur) lit `/opt/neomoov/.env` à la place | Seulement si la voie GHCR est utilisée |
| Jeton de lecture des paquets GHCR | GitHub, compte, « Developer settings », « Personal access tokens (classic) », portée `read:packages` | Sur le serveur, une fois : `docker login ghcr.io -u <compte GitHub>` (mot de passe : le jeton) ; `IMAGE_PREFIX=ghcr.io/neomoov1-ui/neomoov` dans `.env` | Voie `infra/deploy.sh pull <sha>` seulement | Facultatif |

## 5. Textos et voix (Twilio, D50)

| Élément | Où le créer | Où le déposer | Bloqué tant qu'il manque | État |
|---|---|---|---|---|
| Compte mis à niveau (hors essai), numéro canadien SMS et voix | console.twilio.com | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `SMS_PROVIDER=real` ; retirer `sms` d'`ALLOW_MOCK_PROVIDERS` | **Toute connexion** : clients et chauffeurs se connectent par code SMS ; seuls les numéros d'examen des magasins (section 8) s'en passent | À faire |
| Webhooks du numéro : statut `https://api.neomoov.net/v1/webhooks/twilio/status`, textos entrants `https://api.neomoov.net/v1/webhooks/twilio/inbound` | Twilio, numéro, Messaging | | Suivi de livraison, relais des réponses des clients sans application | Après déploiement |
| Second numéro, réservé à WhatsApp | Idem | `C:\Users\PC\cles-neomoov\twilio.txt` | WhatsApp (section 13) | À faire |

## 6. Courriels (Resend)

| Élément | Où le créer | Où le déposer | Bloqué tant qu'il manque | État |
|---|---|---|---|---|
| Domaine `neomoov.net` vérifié (enregistrements DNS chez LWS) et clé d'envoi | resend.com, Domains, API Keys | `RESEND_API_KEY`, `EMAIL_FROM` (défaut : `Neomoov <notifications@neomoov.net>`), `EMAIL_PROVIDER=real` ; retirer `email` d'`ALLOW_MOCK_PROVIDERS` | Reçus, factures, relevés, liens d'export Loi 25, rapports des agents, et **alertes du personnel** (course figée, aucun chauffeur, planifiée non confirmée, relevé en échec, escalade et budget des agents, SOS en plus du texto) envoyées aux administrateurs et opérateurs | À faire |

## 7. Notifications push et builds (Expo, EAS)

| Élément | Où le créer | Où le déposer | Bloqué tant qu'il manque | État |
|---|---|---|---|---|
| Jeton de l'organisation `neomoov` | expo.dev, organisation, Access tokens | `EXPO_TOKEN` (poste) | Builds par Claude | Fait au 25 septembre |
| Projets EAS des deux applications (`neomoov-client`, `neomoov-driver`) | `npx eas-cli@latest init` dans `apps/mobile-client` puis `apps/mobile-driver` (`docs/runbooks/publication-mobile.md`, section 4) | Identifiant (UUID) lu dans `EAS_PROJECT_ID` par `app.config.ts` : variable `EAS_PROJECT_ID` de chaque projet EAS, terminal du poste avant toute commande `eas`, variables GitHub `EAS_PROJECT_ID_CLIENT` et `EAS_PROJECT_ID_DRIVER`. Rien à écrire dans `app.json` | Builds, notifications push (sans projet, l'enregistrement du téléphone est ignoré), mises à jour à la volée | À faire |
| Clés Google Maps iOS et Android | Google Cloud (section 10) | Variables des projets EAS `GOOGLE_MAPS_IOS_KEY`, `GOOGLE_MAPS_ANDROID_KEY` (visibilité « secret ») | Carte Google dans les builds Android | À faire |
| `PUSH_PROVIDER=real` ; `EXPO_PUSH_ACCESS_TOKEN` seulement si la « sécurité renforcée » des push est activée chez Expo | Serveur | `/opt/neomoov/.env` ; retirer `push` d'`ALLOW_MOCK_PROVIDERS` | Toutes les notifications push | À faire |

## 8. Magasins (Apple, Google Play)

| Élément | Où le créer | Où le déposer | Bloqué tant qu'il manque | État |
|---|---|---|---|---|
| Compte Apple Developer (organisation) validé | developer.apple.com | | Tout build iOS, TestFlight | En validation au 25 septembre |
| Identifiants d'application `com.neomoov.client`, `com.neomoov.driver` (Push, Sign in with Apple, Maps, Background Modes pour le chauffeur) | Certificates, Identifiers & Profiles | | Builds iOS | Après validation |
| Fiches des deux applications dans App Store Connect | App Store Connect, Apps | `ascAppId` et `appleTeamId` dans `submit.production.ios` de chaque `eas.json` (identifiants publics, commités par Claude) | Soumission automatique | Après validation |
| Clé d'API App Store Connect (rôle Admin) | App Store Connect, Intégrations | `.p8` et `apple.txt` dans `C:\Users\PC\cles-neomoov\` ; enregistrée ensuite dans EAS au premier `eas submit` | Soumission par Claude | Après validation |
| Services ID `net.neomoov.web` et `APPLE_CLIENT_IDS` | Identifiers, Services IDs | `/opt/neomoov/.env` | Connexion Apple (API prête, aucun écran ne la propose encore) | Après validation |
| Compte Google Play Console (organisation) validé, deux applications créées | play.google.com/console | | Tout envoi Android au magasin | En validation au 25 septembre |
| Compte de service de publication | Play Console, Accès à l'API | `C:\Users\PC\cles-neomoov\google-play-service-account.json` (chemin attendu par `eas.json`) | Soumission automatique ; le premier `.aab` s'envoie en général à la main | Après validation |
| Clients OAuth Android (empreinte SHA-1 donnée après le premier build) | Google Cloud, Clients | Ajoutés à `GOOGLE_CLIENT_IDS` | Connexion Google sur Android (API prête, aucun écran ne la propose encore) | Après le premier build |
| **Comptes d'examen** : deux numéros fictifs (un client, un chauffeur) et un code fixe | Numéros de la plage fictive `+1 514 555 0100` à `0199` (`docs/beta/comptes-de-test.md`) ; code de 6 chiffres choisi par le fondateur (refusé au démarrage s'il est trivial : chiffres répétés, `123456`, `654321`) | `REVIEW_PHONES` (numéros E.164 séparés par des virgules) et `REVIEW_OTP_CODE` dans `/opt/neomoov/.env`, puis recréer `api` et `worker` ; le code seulement dans les « Sign-In Information » d'App Store Connect et l'« Accès aux applications » de Google Play | Revue des deux magasins (l'examinateur ne reçoit pas les textos) ; préparation des comptes de démonstration sans Twilio | Mécanisme livré le 26 septembre ; valeurs à poser. Vider les deux variables après la publication |
| Vidéo de démonstration de la localisation en arrière-plan | Téléphone, puis YouTube non répertorié | Lien dans la déclaration Google Play | Revue Google de l'application chauffeur | À produire (`docs/store/driver.md`) |
| Adresse d'assistance, politique de confidentialité et page de suppression de compte en ligne | neomoov.net ; la page de suppression existe déjà : `https://reserver.neomoov.net/supprimer-mon-compte` | Fiches des magasins | Revue des deux magasins | Politique et page d'assistance à publier ; page de suppression à vérifier en production (`docs/store/verification-soumission.md`) |

## 9. Paiements (Stripe)

| Élément | Où le créer | Où le déposer | Bloqué tant qu'il manque | État |
|---|---|---|---|---|
| Clés de test | dashboard.stripe.com, mode test | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `PAYMENT_PROVIDER=real` (staging) | Essais réels du paiement par carte | À faire au 25 septembre |
| Connect Express configuré | Stripe, Connect | `STRIPE_CONNECT_CLIENT_ID` (facultatif) | Versements aux chauffeurs | À faire |
| Point de réception des webhooks `https://api.neomoov.net/v1/webhooks/stripe` | Stripe, Webhooks (fait par Claude après déploiement) | `STRIPE_WEBHOOK_SECRET` | Confirmation des paiements, remboursements, litiges | Après déploiement |
| Activation du compte en mode réel (NEQ, compte bancaire, pièce d'identité) puis clés réelles | Stripe, Activer le compte | Serveur de production seulement ; retirer `payment` d'`ALLOW_MOCK_PROVIDERS` | Encaissements et versements réels ; d'ici là, bêta en paiement au chauffeur | Avant le lancement commercial |
| `CARD_PAYMENTS` | | `/opt/neomoov/.env` | Vide : carte jamais proposée en production avec le paiement simulé. Dès `PAYMENT_PROVIDER=real`, poser `CARD_PAYMENTS=off` tant que les applications n'ont pas d'écran d'ajout de carte (sinon la carte est proposée et le prépaiement échoue) | À poser au passage à Stripe réel |
| Identifiant marchand Apple Pay et domaine vérifié | Stripe, moyens de paiement ; réglage `payments.apple_pay_merchant_id` | My Hub, Paramètres | Apple Pay | Avec la feuille de paiement (non branchée dans les applications) |

## 10. Cartes (Google Maps Platform)

| Élément | Où le créer | Où le déposer | Bloqué tant qu'il manque | État |
|---|---|---|---|---|
| Clé serveur restreinte à l'adresse IP du VPS (Routes, Places, Geocoding) | Google Cloud, Identifiants | `GOOGLE_MAPS_SERVER_KEY`, `MAPS_PROVIDER=real` ; retirer `maps` d'`ALLOW_MOCK_PROVIDERS` | Adresses et devis réels (en simulé, les adresses sont fictives) | Clé créée ; restriction IP à poser |
| Budget et alertes | Google Cloud, Budgets | | Protection contre une facture imprévue | À faire |
| Fournisseur de tuiles pour les cartes de My Hub et du suivi partagé | Au choix (Google Maps, déjà payé, ou un fournisseur de tuiles OpenStreetMap) | À intégrer au code | Les tuiles publiques d'OpenStreetMap utilisées aujourd'hui ne conviennent pas à un usage commercial soutenu (décision du 26 septembre) | Décision du fondateur |

## 11. Anti-robots des formulaires publics (Cloudflare Turnstile)

| Élément | Où le créer | Où le déposer | Bloqué tant qu'il manque | État |
|---|---|---|---|---|
| Site Turnstile pour `hub.neomoov.net` et `reserver.neomoov.net` : clé de site et clé secrète | dash.cloudflare.com, Turnstile (gratuit ; compte Cloudflare absent des 14 comptes) | `TURNSTILE_SECRET_KEY` (API) et `NEXT_PUBLIC_TURNSTILE_SITE_KEY` dans `/opt/neomoov/.env` ; la clé de site est passée au build de l'image du web (`apps/web/Dockerfile`, `infra/compose.prod.yml`) : après l'ajout, `infra/deploy.sh build`. Même clé de site en variable GitHub si la voie GHCR est utilisée (section 4) | En production, sans clé secrète, **tout jeton est refusé** : la préinscription des chauffeurs (`/chauffeurs`, `POST /v1/public/leads`) échoue | À créer |

## 12. Antivirus des documents (ClamAV, sur le serveur)

| Élément | Où le créer | Où le déposer | Bloqué tant qu'il manque | État |
|---|---|---|---|---|
| Conteneur `clamav` (profil Docker `antivirus` de `infra/compose.prod.yml`, environ 1,2 Go de mémoire) | Aucun compte | `COMPOSE_PROFILES=antivirus` et `VIRUS_SCANNER_PROVIDER=real` dans `/opt/neomoov/.env`, puis `infra/deploy.sh build` (qui lit le fichier) ; retirer `antivirus` d'`ALLOW_MOCK_PROVIDERS`. Les commandes `docker compose` tapées à la main ne lisent pas ce fichier pour elles-mêmes : y ajouter `--profile antivirus` pour agir sur `clamav` | Analyse réelle des documents des chauffeurs ; en simulé, seul le fichier de test EICAR est refusé | À faire (mémoire du VPS à vérifier) |

## 13. Agents IA, voix et WhatsApp

| Élément | Où le créer | Où le déposer | Bloqué tant qu'il manque | État |
|---|---|---|---|---|
| Clé Anthropic et limite de dépense mensuelle | console.anthropic.com | `ANTHROPIC_API_KEY`, `LLM_PROVIDER=real` ; retirer `llm` d'`ALLOW_MOCK_PROVIDERS` | Agents relation client, recrutement, comptabilité, analyse (sinon escalade à l'équipe) | Clé présente sur le poste au 25 septembre |
| Vapi : clé privée, numéro Twilio importé, assistant configuré | dashboard.vapi.ai (`docs/voice-agent.md`) | `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`, `VAPI_WEBHOOK_SECRET`, `VOICE_PROVIDER=real` ; retirer `voice` d'`ALLOW_MOCK_PROVIDERS` | Réservation par téléphone, appel du fondateur sur SOS | À faire ; simulé pendant la bêta proposée |
| Réglages `voice.transfer_number`, `alerts.founder_phone`, `voice.sos_assistant_id` | My Hub, Paramètres | Base | Transfert vers un humain (valeur de départ fictive), appel sur SOS | À faire |
| WhatsApp : entreprise vérifiée, numéro, jeton permanent, secret de l'application, moyen de paiement | business.facebook.com, developers.facebook.com | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PROVIDER=real` ; retirer `whatsapp` d'`ALLOW_MOCK_PROVIDERS` | Réservation et assistance par WhatsApp | Vérification en cours au 25 septembre ; simulé pendant la bêta proposée |

## 14. Surveillance

| Élément | Où le créer | Où le déposer | Bloqué tant qu'il manque | État |
|---|---|---|---|---|
| Sentry, projet `api` (API et worker) | sentry.io (`docs/runbooks/observabilite.md`, section 2) | `SENTRY_DSN`, `SENTRY_ENVIRONMENT=production` dans `/opt/neomoov/.env` | Suivi des erreurs de l'API et du worker : le code est branché et reste inactif sans DSN | À faire |
| Sentry, projet `web` | Idem | `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT` dans `/opt/neomoov/.env` (lus au build de l'image : `infra/deploy.sh build`) et variables GitHub du même nom (voie GHCR) | Suivi des erreurs de My Hub et de la réservation web | À faire |
| Sentry, projet `mobile` | Idem | `EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_SENTRY_ENVIRONMENT` dans les variables des projets EAS (profils `preview` et `production`) ; nouveau build ou mise à jour à la volée ensuite | Suivi des plantages des applications ; à déclarer dans les étiquettes de confidentialité dès qu'il est actif (`docs/store/`) | À faire |
| Better Stack : moniteurs de disponibilité de `api`, `hub`, `reserver` et du temps réel, avec alerte | betterstack.com (`docs/runbooks/observabilite.md`, section 5) | Réglés chez Better Stack, aucun code | Alerte quand l'API ou un site tombe : **aucune aujourd'hui** | À faire |
| Better Stack : moniteur « heartbeat » du worker | Idem | `BETTERSTACK_HEARTBEAT_URL` dans `/opt/neomoov/.env` | Alerte quand le worker s'arrête | À faire |
| Better Stack : source de journaux | Idem | `BETTERSTACK_TOKEN` | Rien pour l'instant : la variable est acceptée mais aucun code n'envoie encore les journaux (acheminement à brancher, `observabilite.md`, section 7) | À faire après le branchement |

## 15. Facturation certifiée (SEV)

| Élément | Où le créer | Où le déposer | Bloqué tant qu'il manque | État |
|---|---|---|---|---|
| Fournisseur SEV certifié par Revenu Québec, contrat et clé | Choix du fondateur (`docs/sev-adapter.md`, `docs/compliance/checklist.md`) | `SEV_API_KEY` | Lancement commercial (section 10.6). L'adaptateur réel n'est pas écrit : avec `SEV_PROVIDER=real`, toute transmission est refusée. Garder `SEV_PROVIDER=mock` et `sev` dans `ALLOW_MOCK_PROVIDERS` pendant la V1 | Fournisseur à choisir, adaptateur à écrire |

## 16. Contenu et réglages de l'entreprise (My Hub, Paramètres)

| Élément | Où | Bloqué tant qu'il manque |
|---|---|---|
| Numéros de TPS et TVQ de Neomoov, dénomination et adresse : `company.gst_number`, `company.qst_number` (vides au départ), `company.legal_name` (valeur de départ « Neomoov »), `company.address` (valeur de départ « Montréal (Québec) ») | My Hub, Paramètres | **Bloquant avant la première facture réelle** : mentions obligatoires des factures de frais de service. Dénomination légale fixée par D25 (décision du 22 septembre) : « GROUPE NOUVEAU SYSTEME KARDINAL (GROUPE NSK) INC. », à confirmer avec le comptable pour les factures de Neomoov |
| Téléphone et courriel d'assistance : `support.phone`, `support.email` | My Hub, Paramètres (réglages créés vides par les données de départ) | Écran Assistance des applications (coordonnées masquées tant qu'ils sont vides), recours de la page de suppression de compte, exigence des magasins |
| Politique de confidentialité et conditions d'utilisation (versions publiées) | neomoov.net ; versions dans `legal.privacy_policy_version` et `legal.terms_version` | Création des comptes (acceptation obligatoire), fiches des magasins |
| Responsable de la protection des renseignements personnels désigné et publié | Site, politique de confidentialité | Loi 25 (`docs/privacy/efvp.md`) |
| Destinataires des rapports des agents : `agents.report_recipients` | My Hub, Paramètres | Rien (défaut : les administrateurs) |

## 17. Hors technique (suivis par le fondateur)

Autorisations de la CTQ, SAAQ, Aéroports de Montréal, assurances, Revenu Québec et choix du SEV certifié, avis de l'avocat sur la résidence des données et sur les courses rémunérées de la bêta : `docs/compliance/checklist.md` et `docs/beta/README.md`.

## Ordre conseillé pour la bêta

1. Serveur, DNS, projet Supabase de production, `ALLOW_MOCK_PROVIDERS` complet pour un premier démarrage technique, `BACKUP_PASSPHRASE` (sections 1 à 3) ; premier administrateur de My Hub.
2. Twilio (sans lui, personne ne se connecte), Resend (alertes du personnel comprises), Expo (projets EAS et push), clé serveur Google Maps, clé Anthropic ; bucket et clés S3 ; antivirus (`COMPOSE_PROFILES=antivirus`) ; puis `ALLOW_MOCK_PROVIDERS=payment,sev,whatsapp,voice`.
3. Turnstile (clés, puis `infra/deploy.sh build`), clé de service publique, réglages de l'entreprise et de l'assistance (section 16).
4. Apple et Google Play dès leur validation ; `REVIEW_PHONES` et `REVIEW_OTP_CODE` posés, comptes de démonstration préparés (`docs/beta/comptes-de-test.md`, section 3).
5. Better Stack (moniteurs et battement du worker), Sentry ; GitHub (environnement `production`, secrets et variables) si le déploiement passe par GitHub Actions.
6. Vapi et WhatsApp quand ils sont prêts ; Stripe réel (avec `CARD_PAYMENTS=off`), SEV certifié et PITR de Supabase avant le lancement commercial.
