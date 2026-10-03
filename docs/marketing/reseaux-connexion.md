# Réseaux sociaux : connecter les comptes de Neomoov (procédures pour le fondateur)

Espace My Hub : **Pilotage, Réseaux sociaux** (`/hub/reseaux`). Chaque réseau a sa carte : état coloré, compte relié, dernière validation, boutons Connecter, Revalider, Déconnecter, mode de publication, lien public, case « Afficher sur le site » (page Contact de neomoov.net) et le panneau « Comment connecter », qui reprend les procédures ci-dessous. Ce document est produit à partir du même texte que My Hub (3 octobre 2026).

## Ce que fait la plateforme, une fois le compte relié

- Les jetons et secrets sont chiffrés en base (table `social_accounts`, `FieldCipher`) ; ils ne sont jamais affichés, ni dans My Hub, ni dans le journal d'audit, ni dans les journaux.
- Chaque compte direct est validé chaque jour (appel en lecture seule chez le réseau) et avant une publication si la dernière validation date de plus d'une heure ; un jeton d'accès qui arrive à échéance est renouvelé tout seul.
- Un compte refusé ou échu passe à l'état « Refusé » ou « Échu », n'est plus utilisé, et l'équipe reçoit une alerte : il suffit de cliquer « Reconnecter ». Une autorisation qui se termine dans 7 jours sans renouvellement possible déclenche aussi une alerte.
- LinkedIn, TikTok et YouTube restent « En attente d'approbation » tant que vous n'avez pas coché « Le réseau a approuvé l'application » : leurs publications passent en relais manuel (texte à copier, image à télécharger, « Marquer comme publié »). Pour YouTube et TikTok, les variables `YOUTUBE_API_AUDITED=on` et `TIKTOK_APP_AUDITED=on` valent aussi approbation.
- La page Contact de neomoov.net affiche les comptes « Connecté » cochés « Afficher sur le site » (adresse publique `GET /v1/public/social-links`, mise à jour en 10 minutes au plus).
- Aucun agrégateur (décision du fondateur du 3 octobre 2026) : connexions directes, ou relais manuel quand le réseau n'ouvre pas son API (Snapchat, chaîne WhatsApp).

## Résumé : quoi créer, quelle adresse de rappel déclarer

| Réseau | Mode | Variables du serveur | Adresse de rappel à déclarer chez le réseau |
|---|---|---|---|
| Blogue neomoov.net | direct (lecture seule) | `WORDPRESS_URL`, `WORDPRESS_USER`, `WORDPRESS_APP_PASSWORD` | aucune |
| Facebook | direct | `META_APP_ID`, `META_APP_SECRET` | `https://api.neomoov.net/v1/social/oauth/callback/facebook` |
| Instagram | direct | `META_APP_ID`, `META_APP_SECRET` (les mêmes) | `https://api.neomoov.net/v1/social/oauth/callback/facebook` |
| LinkedIn | direct après approbation (relais manuel avant) | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | `https://api.neomoov.net/v1/social/oauth/callback/linkedin` |
| X | direct | `X_CLIENT_ID`, `X_CLIENT_SECRET` | `https://api.neomoov.net/v1/social/oauth/callback/x` |
| TikTok | direct après audit (relais manuel avant) | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | `https://api.neomoov.net/v1/social/oauth/callback/tiktok` |
| Snapchat | relais manuel | aucune | aucune |
| Telegram | direct | aucune (jeton du bot saisi dans My Hub) | aucune |
| YouTube | direct après audit (relais manuel avant) | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` | `https://api.neomoov.net/v1/social/oauth/callback/youtube` |
| Chaîne WhatsApp | relais manuel | aucune | aucune |

Poser une variable sur le serveur (la valeur est demandée sans être affichée), en remplaçant `NOM` :

```
ssh -t root@<serveur> /opt/neomoov/infra/scripts/env-set.sh NOM --recreate api worker
```

L'adresse de rappel suit `APP_BASE_URL` : `<APP_BASE_URL>/v1/social/oauth/callback/<espace>`. My Hub affiche l'adresse exacte sur chaque carte, avec un bouton « Copier ».

## Blogue neomoov.net

Le blogue est le site WordPress de neomoov.net : aucune application à créer, trois variables du serveur suffisent.

