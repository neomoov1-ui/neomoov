# Connecteurs de diffusion (phase 1 « entreprise autonome », 2 octobre 2026)

Un connecteur par espace (`SocialPublisher` : publier, mesurer, lire les commentaires, répondre), un lecteur et éditeur du site (`SiteConnector`), une voix de synthèse (`TtsProvider`) et la Search Console (`SearchConsoleProvider`). Interfaces : `apps/api/src/adapters/marketing.types.ts`. Simulations : `adapters/mock/marketing.mock.ts`. Choix par `MARKETING_PROVIDER` (`mock` ou `real`) ; en mode réel, un espace sans clés reçoit un connecteur « non configuré » qui refuse clairement et le calendrier l'ignore (jamais de simulation silencieuse ; en production, un mode `mock` se déclare dans `ALLOW_MOCK_PROVIDERS` avec l'alias `marketing`).

## Créneaux par défaut (réglage `marketing.slots`, jour 1 = lundi, heure de Montréal)

| Espace | Créneaux | Formats | Longueur | Mots-clics |
|---|---|---|---|---|
| `site_blog` | mardi et jeudi 10 h | article | 12 000 | 0 |
| `academy` | mercredi et vendredi 10 h | article, publication | 8 000 | 0 |
| `google_business` | lundi et jeudi 11 h | publication | 1 500 | 0 |
| `facebook` | lundi et mercredi 12 h, vendredi 17 h | publication, Reel, vidéo | 2 000 | 5 |
| `instagram` | mardi et jeudi 12 h, samedi 11 h | publication, Reel, story | 2 200 | 10 |
| `linkedin` | mardi et jeudi 8 h 30 | publication, article (FR puis EN) | 3 000 | 5 |
| `tiktok` | mercredi et samedi 18 h | vidéo courte | 2 200 | 8 |
| `youtube` | vendredi 16 h | vidéo, Short | 5 000 | 10 |
| `x` | lundi, mercredi, vendredi 9 h | publication (FR puis EN) | 280 | 3 |
| `snapchat` | vendredi et dimanche 19 h | story, vidéo courte | 250 | 3 |
| `newsletter` | jeudi 10 h | infolettre | 20 000 | 0 |

Au-delà des créneaux, les contenus prennent les jours libres de la semaine à l'heure du premier créneau, puis la semaine suivante. Mesures à J+1 et J+7 (`marketing.measure_days`), trois tentatives de publication espacées de 5 min, 30 min et 2 h (`marketing.publish_max_attempts`), puis état `failed` et alerte au personnel.

## Connecteurs livrés (réels)

### WordPress : `site_blog` et `academy`
- API REST du site (`/wp-json/wp/v2`), mot de passe d'application : `WORDPRESS_URL`, `WORDPRESS_USER`, `WORDPRESS_APP_PASSWORD` (Utilisateurs, Profil, « Mots de passe d'application » ; le même que `WP_NEOMOOV_APP_PASSWORD` des outils du site). Droits : un compte Éditeur suffit (articles, médias, commentaires, pages).
- Publication : article en brouillon ou en ligne selon l'état du contenu, catégorie `WORDPRESS_BLOG_CATEGORY` ou `WORDPRESS_ACADEMY_CATEGORY` (slug), visuel en image à la une, balises `_neomoov_seo_title` et `_neomoov_seo_desc` (champs posés par l'outil `publier.js` du site ; `WORDPRESS_SEO_META=yoast` pour un site sous Yoast, si ses champs sont exposés à l'API).
- Mesures : nombre de commentaires (la portée et les clics viennent de la Search Console) ; commentaires approuvés lus et réponses postées en réponse.
- Site : lecture des pages et articles publiés (titres, balises, H1, en-têtes, liens internes, mots), correction des balises, brouillons (jamais publiés par la plateforme), médiathèque (photos réelles, D46).

### Brevo : `newsletter`
- `BREVO_API_KEY` (déjà en place côté Academy), `BREVO_NEWSLETTER_LIST_ID`, `BREVO_SENDER_EMAIL` (expéditeur vérifié), `BREVO_SENDER_NAME`. Droits : clé API v3 avec les campagnes courriel.
- Publication : campagne « classique » en brouillon (titre, texte en HTML, lien de désinscription `{{ unsubscribe }}`, Loi anti-pourriel) ; l'envoi reste une décision humaine dans Brevo tant que le fondateur n'a pas tranché l'envoi automatique. Mesures : envoyés ou livrés (portée), ouvertures uniques (interactions), clics uniques.

