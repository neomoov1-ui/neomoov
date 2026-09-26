# Rapport de charge (étape 15, tâche 3)

État au 26 septembre 2026. Scripts : `tests/load/` (k6), lanceur `pnpm test:load` (`scripts/load/run-load.mjs`), comptes de charge `apps/api/src/scripts/load-fixtures/`. Mode d'emploi : `docs/testing/README.md`.

## En bref

- **Profil fumée mesuré** contre une API locale lancée depuis le poste de développement, sur la base de développement partagée (Supabase, Canada), fournisseurs simulés : 12 chauffeurs connectés, 3 courses simultanées attribuées et menées à terme, 32 devis. Il vérifie les scripts et donne une première lecture, **pas une mesure de production**.
- **Profil complet à exécuter en préproduction isolée** (2 000 sockets chauffeurs, 400 positions par seconde pendant 15 minutes, 500 demandes de course simultanées, 100 devis par seconde) : jamais contre la production, jamais contre la base de développement partagée. Procédure plus bas.
- **Un défaut corrigé** : des courses immédiates demandées au même instant sollicitaient le même chauffeur ; la seconde attendait l'expiration de l'offre (15 s) sans être attribuée. Corrigé (offre insérée sous verrou du chauffeur) et couvert par le test `dispatch-concurrency`.
- **Ce qui bloque les cibles de latence** : le nombre d'allers-retours à la base par requête (9 à 50) multiplié par la distance entre l'API et la base. Avec la topologie prévue (serveurs LWS à Paris, base Supabase au Canada, 80 à 100 ms par aller-retour), les cibles de 300 ms et de 100 ms sont hors d'atteinte. Décision à prendre avant la préproduction (point 1 ci-dessous).

## Cibles de la section 2.2 et seuils k6

Chaque cible est un seuil k6 : l'essai sort en échec (code 99) dès qu'une cible n'est pas atteinte.

| Mesure (section 2.2) | Métrique k6 | Seuil |
|---|---|---|
| Calcul d'un devis hors appel cartographique : moins de 100 ms | `quote_ms` avec cartographie simulée (`LOAD_MAPS=mock`) | 95e centile < 100 ms |
| Devis complet avec itinéraire : moins de 800 ms au 95e centile | `quote_ms` avec cartographie réelle (`LOAD_MAPS=real`) | 95e centile < 800 ms |
| Attribution d'une course immédiate : première offre en moins de 3 s | `dispatch_first_offer_ms` (horodatages du serveur : `offering` moins `requested`) | 95e centile < 3 000 ms, et `ride_assigned` > 99 % |
| Diffusion de la position d'un chauffeur au client : moins de 2 s | `location_broadcast_ms` (envoi du chauffeur à réception par le client, même horloge) | 95e centile < 2 000 ms |
| Latence de l'API hors services externes : moins de 300 ms au 95e centile | `http_req_duration{kind:api}` (HTTP hors devis) et `ws_ack_ms` (acquittements des sockets) | 95e centile < 300 ms |
| 2 000 chauffeurs connectés simultanément | `driver_sockets_opened`, `socket_connect_ok` | ≥ 99 % des chauffeurs du profil, connexions réussies > 99 % |
| 400 positions par seconde sans dégradation | `positions_sent`, `location_ok`, `ws_ack_ms` | ≥ 90 % des positions attendues, positions acceptées > 99 % |
| (général) | `http_req_failed`, `checks` | < 1 % d'échecs, > 99 % de vérifications réussies |

Le calcul pur du devis (moteur du domaine) prend 0,2 ms en médiane et 0,4 ms au 95e centile (20 000 calculs, poste de développement) : la cible de 100 ms porte en pratique sur l'accès à la base.

## Résultats de la fumée (26 septembre 2026, 12 h 26)

Conditions : API locale (Node 24, mode test, `DISPATCH_TICK_MS=0`, courses immédiates activées, fournisseurs simulés, sans Redis) sur le poste de développement ; base de développement partagée à environ 30 ms l'aller-retour (médiane mesurée, 41 ms au 95e centile) ; k6 2.3.0 sur le même poste ; zone isolée au nord-est de l'aire de service. Profil : 12 chauffeurs (une position toutes les 2 s pendant 50 s), 3 courses simultanées, 2 devis par seconde pendant 15 s. Durée : 104 s au total, dont 50 s de k6.

