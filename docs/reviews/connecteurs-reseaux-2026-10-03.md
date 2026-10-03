# Connecteurs réels des réseaux (agent Q4, 3 octobre 2026)

Branche `connecteurs-reseaux` (depuis `origin/main` `ec9ba36`), poussée sur `origin`. Mission d'origine : `neomoov-outils/agents/Q4-connecteurs-reseaux.md` ; réorientée en cours de route par la session principale (chantier « Réseaux sociaux », `S-COMMUN-reseaux.md`), puis par la décision du fondateur : **connexions directes seulement, sans agrégateur** ; ordre X, Telegram, LinkedIn (page entreprise), YouTube, TikTok, la Fiche Google en dernier (facultative) ; Snapchat et la chaîne WhatsApp en relais manuel.

## Ce qui est fait

### Contrat `SOCIAL_CREDENTIALS` (poussé seul en premier, `2a47adb`, puis `31a1d69`)
- `apps/api/src/modules/marketing/social-credentials.ts` : jeton `SOCIAL_CREDENTIALS`, `SocialCredentialsProvider { get, markInvalid }`, `SocialCredentials` (contrat commun à la lettre), plus :
  - `CREDENTIAL_FIELDS` : par espace, les clés de `values` (nom, variable d'environnement de repli, libellé, secret, obligatoire) ; S1 peut s'en servir pour ses formulaires et le chiffrement ;
  - `credentialsReady(space, credentials)` ; `MANUAL_ONLY_SPACES` (`whatsapp_channel`, `snapchat`) ; `TOKEN_FIELDS` ;
  - **extension facultative `update?(space, values)`** : le connecteur écrit dans le compte les jetons qu'il renouvelle (`refreshToken`, `refreshTokenExpiresAt`, `accessToken`, `accessTokenExpiresAt`). Indispensable pour X et TikTok (jeton de rafraîchissement remplacé à chaque échange : sans écriture, la validation de S1 et le connecteur se l'invalideraient mutuellement).
