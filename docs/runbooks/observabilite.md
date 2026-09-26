# Observabilité : suivre une erreur, lire les métriques, être alerté

Prompt 15, tâche 6 ; sections 2.7 et 10.4 du cahier des charges. Ce manuel dit ce qui existe dans le code, ce qu'il reste à créer chez Sentry et Better Stack (aucun compte n'a été ouvert par Claude), les seuils d'alerte, et comment remonter d'une alerte à la cause. Aucun secret ici : les DSN, jetons et adresses de battement vont dans `/opt/neomoov/.env` (serveur), dans les variables des profils EAS (mobiles) et dans le gestionnaire de mots de passe.

## 1. Ce que fait la plateforme

| Brique | Où | Actif quand |
|---|---|---|
| Journaux JSON (pino) | API et worker, sortie standard, lus par `docker compose logs` | Toujours |
| Identifiant de corrélation | En-tête `X-Correlation-Id` créé par le web et les mobiles (`packages/api-client`), repris par l'API (sinon créé), renvoyé dans chaque réponse et chaque erreur, présent sur chaque ligne de journal de la requête, transmis aux tâches des files (`_correlationId` dans les données) et aux événements qui traversent Redis | Toujours |
| Suivi des erreurs (Sentry) | API, worker, web (navigateur et serveur Next.js), applications client et chauffeur | Seulement si le DSN de l'application est renseigné ; sinon le SDK n'est même pas chargé |
| Métriques | Page My Hub « Métriques » (`/hub/metriques`), `GET /v1/admin/metrics`, `GET /v1/internal/metrics` (Prometheus) | Toujours |
| Santé détaillée | `GET /v1/health` : version, environnement, base, Redis, files, disjoncteurs ; 503 si la base est injoignable | Toujours |
| Battement du worker | Le worker appelle un moniteur « heartbeat » Better Stack chaque minute | Seulement si `BETTERSTACK_HEARTBEAT_URL` est renseignée |

Données personnelles : le journal masque les secrets (mots de passe, jetons, codes, clés) et les données personnelles (téléphone, courriel, adresses, coordonnées, nom, adresse IP) au premier et au deuxième niveau des objets journalisés. Avant tout envoi à Sentry, les événements passent par le même filtre (`scrubErrorEvent` de `@neomoov/domain`), complété par des motifs sur les textes libres : jetons JWT et `Bearer`, clés Stripe et Neomoov, paramètres `key`, `token`, `code`… des adresses web, courriels, téléphones, codes postaux et adresses postales. Les SDK sont réglés pour ne rien collecter d'eux-mêmes : ni utilisateur, ni témoins, ni en-têtes, ni corps de requête, ni variables locales, ni capture d'écran (mobile).

## 2. Sentry : trois projets à créer (par le fondateur)