| Mesure | Résultat | Cible | État |
|---|---|---|---|
| Calcul d'un devis, cartographie simulée (95e centile) | 1 196 ms | < 100 ms | échec |
| Première offre d'une course immédiate (95e centile) | 2 540 ms | < 3 000 ms | atteint |
| Attribution complète, acceptation du chauffeur comprise (95e centile) | 4 580 ms | (information) | |
| Position du chauffeur reçue par le client (95e centile) | 450 ms | < 2 000 ms | atteint |
| Latence de l'API, HTTP hors devis (95e centile) | 2 334 ms | < 300 ms | échec |
| Latence de l'API, acquittement des sockets (95e centile) | 532 ms | < 300 ms | échec |
| Sockets chauffeurs connectés | 12 sur 12 | 12 | atteint |
| Positions envoyées | 251 (4,9 par seconde en moyenne, montée comprise) | ≥ 232 | atteint |
| Courses attribuées | 100 % (3 offres, 3 acceptations, 3 courses terminées) | > 99 % | atteint |
| Requêtes HTTP en échec | 0 % | < 1 % | atteint |

| Requête | Nombre | Médiane | 95e centile | Maximum |
|---|---|---|---|---|
| `POST /v1/quotes` | 32 | 709 ms | 1 196 ms | 2 078 ms |
| `POST /v1/rides` | 3 | 2 150 ms | 2 597 ms | 2 646 ms |
| `POST /v1/driver/offers/{id}/accept` | 3 | 2 119 ms | 2 263 ms | 2 279 ms |
| `POST /v1/driver/rides/{id}/depart` | 3 | 1 112 ms | 1 115 ms | 1 116 ms |
| `POST /v1/driver/rides/{id}/arrive` | 3 | 1 097 ms | 1 175 ms | 1 183 ms |
| `POST /v1/driver/rides/{id}/start` | 3 | 805 ms | 833 ms | 836 ms |
| `POST /v1/driver/rides/{id}/complete` | 3 | 1 697 ms | 1 743 ms | 1 748 ms |
| socket `status.update` (passage en ligne) | 12 | 773 ms | 1 183 ms | 1 326 ms |
| socket `location.update` | 251 | 160 ms | 349 ms | 608 ms |
| socket `ride.subscribe` | 3 | 277 ms | 435 ms | 452 ms |

Lecture : les temps suivent le nombre d'allers-retours à la base, pas la charge (3 courses, 6 positions par seconde). Comptés sur le même chemin (diagnostic ponctuel, réactions asynchrones comprises, requêtes internes des transactions non comptées) : devis 9, demande de course et première offre 36, acceptation 33, départ 17, arrivée 18, début 14, fin de course 52 (paiement, registres, facture, SEV, notifications), position 2 (course en cours, présence) plus 1 par minute pour l'approche. À 30 ms l'aller-retour, un devis ne peut pas descendre sous 270 ms ; à 90 ms (Paris-Canada), sous 800 ms.

