# Neomoov. Les 14 comptes externes à créer, dans l'ordre

Version 1.4, 25 septembre 2026 : connexion Google et Apple dans les applications (étape 3 du code, variables GOOGLE_CLIENT_IDS et APPLE_CLIENT_IDS). Historique : v1.3 du 24 septembre au soir (v1.2 le même jour, v1.1 du 23 septembre, v1.0 du 22 septembre) : décisions D49 (Supabase Storage) et D50 (nouveau compte Twilio) prises par le fondateur. Niveau interne. Dérivé de la section 8.5 du document de référence v1.1, du cahier des charges v1.1 (décision D48, serveurs chez LWS) et de la configuration du dépôt (`apps/api/src/config/env.ts`, `apps/*/app.json`, `eas.json`).

Tous les comptes s'ouvrent au nom de **GROUPE NOUVEAU SYSTEME KARDINAL (GROUPE NSK) INC.**, avec l'adresse **`neomoov1@gmail.com`** (décision du 22 septembre 2026). Les clés vont dans **`C:\Users\PC\code\neomoov\.env`**, sous le nom de variable indiqué, jamais dans une conversation, un courriel ou un document. Les fichiers (`.p8`, JSON, mot de passe du serveur) vont dans **`C:\Users\PC\cles-neomoov\`**, jamais dans le dépôt.

**Suite (25 septembre 2026, les 14 comptes existent) :** le guide pas à pas des clés et réglages, compte par compte, est dans `docs/cles-comptes-externes.md`. Bilan du fichier `.env` sans afficher une valeur : `pnpm env:check`.

## Déjà fait (rien à refaire)

| Compte | État |
|---|---|
| **Supabase** | Projet `neomoov-dev`, région Canada (Central), `DATABASE_URL` dans `.env`, 72 tables migrées et semées (24 septembre). Un projet de test puis de production viendront plus tard |
| **GitHub** | Dépôt privé https://github.com/neomoov1-ui/neomoov, commits poussés |
| **Site et courriel** | neomoov.net (WordPress chez LWS) en ligne et indexé ; `contact@neomoov.net` existe et arrive dans le Gmail |
| **D-U-N-S** | 243377415 (obtenu le 22 septembre) |

## À avoir sous la main avant de commencer

- Dénomination légale exacte, NEQ, adresse du siège, date de constitution, numéros de TPS et de TVQ
- D-U-N-S 243377415
- Carte de crédit d'entreprise et spécimen de chèque (Stripe, Apple, Google)
- Pièce d'identité du dirigeant (Apple, Google Play, Stripe en mode réel, Meta)
- Un document officiel au nom de la société avec l'adresse (état de renseignements du Registraire des entreprises, ou relevé bancaire), pour la vérification Meta
- Le gestionnaire de mots de passe (compte 5) ouvert en premier, pour y ranger chaque accès au fur et à mesure

## Quand

| Quand | Comptes | Pourquoi |
|---|---|---|
| Aujourd'hui | 1 (serveur LWS), 2 (Google Maps), 5 (mots de passe), 6 (Stripe test), 7 (Expo) | Bloquent le déploiement, les cartes, les paiements de test et les compilations Android |
| Aujourd'hui aussi, car la validation prend du temps | 3 (Apple), 4 (Google Play), 13 (WhatsApp) | Une à deux semaines de vérification chez chacun ; à lancer sans attendre |
| Cette semaine | 8 (Anthropic), 9 (stockage), 10 (textos), 11 (courriels), 12 (Vapi), 14 (Sentry, Better Stack) | Nécessaires avant l'étape 13 (notifications, agents, vocal) et la mise en ligne bêta |

---

## 1. LWS, serveur VPS KVM (à la place de Railway)

- **Lien :** https://www.lws.fr/vps-kvm.php (le compte client LWS existant, celui de neomoov.net)
- **Coût :** VPS KVM **M** (4 vCore, 8 Go, 150 Go NVMe) : 4,99 € HT le premier mois puis 19,99 € HT par mois, engagement d'un mois
- **À faire :**
  1. Choisir la formule **VPS KVM M**. Pas un « VPS Linux » à panneau ISPConfig ou Hestia, ni un hébergement web, ni Plesk.
  2. Gabarit : **Docker CE**, système **Ubuntu 24.04** (sinon Debian 13, tout aussi bon). Ne cocher ni CapRover, ni Coolify, ni Portainer, ni EasyPanel, ni Supabase.
  3. Si un nom d'hôte est demandé : `vps.neomoov.net`. Si un domaine est demandé : « j'ai déjà un domaine », `neomoov.net`. Clé SSH : laisser vide.
  4. Commander sous le même compte LWS que neomoov.net, pour que le domaine et le serveur soient dans le même panel. Les autres domaines ne sont jamais touchés : seule la zone DNS de neomoov.net recevra trois sous-domaines.
- **Ce que j'attends :** un fichier `C:\Users\PC\cles-neomoov\lws-vps.txt` avec l'adresse IPv4, le mot de passe root reçu par courriel et le nom d'hôte attribué. Tu me dis « le VPS est dans cles-neomoov ». Je sécurise (clé SSH, pare-feu, mises à jour), j'installe Docker Compose et Caddy (TLS), Redis tourne dessus, puis je te donne les trois enregistrements DNS à poser (`api`, `hub`, `reserver`), ou tu me donnes l'accès DNS du panel.

## 2. Google Maps Platform

- **Lien :** https://console.cloud.google.com/google/maps-apis/start (connecté avec `neomoov1@gmail.com`)
- **Coût :** gratuit au départ (quota mensuel gratuit par API), puis à l'usage ; carte obligatoire
- **À faire :**
  1. Créer un projet nommé `neomoov`.
  2. Facturation : compte de facturation avec la carte d'entreprise ; « Budgets et alertes » : 50 $ par mois.
  3. « API et services », « Bibliothèque » : activer **Routes API**, **Places API (New)**, **Geocoding API**, **Maps SDK for Android**, **Maps SDK for iOS**.
  4. « API et services », « Identifiants », « Créer des identifiants », « Clé API », trois fois :
     - `neomoov-serveur` : restriction d'API : Routes, Places, Geocoding ; restriction d'application : aucune pour l'instant (adresses IP dès que le serveur LWS existe)
     - `neomoov-ios` : restriction d'application « Applications iOS », identifiants `com.neomoov.client` et `com.neomoov.driver`
     - `neomoov-android` : restriction d'application « Applications Android », paquets `com.neomoov.client` et `com.neomoov.driver` ; l'empreinte SHA-1, je te la donne après les premières compilations Expo, laisse vide d'ici là
  5. **Connexion Google dans les applications** (étape 3 du code, 25 septembre 2026) : « API et services », « Écran de consentement OAuth » (ou « Google Auth Platform ») : type Externe, nom `Neomoov`, courriel `neomoov1@gmail.com`, domaine `neomoov.net`. Puis « Clients », « Créer un client » : **Application Web** (`neomoov-web`, origines `https://hub.neomoov.net` et `https://reserver.neomoov.net`), **iOS** (un client par identifiant de bundle : `com.neomoov.client`, `com.neomoov.driver`), **Android** (paquets `com.neomoov.client` et `com.neomoov.driver`, empreinte SHA-1 plus tard). Chaque client donne un « ID client » en `.apps.googleusercontent.com`.