- Implémentation par défaut `EnvSocialCredentialsProvider` (variables d'environnement) : mode `direct` si les variables de l'espace sont posées, `manual` pour Snapchat et la chaîne WhatsApp, sinon aucun compte ; `markInvalid` retire le compte jusqu'au redémarrage. Fournie par `AdaptersModule` (global, exportée) ; **S1 remplace cette fabrique** par sa table `social_accounts` (repli sur les variables). Le mode `aggregator` reste dans le type du contrat mais n'est jamais servi : un compte dans ce mode est refusé par `SOCIAL_MANUAL_RELAY` (« connexions directes seulement »).

### Connecteurs tirés des comptes (`adapters/real/credentialed.ts`, `marketing.ts`)
- Un `CredentialedPublisher` par espace (les 11 du domaine, plus `telegram` et `whatsapp_channel`) : identifiants demandés au fournisseur à chaque usage (un compte relié ou retiré vaut aussitôt), adaptateur gardé tant que les valeurs ne changent pas (jetons d'accès en cache ; les jetons que le connecteur renouvelle lui-même n'entraînent pas de reconstruction), état « configuré » relu au plus toutes les minutes (et au démarrage : fabrique asynchrone), `markInvalid` sur `SOCIAL_AUTH_FAILED` ou `SOCIAL_AUTH_EXPIRED`. **Aucun adaptateur ne lit l'environnement pour un jeton de réseau** ; seuls des réglages non secrets y restent (catégories WordPress, versions d'API, visibilités, audits).
- Meta (Facebook, Instagram), WordPress et Brevo passent aussi par le fournisseur (même comportement qu'avant avec les variables).

### Adaptateurs (tous testés contre un serveur HTTP simulé, `fetch` injecté)
| Espace | Fichier | Contenu |
|---|---|---|
| X | `x.ts` | API v2 : image (`POST /2/media/upload`) puis publication ; texte bilingue (ligne `[EN]`) : français, puis anglais en réponse ; réponses lues par la recherche récente (niveau d'accès insuffisant : aucune lecture, sans erreur) ; mesures publiques (et privées si permises) ; OAuth 2.0 PKCE, jeton de rafraîchissement remplacé à chaque échange et conservé (compte, sinon réglage chiffré `oauth.x`). |
| Telegram | `telegram.ts` | Bot API : `sendPhoto`, `sendVideo`, `sendMessage` (légende de 1 024 caractères, texte long à la suite en réponse) ; commentaires du groupe de discussion lié (`getUpdates`, transfert automatique, fils) et réponse du bot ; mesures nulles (la Bot API ne donne pas les vues) ; jeton du bot jamais dans un message. |
| LinkedIn | `linkedin.ts` | Posts API (`/rest/posts`, image par `initializeUpload`), « little text », commentaires et réponse imbriquée, statistiques ; **403 à la publication → `SOCIAL_APPROVAL_PENDING` (relais manuel)** ; jeton de 60 jours (échéance par variable ou introspection) ou jeton de rafraîchissement. |
| YouTube | `youtube.ts` | Téléversement résumable par morceaux (308, `Range`), métadonnées, commentaires, statistiques ; **sans `YOUTUBE_API_AUDITED=on`, envoi en privé avec la mention (`notice`)** ; audité mais gardée privée : mention aussi ; quota épuisé → limite atteinte jusqu'à minuit, heure du Pacifique. |
| TikTok | `tiktok.ts` | Content Posting API (publication directe) : créateur, initialisation, morceaux sans jeton (ou `PULL_FROM_URL`), suivi, mesures ; **sans `TIKTOK_APP_AUDITED=on`, `SELF_ONLY` avec la mention** ; audité : visibilité réglée, repli `SELF_ONLY` avec la mention si TikTok refuse ; identifiants int64 gardés exacts ; « votre marque » déclaré. |
| Fiche Google (facultative) | `google-business.ts` | `localPosts` (bouton RÉSERVER ou EN SAVOIR PLUS, photo), avis lus (un avis rendu à une seule publication, identifiant court) et `updateReply`, mesures de la fiche (Performance API). |
| Socle | `oauth.ts`, `oauth-store.ts` | Session OAuth (cache, un seul échange à la fois, relecture du magasin avant l'échange, jeton refusé jamais repris), client HTTP (401 : nouvel échange puis un essai ; 429 avec délai ; erreurs typées), magasin chiffré `oauth.<réseau>` (portée `oauth`, invisible dans My Hub). |

### Diffusion (`publishing.service.ts`, `marketing-jobs.service.ts`)
- `SOCIAL_MANUAL_RELAY` et `SOCIAL_APPROVAL_PENDING` (`MANUAL_RELAY_ERRORS`, `marketing.types.ts`) : aucune nouvelle tentative ; la publication passe en `failed` avec `lastError` commençant par le code, alerte au personnel `marketing_manual_relay` (« à relayer à la main »).
- Limite atteinte : la tentative suivante attend au moins le délai demandé par le réseau (26 heures au plus).
- Mention (`notice`) du résultat gardée dans le journal d'audit et l'appel d'outil de l'agent.
- Avis noté 3 sur 5 ou moins : jamais de réponse automatique ; relayé sous le réseau `gbp` (relais humain), plus jamais vers le connecteur Meta.
- Passe horaire des autorisations (`credentialsPass`) : alerte au personnel (une par jour et par réseau) avant l'échéance (7 jours, réglage `marketing.token_alert_days`) ou sur un échec d'échange.
- `telegram` ajouté aux réseaux de la boîte unifiée (`SOCIAL_NETWORKS`, `RELAY_NETWORKS` du domaine, libellés et listes de My Hub) ; OpenAPI régénérée, client d'API reconstruit.

### Variables, contrôle, documentation, outil
- `env.ts`, `.env.example` : `GOOGLE_BUSINESS_*` (remplace `GBP_*`), `LINKEDIN_*` (dont `LINKEDIN_ACCESS_TOKEN_EXPIRES_AT`, `LINKEDIN_API_VERSION`), `YOUTUBE_PRIVACY_STATUS`, `YOUTUBE_API_AUDITED`, `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REFRESH_TOKEN` (remplacent les clés OAuth 1.0a), `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REFRESH_TOKEN`, `TIKTOK_PRIVACY_LEVEL`, `TIKTOK_APP_AUDITED`, `TIKTOK_UPLOAD_MODE`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID`, `TELEGRAM_DISCUSSION_CHAT_ID`. Aucune variable d'agrégateur.
- `scripts/env-check.mjs` : forme des valeurs (sans les afficher) et bilan « prêt / manque … » par réseau (noms seulement).
- `docs/marketing/connecteurs.md` : fonctionnement, limites, et pas à pas du fondateur réseau par réseau dans l'ordre décidé ; `docs/operations/mise-en-service-finale.md` (section 15) renvoie au pas à pas.
- Outil `pnpm --filter @neomoov/api oauth:jeton -- --fournisseur=google-business|youtube|google-calendar|linkedin|x|tiktok` (`scripts/oauth-jeton.ts`, `oauth-authorization.ts`) : écran d'autorisation, retour sur `http://127.0.0.1:<port>/rappel` (ou adresse https collée, `--rappel=`), PKCE, échange, **jeton écrit dans `C:\Users\PC\cles-neomoov\<fournisseur>-refresh-token.txt`, jamais affiché ni écrit dans un `.env`** (choix du fichier de repli : écrire une ligne d'un `.env` suppose de le lire, contraire aux règles), identifiants utiles affichés (comptes et établissements de la fiche, chaîne, pages LinkedIn, compte X) et commande `Get-Content -Raw … | ssh … env-set.sh NOM` qui pose la valeur sans la voir.

## Essais et résultats
- Unitaires (sans base), 12 fichiers, **63 essais verts** : `connecteur-x`, `connecteur-telegram`, `connecteur-linkedin`, `connecteur-youtube`, `connecteur-tiktok`, `connecteur-google-business` (succès, jeton expiré puis renouvelé, 429 avec délai, erreur de validation, secrets absents des messages et de `toJSON`), `connecteurs-socle` (échange unique, délais, erreurs, alerte d'échéance, choix des connecteurs, délai d'un 429 dans la diffusion), `connecteurs-comptes` (jeton de X écrit dans le compte et relu, reconnexion, compte refusé, relais manuel, diffusion sans relance), `social-credentials`, `oauth-jeton` (adresses, PKCE, échange, retour local, fichier du jeton dans un dossier temporaire), `marketing-adapters` (mis à jour : noms des variables, connecteurs tirés des comptes), `env`.
- Sous verrou de la base (`db-lock.cjs`, nom `q4-connecteurs`) : `autonome-e-marketing.e2e` **inchangé, 7/7 vert** (avant et après la refonte), `connecteurs-avis.e2e` 1/1 (avis 5/5 réponse automatique, 2/5 relayé sous `gbp`), `oauth-token-store.e2e` 1/1 (magasin chiffré), `mock-webhooks-production` 2/2.
- Types : `tsc --noEmit` de l'API (sources et essais) et du web : sans erreur. Essai du domaine `inbox.test.ts` : vert. `isolation-coverage` non lancé : aucune table créée ni modifiée (le magasin utilise la table des réglages, portée `oauth`).
- Aucun appel à une API réelle ; aucun déploiement ; aucun `.env` lu ni modifié (l'essai de `env-check.mjs` a tourné sur une copie du script avec un faux `.env` dans le dossier temporaire de la session).

## À savoir pour la fusion (session principale, S1, S2)
- **S1** : remplacer la fabrique de `SOCIAL_CREDENTIALS` dans `adapters/adapters.module.ts` ; **implémenter `update`** (fusion des valeurs de jeton dans le compte, chiffrées) ; si S1 renouvelle lui-même les jetons de X ou TikTok pour valider, relire le compte avant et y écrire le nouveau jeton (même règle que le connecteur), sinon les deux s'invalident. `markInvalid` est appelé sur un échange refusé : statut `invalid` attendu. Les clés de `values` sont celles de `CREDENTIAL_FIELDS`.
- **S2** : `telegram` et `whatsapp_channel` sont déjà servis par les connecteurs (`PUBLISHER_SPACES`) ; une fois ajoutés au domaine, rien à changer côté connecteurs. Afficher « à relayer à la main » pour les contenus `failed` dont `lastError` commence par `SOCIAL_MANUAL_RELAY` ou `SOCIAL_APPROVAL_PENDING` (ou remplacer ce marquage par l'état de relais manuel de S2 dans `recordFailure`). La mention `notice` (vidéo privée) est dans le journal d'audit `marketing.content_published` : à afficher si utile.
- Conflits probables : `config/env.ts`, `.env.example`, `adapters.module.ts`, `docs/marketing/connecteurs.md`, `packages/domain/src/enums.ts` (une ligne), `apps/web/src/lib/i18n-hub.ts` (libellé Telegram).
- Changement de comportement en mode réel : Snapchat (et la chaîne WhatsApp dès qu'elle est au domaine) sont « configurés » en relais manuel : le calendrier leur prépare des contenus, qui passent en relais manuel au créneau (une alerte au personnel par contenu).
- Défaut existant non corrigé (hors périmètre) : un commentaire WordPress relayé à la boîte unifiée porte le réseau `site_blog`, hors de `SOCIAL_NETWORKS` ; la réponse de la relation client partirait vers le connecteur Meta. Même correction possible que `gbp` (`INBOX_NETWORK_OF` dans `publishing.service.ts`).
- Points d'API à confirmer au premier essai réel (décrits d'après la documentation des réseaux, non vérifiables sans compte) : champs de l'envoi simple `POST /2/media/upload` de X ; version par défaut `LINKEDIN_API_VERSION=202606` ; défi PKCE hexadécimal et adresse https de TikTok ; coût d'un envoi YouTube ; adresse de retour `127.0.0.1` acceptée par LinkedIn.

## Ce que le fondateur doit fournir, par réseau (détail : `docs/marketing/connecteurs.md`)
1. **X** : compte développeur (formule Free pour publier ; **Basic payante pour lire réponses et mesures : décision**), application « Web App, Automated App or Bot » en lecture et écriture, adresse de retour ; Client ID et Client Secret OAuth 2.0 ; autorisation par `oauth:jeton` (ou bouton de My Hub).
2. **Telegram** : bot créé chez @BotFather (jeton), bot administrateur du canal (droit de publier), `@nom` ou identifiant du canal ; facultatif : groupe de discussion lié, bot administrateur du groupe.
3. **LinkedIn** : application liée à la page (association vérifiée), **demande de la Community Management API** (en attendant : relais manuel), adresse de retour, Client ID et Secret, autorisation par un super administrateur de la page ; identifiant de la page.
4. **YouTube** : projet Google Cloud, YouTube Data API v3 activée, écran de consentement « En production » (validation de Google), client OAuth « application de bureau », autorisation sur la chaîne Neomoov ; **demande d'audit des services API de YouTube** (en attendant : vidéos privées), puis `YOUTUBE_API_AUDITED=on`.
5. **TikTok** : application TikTok for Developers (Login Kit, Content Posting API, Direct Post), adresse de retour https, Client key et secret, **soumission à l'audit** (en attendant : publications privées), puis `TIKTOK_APP_AUDITED=on` ; autorisation du compte TikTok de Neomoov.
6. **Fiche Google (facultative)** : demande d'accès aux API Business Profile (numéro du projet), API activées, autorisation par le gestionnaire de la fiche ; identifiants du compte et de l'établissement (affichés par `oauth:jeton`).
7. **Snapchat, chaîne WhatsApp** : rien (relais manuel ; seulement le lien public, côté S1).

## Décisions restantes
- Formule X (Free sans lecture, ou Basic payante).
- Relais manuel : garder l'état `failed` avec code dans `lastError` ou adopter l'état propre de S2 ; une alerte par contenu ou un récapitulatif quotidien.
- Snapchat et chaîne WhatsApp dans le calendrier automatique (contenus préparés pour relais manuel) : oui par défaut, à confirmer.

## Refus et écarts
- Aucune action refusée par le système de permissions.
- Écriture dans un `.env` (bonus `oauth:jeton`) écartée volontairement au profit du fichier de repli `C:\Users\PC\cles-neomoov\` (règle absolue : aucun outil ne lit ni ne modifie un `.env`).
- Adaptateur Ayrshare non écrit (décision du fondateur arrivée avant son début).