1. Ouvrir neomoov.net/wp-admin avec votre compte administrateur, menu Utilisateurs, Profil.
2. Section « Mots de passe d'application » : nom « Neomoov plateforme », cliquer « Ajouter un nouveau mot de passe d'application », copier le mot de passe affiché (il n'est montré qu'une seule fois).
3. Sur le serveur, poser WORDPRESS_URL (https://neomoov.net), WORDPRESS_USER (votre identifiant WordPress) et WORDPRESS_APP_PASSWORD (le mot de passe copié), une par une avec la commande ci-dessous.
4. Revenir ici et cliquer « Revalider » : l'état passe à « Connecté » avec votre nom WordPress.

**Ensuite, automatiquement.** Validation chaque jour ; les articles approuvés dans le calendrier sont publiés sur le blogue. Si le mot de passe d'application est retiré, l'état passe à « Refusé » et l'équipe reçoit une alerte.

## Facebook

Un seul parcours Meta relie la page Facebook Neomoov ET le compte Instagram professionnel rattaché.

1. Aller sur developers.facebook.com avec le compte Facebook qui administre la page Neomoov, « Mes apps », « Créer une app » (ou ouvrir l'app Meta déjà créée pour WhatsApp : la même app peut servir).
2. Type d'app « Entreprise » ; nom « Neomoov plateforme » ; relier le portefeuille d'entreprise Neomoov (Meta Business Suite).
3. Ajouter le produit « Facebook Login for Business » ; dans ses paramètres, « URI de redirection OAuth valides » : coller l'adresse de rappel `https://api.neomoov.net/v1/social/oauth/callback/facebook` ; laisser « Connexion OAuth Web » et « Appliquer HTTPS » activés.
4. Paramètres de l'app, Général : copier « ID de l'app » et « Clé secrète de l'app » ; renseigner le domaine api.neomoov.net, la politique de confidentialité (https://neomoov.net) et l'icône.
5. Autorisations à ajouter à l'app : pages_show_list, pages_read_engagement, pages_manage_posts, pages_manage_engagement, pages_read_user_content, pages_messaging, business_management, instagram_basic, instagram_content_publish, instagram_manage_comments, instagram_manage_messages.
6. Instagram : le compte doit être professionnel (Instagram, Paramètres, Type de compte, « Passer à un compte professionnel ») et rattaché à la page (Meta Business Suite, Paramètres, Comptes Instagram).
7. Sur le serveur, poser META_APP_ID et META_APP_SECRET avec la commande ci-dessous.
8. Ici, cliquer « Connecter » : Meta affiche ses autorisations, tout accepter et cocher la page Neomoov et le compte Instagram. Si plusieurs pages sont proposées, choisir la page ici.

**Approbation du réseau.** Tant que l'app reste « en développement », les autorisations marchent pour vous (administrateur de l'app) et suffisent pour publier sur VOS pages. L'examen de l'app par Meta (quelques jours à quelques semaines) n'est nécessaire que pour gérer les pages d'autres personnes.

**Ensuite, automatiquement.** Le jeton de page n'expire pas. Validation chaque jour ; si Meta retire l'accès (mot de passe changé, autorisation retirée), l'état passe à « Refusé » et l'équipe reçoit une alerte : il suffit de reconnecter.

## Instagram

Instagram se connecte avec Facebook : le même parcours Meta relie la page et le compte Instagram professionnel rattaché.

1. Passer le compte Instagram Neomoov en compte professionnel (Instagram, Paramètres, Type de compte et outils, « Passer à un compte professionnel », catégorie Entreprise).
2. Le rattacher à la page Facebook Neomoov (Meta Business Suite, Paramètres, Comptes Instagram, « Connecter un compte »).
3. Suivre la procédure de la carte Facebook (même app Meta, même adresse de rappel `https://api.neomoov.net/v1/social/oauth/callback/facebook`).
4. Cliquer « Connecter » ici ou sur la carte Facebook : les deux cartes passent à « Connecté ».

**Approbation du réseau.** Comme Facebook : aucune attente pour vos propres comptes tant que l'app Meta est en développement.

**Ensuite, automatiquement.** Publication des photos et des reels, lecture des commentaires et réponses par le même jeton de page ; validation chaque jour, alerte si l'accès est retiré.

## LinkedIn

Page entreprise LinkedIn par la Community Management API (publication, commentaires, statistiques).

1. Aller sur linkedin.com/developers, « Create app » : nom « Neomoov plateforme », page LinkedIn de Neomoov (il faut en être Super administrateur), logo, accepter les conditions.
2. Onglet « Settings » : cliquer « Verify » pour faire confirmer l'app par la page (un administrateur de la page approuve).
3. Onglet « Products » : demander « Community Management API » et remplir le formulaire (usage : publier et répondre aux commentaires de notre propre page).
4. Onglet « Auth » : « Authorized redirect URLs for your app » : coller `https://api.neomoov.net/v1/social/oauth/callback/linkedin` ; copier « Client ID » et « Primary Client Secret ».
5. Sur le serveur, poser LINKEDIN_CLIENT_ID et LINKEDIN_CLIENT_SECRET avec la commande ci-dessous.
6. Ici, cliquer « Connecter » (possible dès que LinkedIn a accordé le produit) ; si plusieurs pages sont proposées, choisir celle de Neomoov.
7. Quand LinkedIn a approuvé l'accès, cocher « Le réseau a approuvé l'application » : la publication passe en direct.

**Approbation du réseau.** LinkedIn examine chaque demande de Community Management API : quelques jours à quelques semaines, avec parfois une vérification de l'entreprise. En attendant, l'état reste « En attente d'approbation » et les publications LinkedIn sont préparées en relais manuel (texte à copier, image à télécharger).

**Ensuite, automatiquement.** Jeton d'accès de 60 jours renouvelé automatiquement par le jeton de rafraîchissement (un an) ; alerte à l'équipe 7 jours avant une échéance qui demande de reconnecter ; validation chaque jour.

## X

Compte X de Neomoov par l'API v2 (OAuth 2.0 avec PKCE).

1. Aller sur developer.x.com avec le compte X de Neomoov et choisir le palier d'accès voulu (le palier gratuit permet de publier, avec un plafond mensuel).
2. Projects & Apps : créer un projet et une app « Neomoov plateforme ».
3. Dans l'app, « User authentication settings », « Set up » : App permissions « Read and write » ; Type of App « Web App, Automated App or Bot » ; Callback URI : coller `https://api.neomoov.net/v1/social/oauth/callback/x` ; Website URL : https://neomoov.net.
4. Onglet « Keys and tokens » : copier « OAuth 2.0 Client ID » et « Client Secret ».
5. Sur le serveur, poser X_CLIENT_ID et X_CLIENT_SECRET avec la commande ci-dessous.
6. Ici, cliquer « Connecter » et autoriser l'app avec le compte X de Neomoov.

**Ensuite, automatiquement.** Le jeton d'accès (2 heures) est renouvelé tout seul, sans intervention ; validation chaque jour, alerte si l'autorisation est retirée.

## TikTok

Compte TikTok de Neomoov par Login Kit et la Content Posting API (publication directe des vidéos courtes).

1. Aller sur developers.tiktok.com, « Manage apps », « Connect an app » : nom, icône, catégorie, description, adresses de la politique de confidentialité et des conditions d'utilisation de neomoov.net.
2. Ajouter les produits « Login Kit » et « Content Posting API » (activer « Direct Post »).
3. Login Kit, « Redirect URI » (Web) : coller `https://api.neomoov.net/v1/social/oauth/callback/tiktok` ; champs d'application : user.info.basic, user.info.profile, video.publish, video.upload.
4. Dans « URL properties », vérifier le domaine d'où partent les vidéos (stockage des médias), demandé par TikTok pour la publication par adresse.
5. Cliquer « Submit for review » pour l'audit de l'app.
6. Copier « Client key » et « Client secret » ; sur le serveur, poser TIKTOK_CLIENT_KEY et TIKTOK_CLIENT_SECRET avec la commande ci-dessous.
7. Ici, cliquer « Connecter » avec le compte TikTok de Neomoov ; après l'audit, cocher « Le réseau a approuvé l'application ».

**Approbation du réseau.** TikTok audite l'app (quelques jours, parfois plus). Avant l'audit, une vidéo publiée par l'API reste privée (visible du seul compte) : l'état reste « En attente d'approbation » et les vidéos TikTok passent en relais manuel.

**Ensuite, automatiquement.** Jeton d'accès de 24 heures renouvelé automatiquement (jeton de rafraîchissement d'un an) ; alerte à l'équipe avant l'échéance ; validation chaque jour.