- **Ce que j'attends :** `GOOGLE_MAPS_SERVER_KEY`, `GOOGLE_MAPS_IOS_KEY`, `GOOGLE_MAPS_ANDROID_KEY` et `GOOGLE_CLIENT_IDS` (tous les ID clients, séparés par des virgules) dans `.env`

## 3. Apple Developer Program, compte d'organisation

- **Liens :** vérifier le D-U-N-S https://developer.apple.com/enroll/duns-lookup/ puis s'inscrire https://developer.apple.com/programs/enroll/ (ou l'application « Apple Developer » sur iPhone, souvent plus rapide pour la vérification d'identité)
- **Coût :** 99 $ US par an
- **À faire :**
  1. Identifiant Apple `neomoov1@gmail.com`, avec la validation en deux étapes activée.
  2. Vérifier que le D-U-N-S 243377415 renvoie bien la dénomination légale et l'adresse du siège. Si une donnée diffère, la corriger chez Dun & Bradstreet avant de s'inscrire.
  3. S'inscrire comme **Organisation** : dénomination légale, D-U-N-S, site `neomoov.net`, courriel au nom du domaine `contact@neomoov.net`, téléphone, et confirmer que tu as le pouvoir d'engager la société.
  4. Payer et attendre la validation : deux jours à deux semaines, Apple appelle parfois le numéro indiqué.
