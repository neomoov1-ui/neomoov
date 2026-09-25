# Neomoov. Guide des clés et réglages des 14 comptes externes

Version 1.0, 25 septembre 2026. Suite de « Les 14 comptes externes à créer » (v1.4) : les 14 comptes existent et sont payés. Ce guide dit, compte par compte, où cliquer pour produire chaque clé, quels réglages poser, et où déposer le résultat. Niveau interne. Aucune valeur de clé ici, jamais.

---

## 0. Le fichier `.env` : où il est, comment y déposer les clés

### Où il est

Il y a deux fichiers `.env` sur le poste. Un seul compte pour le code de Neomoov :

| Fichier | Rôle |
|---|---|
| **`C:\Users\PC\code\neomoov\.env`** | **Le bon.** L'API, le worker, les migrations et les tests le lisent au démarrage |
| `C:\Users\PC\Downloads\jarvis-starter-kit\jarvis-starter-kit\.env` | Celui du Jarvis. Rien de Neomoov n'y va |

### Trois façons de l'ouvrir (la première suffit)

1. **VS Code** : menu Fichier, « Ouvrir le dossier », coller `C:\Users\PC\code\neomoov`, Ouvrir. Dans l'explorateur de gauche, `.env` est à la racine, juste sous `.env.example`. Ou, le dossier étant ouvert, `Ctrl+P`, taper `.env`, Entrée.
2. **PowerShell** (touche Windows, taper « PowerShell », Entrée) : `code C:\Users\PC\code\neomoov\.env` (ouvre dans VS Code) ou `notepad C:\Users\PC\code\neomoov\.env`.
3. **Explorateur Windows** : coller `C:\Users\PC\code\neomoov` dans la barre d'adresse, Entrée. Si `.env` reste invisible : onglet Affichage, Afficher, cocher « Éléments masqués ».

### Comment déposer une clé

1. Trouver la ligne `NOM_DE_LA_VARIABLE=`. Si elle n'existe pas, la copier depuis `.env.example` (même dossier) et l'ajouter à la fin du fichier.
2. Coller la valeur juste après le `=`, sans guillemets, sans espace, une clé par ligne. Enregistrer (`Ctrl+S`).
3. **Vérifier sans rien montrer** : dans PowerShell, `cd C:\Users\PC\code\neomoov` puis `pnpm env:check`. La commande affiche `OK` ou `--` devant chaque variable, et n'affiche jamais une valeur. Tu peux me coller cette sortie telle quelle, ou me demander de la lancer.
4. Me dire « les clés Stripe sont dans le .env ». Je ne lis jamais ce fichier à l'écran : le code le lit.

**État au 25 septembre 2026 (`pnpm env:check`) :** 7 variables renseignées sur 68 : `DATABASE_URL`, `TEST_DATABASE_URL`, les trois clés Google Maps, `ANTHROPIC_API_KEY`, `EXPO_TOKEN`. Manquent notamment `GOOGLE_CLIENT_IDS` (ligne à ajouter, voir compte 2). Une ligne `APPLE DUNS_NUMBER` (avec un espace) existe : elle est inconnue du code, à supprimer, le D-U-N-S n'a pas sa place dans ce fichier.

### Les fichiers et les mots de passe

