# Neomoov. Comptes externes à créer, dans l'ordre

Version 1.1, 23 septembre 2026 (version 1.0 du 22 septembre). Niveau interne. Dérivé de la section 8.5 du document de référence v1.1, du cahier des charges v1.1 et du plan de développement. Répond à la demande du fondateur : « tous les comptes externes pour l'ensemble du projet, les informations dont Claude a besoin, et l'ordre ».

Tous les comptes s'ouvrent au nom de **GROUPE NOUVEAU SYSTEME KARDINAL (GROUPE NSK) INC.**, avec l'adresse `neomoov1@gmail.com` (décision du 22 septembre 2026), sauf Apple et Google Play qui restent sur les comptes existants. Les clés vont dans `C:\Users\PC\code\neomoov\.env`, sous le nom de variable indiqué, jamais dans une conversation, un courriel ou un document.

## Ce que je dois recevoir, selon le type de compte

| Type | Ce dont j'ai besoin | Comment me le donner |
|---|---|---|
| Compte avec clé d'API | La clé, collée dans `.env` après le nom de variable indiqué | Tu me dis « la clé X est dans le .env » |
| Compte hébergeur (Supabase, Railway, Vercel, Expo, Cloudflare) | Une adresse de connexion ou un jeton, dans `.env` ; parfois une invitation de mon compte comme collaborateur | Invitation par courriel à `paulemileverges@gmail.com` ou jeton dans `.env` |
| Magasins d'applications (Apple, Google) | Compte validé au nom de la société ; puis une clé d'API App Store Connect (fichier `.p8`) et un compte de service Google Play (fichier JSON) déposés dans `C:\Users\PC\cles-neomoov\` | Tu me dis « fichiers déposés » |
| Comptes administratifs (Revenu Québec, CTQ, assureur, banque) | Aucun accès : seulement les numéros et les documents obtenus (NEQ, numéros de taxes, numéro de dossier CTQ, attestation d'assurance) | Tu me donnes les numéros ou tu déposes les documents dans `context/import/neomoov/` |
| Comptes de communication (réseaux sociaux, Google Business Profile, LinkedIn) | Rien avant T4 2026 ; ensuite un accès « gestionnaire » de mon côté ou des jetons d'API pour les agents | Plus tard |

## À préparer avant de commencer (une seule fois)

- Dénomination légale exacte (D25), numéro d'entreprise du Québec (NEQ), adresse du siège, date de constitution
- Numéros de TPS et de TVQ de la société
- Numéro D-U-N-S : **243377415** (obtenu le 22 septembre 2026)
- Compte bancaire d'entreprise (spécimen de chèque) et carte de crédit d'entreprise
- Pièce d'identité du dirigeant (Stripe, Apple, Google et Supabase Pro la demandent)
- Un gestionnaire de mots de passe (ligne 8) : tous les accès y sont rangés, rien ailleurs

## État au 23 septembre 2026

| Compte | État |
|---|---|
| Apple Developer | Existant (individuel, ouvert pour Taxi Sylvain, équipe DNB64CQYH6). À convertir en organisation ou à doubler par un compte d'organisation Groupe NSK Inc. avec le D-U-N-S |
| Google Play Console | Existant (Taxi Sylvain). Une console d'organisation au nom de Groupe NSK Inc. est nécessaire pour Neomoov |
| GitHub | Compte `neomoov1` créé le 22 septembre ; dépôt privé `neomoov` et invitation de `paulemileverges-star` restent à faire (3 commits locaux attendent) |
| WordPress LWS, neomoov.net | En service, accès dans `.env` du Jarvis (`WP_NEOMOOV_*`) |
| Twilio, Brevo, Railway, Vercel, Expo | Existants (Taxi Sylvain), réutilisables avec un projet ou une organisation « neomoov » |

## Ordre de création (hyper important) et ce que j'attends de chacun

### Bloc 1. Aujourd'hui : ce qui bloque le code dès demain

| N° | Compte | Lien | Coût | Ce qu'il faut pour l'ouvrir | Ce que j'attends |
|---|---|---|---|---|---|
| 1 | **Supabase** (base PostgreSQL et PostGIS, région Canada central) | https://supabase.com/dashboard/sign-up | Gratuit, puis 25 $ US par mois avant le lancement | Compte `neomoov1@gmail.com` (ou GitHub neomoov1), organisation « Neomoov », projet `neomoov-dev`, région **Canada (Central)**, mot de passe généré et rangé | `DATABASE_URL` = adresse « Session pooler » avec le mot de passe, dans `.env`. Marche à suivre détaillée donnée le 23 septembre. **Sans elle, aucune étape de code ne peut avancer** |
| 2 | **GitHub** : dépôt `neomoov` privé sous le compte neomoov1, puis invitation | https://github.com/new puis Settings, Collaborators | Gratuit | Compte existant | Invitation acceptée par `paulemileverges-star` ; je pousse les 3 commits en attente |
| 3 | **Railway** : projet `neomoov` avec un service Redis | https://railway.com (compte existant) | 5 à 20 $ par mois | Compte existant | `REDIS_URL` dans `.env` (ou une invitation au projet, je crée le service) |
| 4 | **Google Maps Platform** : projet `neomoov` | https://console.cloud.google.com/google/maps-apis/start | Crédit mensuel gratuit puis à l'usage | Compte Google `neomoov1@gmail.com`, carte de crédit, alerte de budget à 50 $ | Activer Routes API (avec péages et trafic), Places API (New), Geocoding API, Maps SDK Android et iOS ; trois clés restreintes : `GOOGLE_MAPS_SERVER_KEY`, `GOOGLE_MAPS_IOS_KEY`, `GOOGLE_MAPS_ANDROID_KEY` |
| 5 | **Apple Developer Program**, organisation | Vérifier le D-U-N-S : https://developer.apple.com/enroll/duns-lookup/ puis https://developer.apple.com/programs/enroll/ | 99 $ US par an | D-U-N-S, site web (neomoov.net), courriel au nom du domaine (`contact@neomoov.net`), téléphone | Compte validé (quelques jours à deux semaines, Apple appelle parfois). Ensuite : clé d'API App Store Connect (`.p8`, identifiant de clé, identifiant d'émetteur) dans `C:\Users\PC\cles-neomoov\` |
| 6 | **Google Play Console**, organisation | https://play.google.com/console/signup | 25 $ US une fois | D-U-N-S, pièce d'identité, site web | Compte vérifié ; ensuite un compte de service (JSON) pour les envois automatiques |
| 7 | **Revenu Québec, Mon dossier pour les entreprises** | https://www.revenuquebec.ca (Mon dossier, Entreprises) | Gratuit | NEQ, numéros de taxes | Numéros et accès actifs (redevance de 0,90 $, facturation obligatoire, SEV) ; aucun accès de mon côté |
| 8 | **1Password** (ou équivalent) | https://1password.com | 8 $ par mois | Carte | Rien ; tous les accès ci-dessous y sont rangés |

### Bloc 2. Avant l'étape 7 (paiements), cette semaine

| N° | Compte | Lien | Coût | Ce qu'il faut | Ce que j'attends |
|---|---|---|---|---|---|
| 9 | **Stripe**, au nom de la société | https://dashboard.stripe.com/register | 2,9 % + 0,30 $ par transaction ; Connect en sus | Mode test d'abord : rien. Mode réel : NEQ, compte bancaire, pièce d'identité | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` (test) ; activer Connect (comptes Express), Apple Pay (domaine neomoov.net) et Google Pay. `STRIPE_WEBHOOK_SECRET` vient à l'étape 7 |
| 10 | **Cloudflare** | https://dash.cloudflare.com/sign-up | 0 à 20 $ par mois | Transférer le DNS de `neomoov.net` (LWS) vers Cloudflare, ou me donner l'accès DNS de LWS | R2 activé : `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (documents des chauffeurs ; plus tard enregistrements audio et vidéo) |
| 11 | **Courriels de la société** sur `neomoov.net` | Panel LWS, rubrique Emails | Compris | Boîtes ou redirections `contact@` (existe), `assistance@`, `comptes@` vers `neomoov1@gmail.com` | Rien d'autre |
| 12 | **Expo** : organisation « neomoov » | https://expo.dev, Réglages, Access tokens | 0 à 99 $ US par mois | Compte existant | `EXPO_TOKEN` (jeton de l'organisation) dans `.env` |
| 13 | **Vercel** : équipe ou projet « neomoov » | https://vercel.com (compte existant) | Gratuit au départ | Compte existant | Rien tout de suite (je déploie avec la CLI connectée) |

