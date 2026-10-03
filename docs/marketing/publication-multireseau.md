# Publication multiréseau de My Hub (3 octobre 2026)

Écran My Hub : menu Pilotage, **Publier (réseaux)** (`/hub/marketing/publier`), quatre onglets : Composer, Publications, À relayer, Commentaires et messages. Code : `packages/domain/src/marketing/visuals.ts` et `publications.ts` (règles pures), `apps/api/src/modules/marketing/publications.service.ts` et `visual-templates.ts`, migration `0038_publication-multireseau`.

## Espaces

Les dix espaces du fondateur : `site_blog`, `facebook`, `instagram`, `linkedin`, `x`, `tiktok`, `snapchat`, `telegram`, `youtube`, `whatsapp_channel` (« tous » dans le composer et dans le lot). `telegram` et `whatsapp_channel` s'ajoutent à `CONTENT_SPACES` (règles : Telegram 1 024 caractères, légende d'une photo du bot ; chaîne WhatsApp 1 000 caractères, sans mot-clic). Les espaces `academy`, `google_business` et `newsletter` restent ceux du calendrier de l'agent contenu.

## Tailles exactes (table unique `VISUAL_SIZES`, testée)

| Espace | Fil | Story, reel, short | Autre |
|---|---|---|---|
| Blogue neomoov.net | 1200 × 630 | | |
| Facebook | 1080 × 1350 (4:5) | 1080 × 1920 | |
| Instagram | 1080 × 1350 (4:5) | 1080 × 1920 | |
| LinkedIn | 1200 × 1200 | | |
| X | 1600 × 900 | | |
| TikTok | 1080 × 1920 | 1080 × 1920 | |
| Snapchat | 1080 × 1920 | 1080 × 1920 | |
| Telegram | 1280 × 720 | | |
| YouTube | 1080 × 1920 (Short, vidéo seulement) | 1080 × 1920 | miniature 1280 × 720 ; vidéo longue 1280 × 720 |
| Chaîne WhatsApp | 1080 × 1080 | | |
| Academy, infolettre | 1200 × 630 | | |
| Fiche Google | 1200 × 900 | | |

## Une image différente par réseau

Pour une même publication, chaque contenu (réseau, et langue sur LinkedIn et X) reçoit sa variante (`planVariants`) : gabarit (6 : bandeau, cadre, diagonale, carte, plein cadre, partage), accent de couleur de la marque (lime, vert, bleu, bleu pâle), position du titre (haut, centre, bas), recadrage et agrandissement de la photo, photo réelle de la médiathèque du site (différente pour chaque réseau quand la médiathèque en a assez ; règle D46 : jamais d'image de synthèse, sans photo un fond de marque), texte court sur l'image (variante, sinon texte de la publication, sinon titre) et mention du réseau (« À la une », « En bref »…). Gabarit, accent et position forment des triplets tous différents jusqu'à douze contenus. Le visuel est rendu en PNG par le navigateur de l'image Docker (`BROWSER_BIN`) ; son empreinte SHA-256 est gardée (`content_items.visual.fingerprint`) et l'essai vérifie qu'elles sont toutes différentes. Vidéo courte (TikTok, YouTube Short, reels) : chaîne existante (diapositives, narration, ffmpeg), la variante en couverture.

## Composer

Texte de base, version courte (X et Snapchat), texte de l'image, mots-clics, appel à l'action (`marketing.cta_urls`), mots pour choisir les photos ; réseaux : un, plusieurs ou tous. Le texte de chaque réseau est adapté automatiquement (format, version courte, mots-clics ramenés à la limite, titre gardé sur le blogue et YouTube, repli sur la version courte si le texte dépasse) et modifiable ; l'agent de contenu peut rédiger les textes à la demande (« Faire rédiger »). Longueurs et règles éditoriales contrôlées en direct (indicatif) puis par l'API. Diffusion : brouillons (aperçus d'abord, puis « Diffuser les brouillons »), maintenant, à une date et une heure, ou aux prochains créneaux de chaque réseau. Un contenu bloqué par une règle reste en brouillon.

## Import d'un lot et programmation en lot

Format : `docs/marketing/lancement-50-publications.schema.json` (exemple : `lancement-50-publications.exemple.json` ; lot du lancement : `lancement-50-publications.json`). Route `POST /v1/admin/marketing/publications/import` (100 Ko par appel : My Hub envoie le fichier par tranches ; rejouable, clé campagne et référence). « Approuver et programmer » (`POST /v1/admin/marketing/publications/schedule`) : campagne, premier jour, nombre de jours ; les jours du lot sont gardés, ou ramenés proportionnellement au nombre de jours demandé s'il est plus petit ; chaque réseau prend son créneau `marketing.slots` du jour (30 minutes au moins entre deux publications d'un même réseau). Jamais en lot : un contenu bloqué par une règle ou sensible.

## Relais manuel (« À relayer »)

Décision du fondateur : aucun agrégateur. Sont relayés à la main : la chaîne WhatsApp et Snapchat (toujours), les espaces du réglage `marketing.relay_spaces`, tout réseau sans connecteur utilisable au moment de la programmation ou de la diffusion, et les contenus refusés par leur connecteur avec `SOCIAL_MANUAL_RELAY` ou `SOCIAL_APPROVAL_PENDING` (LinkedIn, TikTok, YouTube tant que leur approbation n'est pas obtenue). La vue du jour (retards compris) donne pour chaque tâche : visuel, texte prêt à copier, fichier à la bonne taille à télécharger (et miniature YouTube), lien direct vers l'outil du réseau (sur X, la fenêtre de publication s'ouvre avec le texte), puis « Marquer comme publié » avec lien facultatif. Un récapitulatif quotidien est envoyé au personnel (`marketing.relay_digest_hour`, 8 h, -1 pour le couper).

## Commentaires et messages

Compteurs par réseau de la boîte unifiée (canal `social`) : non lus, remis à l'humain, réponses à relayer ; liste et fil par réseau ; réponse de l'équipe ; une réponse en attente de relais part par le connecteur du réseau quand il existe (commentaire d'une publication suivie par la plateforme), sinon « Copier la réponse » puis « Marquer relayée ».

## Mention du connecteur

La mention renvoyée à la publication (vidéo YouTube ou TikTok privée tant que l'audit n'est pas accordé) est gardée sur le contenu (`publish_notice`) et affichée dans l'état par réseau.