- **Ne pas convertir** le compte individuel actuel (équipe DNB64CQYH6) : il porte les applications de Taxi Sylvain.
- **Connexion avec Apple** (étape 3 du code) : une fois le compte validé, « Certificates, Identifiers & Profiles », « Identifiers » : les identifiants d'application `com.neomoov.client` et `com.neomoov.driver` avec la capacité « Sign in with Apple », plus un « Services ID » (`net.neomoov.web`) pour My Hub et la réservation web. Ces trois identifiants vont dans `APPLE_CLIENT_IDS` (séparés par des virgules).
- **Ce que j'attends :** rien avant la validation. Ensuite, dans App Store Connect, « Utilisateurs et accès », « Intégrations », « Clés d'API App Store Connect » : une clé de rôle **Admin**, nommée `claude-code`. Télécharger le fichier `.p8` (possible une seule fois) dans `C:\Users\PC\cles-neomoov\`, et noter à côté, dans `apple.txt` : l'identifiant de clé, l'identifiant d'émetteur (Issuer ID) et l'identifiant d'équipe (Team ID).

## 4. Google Play Console, compte d'organisation

- **Lien :** https://play.google.com/console/signup (connecté avec `neomoov1@gmail.com`)
- **Coût :** 25 $ US une fois
- **À faire :**
  1. Type de compte **Organisation** : dénomination légale, D-U-N-S 243377415, adresse, téléphone et courriel vérifiés, site `neomoov.net`.
  2. Vérification d'identité du représentant (pièce d'identité), parfois un document de l'entreprise. Validation en deux à sept jours.
  3. Un compte d'organisation évite l'obligation des comptes personnels (12 testeurs pendant 14 jours avant toute publication).
- **Ce que j'attends :** rien avant la validation. Ensuite, « Paramètres », « Accès à l'API » : lier le projet Google Cloud `neomoov` (compte 2), créer un compte de service, lui accorder le rôle « Administrateur des versions » dans la console, et enregistrer sa clé JSON sous `C:\Users\PC\cles-neomoov\google-play-service-account.json` (chemin déjà attendu par `eas.json`).

## 5. Gestionnaire de mots de passe

- **Liens :** 1Password https://1password.com/sign-up (environ 8 $ US par utilisateur par mois) ou Bitwarden, gratuit https://bitwarden.com/go/start-free/
- **À faire :** un coffre « Neomoov » ; y ranger l'accès de chacun des comptes de cette liste au moment de sa création ; activer la validation en deux étapes partout, le gestionnaire peut porter les codes.
- **Ce que j'attends :** rien. Aucun mot de passe ne transite jamais par un message.

## 6. Stripe

- **Lien :** https://dashboard.stripe.com/register
- **Coût :** rien en mode test ; en réel, 2,9 % + 0,30 $ par transaction, Connect en sus
- **À faire maintenant (mode test) :**
  1. Compte au nom de la société, pays Canada.
  2. « Développeurs », « Clés d'API » : copier la clé secrète de test (`sk_test_…`) et la clé publiable de test (`pk_test_…`).
  3. « Connect », « Commencer » : comptes **Express** (ce sont les chauffeurs), plateforme de type « place de marché ».
  4. « Paramètres », « Moyens de paiement » : Apple Pay et Google Pay activés. Le domaine `neomoov.net` sera ajouté pour Apple Pay quand le site de réservation sera en ligne.
- **À faire avant le lancement (mode réel) :** activation du compte : NEQ, adresse, compte bancaire, pièce d'identité du dirigeant, description de l'activité.
- **Ce que j'attends :** `STRIPE_SECRET_KEY` et `STRIPE_PUBLISHABLE_KEY` (test) dans `.env`. `STRIPE_WEBHOOK_SECRET` vient plus tard : je crée le point de réception quand l'API est en ligne et je te dis où lire la valeur.

## 7. Expo : nouveau compte au nom de Neomoov (choix du fondateur, 24 septembre 2026)

- **Lien :** https://expo.dev/signup (avec `neomoov1@gmail.com`), compte distinct de celui qui porte Taxi Sylvain
- **Coût :** gratuit (30 compilations par mois avec file d'attente, quota propre au compte) ; forfait Production à 99 $ US par mois seulement si l'attente des compilations devient un frein
- **À faire :**
  1. Créer le compte : nom d'utilisateur `neomoov` (ou `neomoov-inc` si pris), validation en deux étapes activée.
  2. Menu du compte, **Create organization** : `neomoov`. L'organisation est la propriétaire des projets ; d'autres personnes pourront y être ajoutées plus tard sans partager le mot de passe.
  3. Réglages de cette organisation, **Access tokens** (ou un « robot user » nommé `claude-code`) : créer un jeton.
- **Ce que j'attends :** `EXPO_TOKEN` dans `.env` (jeton de l'organisation `neomoov`). Je crée ensuite les deux projets EAS et je lance les compilations Android de test ; iOS attend Apple (compte 3). Rien n'est repris de l'ancien compte : certificats et clés seront créés dans celui-ci.

## 8. Anthropic, console de l'API

- **Lien :** https://console.anthropic.com (avec `neomoov1@gmail.com`)
- **Coût :** à l'usage, crédits prépayés
- **À faire :**
  1. Organisation `Neomoov`.
  2. « Facturation » : carte, achat de crédits (25 $ suffisent pour commencer), limite mensuelle fixée à 100 $.
  3. « Clés d'API » : créer `neomoov-api`.
- **Ce que j'attends :** `ANTHROPIC_API_KEY` dans `.env` (agents IA des conversations, entretien vocal des candidats, WhatsApp)

## 9. Stockage des documents : Supabase Storage (décision D49, 24 septembre 2026)

- **Pourquoi :** la décision D48 garde la base **et les documents** au Canada. Cloudflare R2 n'a aucune région canadienne. Supabase Storage vit dans le projet `neomoov-dev`, région Canada (Central), parle le protocole S3 attendu par le code, et ne demande aucun compte de plus. Cloudflare R2 est abandonné.
- **Lien :** https://supabase.com/dashboard (projet `neomoov-dev`)
- **Coût :** compris (1 Go sur le plan gratuit, 100 Go sur le plan Pro)
- **À faire :**
  1. « Storage », « New bucket » : `documents`, **privé**.
  2. « Storage », « Settings » (ou « Project Settings », « Storage ») : activer **S3 protocol**, puis « New access key » nommée `neomoov-api`. Noter l'adresse « Endpoint » affichée.
- **Ce que j'attends :** `S3_ENDPOINT`, `S3_BUCKET=documents`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` dans `.env`