| Projet Sentry | Plateforme à choisir | Variable | Où la poser |
|---|---|---|---|
| `api` (API et worker, séparés par l'étiquette `service`) | Node.js | `SENTRY_DSN` | `/opt/neomoov/.env` |
| `web` | Next.js | `NEXT_PUBLIC_SENTRY_DSN` | `/opt/neomoov/.env` (lu à la construction de l'image web) et variable GitHub `NEXT_PUBLIC_SENTRY_DSN` (images publiées par GitHub Actions) |
| `mobile` (client et chauffeur, séparés par l'étiquette `service`) | React Native | `EXPO_PUBLIC_SENTRY_DSN` | Variables d'environnement EAS des profils `preview` et `production` (le DSN est public : il ne permet que d'envoyer des événements) |

Compléments, mêmes emplacements : `SENTRY_ENVIRONMENT`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT`, `EXPO_PUBLIC_SENTRY_ENVIRONMENT` (`staging` ou `production` ; vide : `NODE_ENV`, ou `production` pour une application compilée). `APP_VERSION` (version déployée) est posée par `infra/deploy.sh` à chaque déploiement : rien à saisir.

`NEXT_PUBLIC_SENTRY_DSN` ajoutée à `/opt/neomoov/.env` ne prend effet qu'au build suivant de l'image du web (`infra/deploy.sh build`), pas par un redémarrage. La version des applications mobiles vient de l'application elle-même (`com.neomoov.client@1.4.0+12`).

Réglages à faire dans Sentry, une fois par projet :
1. « Alerts », « Create Alert », « Issues » : « A new issue is created » et « The issue changes state from resolved to unresolved », action « Send a notification to » le fondateur (courriel). Deuxième règle : « Number of events in an issue is more than 50 in 1 hour ».
2. « Settings », « Security & Privacy » : laisser « Data Scrubber » et « Use Default Scrubbers » activés (deuxième filet), cocher « Prevent Storing of IP Addresses ».
3. « Settings », « Client Keys (DSN) » : copier le DSN (à mettre dans la variable du tableau).

Lire Sentry :
- Filtrer par `environment` (`production`, `staging`) et par `release` (version déployée) ; l'étiquette `service` sépare `api`, `worker`, `web`, `mobile-client`, `mobile-driver`.
- L'étiquette `correlationId` d'un événement de l'API ou du worker est celle de la requête ou de la tâche ; sur le web et les mobiles, elle est jointe aux pannes de l'API (5xx) vues par l'écran, avec `apiCode` et `apiStatus`.
- Les tâches de file sont signalées à leur dernière tentative seulement (étiquettes `queue` et `job`) ; les erreurs 502 et 503 voulues (fournisseur en panne, mode dégradé) ne le sont pas : elles se lisent dans les disjoncteurs et les métriques.
- Les piles d'appels des applications compilées sont minifiées : l'envoi des cartes de code source (source maps) n'est pas encore branché (voir la section 7).

## 3. Suivre une requête de bout en bout

1. Récupérer l'identifiant de corrélation : message d'erreur de l'API vu par l'utilisateur (`correlationId` dans le corps, ou en-tête `X-Correlation-Id`), étiquette `correlationId` d'un événement Sentry, ou colonne `correlation_id` du journal d'audit.
2. Chercher les lignes de l'API et du worker :

```
ssh root@<ip>
cd /opt/neomoov
docker compose -f infra/compose.prod.yml logs --since 24h api worker | grep '"correlationId":"<identifiant>"'
```

3. Les lignes du worker qui portent le même identifiant sont celles des tâches mises en file pendant la requête (paiement, notification, facture) ; une tâche planifiée (battement, passes périodiques) a son propre identifiant.

## 4. Métriques

My Hub, « Pilotage », « Métriques » (tout le personnel, lecture ; actualisation toutes les 30 secondes). Les mesures en base sont gardées 15 secondes par instance.

| Mesure | Définition | Cible (section 2.2) |
|---|---|---|
| Courses par état | États en cours (`requested` à `in_progress`) : nombre actuel ; états finaux : courses passées dans cet état sur 24 h | |
| Demande vers première offre | Médiane, 95e centile et maximum sur 24 h. Course immédiate : depuis la demande ; course planifiée : depuis le début de sa répartition (état `offering`, une heure avant la prise en charge) | 95e centile sous 3 s |
| Demande vers attribution | Même point de départ, jusqu'à l'état `assigned` | |
| Latences de l'API | Par motif de route, 15 dernières minutes, instance qui répond (chaque instance mesure ses propres requêtes : deux lectures peuvent différer) | 95e centile sous 300 ms |
| Files | En attente, en cours, en échec (Redis) ; perdues (mode mémoire, développement) | En échec : 0 |
| Échecs de paiement | Paiements `failed` sur 24 h, par motif | |
| Fournisseurs | Disjoncteurs (état, échecs et ouvertures depuis le démarrage de l'instance), notifications en erreur sur 24 h par canal | |

Format Prometheus : `GET https://api.neomoov.net/v1/internal/metrics` avec une clé de service à portée `metrics:read` (`POST /v1/admin/api-keys`, administrateur, voir `personnel-my-hub.md`) dans l'en-tête `Authorization: Bearer <clé>`. Séries : `neomoov_http_request_duration_seconds` (histogramme par route), `neomoov_http_server_errors_total`, `neomoov_rides`, `neomoov_assignment_seconds`, `neomoov_first_offer_seconds`, `neomoov_queue_jobs`, `neomoov_payment_failures_24h`, `neomoov_notification_errors_24h`, `neomoov_circuit_open`, `neomoov_circuit_failures_total`. Better Stack (Telemetry, source Prometheus) peut les lire toutes les minutes ; chaque lecture ne voit qu'une instance de l'API.

## 5. Better Stack : sondes et alertes à créer (par le fondateur, compte à ouvrir)

Équipe d'astreinte : « Uptime », « Team », « On-call » : le fondateur, avec son courriel, son numéro de téléphone (SMS et appel) et l'application mobile Better Stack. Les alertes par SMS et appel demandent un plan payant (licence « Responder ») : à vérifier au moment de l'abonnement ; sans elles, courriel et notification de l'application.

| Sonde | Type | Adresse | Réussite | Fréquence et confirmation | Alerte |
|---|---|---|---|---|---|
| API | HTTP, statut | `https://api.neomoov.net/v1/health` | Statut 200 (503 = base injoignable) | 1 min (3 min sur le plan gratuit), délai de 10 s, 2 échecs de suite | Courriel, SMS et appel |
| API dégradée | HTTP, mot-clé | `https://api.neomoov.net/v1/health` | La réponse contient `"status":"ok"` (sinon : fournisseur en panne ou Redis absent, voir `degraded-mode.md`) | 3 min, 2 échecs de suite | Courriel seulement |
| Temps réel | HTTP, mot-clé | `https://api.neomoov.net/socket.io/?EIO=4&transport=polling` | Statut 200 et la réponse contient `"sid"` (poignée de main Socket.IO, sans authentification) | 1 min, 2 échecs de suite | Courriel, SMS et appel |
| My Hub | HTTP, statut | `https://hub.neomoov.net/hub/connexion` | Statut 200 | 3 min, 2 échecs de suite | Courriel et SMS |
| Réservation web | HTTP, mot-clé | `https://reserver.neomoov.net/reserver` | Statut 200 et le mot `Neomoov` | 3 min, 2 échecs de suite | Courriel et SMS |
| Worker | Battement (« Heartbeat ») | Adresse fournie par Better Stack, à copier dans `BETTERSTACK_HEARTBEAT_URL` | Un appel chaque minute (le battement passe par Redis et la file `heartbeat`) | Période 1 min, délai de grâce 5 min | Courriel et SMS |

Pour chaque sonde HTTP : régions « Amérique du Nord » et « Europe » (le serveur est à Paris, les utilisateurs à Montréal), vérification du certificat TLS avec alerte 14 jours avant son expiration, temps de réponse signalé au-delà de 2 secondes. Politique d'escalade : alerte immédiate au fondateur, rappel toutes les 30 minutes tant que l'incident n'est pas pris en charge. Une page d'état publique est facultative.

Journaux centralisés : Better Stack Telemetry, source `neomoov-api` (jeton dans `BETTERSTACK_TOKEN`) ; l'acheminement des journaux Docker vers cette source (Vector ou pilote de journal) est à brancher au déploiement de l'étape 16.

## 6. Réagir à une alerte

1. `GET /v1/health` : `checks.database` en erreur, voir `sauvegardes.md` et Supabase ; `checks.redis` en erreur, redémarrer Redis (`redemarrer-un-service.md`, section 5) ; `circuits` ouverts, fournisseur en panne, voir `degraded-mode.md`.
2. My Hub, « Métriques » : files en échec (relancer depuis la file concernée une fois la cause réglée), paiements en échec, notifications en erreur par canal, latences par route.
3. Sentry : nouvelles erreurs de la version en cours ; l'étiquette `correlationId` mène aux journaux (section 3).
4. Battement du worker absent : `docker compose -f infra/compose.prod.yml ps worker`, puis ses journaux ; sans Redis, le worker ne traite plus rien.

## 7. Reste à faire

- Envoi des cartes de code source à Sentry : web (`withSentryConfig` et un jeton `SENTRY_AUTH_TOKEN` à la construction) et mobiles (greffon Expo `@sentry/react-native/expo` et le même jeton dans EAS) ; sans elles, les piles d'appels sont minifiées.
- Poser `NEXT_PUBLIC_APP_VERSION` à la construction du web depuis `infra/deploy.sh` : le script pose déjà `APP_VERSION` (les 12 premiers caractères du commit déployé, lus par `/v1/health` et Sentry pour l'API et le worker), pas la version du web ; les images du web publiées par GitHub Actions (`images.yml`) portent déjà l'empreinte Git.
- Acheminer les journaux Docker vers Better Stack Telemetry (section 5) : `BETTERSTACK_TOKEN` est acceptée par la configuration, mais aucun code ne l'utilise encore.
