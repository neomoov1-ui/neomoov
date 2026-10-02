# Neomoov. Mise en service finale : ce qui reste de votre côté

Version 1.0, 2 octobre 2026. Suite du « Guide des clés et réglages des 14 comptes externes » (v1.0 du 25 septembre, `docs/cles-comptes-externes.md`) et de « Accès à fournir » (`docs/operations/acces-a-fournir.md`). Ce guide part de l'état **réel** de la production constaté le 2 octobre à 16 h et dit, dans l'ordre, ce que vous faites (Twilio, Vapi, Meta Business pour WhatsApp, puis tous les autres réglages) et ce que je fais dès que vous me le dites. Aucune valeur de clé ici, jamais.

---

## 0. Où en est la production (constaté le 2 octobre à 16 h)

Vérification faite sans lire une seule valeur : le script `scripts/env-check.mjs` lancé contre `/opt/neomoov/.env` du serveur n'affiche que « OK » ou « -- » par variable (43 variables renseignées sur 121), plus deux sondes publiques.

| Élément | État | Conséquence aujourd'hui | Section |
|---|---|---|---|
| Textos (Twilio) | **En place depuis le 2 octobre au soir** (clés posées par `envoyer-twilio-serveur.ps1`, textos réels, premier code de connexion reçu) | Reste le webhook des textos entrants sur le numéro (section 2, étape C) et le second numéro pour WhatsApp | 2 |
| Clé publique du site (`NEOMOOV_PUBLIC_API_KEY`) | Absente | **Réservation web et préinscription des chauffeurs en panne** : `reserver.neomoov.net` répond « Clé publique non configurée sur le serveur web » (503), et le site neomoov.net qui l'intègre aussi | 3 |
| Courriels (Resend) | **En place** : deux courriels d'essai envoyés depuis le serveur le 2 octobre au soir et acceptés (domaine vérifié) ; expéditeur `Neomoov <assistance@neomoov.net>` ; redirections `assistance@`, `comptes@`, `operations@`, `beta@`, `support@` créées chez LWS | Rien | 4 |
| Documents (stockage S3 de Supabase) | **En place depuis le 2 octobre au soir** (clés posées par `envoyer-s3-serveur.ps1`, stockage réel, aller-retour PDF vérifié : dépôt, lecture, adresse signée, suppression) | Rien | 5 |
| Sauvegarde chiffrée du serveur | **Phrase générée le 2 octobre au soir, première sauvegarde faite et vérifiée (145 tables)** ; sauvegarde automatique chaque nuit à 3 h 30 | **Copier la phrase dans Bitwarden** (sans elle, aucune sauvegarde ne se relit) : `ssh root@78.138.58.92 "grep '^BACKUP_PASSPHRASE=' /opt/neomoov/.env"` ; choisir la copie hors site ; confirmer la sauvegarde dans My Hub, Conformité et conservation | 6 |
| Dépôt GitHub `neomoov1-ui/neomoov` | Public | Code confidentiel et contenu payant de l'Academy exposés | 7 |
| Agent vocal (Vapi) | **En place depuis le 2 octobre au soir** : clé posée par `envoyer-vapi-serveur.ps1`, numéro Twilio importé, assistants « Neomoov accueil » et « Neomoov SOS » créés par `vapi:setup`, voix réelle, numéros de transfert et d'alerte réglés | Essai d'appel à faire par le fondateur ; appels sortants de prospection plus tard (phase 3) | 8 |
| WhatsApp (Meta) | **En place depuis le 3 octobre** : application Meta `Neomoov` (5 cas d'utilisation), numéro `+1 438 900 4990` vérifié et enregistré par l'API (NIP), jeton système, clé secrète et jeton de vérification posés, webhook vérifié, champ `messages` abonné, premier échange réel (message reçu, deux réponses de l'agent) | Après la vérification de l'entreprise par Meta : moyen de paiement et mode « En ligne » (section 9, étape G) ; renouveler le jeton système vu dans la conversation | 9 |
| Paiements Square (production), cartes Google Maps, anti-robots Turnstile, erreurs Sentry (API), modèle Claude, jeton HubSpot | En place | Encaissement réel possible ; devis réels ; préinscription protégée (dès que la section 3 est faite) | 10 |
| Surveillance (Better Stack), Sentry du web, Sentry des applications | Absents | Aucune alerte si l'API ou un site tombe | 10 |
| Fichier `.env` du poste | Lignes 40, 42, 44 et 46 mal formées ; variables inconnues `RESEND_API_KEY_2`, `Hostname`, `Utilisateur`, `PRODUCTION_DATABASE_URL` | Sans effet sur la production ; mais un secret de production (`PRODUCTION_DATABASE_URL`) n'a pas sa place sur le poste | 1 |

Les sections 2 à 7 débloquent la production : comptez une heure et demie, dans l'ordre. Les sections 8 et 9 ajoutent la voix et WhatsApp. Les sections 10 à 15 font la version finale.

### Inventaire de tous les comptes externes : état et geste restant

| Compte | Rôle | État au 2 octobre | Geste restant (section) |
|---|---|---|---|
| LWS (VPS, domaine, courriels) | Serveur de l'API, DNS, boîtes `@neomoov.net`, site WordPress | Serveur et DNS en place, site en ligne | Enregistrements DNS de Resend et de Brevo ; boîtes `assistance@`, `comptes@`, `beta@`, `operations@` (4, 13) |
| Supabase | Base de données de production (Canada), documents | Base en place | Clés d'accès S3 (5) ; option PITR (6) |
| Google Cloud | Cartes (Routes, Places, Geocoding), connexion Google | Clé serveur en production | Restriction de la clé serveur à l'adresse du VPS, budget avec alertes (10) ; clients OAuth Android après l'empreinte SHA-1 (12) |
| Google (Search Console, fiche d'établissement, YouTube, Agenda) | Référencement, recherche locale, vidéos, rendez-vous (phase 1 autonome) | À ouvrir | (15) |
| Apple Developer | Applications iPhone, connexion Apple | En validation | Identifiants, clé App Store Connect, fiches (12) |
| Google Play Console | Applications Android | En validation | Compte de service, deux applications (12) |
| Expo (EAS) | Compilations et mises à jour des applications, notifications push | Jeton sur le poste ; compilations Android faites | Confirmer les deux projets EAS et leurs variables (12) |
| Bitwarden | Mots de passe et secrets irremplaçables | En place | Y ranger la phrase des sauvegardes et le NIP WhatsApp (6, 9) |
| Twilio | Textos de connexion et de service, numéro vocal, numéro WhatsApp | **Compte validé** ; aucune clé sur le serveur | Numéros, webhook, permissions, trois variables (2) |
| Vapi | Accueil téléphonique, appel SOS, plus tard appels sortants | Compte à finaliser | Facturation, import du numéro, clé, secret (8) |
| ElevenLabs | Voix premium (téléphone, narration des vidéos) | À créer seulement si la voix Azure ne convient pas | (8 bis) |
| Meta Business (WhatsApp, puis Facebook et Instagram) | WhatsApp Business, boîte unifiée de la phase 1, publication | Vérification de l'entreprise en cours | Application, numéro, jeton système, secret, webhook, paiement (9) ; page et compte Instagram (15) |
| Resend | Courriels transactionnels (reçus, factures, alertes) | Clé sur le serveur, **aucun domaine vérifié** | Domaine `neomoov.net` et DNS (4) |
| Brevo | Courriels de l'Academy (séquences), relais entrant de `contact@` (phase 1) | Clé en place côté WordPress ; 20 brouillons importés | Domaine authentifié, quatre scénarios, double consentement (13) ; relais entrant (15) |
| Square | Encaissement (production) | **En place** | Bac à sable du poste à corriger (10) |
| Stripe | Encaissement et versements aux chauffeurs (plus tard) | En validation | Rien tant que le compte n'est pas activé (10) |
| Anthropic | Modèle des agents | Clé sur le serveur | Limite de dépense mensuelle et recharge automatique à vérifier (10) |
| HubSpot | CRM : prospects, comptes d'affaires, transactions | Compte gratuit et jeton sur le serveur ; **9 portées manquantes**, devise en USD | Devise CAD, portées, puis mise en place et bascule (10 bis) |
| Cloudflare Turnstile | Anti-robots des formulaires publics | **En place** | Rien |
| Sentry | Erreurs de l'API, du web, des applications | Projet API en place | Projets `web` et `mobile` (10) |
| Better Stack | Disponibilité, alertes, battement du worker | Jeton sur le poste seulement | Moniteurs, battement, astreinte (10) |
| GitHub | Code source, déploiement | **Dépôt public** | Passer en privé (7) ; environnement de déploiement facultatif |
| Tidio | Discussion sur le site | En place, formule gratuite | Décision : garder ou remplacer par l'agent de la plateforme (13) |
| Stockage hors site des sauvegardes | Copie quotidienne chiffrée hors du serveur | À choisir | Backblaze B2 ou stockage objet canadien (6) |
| LinkedIn, TikTok, X, Snapchat | Publication automatisée (phases 1 et 2) | À ouvrir | (15) |
| PandaDoc ou DocuSign ; Meta Ads, Google Ads | Signature électronique, publicité (phase 4) | À ouvrir plus tard | (15) |
| Revenu Québec (SEV certifié), CTQ, SAAQ, assurances | Obligations hors technique | À suivre par vous | (14) |

---

## 1. La méthode : poser une valeur sans jamais la montrer

### Où vont les valeurs

| Lieu | Contenu |
|---|---|
| `/opt/neomoov/.env` sur le serveur (droits 600) | **Toutes les clés de production** (API, worker, web). C'est là que tout ce guide dépose |
| `C:\Users\PC\code\neomoov\.env` (poste) | Clés de test et de développement seulement ; jamais une clé de production |
| Bitwarden, dossier `Neomoov` | Mots de passe des comptes, codes de secours, copies des secrets irremplaçables (`ENCRYPTION_KEY`, `BACKUP_PASSPHRASE`, NIP WhatsApp) |
| `C:\Users\PC\cles-neomoov\` | Fichiers (clé `.p8` d'Apple, JSON Google Play, notes `twilio.txt`, `apple.txt`) |
| My Hub, Administration, Paramètres | Réglages non secrets (dénomination, taxes, numéros d'assistance et d'alerte) |

### La commande à connaître : `env-set.sh`

Depuis **Git Bash** sur votre poste (touche Windows, taper « Git Bash »). La clé SSH qui ouvre le serveur est déjà sur ce poste : rien à installer.

```
ssh -t root@78.138.58.92 /opt/neomoov/infra/scripts/env-set.sh NOM_DE_LA_VARIABLE
```

La commande demande la valeur ; **rien ne s'affiche pendant la frappe** (collez avec le clic droit ou Maj+Insertion, puis Entrée). Elle remplace la ligne `NOM=` du fichier du serveur sans jamais afficher ni journaliser la valeur. Variantes :

| Besoin | Commande |
|---|---|
| Poser puis redémarrer les services qui lisent la variable | `… env-set.sh NOM --recreate api worker` (ajouter `web` pour la clé publique du site ; une dizaine de secondes de latence possible sur l'API) |
| Fabriquer un secret aléatoire de 32 caractères (sans le voir) | `… env-set.sh NOM --generate` |
| Variable figée dans l'image du web (`NEXT_PUBLIC_…`) | `… env-set.sh NOM --build` (reconstruit le web, 5 à 10 minutes) |
| Voir une valeur **sur votre écran seulement** (pour la copier dans Bitwarden ou chez un fournisseur) | `ssh root@78.138.58.92 "grep '^NOM=' /opt/neomoov/.env"` |

Si `ssh` demande « Are you sure you want to continue connecting? », répondre `yes`. Si la connexion est refusée, dites-le-moi : je vérifie la clé sur le serveur.

### Les variables de bascule, je m'en charge

Les variables `<SERVICE>_PROVIDER=real` et la liste `ALLOW_MOCK_PROVIDERS` ne sont pas secrètes : dès que vous me dites « X est posé », je fais la bascule, le redémarrage et un essai réel, puis je vous confirme.

### Le `.env` du poste, à nettoyer une fois (5 minutes)

Ouvrir `C:\Users\PC\code\neomoov\.env` dans VS Code : corriger ou supprimer les lignes 40, 42, 44 et 46 (nom avec espace ou ligne sans signe égal), supprimer `PRODUCTION_DATABASE_URL` (un secret de production n'a pas sa place sur le poste ; il est déjà sur le serveur), renommer ou supprimer `RESEND_API_KEY_2`, `Hostname`, `Utilisateur`. Puis `pnpm env:check` dans `C:\Users\PC\code\neomoov` : plus aucune « ligne à corriger ».

---

## 2. Twilio : textos et numéro vocal (urgent, 20 minutes)

Votre compte est validé (hors essai). Il reste les numéros, le webhook des textos entrants, les permissions, les identifiants.

- **Liens :** console https://console.twilio.com ; facturation https://console.twilio.com/billing ; acheter un numéro https://console.twilio.com/us1/develop/phone-numbers/manage/search ; numéros actifs https://console.twilio.com/us1/develop/phone-numbers/manage/incoming ; permissions des textos https://console.twilio.com/us1/develop/sms/settings/geo-permissions ; permissions de la voix https://console.twilio.com/us1/develop/voice/settings/geo-permissions

**Étape A. Recharge automatique.** « Billing », « Auto-recharge » : recharger 20 $ US quand le solde passe sous 5 $. Sans cela, le jour où le solde tombe à zéro, plus personne ne se connecte.

**Étape B. Deux numéros canadiens.** Page d'achat : pays **Canada**, capacités **SMS** et **Voice** cochées, indicatif `514` ou `438` (sinon `450`), « Search », « Buy » :

1. **Numéro principal** : textos de connexion, confirmations, et l'accueil téléphonique (section 8). C'est lui qui s'affichera comme numéro de Neomoov.
2. **Second numéro**, réservé à WhatsApp (section 9) : il ne sert à rien d'autre. Le noter dans `C:\Users\PC\cles-neomoov\twilio.txt` avec la mention « numéro WhatsApp ».

Si un numéro existe déjà sur le compte, il sert de numéro principal.

**Étape C. Webhook des textos entrants (numéro principal).** Page des numéros actifs, cliquer le numéro principal, section **Messaging Configuration** :

- « A message comes in » : **Webhook**, adresse `https://api.neomoov.net/v1/webhooks/twilio/inbound`, méthode **HTTP POST** ; « Save configuration ».
- Section **Voice Configuration** : ne rien changer (Vapi la réglera lui-même à l'import, section 8).
- Rien à régler pour les accusés de livraison : l'API indique son adresse de statut à chaque envoi.

Le second numéro reste sans webhook.

**Étape D. Permissions géographiques.** Textos : Canada et États-Unis cochés, rien d'autre. Voix : Canada et États-Unis (les appels sortants de l'agent vocal passent par Twilio).

**Étape E. Identifiants.** Page d'accueil de la console, encadré **Account Info** : « Account SID » (commence par `AC`) et « Auth Token » (cliquer pour l'afficher).

**Étape F. Poser les trois valeurs (Git Bash).**

```
ssh -t root@78.138.58.92 /opt/neomoov/infra/scripts/env-set.sh TWILIO_ACCOUNT_SID
ssh -t root@78.138.58.92 /opt/neomoov/infra/scripts/env-set.sh TWILIO_AUTH_TOKEN
ssh -t root@78.138.58.92 /opt/neomoov/infra/scripts/env-set.sh TWILIO_FROM_NUMBER
```

Le numéro s'écrit au format international sans espace : `+1514XXXXXXX`.

- **Vous me dites :** « Twilio est posé ».
- **Je fais :** `SMS_PROVIDER=real`, retrait de `sms` de la liste des simulés, redémarrage, puis un vrai code de connexion envoyé à votre numéro ; réponse à un texto entrant par l'agent relation client. Note : un numéro canadien n'exige pas l'enregistrement « A2P 10DLC » (réservé aux envois vers les États-Unis).

---

## 3. Clé publique du site (urgent, 5 minutes)

Elle permet au serveur web (réservation, préinscription) et au site de demander des devis et d'envoyer des candidatures à l'API, sans exposer autre chose.

1. My Hub https://hub.neomoov.net, connexion avec votre compte administrateur (mot de passe puis code de l'application d'authentification).
2. **Administration**, **Clés de service**, **Créer une clé** : nom `Site web`, portée **`public:write`** seulement, aucun agent, aucune expiration. Dialogue « Clé créée » : **Copier la clé** (`nmk_…`, affichée une seule fois).
3. Git Bash :

```
ssh -t root@78.138.58.92 /opt/neomoov/infra/scripts/env-set.sh NEOMOOV_PUBLIC_API_KEY --recreate web
```

4. Vérifier : https://reserver.neomoov.net/reserver donne un prix pour un trajet ; https://reserver.neomoov.net/chauffeurs accepte une préinscription d'essai (avec votre propre numéro).

- **Vous me dites :** « clé publique posée ». Je vérifie le site neomoov.net (la réservation intégrée) et la préinscription de bout en bout.

---

## 4. Resend : le domaine des courriels (à confirmer, 15 minutes si quelque chose manque)

- **Liens :** domaines https://resend.com/domains ; clés https://resend.com/api-keys ; DNS chez LWS : https://panel.lws.fr, « Mes domaines », `neomoov.net`, « Zone DNS »

**Étape A. Vérifier le compte.** Sur la page des domaines, `neomoov.net` doit être « Verified » (il l'était le 29 septembre). La clé en production est une clé « envoi seulement » : c'est normal, et c'est pourquoi l'état du domaine ne se lit pas par l'API ; je le confirme par un envoi réel depuis le serveur. Si le domaine n'apparaît pas, passer aux étapes B et C.

**Étape B. Ajouter le domaine.** Page des domaines, « Add Domain » : `neomoov.net`, région « North Virginia (us-east-1) ». Resend affiche les enregistrements DNS à copier.

**Étape C. Poser les enregistrements chez LWS**, exactement comme Resend les affiche (nom sans `.neomoov.net`) :

| Type | Nom | Valeur |
|---|---|---|
| MX | `send` | `feedback-smtp.us-east-1.amazonses.com`, priorité 10 |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` |
| TXT | `resend._domainkey` | la longue valeur `p=…` donnée par Resend |
| TXT | `_dmarc` | `v=DMARC1; p=none;` (seulement s'il n'y a pas déjà une ligne `_dmarc`) |

Ne pas toucher aux lignes `MX` de `@` (courriel `contact@neomoov.net`). Retour sur Resend, « Verify » : « Verified » en quelques minutes à quelques heures.

**Étape D. Adresses.** Panel LWS, rubrique Emails de `neomoov.net` : boîtes ou redirections vers `neomoov1@gmail.com` pour `assistance@`, `comptes@`, `beta@`, `operations@` et `contact@` (déjà là). `assistance@` est l'adresse affichée dans les applications ; `contact@` reçoit les avis de certificats du serveur.

- **Vous me dites :** « domaine Resend vérifié, adresses créées ».
- **Je fais :** expéditeur `Neomoov <notifications@neomoov.net>`, courriel d'essai depuis le serveur, puis les alertes du personnel vers `operations@`.

---

## 5. Documents des chauffeurs : clés S3 de Supabase (10 minutes)

- **Liens :** réglages du stockage https://supabase.com/dashboard/project/_/settings/storage (choisir le projet de **production**, celui dont l'API se sert) ; compartiments https://supabase.com/dashboard/project/_/storage/buckets

1. Section « S3 Connection » : « Enable connection via S3 protocol » activé. L'adresse et la région sont déjà posées sur le serveur.
2. Section « S3 Access Keys », « New access key » : description `neomoov-api`, « Create ». La page montre l'« Access key ID » et le « Secret access key » **une seule fois**.
3. Git Bash :

```
ssh -t root@78.138.58.92 /opt/neomoov/infra/scripts/env-set.sh S3_ACCESS_KEY
ssh -t root@78.138.58.92 /opt/neomoov/infra/scripts/env-set.sh S3_SECRET_KEY
```

- **Vous me dites :** « clés S3 posées ».
- **Je fais :** création du compartiment privé `documents` s'il manque, `STORAGE_PROVIDER=real`, redémarrage, essai d'envoi et d'ouverture d'un document dans My Hub.

---

## 6. Sauvegardes : phrase secrète et copie hors site (10 minutes, puis une décision)

1. Fabriquer la phrase sans la voir : `ssh -t root@78.138.58.92 /opt/neomoov/infra/scripts/env-set.sh BACKUP_PASSPHRASE --generate`
2. La copier dans Bitwarden, sur votre écran seulement : `ssh root@78.138.58.92 "grep '^BACKUP_PASSPHRASE=' /opt/neomoov/.env"`. **Sans cette copie, aucune sauvegarde ne se relit.**
3. La sauvegarde quotidienne (3 h 30) démarre seule dès la nuit suivante ; je vérifie le journal le lendemain et je fais le premier essai de restauration.

**Décision : la copie hors du serveur.** Le serveur est en France ; une copie quotidienne chiffrée doit vivre ailleurs. Deux voies : un seau de stockage objet au Canada (par exemple le stockage de Supabase dans un second projet, ou un fournisseur canadien), ou Backblaze B2 (le moins cher). Dites-moi laquelle ; je configure `rclone` sur le serveur avec vous (vous tapez la clé du stockage dans la session, elle ne passe pas par moi) et je pose `BACKUP_REMOTE`.

**Décision : la restauration à un instant donné de Supabase (PITR).** Option payante du projet de production ; elle ramène la perte maximale à une heure (objectif du cahier des charges avant le lancement commercial). À activer dans le projet, « Add-ons », quand vous le décidez.

---

## 7. GitHub : rendre le dépôt privé (2 minutes)

https://github.com/neomoov1-ui/neomoov, « Settings », tout en bas « Danger Zone », « Change repository visibility », **Private**, confirmer. Les déploiements continuent depuis le poste (`git push lws`), rien d'autre ne change. Facultatif ensuite : environnement `production` et secrets de déploiement (`docs/operations/acces-a-fournir.md`, section 4) pour déployer depuis GitHub.

---

## 8. Vapi : l'accueil téléphonique et l'appel SOS (20 minutes)

La configuration des assistants est désormais dans le code (`docs/voice-agent.md`) : vous n'avez rien à construire dans le tableau de bord de Vapi. Il vous reste la facturation, l'import du numéro, la clé, le secret et deux réglages.

- **Liens :** tableau de bord https://dashboard.vapi.ai ; numéros https://dashboard.vapi.ai/phone-numbers ; clés d'API : menu de l'organisation, « API Keys » ; facturation : « Billing »

**Étape A. Facturation.** Carte d'entreprise et plafond mensuel (« Spending limit ») de 100 $ US. Les minutes d'appel (modèle, voix, transcription, téléphonie) sont facturées par Vapi.

**Étape B. Importer le numéro principal Twilio.** « Phone Numbers », « Create Phone Number », **« Import Twilio »** : numéro au format `+1…`, Account SID, Auth Token (saisis chez Vapi, jamais dans un message), libellé `Neomoov`, « Import from Twilio ». Vapi règle lui-même le webhook vocal du numéro chez Twilio ; le webhook des textos (section 2, étape C) reste en place. **Ne pas acheter de numéro chez Vapi** (numéros américains).

**Étape C. Clé d'API.** « API Keys », « Create key », nom `neomoov-api`, type **Private**. Git Bash : `ssh -t root@78.138.58.92 /opt/neomoov/infra/scripts/env-set.sh VAPI_API_KEY`

**Étape D. Secret du webhook.** `ssh -t root@78.138.58.92 /opt/neomoov/infra/scripts/env-set.sh VAPI_WEBHOOK_SECRET --generate` (rien à copier ailleurs : mon script l'inscrit chez Vapi).

**Étape E. Deux réglages dans My Hub**, Administration, **Paramètres** : `voice.transfer_number` (le numéro vers lequel l'assistant transfère un appel : votre cellulaire ou celui de la personne de garde, format `+1…` ; la valeur de départ `+1 514 555-0100` est fictive) et `alerts.founder_phone` (votre cellulaire : c'est lui que l'assistant SOS appelle).

- **Vous me dites :** « Vapi est posé, numéro importé ».
- **Je fais :** `vapi:setup` sur le serveur (crée « Neomoov accueil » et « Neomoov SOS », rattache le numéro, inscrit l'assistant SOS dans les réglages), `VOICE_PROVIDER=real`, redémarrage, puis l'essai à deux : vous appelez le numéro, demandez un prix, réservez, rappelez pour l'état et l'annulation, dites « c'est une urgence » (transfert vers votre numéro). Voix par défaut : français du Québec (Azure « Sylvie ») ; dites-moi si vous préférez une voix masculine (« Antoine », « Jean ») ou une voix ElevenLabs. Le modèle de conversation est Claude par l'intégration de Vapi (facturé par Vapi) ; on peut brancher votre propre clé Anthropic dans Vapi, « Integrations », plus tard.

Pour les appels sortants de prospection (phase 3 du plan « entreprise autonome »), un troisième numéro Twilio dédié sera importé de la même façon le moment venu.

---

## 8 bis. ElevenLabs : une voix premium, si la voix Azure ne suffit pas (15 minutes)

La voix par défaut de l'accueil téléphonique est la voix québécoise « Sylvie » d'Azure, fournie par Vapi sans compte supplémentaire. ElevenLabs offre des voix plus naturelles, multilingues (la même voix passe du français à l'anglais), le clonage d'une voix réelle (avec l'autorisation écrite de la personne) et une narration de meilleure qualité pour les vidéos de l'Academy et du marketing (aujourd'hui produites par Piper sur le serveur). À ouvrir après le premier essai d'appel, si la voix Azure ne vous convient pas.

- **Liens :** https://elevenlabs.io ; bibliothèque de voix : menu « Voices », « Explore » ; clés : menu du profil, « API Keys »

**Étape A. Compte et formule.** Inscription avec `neomoov1@gmail.com`, formule « Creator » (environ 22 $ US par mois, une centaine de minutes de synthèse ; « Starter » à 5 $ pour essayer). Ranger le mot de passe dans Bitwarden.

**Étape B. Choisir la voix.** « Voices », « Explore » : filtrer langue **French**, accent **Canadian**, écouter, « Add to my voices ». Ouvrir la voix ajoutée et copier son **Voice ID** (chaîne de 20 caractères, non secrète). Pour cloner une voix réelle (la vôtre ou celle d'une comédienne) : « Voices », « Add a new voice », « Instant Voice Clone », 1 à 3 minutes d'audio propre, autorisation écrite conservée.

**Étape C. Brancher chez Vapi.** Vapi, menu de l'organisation, « Integrations » (ou « Provider Keys »), **ElevenLabs** : coller la clé d'API ElevenLabs (saisie chez Vapi, jamais dans un message). Les voix de votre compte deviennent utilisables par l'assistant.

**Étape D. Pour la narration des vidéos.** `ssh -t root@78.138.58.92 /opt/neomoov/infra/scripts/env-set.sh ELEVENLABS_API_KEY` : j'ajoute la variable au code (narration de l'Academy et chaîne vidéo de la phase 1) dès qu'elle existe.

- **Vous me dites :** « ElevenLabs posé, voix : <identifiant> ».
- **Je fais :** `vapi:setup --voice=11labs:<identifiant>` (l'assistant change de voix en une minute), puis la narration des prochaines vidéos avec cette voix.

---

## 9. Meta Business : WhatsApp (30 minutes, plus la vérification de l'entreprise)

- **Liens :** vérification de l'entreprise https://business.facebook.com/settings/security ; applications https://developers.facebook.com/apps ; utilisateurs système https://business.facebook.com/settings/system-users ; comptes WhatsApp https://business.facebook.com/settings/whatsapp-business-accounts
- **Préalable :** la vérification de l'entreprise (lancée le 25 septembre). Les étapes A à F se font sans attendre ; l'étape G (paiement, mode « En ligne ») attend la vérification. Dites-moi où elle en est.

**Étape A. L'application Meta.** developers.facebook.com, « Mes applications », « Créer une application » : cas d'usage « Autre », type **Entreprise**, nom `Neomoov`, portefeuille d'entreprise de GROUPE NSK. Dans le tableau de bord de l'application, ajouter le produit **WhatsApp** (et, pour la phase 1 du plan autonome, **Messenger** et **Instagram** : même application, inutile d'en créer une autre).

**Étape B. Le numéro WhatsApp.** « WhatsApp », « Configuration de l'API » (API Setup), « Ajouter un numéro de téléphone » : nom affiché `Neomoov`, catégorie « Transport », le **second** numéro Twilio, vérification par **texto**. Le code arrive chez Twilio : console Twilio, « Monitor », « Logs », « Messaging », ouvrir le message entrant pour lire le code. Une fois vérifié, la même page affiche l'**identifiant du numéro de téléphone** (Phone number ID) : `… env-set.sh WHATSAPP_PHONE_ID`. Puis, dans WhatsApp Manager, « Numéros de téléphone », réglages du numéro, **vérification en deux étapes** : choisir un NIP à 6 chiffres et le ranger dans Bitwarden (sans lui, personne ne peut déplacer le numéro). Si le code de vérification n'arrive pas après deux essais (certains expéditeurs courts n'atteignent pas les numéros Twilio), dites-le-moi : on passera par une carte SIM prépayée dédiée.

**Étape C. Le jeton permanent.** Page des utilisateurs système, « Ajouter » : nom `neomoov-api`, rôle **Admin**. « Attribuer des actifs » : l'application `Neomoov` (contrôle total) et le compte WhatsApp Business `Neomoov` (contrôle total). « Générer un nouveau jeton » : application `Neomoov`, expiration **Jamais**, autorisations `whatsapp_business_messaging` et `whatsapp_business_management` (et, si elles sont proposées grâce aux produits Messenger et Instagram : `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`, `instagram_basic`, `instagram_manage_messages`, pour la boîte unifiée de la phase 1). Le jeton n'est affiché qu'une fois : `… env-set.sh WHATSAPP_TOKEN`.

**Étape D. Le secret de l'application.** Application `Neomoov`, « Paramètres de l'application », « De base », « Clé secrète », « Afficher » : `… env-set.sh WHATSAPP_APP_SECRET`. Sans lui, l'API refuse tout message entrant (signature `X-Hub-Signature-256`). Sur la même page, renseigner l'adresse de la politique de confidentialité (page du site) et le courriel de contact : exigés pour passer l'application « En ligne ».

**Étape E. Le jeton de vérification du webhook, puis le redémarrage.**

```
ssh -t root@78.138.58.92 /opt/neomoov/infra/scripts/env-set.sh WHATSAPP_VERIFY_TOKEN --generate
ssh -t root@78.138.58.92 /opt/neomoov/infra/scripts/env-set.sh WHATSAPP_PHONE_ID --recreate api worker
```

(La seconde commande redemande l'identifiant du numéro et redémarre l'API : elle doit connaître le jeton **avant** l'étape F.) Puis afficher le jeton sur votre écran pour le coller chez Meta : `ssh root@78.138.58.92 "grep '^WHATSAPP_VERIFY_TOKEN=' /opt/neomoov/.env"`.

**Étape F. Le webhook chez Meta.** Application, « WhatsApp », « Configuration », encadré « Webhook », « Modifier » : adresse de rappel `https://api.neomoov.net/v1/webhooks/whatsapp`, jeton de vérification = la valeur affichée à l'étape E, « Vérifier et enregistrer » (Meta appelle l'API, qui répond au défi). Puis « Gérer » (champs du webhook) : s'abonner à **`messages`**.

**Étape G. Après la vérification de l'entreprise.** Page des comptes WhatsApp, compte `Neomoov`, « Paramètres », « Moyen de paiement » : carte d'entreprise (sans lui, Meta bloque les conversations ouvertes par Neomoov, comme les rappels de course). Puis l'application passe en mode **« En ligne »** (interrupteur en haut de la page de l'application) : en mode développement, seuls les numéros de test reçoivent les messages.

- **Vous me dites :** « WhatsApp est posé » (et où en est la vérification).
- **Je fais :** abonnement de l'application au compte WhatsApp (appel d'API depuis le serveur), `WHATSAPP_PROVIDER=real`, redémarrage, essai : vous écrivez « Bonjour » au numéro depuis votre WhatsApp, l'agent relation client répond. Les gabarits de messages (rappels de course hors fenêtre de 24 heures), je les soumets à Meta quand ils serviront.

---

## 10. Serveur : les autres variables, dans l'ordre d'utilité

| Variable | Où la trouver | Commande (Git Bash) | Ce que ça apporte |
|---|---|---|---|
| `SENTRY_ENVIRONMENT` | valeur fixe `production` | je la pose | Erreurs de l'API étiquetées « production » |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry, projet `web` (plateforme Next.js), « Client Keys (DSN) » | `… env-set.sh NEXT_PUBLIC_SENTRY_DSN --build` | Erreurs de My Hub et de la réservation web |
| `EXPO_PUBLIC_SENTRY_DSN` | Sentry, projet `mobile` (React Native) | variables des projets EAS (section 12) | Plantages des applications |
| `BETTERSTACK_HEARTBEAT_URL` | Better Stack, Uptime, « Heartbeats », nouveau battement `neomoov-worker` (période 1 min, délai 3 min) : copier l'adresse | `… env-set.sh BETTERSTACK_HEARTBEAT_URL --recreate worker` | Alerte quand le worker s'arrête |
| Moniteurs Better Stack | Uptime, « Monitors » : `https://api.neomoov.net/v1/health`, `https://hub.neomoov.net`, `https://reserver.neomoov.net`, toutes les 3 minutes ; « On-call » : votre téléphone et l'application mobile | aucune variable | Alerte quand l'API ou un site tombe |
| `REVIEW_PHONES`, `REVIEW_OTP_CODE` | deux numéros fictifs `+15145550101,+15145550102` et un code de 6 chiffres de votre choix (ni répétitif ni `123456`) | `… env-set.sh REVIEW_PHONES` puis `… env-set.sh REVIEW_OTP_CODE --recreate api worker` | Comptes d'examen d'Apple et de Google (l'examinateur ne reçoit pas de texto) ; à vider après la publication |
| HubSpot | section 10 bis | | CRM automatique |
| `APPLE_CLIENT_IDS`, `GOOGLE_CLIENT_IDS` | section 12 (après Apple et Google Play) | `… env-set.sh …` | Connexion Apple et Google (l'API est prête ; aucun écran ne la propose encore : pas bloquant) |
| Square, bac à sable (poste seulement) | Square Developer, « Credentials », onglet Sandbox : « Sandbox Access token » (commence par `EAAA`) et un emplacement du bac à sable | dans `C:\Users\PC\code\neomoov\.env` : `SQUARE_SANDBOX_ACCESS_TOKEN` (la variable contient aujourd'hui l'identifiant d'application, pas le jeton) et `SQUARE_SANDBOX_LOCATION_ID` | Essais de paiement en bac à sable sur le poste ; la production Square est déjà bonne |
| Stripe | compte en validation | rien tant qu'il n'est pas activé | Square encaisse en attendant |
| ClamAV (antivirus des documents) | profil Docker déjà activé sur le serveur ; je vérifie sa mémoire et son état | aucune | Analyse réelle des documents |

---

## 10 bis. HubSpot : configuration, puis un CRM qui se tient à jour tout seul (20 minutes)

Référence complète : `docs/crm.md`. État constaté le 1er octobre : compte gratuit n° 343738989, données hébergées à Montréal (`na3`), fuseau de l'Est, **devise en USD**, jeton limité aux contacts (**9 portées manquantes**), mise en place du modèle refusée faute de portées. La plateforme est la source de vérité ; HubSpot est le miroir que l'équipe commerciale regarde. Aucune ressaisie : tout ce qui suit se fait automatiquement une fois branché.

**Étape A. Réglages du compte (5 minutes).** Roue dentée, « Paramètres par défaut du compte » : devise **CAD** (avant la première transaction avec un montant), langue français, fuseau Montréal. « Confidentialité et consentement » : fonctions de confidentialité activées. « IA » : fonctions d'IA qui lisent les fiches désactivées tant que l'évaluation Loi 25 n'est pas signée. Ne jamais installer l'extension WordPress de HubSpot ni l'application « Stripe Data Sync » (elles aspireraient réservations et paiements).

**Étape B. Les portées du jeton (5 minutes).** Paramètres, « Intégrations », « Applications privées » (ou « Clés de service »), l'application « Plateforme Neomoov », onglet « Portées » : ajouter, en plus de celles déjà cochées, `crm.schemas.contacts.write`, `crm.objects.companies.read`, `crm.objects.companies.write`, `crm.schemas.companies.read`, `crm.schemas.companies.write`, `crm.objects.deals.read`, `crm.objects.deals.write`, `crm.schemas.deals.read`, `crm.schemas.deals.write` (et la portée des notes si elle est proposée). Enregistrer. Si HubSpot affiche un **nouveau jeton** : `ssh -t root@78.138.58.92 /opt/neomoov/infra/scripts/env-set.sh HUBSPOT_ACCESS_TOKEN`.

**Étape C. Les personnes.** Paramètres, « Utilisateurs et équipes » : inviter les personnes qui suivront les ventes (formule gratuite : places illimitées, outils de base). Les contacts qui ne doivent pas recevoir de courriels marketing (candidats chauffeurs, partenaires) se marquent « non marketing » dans HubSpot.

- **Vous me dites :** « HubSpot : devise CAD et portées ajoutées ».
- **Je fais :** `HUBSPOT_PORTAL_ID=343738989` (non secret), `crm:setup` sur le serveur en simulation puis pour de vrai (groupe de propriétés « Neomoov », 25 propriétés, pipeline « Neomoov » avec les douze étapes des deux parcours), `CRM_PROVIDER=real`, retrait de `crm` des simulés, redémarrage, puis l'essai de bout en bout : une préinscription chauffeur d'essai sur le site devient en moins d'une minute un contact avec sa transaction « Candidature reçue ».

**Ce qui se fait ensuite tout seul, et quand :**

| Événement dans la plateforme | Dans HubSpot | Délai |
|---|---|---|
| Prospect du site avec consentement : candidature chauffeur, demande d'entreprise ou de partenaire, préinscription à la formation | Contact (prénom, nom, courriel, téléphone, ville, langue, type de prospect, consentement daté) + transaction au bon parcours (« Candidature reçue », « Préinscrit à la formation », « Nouveau prospect ») + note avec le message | Quelques secondes (file `crm` du worker) |
| Compte d'affaires ouvert (client entreprise sous contrat) | Entreprise + contact de facturation + transaction « Client actif » | Idem |
| Organisation cliente créée (marque blanche, flotte, compagnie) puis abonnée | Entreprise (type, formule) + transaction « Essai en cours », « Contact établi » ou « Client actif » | Idem |
| Phase 1, agent ventes : prospect B2B trouvé, qualifié, contacté (courriel, WhatsApp, appel sortant), relancé, rendez-vous pris, devis émis | Contact et entreprise créés ou mis à jour, transaction qui avance d'étape, note par contact (résumé d'appel, résultat), relances planifiées | À chaque action de l'agent |
| Attestation Neomoov Chauffeur Pro obtenue, formation payée, certifié | Transaction du parcours « Formation chauffeurs » qui avance (« Formation payée », « Certifié ») | Idem |
| Panne de HubSpot | Rien ne bloque : cinq nouvelles tentatives, puis une passe toutes les dix minutes reprend les fiches en erreur et rattrape les 48 dernières heures | Automatique |

Une fiche est identifiée par la propriété « Identifiant Neomoov » : rejouer ne duplique jamais ; un contact qui porte déjà le même courriel (Tidio, saisie manuelle) est mis à jour. Ne partent jamais : trajets, adresses personnelles, positions, paiements, passagers. Suivi : My Hub, files de tâches (file `crm`), et la page « Prospects ». Formule gratuite : un seul pipeline (les deux parcours dans « Neomoov », filtrés par la propriété « Parcours Neomoov ») ; passer à Starter quand il faut deux pipelines, plus de 1 000 contacts marketing ou l'hébergement à Montréal garanti par contrat (`crm:setup` crée alors les deux pipelines). HubSpot ne fait aucune relance lui-même : ce sont les agents de la plateforme qui relancent, HubSpot en garde la trace.

---

## 11. My Hub, Administration, Paramètres (10 minutes, aucune valeur secrète)

| Réglage | Valeur | Pourquoi |
|---|---|---|
| `company.legal_name` | « GROUPE NOUVEAU SYSTEME KARDINAL (GROUPE NSK) INC. » (décision D25 ; à confirmer avec le comptable pour les factures Neomoov) | Mention obligatoire des factures |
| `company.address` | adresse légale complète | Idem |
| `company.gst_number`, `company.qst_number` | numéros de TPS et de TVQ | **Bloquant avant la première facture réelle** |
| `support.phone` | le numéro principal Twilio | Écran Assistance des applications, fiches des magasins |
| `support.email` | `assistance@neomoov.net` | Idem, et recours de la page de suppression de compte |
| `voice.transfer_number`, `alerts.founder_phone` | section 8 | Transfert et SOS |
| `agents.report_recipients` | `operations@neomoov.net` (sinon : tous les administrateurs) | Rapports quotidiens des agents |
| `legal.privacy_policy_version`, `legal.terms_version` | date de la version publiée sur le site | Acceptation à la création des comptes |
| `punctuality.enabled` et les montants D10 | votre décision (5 $, 10 $, remboursement au-delà de 30 minutes) | Garantie de ponctualité |

---

## 12. Applications mobiles et magasins

Dites-moi d'abord où en sont les deux validations (Apple Developer, Google Play Console) et si les deux projets EAS existent dans l'organisation Expo (ils ont servi aux compilations Android du 1er octobre).

| Élément | Vous | Moi |
|---|---|---|
| Apple validé | Team ID dans `apple.txt` ; deux identifiants d'application (`com.neomoov.client`, `com.neomoov.driver` : Sign in with Apple, Push, Maps, Background Modes pour le chauffeur) ; identifiant de service `net.neomoov.web` ; clé d'API App Store Connect (rôle Admin, fichier `.p8` dans `cles-neomoov`, Key ID et Issuer ID dans `apple.txt`) ; fiches des deux applications dans App Store Connect | Compilations iPhone, TestFlight, `APPLE_CLIENT_IDS`, soumission |
| Google Play validé | Projet Google Cloud lié, compte de service `neomoov-eas` (JSON dans `cles-neomoov\google-play-service-account.json`, droits de publication), deux applications créées (`Neomoov`, `Neomoov Chauffeur`) | Premier `.aab` envoyé à la main, tests internes puis fermés, soumission |
| Clés Google Maps des applications | déjà créées ; je les pose dans les variables des projets EAS depuis le poste | Nouveau build |
| Client OAuth Android | après l'empreinte SHA-1 que je vous donne : deux clients Android dans Google Cloud, identifiants ajoutés à `GOOGLE_CLIENT_IDS` | |
| Comptes d'examen | `REVIEW_PHONES` et `REVIEW_OTP_CODE` (section 10), le code dans les notes d'examen des deux magasins | Comptes de démonstration préparés |
| Fiches des magasins | adresse d'assistance (`assistance@`), politique de confidentialité et page d'assistance publiées sur neomoov.net ; vidéo de démonstration de la localisation en arrière-plan (téléphone, YouTube non répertorié) pour l'application chauffeur | Textes et captures (`docs/store/`) |
| Liens réels de téléchargement | Google Play ou APK, App Store ou TestFlight | `node outils/qr.js --android=… --ios=…` : pages `/application-android/`, `/application-ios/` et codes QR mis à jour |

---

## 13. Site neomoov.net, Academy et courriels marketing

- **Brevo, scénarios d'automatisation** : les 20 brouillons (`NCP_…`) sont dans Brevo ; les quatre scénarios (recrutement, inscrits sans achat, acheteurs, abandons de panier : J0, J1, J3, J5, J7) se créent dans « Automations » (je vous donne le pas-à-pas avec les noms exacts des listes et des attributs, 20 minutes), et le domaine `neomoov.net` doit être authentifié dans Brevo (« Expéditeurs et IP », « Domaines », enregistrements DKIM chez LWS). Double consentement (« double opt-in ») sur le formulaire gratuit : à activer dans le formulaire Brevo.
- **Tidio** : décider entre garder Tidio (formule gratuite limitée) ou le remplacer par l'agent de discussion de la plateforme quand la boîte unifiée (phase 1) sera livrée ; en attendant, désactiver le formulaire qui exige le courriel avant la discussion (Paramètres, Live Chat, Apparence, « Pre-Chat Survey »).
- **WordPress** : après la mise en service, faire tourner le mot de passe d'application utilisé par les outils de publication (Utilisateurs, votre profil, « Mots de passe d'application ») et me le dire ; les clés Square du paiement Academy vont dans `wp-config.php` (je prépare la modification, vous la collez).
- **Conditions de vente de l'Academy** : elles disent encore « vidéos non incluses » alors que les vidéos sont livrées : décision, puis je corrige la page et le contrat.

---

## 14. Juridique, conformité et décisions (hors technique)

| Sujet | À faire | Référence |
|---|---|---|
| Loi 25 | Désigner et publier le responsable de la protection des renseignements personnels (nom et courriel dans la politique de confidentialité) ; valider la politique à jour avec la liste des sous-traitants (Supabase au Canada ; LWS en France ; Twilio, Vapi, Resend, Anthropic, Meta, HubSpot aux États-Unis) ; signer l'évaluation des facteurs relatifs à la vie privée | `docs/privacy/efvp.md`, `docs/compliance/checklist.md` |
| Résidence des serveurs (D48) | Avis de l'avocat sur l'API hébergée en France ; le passage sur un hôte canadien se fait sans changer le code | `docs/runbooks/deploiement-lws.md`, section 7 |
| Transport | Autorisations CTQ, SAAQ, Aéroports de Montréal, assurances | `docs/compliance/checklist.md` |
| Revenu Québec | Numéros de TPS et de TVQ (section 11) ; choix du fournisseur SEV certifié (l'adaptateur réel sera écrit après le choix) | `docs/sev-adapter.md` |
| Prospection automatisée (phase 1, ventes) | Règles de télémarketing du CRTC pour les appels sortants (identification, heures d'appel, liste interne de numéros exclus ; inscription à la Liste nationale si des particuliers sont appelés) ; Loi canadienne anti-pourriel pour les courriels aux entreprises (consentement tacite, mécanisme de retrait) ; annonce d'enregistrement si les appels sont enregistrés (ils ne le sont pas aujourd'hui) | avis de l'avocat avant l'activation |
| Formation (Academy) | Avis de l'avocat sur la Loi sur la protection du consommateur (vente de formation) | `livrables/rédaction/neomoov-formation-chauffeurs/00-plan-du-tunnel.md` |
| Décisions métier en attente | Redevance 10 % (non publiée : contredit « sans commission ») ; packs obligatoires ; crédits en paiement direct (interdit aujourd'hui, réversible) ; exigence des quiz avant l'examen ; garantie de ponctualité D10 ; règle « 1 $ sous la concurrence » (qui absorbe l'écart) ; HubSpot gratuit ou Starter ; option Priorité ; prépaiement Interac ; voix québécoise de l'assistant | `context/REPRISE-NEOMOOV.md`, section 4 |

---

## 15. Phase 1 « entreprise autonome » : les comptes à ouvrir ensuite (pas aujourd'hui)

Les trois agents de développement livrent avec leur code un pas-à-pas par réseau ; je vous le remettrai avec leur rapport. Pour anticiper, dans l'ordre d'utilité :

1. **Meta** (même application que la section 9) : page Facebook et compte Instagram professionnel rattachés au portefeuille ; produits Messenger et Instagram ; jeton de page.
2. **Google** : Search Console (vérifier `neomoov.net` par l'enregistrement DNS), fiche d'établissement (Business Profile), chaîne YouTube, agenda Google pour les rendez-vous commerciaux ; une seule application OAuth dans le projet `neomoov`.
3. **LinkedIn** : page entreprise et application « Community Management ».
4. **TikTok for Developers** (Content Posting), **X** (API v2, formule de base, payante), **Snapchat** (Marketing API).
5. **Brevo** : relais entrant (« inbound parsing ») de `contact@neomoov.net` vers la boîte unifiée.
6. **Signature électronique** (PandaDoc ou DocuSign) et comptes publicitaires (Meta Ads, Google Ads) : phase 4.

---

## 16. Récapitulatif : ordre conseillé, et ce que je fais à chaque étape

| Ordre | Vous faites | Vous me dites | Je fais |
|---|---|---|---|
| 1 | Section 2 : Twilio (numéros, webhook, permissions, trois variables) | « Twilio est posé » | Bascule des textos, code de connexion réel, réponse automatique à un texto |
| 2 | Section 3 : clé publique du site | « clé publique posée » | Vérification réservation web, site et préinscription |
| 3 | Section 4 : domaine Resend et adresses | « domaine Resend vérifié » | Expéditeur, courriel d'essai, alertes du personnel |
| 4 | Section 5 : clés S3 | « clés S3 posées » | Compartiment, stockage réel, essai de document |
| 5 | Section 6 : phrase des sauvegardes (copie dans Bitwarden) ; choix de la copie hors site | « sauvegarde posée, hors site : … » | Vérification de la première sauvegarde, essai de restauration, `rclone` |
| 6 | Section 7 : dépôt privé | « dépôt privé » | Rien d'autre |
| 7 | Section 8 : Vapi | « Vapi est posé, numéro importé » | `vapi:setup`, bascule, essai d'appel à deux |
| 8 | Section 9 : Meta WhatsApp | « WhatsApp est posé » | Abonnement de l'application, bascule, essai |
| 9 | Section 10 bis : HubSpot (devise CAD, neuf portées) | « HubSpot : devise CAD et portées ajoutées » | `crm:setup`, `CRM_PROVIDER=real`, essai de bout en bout ; ensuite le CRM se tient à jour seul |
| 10 | Sections 10 et 11 : surveillance, réglages de l'entreprise ; section 8 bis si vous voulez une voix ElevenLabs | « réglages faits » | Vérification, bascules restantes, changement de voix |
| 11 | Section 12 : Apple et Google Play dès leur validation | « Apple validé », « Google Play validé » | Compilations, magasins, liens réels, codes QR |
| 12 | Sections 13 et 14 : Brevo, Tidio, décisions, avocat | vos décisions | Corrections du site, de l'Academy, des contrats ; activation des fonctions décidées |
| 13 | Section 15 : comptes des réseaux, quand les agents de la phase 1 ont livré | « comptes ouverts » | Connecteurs réels, passage des agents en mode automatique après quatre semaines sans erreur |

Après chaque étape, je relance la vérification sans affichage (`OK` ou `--` par variable) et je vous donne l'état mis à jour de la section 0.