## 10. Textos et numéro vocal : nouveau compte Twilio au nom de Neomoov (décision D50, 24 septembre 2026)

- **Pourquoi Twilio :** un numéro canadien s'achète en deux minutes, et Vapi (compte 12) sait importer un numéro Twilio pour l'agent vocal : un seul fournisseur pour les textos et la voix. Compte **distinct** de celui de Taxi Sylvain, pour que Neomoov reste autonome. Telnyx abandonné.
- **Lien :** https://www.twilio.com/try-twilio (avec `neomoov1@gmail.com`)
- **Coût :** environ 1,15 $ US par mois par numéro, moins de 1 ¢ par texto, environ 1,4 ¢ par minute d'appel ; premier dépôt de 20 $ US à la mise à niveau
- **À faire :**
  1. Créer le compte : courriel `neomoov1@gmail.com`, vérification du courriel et d'un téléphone. Dans le questionnaire de départ : « SMS » et « Voice », « with code », JavaScript.
  2. **Mettre le compte à niveau tout de suite** (« Upgrade », carte, dépôt de 20 $ US) : un compte d'essai n'envoie qu'aux numéros vérifiés, ajoute une mention d'essai dans chaque texto et ne permet pas d'acheter un numéro canadien.
  3. « Phone Numbers », « Buy a number » : pays **Canada**, capacités **SMS et Voice** cochées, indicatif 514 ou 438 (Montréal), sinon 450. Aucun dossier réglementaire n'est exigé pour un numéro canadien.
  4. Sur la page d'accueil de la console, section « Account Info » : copier le **Account SID** et l'**Auth Token**.
  5. Facultatif mais utile : « Account », « Manage account », « Sub-accounts » n'est pas nécessaire ; un seul compte pour Neomoov.