### Meta : `facebook` et `instagram`
- Application Meta (type Entreprise, celle de WhatsApp), page Facebook et compte Instagram professionnel rattaché : `META_PAGE_ID`, `META_PAGE_TOKEN` (jeton de page longue durée issu d'un jeton utilisateur système du portefeuille Business), `META_IG_USER_ID`, `META_GRAPH_VERSION` (v21.0).
- Droits à demander (revue d'application Meta) : `pages_manage_posts`, `pages_read_engagement`, `pages_manage_engagement`, `pages_read_user_content`, `read_insights`, `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_insights`, `business_management`.
- Publication Facebook : texte avec lien (`/feed`), photo (`/photos`, adresse signée du stockage), vidéo ou Reel (`/videos`) ; Instagram : conteneur image, Reel ou story puis `media_publish` (la vidéo est attendue jusqu'à `FINISHED`). Mesures : `post_impressions_unique`, `post_engaged_users`, `post_clicks` ; `reach`, `total_interactions`. Commentaires lus et réponses postées. Instagram exige un visuel rendu en PNG ou une vidéo MP4 (`BROWSER_BIN`, `FFMPEG_BIN` sur le serveur).

### Google Search Console (agent `seo`)
- Compte de service Google autorisé sur la propriété (Paramètres, Utilisateurs et autorisations, rôle Restreint suffit) : `SEARCH_CONSOLE_SITE_URL` (`https://neomoov.net/` ou `sc-domain:neomoov.net`), `SEARCH_CONSOLE_CLIENT_EMAIL`, `SEARCH_CONSOLE_PRIVATE_KEY` (clé privée du JSON, retours à la ligne `\n` acceptés). API « Google Search Console API » activée sur le projet.
- Sans clés : aucune statistique (le plan se fonde sur les pages et les mots-clés) ; les mesures « après » des tâches attendent la Search Console.

### Voix de synthèse (vidéos courtes)
- `TTS_ENGINE=piper` avec `PIPER_BIN`, `PIPER_MODEL` (et `PIPER_MODEL_EN`), sur le serveur, hors ligne (même chaîne que l'audio de l'Academy), ou `TTS_ENGINE=azure` avec `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` (voix `fr-CA-SylvieNeural`, `en-CA-ClaraNeural`). Chaîne : narration, une diapositive par séquence (gabarit de marque), liste de montage, `ffmpeg` (`FFMPEG_BIN` ou PATH) ; sans ffmpeg, la première diapositive sert de visuel et le montage reste à faire.

### Réseaux en connexion directe : X, Telegram, LinkedIn, YouTube, TikTok, Fiche Google (3 octobre 2026)

Décision du fondateur (3 octobre 2026) : connexions directes seulement, sans agrégateur ; ordre de mise en service X, Telegram, LinkedIn (page entreprise), YouTube, TikTok, puis la Fiche Google (facultative) ; Snapchat et la chaîne WhatsApp en relais manuel.

**Identifiants des comptes** (contrat `SOCIAL_CREDENTIALS`, `apps/api/src/modules/marketing/social-credentials.ts`) : aucun connecteur ne lit l'environnement pour un jeton de réseau. Chaque espace demande au fournisseur les identifiants de son compte à chaque usage (`credentialed.ts`) : mode `direct` (valeurs de `CREDENTIAL_FIELDS[espace]`) ou `manual` (relais manuel). Implémentation par défaut : les variables d'environnement (ci-dessous) ; la page « Réseaux sociaux » de My Hub (agent S1 : table `social_accounts`, valeurs chiffrées) la remplace, avec repli sur les variables. Un compte relié ou retiré vaut aussitôt ; un jeton refusé (révoqué, expiré) est signalé au fournisseur (`markInvalid` : compte à reconnecter) ; les jetons renouvelés sont écrits dans le compte (`update`), et à défaut gardés chiffrés dans la base (réglage `oauth.<réseau>`, portée `oauth`, invisible dans My Hub, clé dérivée de `ENCRYPTION_KEY`).

Socle commun `oauth.ts` : le jeton de rafraîchissement est échangé contre un jeton d'accès gardé en mémoire jusqu'à une minute de son échéance ; un jeton refusé (401) donne un nouvel échange puis un seul nouvel essai ; chez X et TikTok, le jeton de rafraîchissement change à chaque échange : le connecteur relit le compte avant chaque échange et y écrit le nouveau (un seul jeton valable, quel que soit le processus). Aucun jeton dans les journaux, les messages d'erreur ni `toJSON` (le jeton du bot Telegram, qui fait partie de l'adresse de l'API, n'apparaît jamais).

Erreurs typées qui alimentent les nouvelles tentatives de la diffusion (5 min, 30 min, 2 h, puis `failed` et alerte) : `SOCIAL_RATE_LIMITED` (429, quota quotidien de YouTube, plafond de TikTok ; la tentative suivante attend au moins le délai demandé par le réseau, 26 heures au plus), `SOCIAL_VALIDATION_ERROR` (400, 422), `SOCIAL_FORBIDDEN` (403), `SOCIAL_AUTH_FAILED` ou `SOCIAL_AUTH_EXPIRED` (compte à reconnecter), `SOCIAL_PROVIDER_ERROR` (panne). **Relais manuel**, sans nouvelle tentative : `SOCIAL_MANUAL_RELAY` (compte en mode manuel : Snapchat, chaîne WhatsApp) et `SOCIAL_APPROVAL_PENDING` (LinkedIn sans la Community Management API) : la publication passe en `failed` avec `lastError` commençant par ce code, et le personnel reçoit l'alerte `marketing_manual_relay` (« à relayer à la main ») ; l'écran de publication (agent S2) affiche ces publications comme tâches à publier à la main.

Alerte d'échéance : une fois par heure, la passe marketing lit l'état de chaque autorisation ; le personnel reçoit une alerte (une par jour et par réseau) quand il faut refaire l'autorisation dans moins de `marketing.token_alert_days` jours (7 par défaut : jeton LinkedIn de 60 jours, jetons de rafraîchissement d'un an de LinkedIn et TikTok), ou quand l'échange du jeton échoue.

| Espace | Ce que fait le connecteur | Limites connues |
|---|---|---|
| `x` | Publication (`POST /2/tweets`) avec image (`POST /2/media/upload`) ; texte bilingue : la version française, puis l'anglaise en réponse, quand le corps porte une ligne `[EN]` qui les sépare ; réponses lues par la recherche récente (`conversation_id`) et réponse ; mesures (`public_metrics`, et clics sur le lien si X les donne). OAuth 2.0 avec PKCE. | Formule gratuite : écriture seulement (quelques centaines de publications par mois), aucune lecture : les réponses ne sont pas lues (sans erreur) et les mesures peuvent être refusées ; formule Basic (payante) pour lire. Vidéo non jointe. |
| `telegram` | Le bot, administrateur du canal, publie l'image (`sendPhoto`), la vidéo (`sendVideo`) ou le texte (`sendMessage`) ; légende de 1 024 caractères au plus, sinon le texte suit en réponse (4 096 au plus) ; adresse publique du message (`t.me/<canal>/<n>`). Commentaires : fil du groupe de discussion lié au canal, lus par `getUpdates`, réponses du bot dans le fil. | La Bot API ne donne pas les vues d'un message (mesures à zéro). Le bot ne doit pas avoir de webhook (sinon `getUpdates` est refusé) et doit voir les messages du groupe (administrateur du groupe, ou mode « privacy » désactivé chez BotFather). Photo de 10 Mo, vidéo de 50 Mo au plus. |
| `linkedin` | Publication texte et image (`/rest/posts`, image par `/rest/images?action=initializeUpload`), texte au format « little text » (caractères réservés échappés, mots-clics cliquables), commentaires de la page et réponse imbriquée (`socialActions`), statistiques (`organizationalEntityShareStatistics`). En-têtes `LinkedIn-Version` (`LINKEDIN_API_VERSION`) et `X-Restli-Protocol-Version: 2.0.0`. | **Sans la Community Management API (approbation de LinkedIn en attente) ou sans droits d'administrateur, la publication est refusée par `SOCIAL_APPROVAL_PENDING` et passe en relais manuel.** Vidéo non jointe. L'auteur d'un commentaire n'est connu que par son URN. Une version de l'API est prise en charge un an : avancer `LINKEDIN_API_VERSION` chaque année. |
| `youtube` | Téléversement résumable par morceaux de la vidéo MP4 produite par `visuals.service.ts` (titre de 100 caractères, description avec `#Shorts` pour les vidéos courtes, mots-clés, langue, catégorie Voyages et événements), commentaires et réponse (`commentThreads`, `comments`), statistiques (vues, j'aime, commentaires). | **Tant que le projet Google n'est pas audité par YouTube (`YOUTUBE_API_AUDITED` absent ou `off`), la vidéo est envoyée en privé, avec la mention dans le résultat** (journal d'audit, `notice`) ; après l'audit (`YOUTUBE_API_AUDITED=on`), visibilité `YOUTUBE_PRIVACY_STATUS` (`public` par défaut), et mention si YouTube la garde privée. Quota de 10 000 unités par jour (un envoi en coûte environ 1 600, selon la grille de Google) ; quota épuisé : nouvel essai après minuit, heure du Pacifique. Une image (montage ffmpeg absent) n'est pas publiée. |
| `tiktok` | Publication directe : informations du créateur, initialisation, envoi du fichier par morceaux (`TIKTOK_UPLOAD_MODE=file`, défaut) ou par l'adresse signée (`url`), suivi jusqu'à la mise en ligne, mesures (`video/query`). Contenu déclaré « votre marque » (`brand_organic_toggle`). Identifiants de vidéo int64 gardés exacts. | **Tant que l'application n'est pas auditée par TikTok (`TIKTOK_APP_AUDITED` absent ou `off`), publication privée (`SELF_ONLY`), avec la mention dans le résultat** ; après l'audit, `TIKTOK_PRIVACY_LEVEL` (`PUBLIC_TO_EVERYONE` par défaut), repli automatique en `SELF_ONLY` avec la mention si TikTok refuse. L'API publique ne donne pas les commentaires. Le mode `url` exige que le domaine du stockage soit vérifié chez TikTok. |
| `google_business` (facultative) | Publication locale (`localPosts`) : 1 500 caractères au plus, bouton RÉSERVER (`reserve`) ou EN SAVOIR PLUS vers l'adresse de `marketing.cta_urls`, photo par l'adresse signée. Avis lus et réponse publique (`updateReply`). Mesures de la fiche (API Business Profile Performance). | Mesure de la fiche entière depuis la publication (Google ne mesure plus une publication seule). Un avis noté 3 sur 5 ou moins n'a jamais de réponse automatique : il part vers la relation client (réseau `gbp`, relais humain). |

Réponses de la relation client aux commentaires relayés : LinkedIn, YouTube, X et la Fiche Google (`gbp`) sont des réseaux à relais humain dans la boîte unifiée (`RELAY_NETWORKS`). Les réponses automatiques simples (remerciement, horaires, lien de réservation) partent, elles, par le connecteur.

## Snapchat et chaîne WhatsApp : relais manuel

Décision du fondateur : sans agrégateur, et sans API ouverte pour publier (Snapchat : profil public sur liste d'autorisation ; chaîne WhatsApp : aucune API de Meta) : ces deux espaces sont toujours en mode `manual`. La plateforme prépare le texte et l'image du réseau ; la publication passe en relais manuel (`SOCIAL_MANUAL_RELAY`), à publier à la main depuis My Hub. Variables `SNAPCHAT_*` réservées, sans effet.

## Pas à pas pour le fondateur : ouvrir chaque réseau à la plateforme

**Voie principale (dès que la page « Réseaux sociaux » de My Hub est livrée par l'agent S1)** : un bouton « Connecter » par réseau, l'accord se fait dans le navigateur, les jetons sont rangés chiffrés dans la base ; procédures dans `docs/marketing/reseaux-connexion.md`. Ce qui suit est la **voie de repli par les variables d'environnement**, utilisable dès aujourd'hui ; ce que vous créez chez chaque réseau (application, identifiants, approbations) est le même dans les deux voies.

Principe commun, à lire une fois :

1. Vous créez sur chaque réseau une « application » (ou un « client OAuth ») qui vous donne un identifiant et un secret.
2. Sur votre poste, vous donnez cet identifiant et ce secret à la commande `oauth:jeton` (dans le `.env` de votre poste, ou seulement pour la fenêtre PowerShell en cours : `$env:NOM = 'valeur'`).
3. La commande ouvre la page d'accord du réseau dans votre navigateur ; vous vous connectez avec le compte de Neomoov et vous acceptez. Le jeton obtenu est écrit dans un fichier de `C:\Users\PC\cles-neomoov\` ; il n'est jamais affiché.
   ```powershell
   cd C:\Users\PC\code\neomoov
   pnpm --filter @neomoov/api oauth:jeton -- --fournisseur=x
   ```
   Fournisseurs : `x`, `linkedin`, `youtube`, `tiktok`, `google-business`, `google-calendar` (Telegram n'en a pas besoin). Adresse de retour par défaut : `http://127.0.0.1:53682/rappel` (à déclarer chez LinkedIn et X ; inutile chez Google avec un client « application de bureau »). Pour un réseau qui exige une adresse https (TikTok) : `--rappel=https://neomoov.net/oauth/rappel` (adresse déclarée chez le réseau ; la page d'arrivée peut afficher une erreur 404, c'est normal : copiez son adresse complète dans le terminal).
4. Vous posez chaque valeur sur le serveur, sans la voir :
   - valeur tapée ou collée à la main (saisie masquée) : `ssh -t root@78.138.58.92 /opt/neomoov/infra/scripts/env-set.sh NOM`
   - valeur lue dans le fichier du jeton : `Get-Content -Raw "C:\Users\PC\cles-neomoov\<fichier>.txt" | ssh root@78.138.58.92 /opt/neomoov/infra/scripts/env-set.sh NOM`
   - sur la dernière variable d'un réseau, ajoutez `--recreate api worker` pour que l'API et le worker la lisent.
   - si ce n'est pas déjà fait : `MARKETING_PROVIDER` à `real`.
5. Vérification : `pnpm env:check` (sur le poste) dit, réseau par réseau, s'il manque une variable (noms seulement) ; dans My Hub, Marketing, Espaces, le réseau passe à « configuré » ; la première publication programmée part au créneau suivant.

Tout ce qui suit se fait avec le compte **de Neomoov** sur chaque réseau (jamais un compte personnel), en vous connectant sur votre poste.

### 1. X

Ce qu'il faut : le compte X de Neomoov.

1. **Compte développeur** : developer.x.com, connexion avec le compte X de Neomoov, formule « Free » (écriture seulement) ou « Basic » (payante, lecture des réponses et des mesures : décision du fondateur). Un projet et une application sont créés.
2. **Authentification de l'application** : dans l'application, « User authentication settings », « Set up » :
   - App permissions : **Read and write** ;
   - Type of App : **Web App, Automated App or Bot** (client confidentiel) ;
   - Callback URI : `http://127.0.0.1:53682/rappel` (et, pour la page de My Hub, l'adresse donnée par sa procédure) ; Website URL : `https://neomoov.net`.
3. **Identifiants OAuth 2.0** (onglet « Keys and tokens », section « OAuth 2.0 Client ID and Client Secret ») : « Client ID » → `X_CLIENT_ID`, « Client Secret » → `X_CLIENT_SECRET`. Attention : ce ne sont **pas** les « API Key and Secret » ni les « Access Token and Secret » (OAuth 1.0a), qui ne servent pas ici.
4. **Jeton** : `pnpm --filter @neomoov/api oauth:jeton -- --fournisseur=x`, connexion avec le compte X de Neomoov ; la commande affiche le compte autorisé. Fichier `x-refresh-token.txt` → `X_REFRESH_TOKEN`.
5. **Serveur** : `X_CLIENT_ID`, `X_CLIENT_SECRET` à la main, puis `Get-Content -Raw "C:\Users\PC\cles-neomoov\x-refresh-token.txt" | ssh root@78.138.58.92 /opt/neomoov/infra/scripts/env-set.sh X_REFRESH_TOKEN --recreate api worker`, puis **supprimez le fichier** : X remplace ce jeton au premier usage (la plateforme garde le suivant, chiffré, dans la base) ; un même jeton posé à deux endroits ne marche qu'à un seul. Pour refaire l'autorisation plus tard, relancez simplement la commande et reposez la variable.

### 2. Telegram (canal)

Ce qu'il faut : le canal Telegram de Neomoov (de préférence public, avec un `@nom`), et un groupe de discussion lié au canal si vous voulez les commentaires.

1. **Bot** : dans Telegram, ouvrez **@BotFather**, envoyez `/newbot`, nom « Neomoov », identifiant se terminant par `bot` (par exemple `neomoov_publication_bot`). BotFather donne le **jeton du bot** (chiffres, deux-points, puis une longue suite) → `TELEGRAM_BOT_TOKEN` (secret).
2. **Bot administrateur du canal** : dans le canal, Administrateurs, « Ajouter un administrateur », cherchez le bot ; cochez **« Publier des messages »** (le reste peut rester décoché).
3. **Canal** : canal public : son `@nom` → `TELEGRAM_CHANNEL_ID` (par exemple `@neomoov`) ; canal privé : son identifiant numérique `-100…` (transférez un message du canal à @userinfobot ou @RawDataBot pour le lire).
4. **Commentaires (facultatif)** : dans le canal, Paramètres, « Discussion », liez un groupe (créez « Neomoov, discussion ») ; ajoutez le bot au groupe comme **administrateur** (sinon il ne voit pas les commentaires ; ou, chez BotFather, `/setprivacy` puis Disable). Identifiant du groupe (`-100…`, même méthode) → `TELEGRAM_DISCUSSION_CHAT_ID`. Ne posez jamais de webhook sur ce bot (la plateforme lit les messages par `getUpdates`).
5. **Serveur** : `ssh -t root@78.138.58.92 /opt/neomoov/infra/scripts/env-set.sh TELEGRAM_BOT_TOKEN`, puis `TELEGRAM_CHANNEL_ID`, puis `TELEGRAM_DISCUSSION_CHAT_ID --recreate api worker` (ou `TELEGRAM_CHANNEL_ID --recreate api worker` sans groupe).

### 3. LinkedIn (page entreprise)

Ce qu'il faut : être super administrateur de la page entreprise Neomoov.

1. **Application** : linkedin.com/developers, « Create app », nom « Neomoov », page entreprise Neomoov associée, logo ; puis, dans l'onglet « Settings », faites **vérifier l'association à la page** (un lien est envoyé à l'administrateur de la page).
2. **Produit « Community Management API »** : onglet « Products », « Request access ». LinkedIn demande un formulaire (usage : publier sur notre propre page, lire et répondre aux commentaires, mesurer) ; l'approbation peut prendre quelques semaines. **Tant qu'elle n'est pas accordée, chaque publication LinkedIn passe en relais manuel** (`SOCIAL_APPROVAL_PENDING`) : rien n'est perdu. Portées utilisées : `w_organization_social`, `r_organization_social`, `rw_organization_admin`.
3. **Adresse de retour** : onglet « Auth », « Authorized redirect URLs for your app » : ajoutez `http://127.0.0.1:53682/rappel`.
4. **Identifiants** : onglet « Auth » : « Client ID » → `LINKEDIN_CLIENT_ID`, « Primary Client Secret » → `LINKEDIN_CLIENT_SECRET`.
5. **Jeton** : `pnpm --filter @neomoov/api oauth:jeton -- --fournisseur=linkedin`, connexion avec votre compte administrateur. Deux cas :
   - LinkedIn donne un jeton de rafraîchissement (applications agréées, valable un an) : fichier `linkedin-refresh-token.txt` → `LINKEDIN_REFRESH_TOKEN` (avec `LINKEDIN_CLIENT_ID` et `LINKEDIN_CLIENT_SECRET` sur le serveur) ; le jeton d'accès se renouvelle seul ;
   - sinon : fichier `linkedin-access-token.txt` → `LINKEDIN_ACCESS_TOKEN`, valable 60 jours, et la date d'échéance affichée → `LINKEDIN_ACCESS_TOKEN_EXPIRES_AT` (AAAA-MM-JJ). Le personnel reçoit une alerte 7 jours avant : refaites alors la commande.
   La commande affiche aussi les pages que vous administrez : le nombre après `urn:li:organization:` → `LINKEDIN_ORGANIZATION_ID`.
6. **Serveur** : `LINKEDIN_ORGANIZATION_ID`, `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` à la main, puis le jeton depuis son fichier, puis la dernière variable avec `--recreate api worker`. `LINKEDIN_API_VERSION` n'est à poser que pour changer la version par défaut (202606).

### 4. YouTube

Ce qu'il faut : la chaîne YouTube de Neomoov (de préférence un compte de marque, géré par le compte Google de Neomoov).

1. **Projet Google Cloud** : console.cloud.google.com, « Nouveau projet », nom « Neomoov » (ou celui de la Search Console). Bibliothèque d'API : activez **« YouTube Data API v3 »**.
2. **Écran de consentement OAuth** : type « Externe », nom « Neomoov » ; portées `https://www.googleapis.com/auth/youtube.upload` et `https://www.googleapis.com/auth/youtube.force-ssl` ; **« Publier l'application » (état « En production »)**, sinon le jeton est invalidé après 7 jours. Google demande une validation de l'application pour ces portées (vidéo de démonstration, politique de confidentialité sur neomoov.net) : en attendant, l'écran d'accord affiche « application non validée » (Paramètres avancés, Accéder à Neomoov).
3. **Client OAuth** : Identifiants, « ID client OAuth », type **« Application de bureau »** : ID (se termine par `.apps.googleusercontent.com`) → `YOUTUBE_CLIENT_ID`, code secret (commence par `GOCSPX-`) → `YOUTUBE_CLIENT_SECRET`.
4. **Jeton** : `pnpm --filter @neomoov/api oauth:jeton -- --fournisseur=youtube`. À l'écran d'accord, **choisissez la chaîne Neomoov** (pas votre chaîne personnelle) ; la commande affiche le nom de la chaîne autorisée pour vérifier. Fichier `youtube-refresh-token.txt` → `YOUTUBE_REFRESH_TOKEN`.
5. **Audit de YouTube** (pour que les vidéos soient publiques) : formulaire « YouTube API Services, Audit and Quota Extension » (support.google.com/youtube, recherche « API audit ») ; décrire l'usage (publication de nos vidéos courtes de marque). **Tant que l'audit n'est pas accordé, les vidéos partent en privé, avec la mention** (vous pouvez les passer en public à la main dans YouTube Studio). Audit accordé : posez `YOUTUBE_API_AUDITED=on`.
6. **Serveur** : `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` à la main, puis `Get-Content -Raw "C:\Users\PC\cles-neomoov\youtube-refresh-token.txt" | ssh root@78.138.58.92 /opt/neomoov/infra/scripts/env-set.sh YOUTUBE_REFRESH_TOKEN --recreate api worker`. `YOUTUBE_PRIVACY_STATUS` (`public`, `unlisted`, `private`) seulement pour changer le défaut `public` après l'audit.

### 5. TikTok

Ce qu'il faut : le compte TikTok de Neomoov (compte professionnel).

1. **Compte développeur** : developers.tiktok.com, « Manage apps », « Connect an app », type d'organisation, nom « Neomoov », icône, description, adresses des conditions et de la politique de confidentialité de neomoov.net.
2. **Produits** : ajoutez « Login Kit » et « Content Posting API » ; dans « Content Posting API », activez **« Direct Post »**. Portées : `user.info.basic`, `video.publish`, `video.upload`, `video.list`.
3. **Adresse de retour** (Login Kit, « Redirect URI ») : TikTok exige une adresse https : déclarez `https://neomoov.net/oauth/rappel` (une page qui n'existe pas convient : seule l'adresse compte).
4. **Identifiants** (« App details ») : « Client key » → `TIKTOK_CLIENT_KEY`, « Client secret » → `TIKTOK_CLIENT_SECRET`.
5. **Soumission et audit** : soumettez l'application (« Submit for review », avec une courte vidéo de démonstration). **Tant que l'audit de la Content Posting API n'est pas accordé, les publications sont privées (`SELF_ONLY`), avec la mention** ; vous pouvez les rendre publiques à la main dans l'application TikTok. Audit accordé : posez `TIKTOK_APP_AUDITED=on`.
6. **Jeton** : `pnpm --filter @neomoov/api oauth:jeton -- --fournisseur=tiktok --rappel=https://neomoov.net/oauth/rappel`, connexion avec le compte TikTok de Neomoov, puis copiez dans le terminal l'adresse complète de la page d'arrivée. Fichier `tiktok-refresh-token.txt` → `TIKTOK_REFRESH_TOKEN` (valable un an : une alerte au personnel le rappellera).
7. **Serveur** : `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` à la main, puis `Get-Content -Raw "C:\Users\PC\cles-neomoov\tiktok-refresh-token.txt" | ssh root@78.138.58.92 /opt/neomoov/infra/scripts/env-set.sh TIKTOK_REFRESH_TOKEN --recreate api worker`, puis supprimez le fichier (même règle que X). Réglages facultatifs : `TIKTOK_PRIVACY_LEVEL` (après l'audit, `PUBLIC_TO_EVERYONE` par défaut), `TIKTOK_UPLOAD_MODE` (`file` par défaut).

### 6. Fiche Google (Business Profile), facultative

Ce qu'il faut : être propriétaire ou gestionnaire de la fiche Neomoov validée (business.google.com).

1. **Projet Google Cloud** : le même que YouTube convient. Notez le **numéro du projet** (page d'accueil du projet).
2. **Demande d'accès aux API Business Profile** (obligatoire, sinon le quota est de zéro) : sur developers.google.com/my-business, page « Prerequisites », lien « Request access » ; formulaire avec le numéro du projet, le courriel du compte qui gère la fiche, motif : « Publier les nouveautés de notre propre fiche et répondre à nos avis (Neomoov, transport de personnes à Montréal) ». Google répond par courriel (quelques jours).
3. **Activer les API** (Bibliothèque d'API, une fois l'accès accordé) : « My Business Account Management API », « My Business Business Information API », « Business Profile Performance API » et « Google My Business API » (publications et avis).
4. **Écran de consentement** : ajoutez la portée `https://www.googleapis.com/auth/business.manage` (application « En production », comme pour YouTube).
5. **Client OAuth** : le client « Application de bureau » de YouTube peut servir : `GOOGLE_BUSINESS_CLIENT_ID`, `GOOGLE_BUSINESS_CLIENT_SECRET`.
6. **Jeton** : `pnpm --filter @neomoov/api oauth:jeton -- --fournisseur=google-business`, connexion avec le compte qui gère la fiche. Résultat : `google-business-refresh-token.txt` → `GOOGLE_BUSINESS_REFRESH_TOKEN`. La commande affiche aussi vos comptes et établissements : `accounts/123…` → `GOOGLE_BUSINESS_ACCOUNT_ID`, `locations/456…` → `GOOGLE_BUSINESS_LOCATION_ID`.
7. **Serveur** : `GOOGLE_BUSINESS_CLIENT_ID`, `GOOGLE_BUSINESS_CLIENT_SECRET`, `GOOGLE_BUSINESS_ACCOUNT_ID` à la main ; puis `Get-Content -Raw "C:\Users\PC\cles-neomoov\google-business-refresh-token.txt" | ssh root@78.138.58.92 /opt/neomoov/infra/scripts/env-set.sh GOOGLE_BUSINESS_REFRESH_TOKEN` ; enfin `ssh -t root@78.138.58.92 /opt/neomoov/infra/scripts/env-set.sh GOOGLE_BUSINESS_LOCATION_ID --recreate api worker`.

### Google Agenda (rappel)

La même commande sert à l'agenda du fondateur de la direction commerciale : `--fournisseur=google-calendar` (variables `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, jeton dans `google-calendar-refresh-token.txt` → `GOOGLE_CALENDAR_REFRESH_TOKEN`, docs/sales/prospection.md).

## Commentaires et messages entrants

L'agent de diffusion répond lui-même aux commentaires simples (remerciement, horaires, lien de réservation : textes fixes du domaine et réglage `marketing.service_hours`) ; tout autre commentaire, et tout ton négatif, part vers la relation client (`conversation.inbound`, canal `social`, dès que la boîte unifiée de l'agent D l'offre) ou, à défaut, vers le personnel (`alert.agent_escalation`). Sur Facebook et Instagram, la boîte unifiée reçoit déjà les commentaires (webhook Meta) : elle seule y répond. Depuis le 3 octobre 2026, la même passe lit aussi les avis de la Fiche Google (un avis noté 3 sur 5 ou moins va toujours vers un humain), les commentaires LinkedIn et YouTube, les réponses sur X (formule Basic) et les commentaires du groupe de discussion du canal Telegram ; TikTok ne donne pas ses commentaires. Les messages privés (Messenger, Instagram, LinkedIn, X, Snapchat) sont du ressort de l'agent D.