- Les **fichiers** (`.p8` d'Apple, JSON de Google Play, notes de serveur) vont dans `C:\Users\PC\cles-neomoov\`, jamais dans le dépôt.
- Les **mots de passe** et codes de secours vont dans Bitwarden (compte 5). Aucun mot de passe ne transite par un message.

### Ordre conseillé (ce qui débloque le code le plus vite)

| Priorité | Compte | Ce que ça débloque |
|---|---|---|
| 1 | 1 LWS : clé SSH et DNS | Mise en ligne de l'API sur `api.neomoov.net` |
| 2 | 6 Stripe | Étape 7 du code (paiements) |
| 3 | 9 Supabase Storage | Documents des chauffeurs (étape 8) |
| 4 | 10 Twilio, 11 Resend, 12 Vapi, 13 WhatsApp | Étape 13 (notifications, agents, vocal) |
| 5 | 14 Sentry et Better Stack | Mise en ligne bêta |
| 6 | 3 Apple, 4 Google Play | Après leur validation : compilations iPhone, magasins |
| Fait | 2 Google Maps, 5 Bitwarden, 7 Expo, 8 Anthropic | Reste le client Android de Google (empreinte SHA-1, après la première compilation) |

---

## 1. LWS : serveur VPS (livré) et DNS

- **Liens :** panel https://panel.lws.fr ; rubrique « Mes VPS » pour le serveur ; « Mes domaines », `neomoov.net`, « Zone DNS » pour les enregistrements
- **État :** VPS livré, adresse `78.138.58.92`, Ubuntu 24.04, mot de passe root dans `C:\Users\PC\cles-neomoov\lws-vps.txt`. Ma clé SSH est encore refusée par le serveur : elle n'est pas dans sa liste des clés autorisées.

**Étape A. Déposer ma clé SSH (2 minutes).** Ouvrir **Git Bash** (touche Windows, taper « Git Bash »), coller la commande ci-dessous en une seule ligne, Entrée, puis taper le mot de passe root (rien ne s'affiche pendant la frappe, c'est normal) :

```
ssh root@78.138.58.92 "mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBiEUmJ7VR/fYA0JfeaSeHzxc9WR5/Y0wjsqTwCSxDiR taxi-sylvain-railway' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && sed -i 's/\r$//' ~/.ssh/authorized_keys && echo OK"
```

- Si la réponse est `OK`, dis-moi « clé déposée » : je sécurise le serveur (pare-feu, mises à jour), j'installe Docker Compose, Caddy (certificats TLS) et Redis, puis je déploie l'API.
- Si le mot de passe est refusé : panel LWS, « Mes VPS », le serveur, « Réinitialiser le mot de passe root », attendre le courriel, mettre le nouveau dans `lws-vps.txt`, recommencer.
- Si `ssh` demande « Are you sure you want to continue connecting? » : taper `yes`.

**Étape B. Poser les trois enregistrements DNS (5 minutes).** Panel LWS, « Mes domaines », `neomoov.net`, « Zone DNS », « Ajouter un enregistrement », trois fois :

| Type | Nom | Cible | TTL |
|---|---|---|---|
| A | `api` | `78.138.58.92` | 3600 |
| A | `hub` | `78.138.58.92` | 3600 |
| A | `reserver` | `78.138.58.92` | 3600 |

Ne rien toucher d'autre : les lignes `@`, `www` et `MX` portent le site WordPress et le courriel. La propagation prend de 5 minutes à quelques heures ; je vérifie de mon côté.

**Étape C. La base de données sur le serveur (après A).** L'API sur le serveur a besoin de `DATABASE_URL`, que je ne peux pas lire dans ton `.env`. Je te donnerai au moment venu une commande unique à coller dans Git Bash, qui te demandera la valeur sans l'afficher.

- **Rien à mettre dans `.env`.** Ce compte donne un serveur, pas une clé.

## 2. Google Cloud : Maps et connexion Google (fait à 90 %)

- **Liens :** identifiants https://console.cloud.google.com/apis/credentials?project=neomoov ; clients OAuth https://console.cloud.google.com/auth/clients?project=neomoov ; budgets https://console.cloud.google.com/billing/budgets
- **État :** projet `neomoov`, cinq API activées, trois clés (`neomoov-server`, `neomoov-ios`, `neomoov-android`) dans `.env`, clients OAuth web et iOS créés.

**Étape A. Ajouter la ligne `GOOGLE_CLIENT_IDS` dans `.env`.** Page des clients OAuth, colonne « ID client » : copier celui de `neomoov-web`, puis celui du client iOS `com.neomoov.client`, puis celui du client iOS `com.neomoov.driver`. Dans `.env`, ajouter la ligne :

```
GOOGLE_CLIENT_IDS=<id web>,<id iOS client>,<id iOS chauffeur>
```

Les trois identifiants se terminent par `.apps.googleusercontent.com`, séparés par des virgules, sans espace.

**Étape B. Restreindre la clé serveur à l'adresse du VPS (maintenant que l'adresse existe).** Page des identifiants, clé `neomoov-server`, « Restrictions relatives aux applications », choisir « Adresses IP », ajouter `78.138.58.92`, Enregistrer. Les restrictions d'API (Routes, Places, Geocoding) restent.

