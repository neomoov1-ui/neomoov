/**
 * Procédures « Comment connecter » de l'espace Réseaux sociaux (3 octobre 2026), pour le fondateur : quoi créer chez
 * chaque réseau, quoi cocher, l'adresse de rappel à coller ({{callback}}, rendue par l'API), les délais d'approbation
 * connus et ce qui est automatique ensuite. Les mêmes textes, en français, sont dans docs/marketing/reseaux-connexion.md.
 * Aucune valeur secrète, aucun prix.
 */
import type { SocialSpace } from '@neomoov/domain';
import type { Language } from '@/lib/i18n-resources';

export interface Procedure {
  /** Ce que donne la connexion, en une phrase. */
  summary: string;
  steps: string[];
  /** Approbation exigée par le réseau et son délai connu ; null s'il n'y en a pas. */
  approval: string | null;
  automatic: string;
}

/** Commande pour poser une variable sur le serveur (valeur demandée sans être affichée). */
export const ENV_SET = 'ssh -t root@<serveur> /opt/neomoov/infra/scripts/env-set.sh NOM --recreate api worker';

const fr: Record<SocialSpace, Procedure> = {
  site_blog: {
    summary: 'Le blogue est le site WordPress de neomoov.net : aucune application à créer, trois variables du serveur suffisent.',
    steps: [
      'Ouvrir neomoov.net/wp-admin avec votre compte administrateur, menu Utilisateurs, Profil.',
      'Section « Mots de passe d\'application » : nom « Neomoov plateforme », cliquer « Ajouter un nouveau mot de passe d\'application », copier le mot de passe affiché (il n\'est montré qu\'une seule fois).',
      'Sur le serveur, poser WORDPRESS_URL (https://neomoov.net), WORDPRESS_USER (votre identifiant WordPress) et WORDPRESS_APP_PASSWORD (le mot de passe copié), une par une avec la commande ci-dessous.',
      'Revenir ici et cliquer « Revalider » : l\'état passe à « Connecté » avec votre nom WordPress.',
    ],
    approval: null,
    automatic: 'Validation chaque jour ; les articles approuvés dans le calendrier sont publiés sur le blogue. Si le mot de passe d\'application est retiré, l\'état passe à « Refusé » et l\'équipe reçoit une alerte.',
  },
  facebook: {
    summary: 'Un seul parcours Meta relie la page Facebook Neomoov ET le compte Instagram professionnel rattaché.',
    steps: [
      'Aller sur developers.facebook.com avec le compte Facebook qui administre la page Neomoov, « Mes apps », « Créer une app » (ou ouvrir l\'app Meta déjà créée pour WhatsApp : la même app peut servir).',
      'Type d\'app « Entreprise » ; nom « Neomoov plateforme » ; relier le portefeuille d\'entreprise Neomoov (Meta Business Suite).',
      'Ajouter le produit « Facebook Login for Business » ; dans ses paramètres, « URI de redirection OAuth valides » : coller l\'adresse de rappel {{callback}} ; laisser « Connexion OAuth Web » et « Appliquer HTTPS » activés.',
      'Paramètres de l\'app, Général : copier « ID de l\'app » et « Clé secrète de l\'app » ; renseigner le domaine api.neomoov.net, la politique de confidentialité (https://neomoov.net) et l\'icône.',
      'Autorisations à ajouter à l\'app : pages_show_list, pages_read_engagement, pages_manage_posts, pages_manage_engagement, pages_read_user_content, pages_messaging, business_management, instagram_basic, instagram_content_publish, instagram_manage_comments, instagram_manage_messages.',
      'Instagram : le compte doit être professionnel (Instagram, Paramètres, Type de compte, « Passer à un compte professionnel ») et rattaché à la page (Meta Business Suite, Paramètres, Comptes Instagram).',
      'Sur le serveur, poser META_APP_ID et META_APP_SECRET avec la commande ci-dessous.',
      'Ici, cliquer « Connecter » : Meta affiche ses autorisations, tout accepter et cocher la page Neomoov et le compte Instagram. Si plusieurs pages sont proposées, choisir la page ici.',
    ],
    approval: 'Tant que l\'app reste « en développement », les autorisations marchent pour vous (administrateur de l\'app) et suffisent pour publier sur VOS pages. L\'examen de l\'app par Meta (quelques jours à quelques semaines) n\'est nécessaire que pour gérer les pages d\'autres personnes.',
    automatic: 'Le jeton de page n\'expire pas. Validation chaque jour ; si Meta retire l\'accès (mot de passe changé, autorisation retirée), l\'état passe à « Refusé » et l\'équipe reçoit une alerte : il suffit de reconnecter.',
  },
  instagram: {
    summary: 'Instagram se connecte avec Facebook : le même parcours Meta relie la page et le compte Instagram professionnel rattaché.',
    steps: [
      'Passer le compte Instagram Neomoov en compte professionnel (Instagram, Paramètres, Type de compte et outils, « Passer à un compte professionnel », catégorie Entreprise).',
      'Le rattacher à la page Facebook Neomoov (Meta Business Suite, Paramètres, Comptes Instagram, « Connecter un compte »).',
      'Suivre la procédure de la carte Facebook (même app Meta, même adresse de rappel {{callback}}).',
      'Cliquer « Connecter » ici ou sur la carte Facebook : les deux cartes passent à « Connecté ».',
    ],
    approval: 'Comme Facebook : aucune attente pour vos propres comptes tant que l\'app Meta est en développement.',
    automatic: 'Publication des photos et des reels, lecture des commentaires et réponses par le même jeton de page ; validation chaque jour, alerte si l\'accès est retiré.',
  },
  linkedin: {
    summary: 'Page entreprise LinkedIn par la Community Management API (publication, commentaires, statistiques).',
    steps: [
      'Aller sur linkedin.com/developers, « Create app » : nom « Neomoov plateforme », page LinkedIn de Neomoov (il faut en être Super administrateur), logo, accepter les conditions.',
      'Onglet « Settings » : cliquer « Verify » pour faire confirmer l\'app par la page (un administrateur de la page approuve).',
      'Onglet « Products » : demander « Community Management API » et remplir le formulaire (usage : publier et répondre aux commentaires de notre propre page).',
      'Onglet « Auth » : « Authorized redirect URLs for your app » : coller {{callback}} ; copier « Client ID » et « Primary Client Secret ».',
      'Sur le serveur, poser LINKEDIN_CLIENT_ID et LINKEDIN_CLIENT_SECRET avec la commande ci-dessous.',
      'Ici, cliquer « Connecter » (possible dès que LinkedIn a accordé le produit) ; si plusieurs pages sont proposées, choisir celle de Neomoov.',
      'Quand LinkedIn a approuvé l\'accès, cocher « Le réseau a approuvé l\'application » : la publication passe en direct.',
    ],
    approval: 'LinkedIn examine chaque demande de Community Management API : quelques jours à quelques semaines, avec parfois une vérification de l\'entreprise. En attendant, l\'état reste « En attente d\'approbation » et les publications LinkedIn sont préparées en relais manuel (texte à copier, image à télécharger).',
    automatic: 'Jeton d\'accès de 60 jours renouvelé automatiquement par le jeton de rafraîchissement (un an) ; alerte à l\'équipe 7 jours avant une échéance qui demande de reconnecter ; validation chaque jour.',
  },
  x: {
    summary: 'Compte X de Neomoov par l\'API v2 (OAuth 2.0 avec PKCE).',
    steps: [
      'Aller sur developer.x.com avec le compte X de Neomoov et choisir le palier d\'accès voulu (le palier gratuit permet de publier, avec un plafond mensuel).',
      'Projects & Apps : créer un projet et une app « Neomoov plateforme ».',
      'Dans l\'app, « User authentication settings », « Set up » : App permissions « Read and write » ; Type of App « Web App, Automated App or Bot » ; Callback URI : coller {{callback}} ; Website URL : https://neomoov.net.',
      'Onglet « Keys and tokens » : copier « OAuth 2.0 Client ID » et « Client Secret ».',
      'Sur le serveur, poser X_CLIENT_ID et X_CLIENT_SECRET avec la commande ci-dessous.',
      'Ici, cliquer « Connecter » et autoriser l\'app avec le compte X de Neomoov.',
    ],
    approval: null,
    automatic: 'Le jeton d\'accès (2 heures) est renouvelé tout seul, sans intervention ; validation chaque jour, alerte si l\'autorisation est retirée.',
  },
  tiktok: {
    summary: 'Compte TikTok de Neomoov par Login Kit et la Content Posting API (publication directe des vidéos courtes).',
    steps: [
      'Aller sur developers.tiktok.com, « Manage apps », « Connect an app » : nom, icône, catégorie, description, adresses de la politique de confidentialité et des conditions d\'utilisation de neomoov.net.',
      'Ajouter les produits « Login Kit » et « Content Posting API » (activer « Direct Post »).',
      'Login Kit, « Redirect URI » (Web) : coller {{callback}} ; champs d\'application : user.info.basic, user.info.profile, video.publish, video.upload.',
      'Dans « URL properties », vérifier le domaine d\'où partent les vidéos (stockage des médias), demandé par TikTok pour la publication par adresse.',
      'Cliquer « Submit for review » pour l\'audit de l\'app.',
      'Copier « Client key » et « Client secret » ; sur le serveur, poser TIKTOK_CLIENT_KEY et TIKTOK_CLIENT_SECRET avec la commande ci-dessous.',
      'Ici, cliquer « Connecter » avec le compte TikTok de Neomoov ; après l\'audit, cocher « Le réseau a approuvé l\'application ».',
    ],
    approval: 'TikTok audite l\'app (quelques jours, parfois plus). Avant l\'audit, une vidéo publiée par l\'API reste privée (visible du seul compte) : l\'état reste « En attente d\'approbation » et les vidéos TikTok passent en relais manuel.',
    automatic: 'Jeton d\'accès de 24 heures renouvelé automatiquement (jeton de rafraîchissement d\'un an) ; alerte à l\'équipe avant l\'échéance ; validation chaque jour.',
  },
  snapchat: {
    summary: 'Snapchat n\'ouvre pas son API de publication à un compte comme le nôtre (liste d\'autorisation) : relais manuel, lien public seulement.',
    steps: [
      'Dans Snapchat, Profil, « Créer un profil public » (nom Neomoov, photo, catégorie).',
      'Copier le lien du profil public (forme https://www.snapchat.com/add/<nom>).',
      'Le coller ici et cliquer « Enregistrer le lien » ; cocher « Afficher sur le site » pour la page Contact.',
    ],
    approval: null,
    automatic: 'Chaque publication prévue pour Snapchat arrive dans « À publier à la main » (texte à copier, image à la bonne taille à télécharger), puis « Marquer comme publié ».',
  },
  telegram: {
    summary: 'Canal Telegram de Neomoov, publié par un bot administrateur du canal (Bot API).',
    steps: [
      'Dans Telegram, ouvrir @BotFather, envoyer /newbot, nom « Neomoov », identifiant se terminant par « bot » ; copier le jeton donné (forme 123456789:AA…).',
      'Créer le canal (Nouveau canal, « Neomoov », public avec un lien t.me/<nom> : recommandé pour la page Contact).',
      'Dans le canal, Administrateurs, « Ajouter un administrateur » : chercher le bot, lui laisser le droit « Publier des messages » (et « Modifier » et « Supprimer » des messages).',
      'Ici, coller le jeton du bot et le canal (@nom ou lien t.me), puis « Connecter et vérifier » : la plateforme vérifie le bot, le canal et le droit de publier avant d\'enregistrer.',
    ],
    approval: null,
    automatic: 'Le jeton est chiffré et n\'est plus jamais affiché. Vérification chaque jour (bot toujours administrateur) ; alerte à l\'équipe si le bot est retiré du canal.',
  },
  youtube: {
    summary: 'Chaîne YouTube de Neomoov par la YouTube Data API v3 (OAuth Google).',
    steps: [
      'Aller sur console.cloud.google.com, créer un projet « Neomoov plateforme » (ou réutiliser le projet Google déjà créé).',
      '« API et services », Bibliothèque : activer « YouTube Data API v3 ».',
      '« Écran de consentement OAuth » : type Externe, nom Neomoov, courriel d\'assistance, domaine neomoov.net, politique de confidentialité ; ajouter les champs youtube.upload, youtube.readonly et youtube.force-ssl ; publier l\'application (« En production ») pour que l\'autorisation ne s\'arrête pas au bout de 7 jours.',
      '« Identifiants », « Créer des identifiants », « ID client OAuth », type « Application Web » ; « URI de redirection autorisés » : coller {{callback}} ; copier l\'ID client et le code secret.',
      'Remplir la demande d\'audit « YouTube API Services, Audit and Quota Extension ».',
      'Sur le serveur, poser YOUTUBE_CLIENT_ID et YOUTUBE_CLIENT_SECRET avec la commande ci-dessous.',
      'Ici, cliquer « Connecter » avec le compte Google propriétaire de la chaîne ; après l\'audit, cocher « Le réseau a approuvé l\'application ».',
    ],
    approval: 'Google peut valider l\'écran de consentement (champs sensibles) et YouTube audite le projet : quelques jours à quelques semaines. Tant que le projet n\'est pas audité, YouTube garde privées les vidéos téléversées par l\'API : l\'état reste « En attente d\'approbation » et les vidéos passent en relais manuel.',
    automatic: 'Jeton renouvelé automatiquement ; validation chaque jour ; alerte si l\'autorisation est retirée.',
  },
  whatsapp_channel: {
    summary: 'Meta ne fournit aucune API pour publier sur une chaîne WhatsApp : relais manuel, lien public seulement.',
    steps: [
      'Dans WhatsApp (téléphone de Neomoov), onglet « Actus », « + », « Créer une chaîne » : nom Neomoov, photo, description.',
      'Dans la chaîne, « Partager le lien » : copier le lien (forme https://whatsapp.com/channel/…).',
      'Le coller ici et cliquer « Enregistrer le lien » ; cocher « Afficher sur le site » pour la page Contact.',
    ],
    approval: null,
    automatic: 'Chaque publication prévue pour la chaîne arrive dans « À publier à la main » (texte à copier, image à télécharger), puis « Marquer comme publié ».',
  },
};