- **Ce que j'attends :** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (au format +1XXXXXXXXXX) dans `.env`. Le numéro servira aussi au compte 12 (Vapi) et un second numéro, acheté de la même façon, servira à WhatsApp (compte 13).

## 11. Courriels transactionnels : Resend (recommandé) ou Brevo existant

- **Lien :** https://resend.com/signup (avec `neomoov1@gmail.com`) ; sinon le compte Brevo existant https://app.brevo.com
- **Coût :** gratuit jusqu'à 3 000 courriels par mois, puis 20 $ US
- **À faire (Resend) :**
  1. « Domains », « Add domain » : `neomoov.net`.
  2. Resend affiche trois enregistrements DNS (DKIM, chemin de retour, DMARC). Les ajouter dans le panel LWS, domaine neomoov.net, « Zone DNS », puis « Verify » chez Resend. Si tu préfères, donne-moi l'accès au panel et je les pose.
  3. « API Keys », « Create » : `neomoov-api`, accès en envoi, domaine `neomoov.net`.
  4. Dans le panel LWS, rubrique Emails : créer `assistance@neomoov.net` et `comptes@neomoov.net` (ou des redirections vers `neomoov1@gmail.com`), ce sont les adresses d'expédition.
- **Ce que j'attends :** `RESEND_API_KEY` dans `.env` et « le domaine est vérifié ». Si Brevo : `BREVO_API_KEY`.

## 12. Vapi, agent vocal (réservation par téléphone, entretien des candidats)

- **Lien :** https://dashboard.vapi.ai (avec `neomoov1@gmail.com`)
- **Coût :** environ 0,05 $ US par minute pour la plateforme, plus la voix, la transcription, le modèle et la téléphonie : compter 0,20 à 0,35 $ US par minute ; carte obligatoire
- **À faire :**
  1. Compte et organisation `Neomoov` ; « Billing » : carte.
  2. « Phone Numbers », « Import » : importer le numéro Twilio de Neomoov (compte 10). Le SID et le jeton Twilio se saisissent directement chez Vapi, pas dans un message. Ne pas acheter de numéro chez Vapi : ils sont américains.
  3. « Organization settings », « API keys » : clé privée `neomoov-api`.
- **Ce que j'attends :** `VAPI_API_KEY` et l'identifiant du numéro (Phone Number ID) dans `.env`. `VAPI_WEBHOOK_SECRET` : je le génère et je te dis où le coller.

## 13. WhatsApp Business (Meta), à lancer aujourd'hui

- **Liens :** https://business.facebook.com (Meta Business Suite) puis https://developers.facebook.com
- **Coût :** gratuit pour répondre à un client dans les 24 heures qui suivent son message ; quelques cents par conversation lancée par Neomoov
- **À faire :**
  1. Créer le portefeuille d'entreprise « Groupe NSK Inc. » avec `neomoov1@gmail.com`.
  2. « Centre de sécurité », « Vérification de l'entreprise » : dénomination légale, adresse, téléphone, site `neomoov.net`, et un document officiel au nom de la société (état de renseignements du Registraire des entreprises, ou relevé bancaire). Délai : quelques jours à deux semaines. C'est ce délai qui justifie de commencer maintenant.
  3. Sur developers.facebook.com : créer une application de type **Entreprise** nommée `Neomoov`, ajouter le produit **WhatsApp**, la rattacher au portefeuille.
  4. Ajouter un numéro dédié qui n'a jamais servi sur WhatsApp : un second numéro Twilio Neomoov (compte 10) convient, la vérification se fait par code vocal ou texto.
  5. « Paramètres de l'entreprise », « Utilisateurs », « Utilisateurs système » : un utilisateur `neomoov-api` de rôle Admin, avec un jeton d'accès **permanent** portant `whatsapp_business_messaging` et `whatsapp_business_management`.
- **Ce que j'attends :** `WHATSAPP_TOKEN` (jeton permanent) et `WHATSAPP_PHONE_ID` (identifiant du numéro) dans `.env`. `WHATSAPP_VERIFY_TOKEN` : je le génère ; je te dirai l'adresse du webhook à coller dans l'application Meta.

## 14. Sentry et Better Stack (erreurs, disponibilité, alertes)