**Étape C. Client OAuth Android (plus tard).** Il exige l'empreinte SHA-1 du certificat de signature Android, que le compte Expo produit à la première compilation. Je te la donnerai ; tu créeras alors le client Android (« Créer un client », type Android, paquet `com.neomoov.client`, empreinte) et un second pour `com.neomoov.driver`, puis tu ajouteras leurs deux ID à la fin de `GOOGLE_CLIENT_IDS`.

**Étape D. Budget.** Page des budgets, « Créer un budget » : projet `neomoov`, montant 50 $ par mois, alertes à 50 %, 90 % et 100 % vers `neomoov1@gmail.com`. Évite toute surprise quand les cartes seront en ligne.

- **Variables :** `GOOGLE_MAPS_SERVER_KEY`, `GOOGLE_MAPS_IOS_KEY`, `GOOGLE_MAPS_ANDROID_KEY` (faites), `GOOGLE_CLIENT_IDS` (étape A)
- **Tu me dis :** « GOOGLE_CLIENT_IDS est dans le .env »

## 3. Apple Developer Program (en validation)

- **Liens :** état de l'inscription https://developer.apple.com/account ; identifiants https://developer.apple.com/account/resources/identifiers/list ; clés App Store Connect https://appstoreconnect.apple.com/access/integrations/api
- **État :** inscription de l'organisation payée, validation d'Apple en cours (deux jours à deux semaines ; Apple peut appeler le numéro indiqué). Rien à faire avant le courriel de confirmation.

**Dès la validation, quatre étapes :**

**Étape A. Identifiant d'équipe (Team ID).** https://developer.apple.com/account, encadré « Membership details » : copier le « Team ID » (10 caractères) dans `C:\Users\PC\cles-neomoov\apple.txt`.

**Étape B. Identifiants d'applications.** Page des identifiants, bouton « + », « App IDs », « App » :
1. Description `Neomoov Client`, Bundle ID explicite `com.neomoov.client`, cocher les capacités **Sign in with Apple**, **Push Notifications**, **Maps**. Continue, Register.
2. Même chose avec `Neomoov Chauffeur` et `com.neomoov.driver`, plus la capacité **Background Modes** si elle est proposée (position en arrière-plan).

**Étape C. Identifiant de service (connexion Apple sur le web).** Bouton « + », « Services IDs » : description `Neomoov Web`, identifiant `net.neomoov.web`. Une fois créé, l'ouvrir, cocher « Sign in with Apple », « Configure » : application principale `com.neomoov.client`, domaines `hub.neomoov.net` et `reserver.neomoov.net`, adresses de retour `https://hub.neomoov.net/auth/apple` et `https://reserver.neomoov.net/auth/apple`. Save, Continue, Save.