### Bloc 3. Avant l'étape 11 (notifications, agents, vocal)

| N° | Compte | Lien | Coût | Ce qu'il faut | Ce que j'attends |
|---|---|---|---|---|---|
| 14 | **Anthropic, console de l'API** | https://console.anthropic.com | À l'usage | Carte, limite mensuelle fixée (100 $ pour commencer) | `ANTHROPIC_API_KEY` |
| 15 | **Telnyx** (textos) ou réutilisation de Twilio | https://telnyx.com/sign-up | 0,01 à 0,02 $ par texto | Numéro canadien, enregistrement des textos d'entreprise (formulaire de marque et de campagne, quelques jours) | `TELNYX_API_KEY` et le numéro ; ou `TWILIO_*` si tu préfères garder Twilio |
| 16 | **Resend** (courriels transactionnels) ou Brevo existant | https://resend.com/signup | 0 à 50 $ par mois | Vérifier le domaine `neomoov.net` (enregistrements DNS que je te donne) | `RESEND_API_KEY` (ou `BREVO_API_KEY`) |
| 17 | **Vapi** (agent vocal : réservation par téléphone, entretien des candidats) | https://dashboard.vapi.ai | 0,20 à 0,35 $ par minute | Carte, numéro de téléphone importé ou acheté | `VAPI_API_KEY`, identifiant du numéro |
| 18 | **Sentry** et **Better Stack** | https://sentry.io/signup et https://betterstack.com | 0 à 100 $ par mois | Comptes gratuits | `SENTRY_DSN`, `BETTERSTACK_TOKEN` |
| 19 | **WhatsApp Business** (Meta) | https://business.facebook.com | Par conversation | Vérification de l'entreprise chez Meta : une à deux semaines, à lancer maintenant | Identifiant du numéro et jeton d'accès permanent |