- **Liens :** https://sentry.io/signup et https://betterstack.com (avec `neomoov1@gmail.com`)
- **Coût :** gratuit pour commencer, les deux
- **À faire :**
  1. Sentry : organisation `neomoov`, projet `api` de plateforme **Node.js** ; copier le DSN. Les projets web et mobile viendront après.
  2. Better Stack : « Telemetry », « Sources », « Connect source » : `neomoov-api`, plateforme Node.js ; copier le jeton de source. Les moniteurs de disponibilité (« Uptime »), je les créerai quand l'API sera en ligne ; mets ton téléphone dans les alertes.
- **Ce que j'attends :** `SENTRY_DSN` et `BETTERSTACK_TOKEN` dans `.env`

---

## Hors des 14 : démarches sans accès pour moi

| Démarche | Pourquoi | Quand |
|---|---|---|
| **Revenu Québec, Mon dossier pour les entreprises** https://www.revenuquebec.ca | Redevance de 0,90 $ par course, facturation obligatoire, choix d'un SEV certifié en octobre | Maintenant |
| **CTQ** (répartiteur, puis répondant d'un système de transport), **SAAQ**, **Aéroports de Montréal** | Autorisations, section 4.4.6 du document de référence | En cours, suivies par toi |
| **Courtier d'assurance** | Responsabilité civile, courses, flotte, cyber | Devis maintenant |
| **Paiement échelonné** (Affirm Canada, Sezzle ou Klarna) | Courses de plus de 150 $ en plusieurs fois (D35) | Novembre 2026 |
| **QuickBooks**, **PandaDoc ou DocuSign**, **CRM**, **Canva Pro**, comptes publicitaires, Google Business Profile, LinkedIn | Comptabilité, signatures, prospection, marketing | T4 2026 |
| **Séance photo** | Vraies photos Neomoov à la place des banques d'images (D46) | Avant le lancement |

## Comment me transmettre les clés

1. Ouvre `C:\Users\PC\code\neomoov\.env` dans VS Code (il existe, `DATABASE_URL` y est déjà). S'il manque une ligne, copie-la depuis `.env.example`.
2. Colle chaque clé après le signe égal de sa variable, sans guillemets ni espace. Enregistre.
3. Dis-moi seulement « les clés Stripe sont dans le .env ». Je ne lis jamais ce fichier à l'écran : le code le lit au démarrage.
4. Les fichiers (`.p8` Apple, JSON Google, `lws-vps.txt`) vont dans `C:\Users\PC\cles-neomoov\`, jamais dans le dépôt.

## Récapitulatif des variables

| Compte | Variables dans `.env` |
|---|---|
| 2 Google Maps et connexion Google | `GOOGLE_MAPS_SERVER_KEY`, `GOOGLE_MAPS_IOS_KEY`, `GOOGLE_MAPS_ANDROID_KEY`, `GOOGLE_CLIENT_IDS` |
| 3 Apple (après validation) | `APPLE_CLIENT_IDS` (identifiants de bundle et Services ID pour « Sign in with Apple ») |
| 6 Stripe | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` (puis `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_CLIENT_ID`) |
| 7 Expo | `EXPO_TOKEN` |
| 8 Anthropic | `ANTHROPIC_API_KEY` |
| 9 Stockage (Supabase Storage, D49) | `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` |
| 10 Textos et voix (Twilio Neomoov, D50) | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` |
| 11 Courriels | `RESEND_API_KEY` (ou `BREVO_API_KEY`) |
| 7 Expo (nouveau compte Neomoov, organisation `neomoov`) | `EXPO_TOKEN` |
| 12 Vapi | `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID` (puis `VAPI_WEBHOOK_SECRET`) |
| 13 WhatsApp | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` (puis `WHATSAPP_VERIFY_TOKEN`) |
| 14 Sentry, Better Stack | `SENTRY_DSN`, `BETTERSTACK_TOKEN` |
| 1, 3, 4 | Fichiers dans `C:\Users\PC\cles-neomoov\` : `lws-vps.txt`, `.p8` + `apple.txt`, `google-play-service-account.json` |

## Budget pendant le sprint

Environ 50 à 80 $ par mois maintenant (serveur LWS, gestionnaire de mots de passe, crédits Anthropic, numéro Twilio), plus 124 $ US une seule fois (Apple 99, Google Play 25). Supabase passe à 25 $ US par mois avant le lancement. Google Maps, textos et agent vocal restent presque à zéro tant qu'il n'y a pas de clients.