**Étape D. Clé d'API App Store Connect (pour que je publie les applications).** https://appstoreconnect.apple.com/access/integrations/api, « Générer une clé d'API » (ou « + ») : nom `claude-code`, accès **Admin**. Télécharger le fichier `.p8` (**une seule fois possible**) dans `C:\Users\PC\cles-neomoov\`. Noter dans `apple.txt`, à côté du Team ID : l'« ID de clé » (Key ID) et l'« ID d'émetteur » (Issuer ID, affiché en haut de la page).

- **Variables :** `APPLE_CLIENT_IDS=com.neomoov.client,com.neomoov.driver,net.neomoov.web` (après l'étape C)
- **Fichiers :** `cles-neomoov\AuthKey_XXXXXXXXXX.p8` et `cles-neomoov\apple.txt`
- **Tu me dis :** « Apple validé, clé .p8 et apple.txt déposés »

## 4. Google Play Console (en validation)

- **Liens :** console https://play.google.com/console ; comptes de service https://console.cloud.google.com/iam-admin/serviceaccounts?project=neomoov
- **État :** compte d'organisation payé, vérification de l'organisation et de l'identité en cours (deux à sept jours). Rien à faire avant.

**Dès la validation, trois étapes :**

**Étape A. Lier le projet Google Cloud.** Console Play, menu de gauche tout en bas « Configuration » (roue dentée), « Accès à l'API », « Associer un projet Google Cloud existant », choisir `neomoov`.

**Étape B. Compte de service.** Sur la même page, « Créer un compte de service » : le lien ouvre la console Google Cloud. Là : « Créer un compte de service », nom `neomoov-eas`, Créer, aucun rôle à ajouter, Terminer. Ouvrir le compte créé, onglet « Clés », « Ajouter une clé », « Créer une clé », type **JSON**, Créer : un fichier se télécharge. Le renommer et le déplacer en `C:\Users\PC\cles-neomoov\google-play-service-account.json`.

**Étape C. Droits dans la console Play.** Retour sur « Accès à l'API », le compte `neomoov-eas` apparaît, « Gérer les autorisations de Play Console » : cocher « Publier des versions en production, en test et sur les canaux de test » et « Gérer les fiches Play Store », Inviter. Ensuite « Toutes les applications », « Créer une application », deux fois : `Neomoov` (application, gratuite, catégorie Cartes et navigation) et `Neomoov Chauffeur` (mêmes choix). Le reste de la fiche (textes, captures), je le prépare.

- **Fichier :** `cles-neomoov\google-play-service-account.json` (chemin déjà attendu par `eas.json`)
- **Tu me dis :** « Google Play validé, JSON déposé, deux applications créées »

## 5. Bitwarden (fait)

- **Liens :** coffre https://vault.bitwarden.com ; extension de navigateur https://bitwarden.com/download
- **À faire une fois :** installer l'extension dans Edge ou Chrome (elle propose d'enregistrer chaque mot de passe au moment de la saisie). Dans le coffre, « Nouveau dossier » `Neomoov`. Réglages du compte, « Sécurité », « Connexion en deux étapes » : activer l'application d'authentification et imprimer les codes de secours.
- **Pour chaque compte de cette liste :** « + Nouvel élément », type « Identifiant », nom du site, adresse de connexion, courriel `neomoov1@gmail.com`, mot de passe, dossier `Neomoov`. Les codes de récupération à deux étapes de chaque site vont dans le champ « Notes » de l'élément.
- **Rien à mettre dans `.env`.**

## 6. Stripe (mode test maintenant)

- **Liens :** clés de test https://dashboard.stripe.com/test/apikeys ; Connect https://dashboard.stripe.com/test/connect/accounts/overview ; moyens de paiement https://dashboard.stripe.com/settings/payment_methods ; profil de l'entreprise https://dashboard.stripe.com/settings/account ; webhooks https://dashboard.stripe.com/test/webhooks

**Étape A. Les deux clés de test.** Page des clés d'API. Vérifier que l'interrupteur « Mode test » (en haut à droite) est activé. Copier la « Clé publiable » (`pk_test_…`) dans `STRIPE_PUBLISHABLE_KEY`. Sur la ligne « Clé secrète », « Révéler la clé de test » (`sk_test_…`), copier dans `STRIPE_SECRET_KEY`.

**Étape B. Connect (les chauffeurs reçoivent leurs paiements).** Page Connect, « Commencer » : type de plateforme « Place de marché » ; comptes **Express** ; l'entreprise collecte les paiements et reverse aux chauffeurs. Dans « Paramètres », « Connect », « Marque » : nom `Neomoov`, couleur et logo (le logo du site). Dans « Paramètres », « Connect », « Options d'intégration », section OAuth : si un identifiant `ca_…` est affiché, le copier dans `STRIPE_CONNECT_CLIENT_ID` (sinon laisser vide, ce n'est pas bloquant).

**Étape C. Moyens de paiement.** Page des moyens de paiement : cartes activées, **Apple Pay** et **Google Pay** activés (onglet « Portefeuilles »). Le domaine `neomoov.net` sera ajouté pour Apple Pay quand la réservation web sera en ligne, je te le rappellerai.

**Étape D. Profil public.** Page du profil : nom public `Neomoov`, libellé de relevé bancaire `NEOMOOV`, courriel d'assistance `contact@neomoov.net`, téléphone, site `https://neomoov.net`.