const en: Record<SocialSpace, Procedure> = {
  site_blog: {
    summary: 'The blog is the neomoov.net WordPress site: no app to create, three server variables are enough.',
    steps: [
      'Open neomoov.net/wp-admin with your administrator account, Users, Profile.',
      '“Application Passwords” section: name “Neomoov platform”, click “Add New Application Password”, copy the password shown (it is displayed only once).',
      'On the server, set WORDPRESS_URL (https://neomoov.net), WORDPRESS_USER (your WordPress login) and WORDPRESS_APP_PASSWORD (the copied password), one by one with the command below.',
      'Come back here and click “Revalidate”: the status becomes “Connected” with your WordPress name.',
    ],
    approval: null,
    automatic: 'Validated every day; approved articles are published on the blog. If the application password is revoked, the status becomes “Refused” and the team is alerted.',
  },
  facebook: {
    summary: 'A single Meta flow connects the Neomoov Facebook Page AND its linked Instagram professional account.',
    steps: [
      'Go to developers.facebook.com with the Facebook account that manages the Neomoov Page, “My Apps”, “Create App” (or open the Meta app already created for WhatsApp: the same app works).',
      'App type “Business”; name “Neomoov platform”; link the Neomoov business portfolio (Meta Business Suite).',
      'Add the “Facebook Login for Business” product; in its settings, “Valid OAuth Redirect URIs”: paste the callback address {{callback}}; keep “Web OAuth Login” and “Enforce HTTPS” on.',
      'App settings, Basic: copy “App ID” and “App Secret”; fill in the domain api.neomoov.net, the privacy policy (https://neomoov.net) and the icon.',
      'Permissions to add to the app: pages_show_list, pages_read_engagement, pages_manage_posts, pages_manage_engagement, pages_read_user_content, pages_messaging, business_management, instagram_basic, instagram_content_publish, instagram_manage_comments, instagram_manage_messages.',
      'Instagram: the account must be professional (Instagram, Settings, Account type, “Switch to professional account”) and linked to the Page (Meta Business Suite, Settings, Instagram accounts).',
      'On the server, set META_APP_ID and META_APP_SECRET with the command below.',
      'Here, click “Connect”: Meta shows its permissions, accept them all and tick the Neomoov Page and the Instagram account. If several Pages are offered, choose the Page here.',
    ],
    approval: 'While the app stays “in development”, permissions work for you (app administrator), which is enough to publish on YOUR Pages. Meta App Review (a few days to a few weeks) is only needed to manage other people’s Pages.',
    automatic: 'The Page token does not expire. Validated every day; if Meta revokes access (password changed, permission removed), the status becomes “Refused” and the team is alerted: just reconnect.',
  },
  instagram: {
    summary: 'Instagram connects through Facebook: the same Meta flow links the Page and its Instagram professional account.',
    steps: [
      'Switch the Neomoov Instagram account to a professional account (Instagram, Settings, Account type and tools, “Switch to professional account”, Business category).',
      'Link it to the Neomoov Facebook Page (Meta Business Suite, Settings, Instagram accounts, “Connect account”).',
      'Follow the Facebook card procedure (same Meta app, same callback address {{callback}}).',
      'Click “Connect” here or on the Facebook card: both cards become “Connected”.',
    ],
    approval: 'Same as Facebook: no wait for your own accounts while the Meta app is in development.',
    automatic: 'Photos and reels published, comments read and answered with the same Page token; validated every day, alert if access is revoked.',
  },
  linkedin: {
    summary: 'LinkedIn company Page through the Community Management API (posts, comments, statistics).',
    steps: [
      'Go to linkedin.com/developers, “Create app”: name “Neomoov platform”, the Neomoov LinkedIn Page (you must be a Super admin), logo, accept the terms.',
      '“Settings” tab: click “Verify” to have the Page confirm the app (a Page admin approves).',
      '“Products” tab: request “Community Management API” and fill in the form (use: post and answer comments on our own Page).',
      '“Auth” tab: “Authorized redirect URLs for your app”: paste {{callback}}; copy “Client ID” and “Primary Client Secret”.',
      'On the server, set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET with the command below.',
      'Here, click “Connect” (possible as soon as LinkedIn grants the product); if several Pages are offered, choose Neomoov.',
      'Once LinkedIn has approved access, tick “The network approved the app”: publishing switches to direct.',
    ],
    approval: 'LinkedIn reviews every Community Management API request: a few days to a few weeks, sometimes with a company verification. Meanwhile the status stays “Pending approval” and LinkedIn posts are prepared for manual relay (text to copy, image to download).',
    automatic: '60-day access token renewed automatically with the refresh token (one year); the team is alerted 7 days before a deadline that requires reconnecting; validated every day.',
  },
  x: {
    summary: 'Neomoov X account through API v2 (OAuth 2.0 with PKCE).',
    steps: [
      'Go to developer.x.com with the Neomoov X account and choose the access tier you want (the free tier allows posting, with a monthly cap).',
      'Projects & Apps: create a project and an app “Neomoov platform”.',
      'In the app, “User authentication settings”, “Set up”: App permissions “Read and write”; Type of App “Web App, Automated App or Bot”; Callback URI: paste {{callback}}; Website URL: https://neomoov.net.',
      '“Keys and tokens” tab: copy “OAuth 2.0 Client ID” and “Client Secret”.',
      'On the server, set X_CLIENT_ID and X_CLIENT_SECRET with the command below.',
      'Here, click “Connect” and authorize the app with the Neomoov X account.',
    ],
    approval: null,
    automatic: 'The access token (2 hours) renews by itself; validated every day, alert if the authorization is revoked.',
  },
  tiktok: {
    summary: 'Neomoov TikTok account through Login Kit and the Content Posting API (direct posting of short videos).',
    steps: [
      'Go to developers.tiktok.com, “Manage apps”, “Connect an app”: name, icon, category, description, neomoov.net privacy policy and terms addresses.',
      'Add the “Login Kit” and “Content Posting API” products (turn on “Direct Post”).',
      'Login Kit, “Redirect URI” (Web): paste {{callback}}; scopes: user.info.basic, user.info.profile, video.publish, video.upload.',
      'In “URL properties”, verify the domain the videos are served from (media storage), required by TikTok for posting by URL.',
      'Click “Submit for review” for the app audit.',
      'Copy “Client key” and “Client secret”; on the server, set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET with the command below.',
      'Here, click “Connect” with the Neomoov TikTok account; after the audit, tick “The network approved the app”.',
    ],
    approval: 'TikTok audits the app (a few days, sometimes more). Before the audit, a video posted through the API stays private (visible to the account only): the status stays “Pending approval” and TikTok videos go through manual relay.',
    automatic: '24-hour access token renewed automatically (one-year refresh token); the team is alerted before the deadline; validated every day.',
  },
  snapchat: {
    summary: 'Snapchat does not open its posting API to an account like ours (allow list): manual relay, public link only.',
    steps: [
      'In Snapchat, Profile, “Create public profile” (name Neomoov, photo, category).',
      'Copy the public profile link (like https://www.snapchat.com/add/<name>).',
      'Paste it here and click “Save link”; tick “Show on site” for the Contact page.',
    ],
    approval: null,
    automatic: 'Every post planned for Snapchat lands in “To publish by hand” (text to copy, right-sized image to download), then “Mark as published”.',
  },
  telegram: {
    summary: 'Neomoov Telegram channel, posted by a bot that is a channel administrator (Bot API).',
    steps: [
      'In Telegram, open @BotFather, send /newbot, name “Neomoov”, username ending with “bot”; copy the token given (like 123456789:AA…).',
      'Create the channel (New channel, “Neomoov”, public with a t.me/<name> link: recommended for the Contact page).',
      'In the channel, Administrators, “Add administrator”: find the bot, keep the “Post messages” right (and “Edit” and “Delete” messages).',
      'Here, paste the bot token and the channel (@name or t.me link), then “Connect and check”: the platform checks the bot, the channel and the posting right before saving.',
    ],
    approval: null,
    automatic: 'The token is encrypted and never shown again. Checked every day (bot still administrator); the team is alerted if the bot is removed from the channel.',
  },
  youtube: {
    summary: 'Neomoov YouTube channel through the YouTube Data API v3 (Google OAuth).',
    steps: [
      'Go to console.cloud.google.com, create a project “Neomoov platform” (or reuse the Google project already created).',
      '“APIs & Services”, Library: enable “YouTube Data API v3”.',
      '“OAuth consent screen”: External, name Neomoov, support email, domain neomoov.net, privacy policy; add the youtube.upload, youtube.readonly and youtube.force-ssl scopes; publish the app (“In production”) so the authorization does not stop after 7 days.',
      '“Credentials”, “Create credentials”, “OAuth client ID”, type “Web application”; “Authorized redirect URIs”: paste {{callback}}; copy the client ID and secret.',
      'Fill in the “YouTube API Services, Audit and Quota Extension” audit request.',
      'On the server, set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET with the command below.',
      'Here, click “Connect” with the Google account that owns the channel; after the audit, tick “The network approved the app”.',
    ],
    approval: 'Google may verify the consent screen (sensitive scopes) and YouTube audits the project: a few days to a few weeks. Until the project is audited, YouTube keeps API uploads private: the status stays “Pending approval” and videos go through manual relay.',
    automatic: 'Token renewed automatically; validated every day; alert if the authorization is revoked.',
  },
  whatsapp_channel: {
    summary: 'Meta provides no API to post to a WhatsApp channel: manual relay, public link only.',
    steps: [
      'In WhatsApp (Neomoov phone), “Updates” tab, “+”, “Create channel”: name Neomoov, photo, description.',
      'In the channel, “Share link”: copy the link (like https://whatsapp.com/channel/…).',
      'Paste it here and click “Save link”; tick “Show on site” for the Contact page.',
    ],
    approval: null,
    automatic: 'Every post planned for the channel lands in “To publish by hand” (text to copy, image to download), then “Mark as published”.',
  },
};

export const PROCEDURES: Record<Language, Record<SocialSpace, Procedure>> = { 'fr-CA': fr, en };