### Bloc 4. Avant le lancement commercial (hors sprint)

| Compte | Pourquoi | Quand |
|---|---|---|
| **CTQ** (répartiteur, puis répondant d'un système de transport), **SAAQ**, **Aéroports de Montréal** | Autorisations (section 4.4.6 du document de référence), suivies par le fondateur | En cours |
| **Courtier d'assurance** | Responsabilité civile commerciale, couverture des courses, flotte, cyber | Devis maintenant |
| **Fournisseur de SEV certifié** (facturation obligatoire) | Sans lui, aucune course facturable légalement | Choix en octobre 2026 |
| **Partenaire de paiement échelonné** (Affirm Canada, Sezzle ou Klarna) | Courses de plus de 150 $ payées en plusieurs fois (D35) | Novembre 2026 |
| **AWS ou Google Cloud, région de Montréal** | Hébergement canadien de production | Avant le lancement |
| **QuickBooks en ligne**, **PandaDoc ou DocuSign**, **CRM** (HubSpot ou Brevo), **Canva Pro** | Comptabilité, signatures, prospection, visuels | T4 2026 |
| **Comptes publicitaires** (Google Ads, Meta, TikTok, LinkedIn), **Google Business Profile**, **LinkedIn** (page) | Marketing et agents IA | T4 2026 |
| **Séance photo** (photographe, clients et chauffeurs consentants) | Remplacer les photos de banque d'images par de vraies photos Neomoov (D46) | Avant le lancement |

## Comment me transmettre les clés

1. Ouvre `C:\Users\PC\code\neomoov\.env` dans VS Code. S'il n'existe pas, copie `.env.example` en `.env`.
2. Colle chaque clé après le signe égal de sa variable. Enregistre.
3. Dis-moi seulement « les clés Stripe sont dans le .env ». Je ne lis jamais ce fichier à l'écran : le code le lit au démarrage.
4. Les fichiers (`.p8` Apple, JSON Google, attestations) vont dans `C:\Users\PC\cles-neomoov\`, jamais dans le dépôt.

## Budget mensuel à prévoir pendant le sprint

Environ 150 à 300 $ par mois (Supabase, Railway, courriels, gestionnaire de mots de passe, Expo, API Claude), plus 124 $ US une seule fois (Apple et Google Play). L'usage de Google Maps, des textos et de l'agent vocal reste presque nul tant qu'il n'y a pas de clients.