**Étape E. Webhook (plus tard, par moi).** Quand l'API sera en ligne, je créerai le point de réception `https://api.neomoov.net/v1/webhooks/stripe` sur la page des webhooks et je te dirai où lire le « Secret de signature » (`whsec_…`) pour `STRIPE_WEBHOOK_SECRET`.

**Avant le lancement (mode réel) :** « Activer le compte » : NEQ, adresse, compte bancaire de l'entreprise (spécimen de chèque), pièce d'identité du dirigeant, description de l'activité « transport de personnes par réservation ». Les clés réelles (`sk_live_`, `pk_live_`) remplaceront alors les clés de test sur le serveur seulement.

- **Variables :** `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, puis `STRIPE_CONNECT_CLIENT_ID` (facultatif), `STRIPE_WEBHOOK_SECRET` (par moi)
- **Tu me dis :** « les clés Stripe de test sont dans le .env »

## 7. Expo (fait)

- **Liens :** https://expo.dev ; jetons de l'organisation https://expo.dev/accounts/neomoov/settings/access-tokens (remplacer `neomoov` par le nom exact de l'organisation si tu as pris `neomoov-inc`)
- **État :** `EXPO_TOKEN` est dans `.env`. Vérifie seulement que le jeton vient bien de **l'organisation** (menu du compte, choisir l'organisation, puis Settings, Access tokens) et non du compte personnel : un jeton personnel ne peut pas créer les projets dans l'organisation.
- **Ce que je fais :** création des deux projets EAS (`neomoov-client`, `neomoov-driver`) dans l'organisation, génération du certificat de signature Android, première compilation Android de test, puis je te donne l'empreinte SHA-1 pour le compte 2 (étape C) et Google Play. iOS attend Apple (compte 3).
- **Rien d'autre à faire.**

## 8. Anthropic (fait)

- **Liens :** clés https://console.anthropic.com/settings/keys ; facturation https://console.anthropic.com/settings/billing ; limites https://console.anthropic.com/settings/limits
- **État :** `ANTHROPIC_API_KEY` est dans `.env`.
- **À vérifier une fois :** page des limites, « Limite de dépense mensuelle » à 100 $ ; page de facturation, recharge automatique activée avec un plafond, pour que les agents ne s'arrêtent pas faute de crédits pendant la bêta.
- **Rien d'autre à faire.**

## 9. Supabase Storage (documents des chauffeurs)

- **Liens :** réglages du stockage https://supabase.com/dashboard/project/_/settings/storage (choisir le projet `neomoov-dev` s'il est demandé) ; compartiments https://supabase.com/dashboard/project/_/storage/buckets
- **État :** le compartiment `documents` existe déjà, privé, créé par le code le 25 septembre. Il ne reste que les clés d'accès S3.

**Étape A. Activer le protocole S3 et créer les clés.** Page des réglages du stockage : section « S3 Connection », s'assurer que « Enable connection via S3 protocol » est activé. Noter l'adresse « Endpoint » affichée (de la forme `https://<identifiant du projet>.storage.supabase.co/storage/v1/s3`) et la région (`ca-central-1`). Section « S3 Access Keys », « New access key » : description `neomoov-api`, Create. La page montre l'« Access key ID » et le « Secret access key » **une seule fois**.

**Étape B. Dans `.env` :**

```
S3_ENDPOINT=<l'adresse Endpoint>
S3_BUCKET=documents
S3_ACCESS_KEY=<Access key ID>
S3_SECRET_KEY=<Secret access key>
```

Les quatre lignes `R2_…` restent vides : Cloudflare R2 est abandonné (décision D49).

- **Tu me dis :** « les clés S3 de Supabase sont dans le .env »