Avant la correction de la répartition, deux des quatre essais de fumée ont laissé une course sans attribution : deux des trois demandes simultanées avaient sollicité le même chauffeur (journal de débogage de k6, `LOAD_DEBUG=1` : un chauffeur reçoit deux offres à quelques millisecondes d'intervalle).

## Défaut corrigé : offres simultanées au même chauffeur

`DispatchService.stepImmediate` vérifiait « aucune offre en attente ailleurs » puis insérait l'offre, sans verrou commun aux courses : deux courses traitées en même temps voyaient le même chauffeur libre et lui envoyaient chacune une offre. Il n'en acceptait qu'une ; l'autre course restait en offre jusqu'à l'expiration (15 s), puis passait au candidat suivant. Sous 500 demandes simultanées, c'est une part importante des courses retardées de 15 s ou plus, et des chauffeurs sollicités deux fois.

Correction : l'offre d'une course immédiate est insérée dans une transaction qui prend un verrou consultatif du chauffeur (`pg_advisory_xact_lock(544, chauffeur)`) et revérifie les offres en attente ; si le chauffeur vient d'être sollicité ailleurs, la course passe au candidat suivant (signal `offer_skipped` dans son journal). Le verrou est dans la base : il vaut aussi entre plusieurs processus. Test : `apps/api/test/dispatch-concurrency.e2e.test.ts` (trois courses au même instant, trois chauffeurs : une offre chacun), qui échoue sur le code précédent et passe avec la correction. Les diffusions simultanées (réservations planifiées, négociation) ne sont pas modifiées.

## Points à surveiller (par ordre d'importance)

1. **Topologie de l'API et de la base.** La section 10.2 prévoit les serveurs applicatifs chez LWS (Paris) et la base chez Supabase (Canada) ; elle juge acceptables 80 à 100 ms de latence entre Montréal et Paris, mais ce délai s'applique aussi à chaque aller-retour entre l'API et la base, soit 9 à 50 fois par requête. Conséquence attendue : devis vers 1 s, transitions de course entre 1,5 et 5 s, cibles de 100 ms et 300 ms hors d'atteinte, et 400 positions par seconde (800 requêtes par seconde) qui occupent en permanence une cinquantaine de connexions. Options : rapprocher l'API de la base (option b de la section 10.3 : région canadienne, que la décision sur la résidence des données recommande déjà), ou une base à Paris (contraire à la section 10.3). À trancher avant la préproduction ; mesurer le profil complet avec la topologie retenue.
2. **Allers-retours par requête.** Pistes, par gain attendu : calculer la vue d'une course une seule fois par transition (elle l'est deux fois : réponse HTTP et diffusion du socket, 4 requêtes chacune) ; mémoriser les parties d'une course (client, chauffeur, langue) relues par l'outbox et les événements ; garder en mémoire la course active de chaque chauffeur (invalidée par les événements de course), ce qui retire une requête sur deux par position ; regrouper les écritures de présence avec celles de l'historique (déjà par lots de 2 s).
3. **Connexions.** Pool de 10 connexions par processus de l'API (`DATABASE_POOL_MAX`) ; le pooler de session de Supabase de développement plafonne à 15 clients (`EMAXCONNSESSION` observé pendant les tests). En préproduction (2 réplicas de l'API et le worker), utiliser le pooler en mode transaction (`prepare: false`, déjà prévu) ou un plan qui l'autorise, et dimensionner le pool sur le débit de positions.
4. **Index avec l'historique.** Sur une base neuve, les requêtes chaudes passent par `rides_driver_idx (driver_id, created_at)` puis filtrent l'état : la course active à chaque position, le dernier trajet et la course en cours de chaque candidat à la répartition. Avec un an d'historique par chauffeur (plusieurs milliers de courses), chacune parcourt tout l'historique du chauffeur. Index partiels proposés, à valider par `EXPLAIN ANALYZE` sur une base de préproduction chargée d'historique avant de les ajouter par migration :
   `CREATE INDEX rides_driver_active_idx ON rides (driver_id, updated_at DESC) WHERE state IN ('assigned', 'en_route', 'arrived', 'in_progress');`
   `CREATE INDEX rides_driver_finished_idx ON rides (driver_id, updated_at DESC) WHERE state IN ('completed', 'rated');`
   `CREATE INDEX ride_offers_driver_pending_idx ON ride_offers (driver_id) WHERE state = 'sent';`