## Snapchat

Snapchat n'ouvre pas son API de publication à un compte comme le nôtre (liste d'autorisation) : relais manuel, lien public seulement.

1. Dans Snapchat, Profil, « Créer un profil public » (nom Neomoov, photo, catégorie).
2. Copier le lien du profil public (forme https://www.snapchat.com/add/<nom>).
3. Le coller ici et cliquer « Enregistrer le lien » ; cocher « Afficher sur le site » pour la page Contact.

**Ensuite, automatiquement.** Chaque publication prévue pour Snapchat arrive dans « À publier à la main » (texte à copier, image à la bonne taille à télécharger), puis « Marquer comme publié ».

## Telegram

Canal Telegram de Neomoov, publié par un bot administrateur du canal (Bot API).

1. Dans Telegram, ouvrir @BotFather, envoyer /newbot, nom « Neomoov », identifiant se terminant par « bot » ; copier le jeton donné (forme 123456789:AA…).
2. Créer le canal (Nouveau canal, « Neomoov », public avec un lien t.me/<nom> : recommandé pour la page Contact).
3. Dans le canal, Administrateurs, « Ajouter un administrateur » : chercher le bot, lui laisser le droit « Publier des messages » (et « Modifier » et « Supprimer » des messages).
4. Ici, coller le jeton du bot et le canal (@nom ou lien t.me), puis « Connecter et vérifier » : la plateforme vérifie le bot, le canal et le droit de publier avant d'enregistrer.

**Ensuite, automatiquement.** Le jeton est chiffré et n'est plus jamais affiché. Vérification chaque jour (bot toujours administrateur) ; alerte à l'équipe si le bot est retiré du canal.

## YouTube

Chaîne YouTube de Neomoov par la YouTube Data API v3 (OAuth Google).

1. Aller sur console.cloud.google.com, créer un projet « Neomoov plateforme » (ou réutiliser le projet Google déjà créé).
2. « API et services », Bibliothèque : activer « YouTube Data API v3 ».
3. « Écran de consentement OAuth » : type Externe, nom Neomoov, courriel d'assistance, domaine neomoov.net, politique de confidentialité ; ajouter les champs youtube.upload, youtube.readonly et youtube.force-ssl ; publier l'application (« En production ») pour que l'autorisation ne s'arrête pas au bout de 7 jours.
4. « Identifiants », « Créer des identifiants », « ID client OAuth », type « Application Web » (pas « Application de bureau » : My Hub a besoin d'une adresse de rappel en https) ; « URI de redirection autorisés » : coller `https://api.neomoov.net/v1/social/oauth/callback/youtube` (et http://127.0.0.1:53682/rappel si vous utilisez aussi l'outil local oauth:jeton) ; copier l'ID client et le code secret. Si un client « Application de bureau » existe déjà, le remplacer par celui-ci dans les variables.
5. Remplir la demande d'audit « YouTube API Services, Audit and Quota Extension ».
6. Sur le serveur, poser YOUTUBE_CLIENT_ID et YOUTUBE_CLIENT_SECRET avec la commande ci-dessous.
7. Ici, cliquer « Connecter » avec le compte Google propriétaire de la chaîne ; après l'audit, cocher « Le réseau a approuvé l'application ».

**Approbation du réseau.** Google peut valider l'écran de consentement (champs sensibles) et YouTube audite le projet : quelques jours à quelques semaines. Tant que le projet n'est pas audité, YouTube garde privées les vidéos téléversées par l'API : l'état reste « En attente d'approbation » et les vidéos passent en relais manuel.

**Ensuite, automatiquement.** Jeton renouvelé automatiquement ; validation chaque jour ; alerte si l'autorisation est retirée.

## Chaîne WhatsApp

Meta ne fournit aucune API pour publier sur une chaîne WhatsApp : relais manuel, lien public seulement.

1. Dans WhatsApp (téléphone de Neomoov), onglet « Actus », « + », « Créer une chaîne » : nom Neomoov, photo, description.
2. Dans la chaîne, « Partager le lien » : copier le lien (forme https://whatsapp.com/channel/…).
3. Le coller ici et cliquer « Enregistrer le lien » ; cocher « Afficher sur le site » pour la page Contact.

**Ensuite, automatiquement.** Chaque publication prévue pour la chaîne arrive dans « À publier à la main » (texte à copier, image à télécharger), puis « Marquer comme publié ».