## 10. Twilio (textos et numéro vocal, compte Neomoov)

- **Liens :** console https://console.twilio.com ; mise à niveau : menu « Billing » (ou https://console.twilio.com/billing/upgrade) ; achat de numéro https://console.twilio.com/us1/develop/phone-numbers/manage/search ; numéros actifs https://console.twilio.com/us1/develop/phone-numbers/manage/incoming ; permissions géographiques des textos https://console.twilio.com/us1/develop/sms/settings/geo-permissions

**Étape A. Sortir du mode essai.** Tant que le compte est « Trial », il n'envoie qu'aux numéros vérifiés et n'achète pas de numéro canadien. « Upgrade » : carte d'entreprise, premier dépôt de 20 $ US. Puis « Billing », « Auto-recharge » : recharge de 20 $ quand le solde passe sous 5 $.

**Étape B. Deux numéros canadiens.** Page d'achat : pays **Canada**, cocher les capacités **SMS** et **Voice**, indicatif `514` ou `438` (sinon `450`), Search, Buy sur le premier. Recommencer pour un second numéro : il servira à WhatsApp (compte 13) et ne doit jamais servir à autre chose.

**Étape C. Les identifiants.** Page d'accueil de la console, encadré « Account Info » : « Account SID » (commence par `AC`) et « Auth Token » (cliquer pour l'afficher).

**Étape D. Permissions géographiques.** Page des permissions : Canada et États-Unis cochés (par défaut), rien d'autre.

**Étape E. Dans `.env` :**

```
TWILIO_ACCOUNT_SID=AC…
TWILIO_AUTH_TOKEN=…
TWILIO_FROM_NUMBER=+1514XXXXXXX
```

Le second numéro (WhatsApp) : le noter dans `C:\Users\PC\cles-neomoov\twilio.txt` avec la mention « numéro WhatsApp ». Les deux lignes `TELNYX_…` restent vides (Telnyx abandonné, décision D50).

- **Tu me dis :** « Twilio est dans le .env, second numéro dans twilio.txt »

## 11. Resend (courriels transactionnels)

- **Liens :** domaines https://resend.com/domains ; clés https://resend.com/api-keys ; DNS chez LWS : panel, « Mes domaines », `neomoov.net`, « Zone DNS »