5. **Travail lourd dans l'API sans Redis.** Sans Redis, la facture (PDF, code QR), les registres et la capture du paiement s'exécutent dans le processus de l'API à chaque fin de course et ralentissent les sockets (pointes à 600 ms de l'acquittement des positions pendant la fumée). En préproduction, Redis et le worker (`infra/compose.prod.yml`) portent ces files ; c'est la configuration à mesurer.
6. **Limite de requêtes par adresse IP** (`ratelimit.per_ip_per_minute`, 300) : un générateur de charge unique la dépasse dès 5 requêtes par seconde. En préproduction, relever ce réglage pendant l'essai, ou viser l'API sans mandataire avec `LOAD_SPREAD_IPS=1`. Derrière Caddy, l'en-tête `X-Forwarded-For` du générateur est remplacé : seule la première option vaut.
7. **Jetons de 15 minutes** (`auth.access_token_ttl_seconds`) : le profil complet place ses requêtes HTTP dans les 10 premières minutes ; les sockets, authentifiés à la connexion, tiennent les 15 minutes. Un essai plus long demande de régénérer les comptes.
8. **Plusieurs instances de l'API** : avec 2 réplicas, l'adaptateur Redis de Socket.IO est obligatoire pour que la position d'un chauffeur connecté à une instance atteigne le client connecté à l'autre ; le battement de la répartition ne doit tourner que dans le worker (Redis présent). Le transport WebSocket seul n'a pas besoin de sessions collantes ; le repli en interrogation HTTP de Socket.IO en aurait besoin.
9. **Diffusions simultanées** : une réservation planifiée ou une négociation peut encore solliciter un chauffeur qui vient de recevoir une autre offre (même vérification sans verrou). Effet limité (offres visibles ensemble dans la liste du chauffeur) ; à traiter si la préproduction le montre.
10. **Poste générateur** : 2 500 utilisateurs virtuels k6 (2 000 sockets, 500 courses) demandent environ 2 à 4 Go de mémoire et un réseau proche de l'API ; lancer k6 depuis une machine du même centre de données que la préproduction.

## Profil complet en préproduction

Prérequis :

- Environnement isolé : pile `infra/compose.prod.yml` avec Redis et le worker, base de staging dédiée (jamais la base de développement partagée, jamais la production) et la topologie retenue au point 1.
- API : `FEATURE_IMMEDIATE_RIDES=on` (la cible porte sur les courses immédiates ; sinon `LOAD_RIDE_TYPE=scheduled`), fournisseurs simulés pour les paiements, les textos, le courriel et le SEV ; cartographie simulée (cible de 100 ms) ou réelle (`LOAD_MAPS=real`, cible de 800 ms, coût Google à prévoir : environ 30 500 devis, avec deux appels cartographiques chacun).
- Réglage `ratelimit.per_ip_per_minute` relevé pendant l'essai (point 6), puis remis.
- Poste générateur proche de l'API, k6 2.x (`K6_BIN`), l'API construite (`pnpm --filter @neomoov/api build`) et les variables de la base de staging (le lanceur crée les comptes dans cette base).

Commande :

```
LOAD_PROFILE=full LOAD_CONFIRM_ISOLATED=1 LOAD_BASE_URL=https://staging-api.neomoov.net K6_BIN=/chemin/k6 pnpm test:load
```

Durée : 1 à 2 minutes de préparation (2 000 chauffeurs et 500 clients, par lots), 15 minutes et 30 secondes de k6, 1 minute de retrait. `LOAD_SCALE=0.25` joue le même enchaînement au quart pour un premier passage. Le résumé est écrit dans `tests/load/results/full-summary.md` et `.json` ; reporter ici le tableau des cibles et le détail par requête, avec la date, la version déployée et la topologie.

Enchaînement du profil : montée des 2 000 chauffeurs sur 60 s, positions toutes les 5 s jusqu'à 15 minutes ; à 90 s, 500 demandes de course immédiates au même instant, acceptées par les chauffeurs les plus proches et menées à terme (20 s d'approche, 40 s de trajet), suivies par les clients sur le socket ; de 4 à 9 minutes, 100 devis par seconde.

## Limites de la mesure

- La fumée ne charge pas le système : elle valide les scripts et le chemin complet (comptes, sockets, offres, attribution, fin de course, factures, retrait) et donne les temps unitaires sur la base de développement distante.
- Mesurée depuis un poste de développement, avec un réseau domestique et une base partagée où d'autres tests tournaient au même moment.
- Les délais de première offre et d'attribution viennent des horodatages du serveur ; la diffusion des positions, de l'horloge du générateur (même machine pour le chauffeur et le client).
