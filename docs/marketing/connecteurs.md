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

## Connecteurs prévus, non livrés (interfaces et variables réservées)

| Espace | Variables | API et droits à demander | Remarques |
|---|---|---|---|
| `google_business` | `GBP_CLIENT_ID`, `GBP_CLIENT_SECRET`, `GBP_REFRESH_TOKEN`, `GBP_LOCATION_ID` | Business Profile APIs (demande d'accès au projet Google Cloud, formulaire de Google), OAuth du propriétaire de la fiche, portée `https://www.googleapis.com/auth/business.manage` ; publications (`localPosts`), photos, avis et questions | Accès API accordé sur demande motivée ; en attendant, publications à la main |
| `linkedin` | `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_ORGANIZATION_ID` | Community Management API (produit « Community Management » sur l'application LinkedIn, approbation), portées `w_organization_social`, `r_organization_social`, `rw_organization_admin` ; publications `ugcPosts` ou `posts`, statistiques `organizationalEntityShareStatistics` | Messages privés non exposés : relais humain |
| `tiktok` | `TIKTOK_ACCESS_TOKEN` | Content Posting API (TikTok for Developers, audit de l'application), portées `video.publish`, `video.upload`, `user.info.basic` ; vidéo envoyée par adresse (`PULL_FROM_URL`) | Avant audit, les publications restent privées |
| `youtube` | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN` | YouTube Data API v3, OAuth de la chaîne, portées `youtube.upload`, `youtube.force-ssl`, `yt-analytics.readonly` ; `videos.insert`, `commentThreads` | Quota de 10 000 unités par jour (un envoi en coûte 1 600) |
| `x` | `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` | API v2, formule Basic payante (écriture) ; `POST /2/tweets`, médias par `media/upload`, métriques `public_metrics`, mentions | Formule gratuite : 1 500 publications par mois, pas de lecture |
| `snapchat` | `SNAPCHAT_ACCESS_TOKEN`, `SNAPCHAT_PROFILE_ID` | Marketing API (Snap Business Manager, application OAuth), profil public ; publication des stories et Spotlight soumise à l'accès « Public Profile API » | Accès restreint, à demander |

Pour chacun, l'implémentation suit le modèle de `real/meta-graph.ts` : classe `XxxPublisher implements SocialPublisher`, clés lues dans `realSocialPublishers` (`real/marketing.ts`), variables dans `env.ts` et `.env.example`, test unitaire contre un faux `fetch` (comme `test/marketing-adapters.test.ts`).

## Commentaires et messages entrants

L'agent de diffusion répond lui-même aux commentaires simples (remerciement, horaires, lien de réservation : textes fixes du domaine et réglage `marketing.service_hours`) ; tout autre commentaire, et tout ton négatif, part vers la relation client (`conversation.inbound`, canal `social`, dès que la boîte unifiée de l'agent D l'offre) ou, à défaut, vers le personnel (`alert.agent_escalation`). Les messages privés (Messenger, Instagram, LinkedIn, X, Snapchat) sont du ressort de l'agent D.