**Étape A. Ajouter le domaine.** Page des domaines, « Add Domain » : `neomoov.net`, région « North Virginia (us-east-1) » (Resend n'a pas de région canadienne ; les courriels sont transitoires, les données restent au Canada). Resend affiche alors des enregistrements DNS à copier.

**Étape B. Poser les enregistrements chez LWS.** Dans la zone DNS de `neomoov.net`, « Ajouter un enregistrement » pour chacun, exactement comme Resend les affiche. En général :

| Type | Nom (chez LWS, sans `.neomoov.net`) | Valeur |
|---|---|---|
| MX | `send` | `feedback-smtp.us-east-1.amazonses.com`, priorité 10 |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` |
| TXT | `resend._domainkey` | la longue valeur `p=…` donnée par Resend |
| TXT | `_dmarc` | `v=DMARC1; p=none;` (seulement s'il n'y a pas déjà une ligne `_dmarc`) |

Ne pas toucher aux lignes `MX` de `@` : elles portent le courriel `contact@neomoov.net`. Retour sur Resend, « Verify » ; le statut passe à « Verified » en quelques minutes à quelques heures.

**Étape C. Clé d'API.** Page des clés, « Create API Key » : nom `neomoov-api`, permission « Sending access », domaine `neomoov.net`. Copier la clé (`re_…`) dans `RESEND_API_KEY`.

**Étape D. Adresses d'expédition.** Panel LWS, rubrique Emails de `neomoov.net` : créer `assistance@neomoov.net` et `comptes@neomoov.net`, ou des redirections vers `neomoov1@gmail.com`. Ce sont les adresses que les courriels de Neomoov afficheront.

- **Variable :** `RESEND_API_KEY` (si tu préfères Brevo : https://app.brevo.com/settings/keys/api, clé dans `BREVO_API_KEY`)
- **Tu me dis :** « Resend est dans le .env et le domaine est vérifié »

## 12. Vapi (agent vocal)

- **Liens :** tableau de bord https://dashboard.vapi.ai ; numéros https://dashboard.vapi.ai/phone-numbers ; clés https://dashboard.vapi.ai/org/api-keys (menu de l'organisation, « API Keys ») ; facturation https://dashboard.vapi.ai/org/billing

**Étape A. Facturation.** Carte d'entreprise, et un plafond mensuel (« Spending limit ») de 100 $ US.

**Étape B. Importer le numéro Twilio.** Page des numéros, « Import », « Twilio » : coller le Account SID, l'Auth Token et le **premier** numéro Twilio (au format `+1…`), nom `Neomoov`. Ces valeurs se saisissent chez Vapi, jamais dans un message. Ne pas acheter de numéro chez Vapi (ils sont américains). Une fois importé, cliquer sur le numéro : copier son « ID » (identifiant du numéro) dans `VAPI_PHONE_NUMBER_ID`.

**Étape C. Clé d'API.** Page des clés : « Create key », nom `neomoov-api`, type **Private**. Copier dans `VAPI_API_KEY`.

**Étape D. Webhook (par moi).** Je génère `VAPI_WEBHOOK_SECRET` et je règle l'adresse `https://api.neomoov.net/v1/webhooks/vapi` sur l'assistant quand je le crée (étape 13 du code).

- **Variables :** `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`
- **Tu me dis :** « Vapi est dans le .env, numéro importé »

## 13. WhatsApp Business (Meta)

- **Liens :** vérification de l'entreprise https://business.facebook.com/settings/security ; applications https://developers.facebook.com/apps ; utilisateurs système https://business.facebook.com/settings/system-users ; comptes WhatsApp https://business.facebook.com/settings/whatsapp-business-accounts
- **État :** portefeuille d'entreprise créé, vérification de l'entreprise en cours (quelques jours à deux semaines). Les étapes A et B se font tout de suite, l'étape C après la vérification.

**Étape A. Numéro de téléphone.** developers.facebook.com, application `Neomoov`, menu « WhatsApp », « Configuration de l'API » (API Setup), « Ajouter un numéro de téléphone » : nom affiché `Neomoov`, catégorie « Transport », le **second** numéro Twilio, vérification par **texto**. Le code arrive dans Twilio : console Twilio, « Monitor », « Logs », « Messaging », ouvrir le message entrant pour lire le code. Une fois vérifié, la même page affiche l'« Identifiant du numéro de téléphone » (Phone number ID) : copier dans `WHATSAPP_PHONE_ID`.

**Étape B. Jeton permanent.** Page des utilisateurs système, « Ajouter » : nom `neomoov-api`, rôle **Admin**. Puis « Attribuer des actifs » : l'application `Neomoov` avec « Contrôle total », et le compte WhatsApp Business `Neomoov` avec « Contrôle total ». Puis « Générer un nouveau jeton » : application `Neomoov`, expiration **Jamais**, autorisations `whatsapp_business_messaging` et `whatsapp_business_management`. Copier le jeton dans `WHATSAPP_TOKEN` (affiché une seule fois).

**Étape C. Après la vérification de l'entreprise.** Page des comptes WhatsApp, compte `Neomoov`, « Paramètres », « Moyen de paiement » : carte d'entreprise (sans moyen de paiement, Meta bloque les conversations lancées par Neomoov, comme les rappels de course). Puis l'application `Neomoov` passe en mode « En ligne » (bouton en haut de la page de l'application).

**Étape D. Webhook (par moi).** Je génère `WHATSAPP_VERIFY_TOKEN` ; je te dirai l'adresse `https://api.neomoov.net/v1/webhooks/whatsapp` et le jeton à coller dans « WhatsApp », « Configuration », « Webhook » de l'application Meta.

- **Variables :** `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`
- **Tu me dis :** « WhatsApp est dans le .env, entreprise vérifiée ou en attente »

## 14. Sentry et Better Stack (erreurs, disponibilité, alertes)

- **Liens Sentry :** https://sentry.io ; création de projet https://sentry.io/organizations/neomoov/projects/new/ (remplacer `neomoov` par le nom exact de ton organisation Sentry)
- **Liens Better Stack :** sources https://telemetry.betterstack.com ; disponibilité https://uptime.betterstack.com

**Sentry, étape A.** Créer un projet : plateforme **Node.js**, nom `api`, équipe par défaut. La page suivante affiche le « DSN » (adresse `https://…@….ingest.sentry.io/…`) : copier dans `SENTRY_DSN`. On le retrouve à tout moment dans « Settings », « Projects », `api`, « Client Keys (DSN) ». Les projets `web` et `mobile` viendront après.

**Better Stack, étape B.** Telemetry, « Sources », « Connect source » : nom `neomoov-api`, plateforme **Node.js**. La page de la source affiche le « Source token » : copier dans `BETTERSTACK_TOKEN`.

**Better Stack, étape C (alertes).** Uptime, « Team », « On-call », ajouter ton numéro de téléphone et l'application mobile Better Stack pour recevoir les alertes. Les moniteurs de disponibilité (`api.neomoov.net`, `hub.neomoov.net`, `reserver.neomoov.net`), je les crée quand l'API sera en ligne.

- **Variables :** `SENTRY_DSN`, `BETTERSTACK_TOKEN`
- **Tu me dis :** « Sentry et Better Stack sont dans le .env »

---

## Récapitulatif à cocher

| Compte | Variables ou fichiers | État au 25 septembre |
|---|---|---|
| 1 LWS | clé SSH déposée, DNS `api`, `hub`, `reserver` | À faire (étapes A et B) |
| 2 Google Cloud | `GOOGLE_MAPS_*` (faites), `GOOGLE_CLIENT_IDS`, restriction IP, budget | `GOOGLE_CLIENT_IDS` à ajouter ; client Android après SHA-1 |
| 3 Apple | `APPLE_CLIENT_IDS`, `.p8`, `apple.txt` | En validation |
| 4 Google Play | `google-play-service-account.json`, deux applications | En validation |
| 5 Bitwarden | extension, dossier `Neomoov`, deux étapes | Fait, à compléter au fil des comptes |
| 6 Stripe | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, Connect Express, Apple Pay et Google Pay | À faire |
| 7 Expo | `EXPO_TOKEN` | Fait |
| 8 Anthropic | `ANTHROPIC_API_KEY`, limite mensuelle | Fait |
| 9 Supabase Storage | `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | À faire |
| 10 Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, second numéro dans `twilio.txt` | À faire |
| 11 Resend | `RESEND_API_KEY`, domaine vérifié, adresses `assistance@` et `comptes@` | À faire |
| 12 Vapi | `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID` | À faire |
| 13 WhatsApp | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` | Étapes A et B à faire, C après vérification |
| 14 Sentry, Better Stack | `SENTRY_DSN`, `BETTERSTACK_TOKEN` | À faire |

## Ce que je fais dès réception

| Quand tu me dis | Je fais |
|---|---|
| « clé déposée » | Sécurisation du serveur, Docker, Caddy, Redis, déploiement de l'API, puis vérification des DNS |
| « les clés Stripe de test sont dans le .env » | Étape 7 du code avec le vrai Stripe (paiements, Connect, webhook) |
| « les clés S3 sont dans le .env » | Passage du stockage des documents en mode réel, test d'envoi d'un document |
| « Twilio est dans le .env » | Envoi d'un vrai code par texto à ton numéro pour valider |
| « Resend est dans le .env » | Envoi d'un vrai courriel de test depuis `assistance@neomoov.net` |
| « Vapi et WhatsApp sont dans le .env » | Étape 13 : agents, vocal et WhatsApp en mode réel |
| « Sentry et Better Stack sont dans le .env » | Rapports d'erreurs et journaux branchés avant la bêta |
| « Apple validé » ou « Google Play validé » | Compilations iPhone, fiches des magasins, soumission aux tests fermés |
