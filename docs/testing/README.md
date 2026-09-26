# Tests : où est vérifié chaque parcours critique

Inventaire des 25 parcours de la section 9.2 du cahier des charges (obligatoires avant la bêta), avec le test qui couvre chaque étape. Trois niveaux :

- **API (Vitest)** : `apps/api/test/*.e2e.test.ts`, contre la base de développement et les fournisseurs simulés. C'est le niveau qui fait foi pour les règles (montants, états, droits, idempotence).
- **Web (Playwright)** : `apps/web/e2e/*.spec.ts` (My Hub, réservation web, suivi partagé), contre l'API locale.
- **Mobile (Maestro)** : `apps/mobile-client/maestro/` et `apps/mobile-driver/maestro/`, sur un appareil ou un simulateur. Les parcours `e2e/web-journeys.cjs` des deux applications rejouent les écrans principaux dans la version web d'Expo.

| # | Parcours | API (Vitest) | Web / Mobile | État |
|---|---|---|---|---|
| 1 | Inscription SMS, carte, réservation Neo Premium, attribution, suivi, fin, pourboire, évaluation, reçu et facture | `auth` (compte en moins de 60 s), `payments` (carte, autorisation, capture, pourboire), `dispatch` (offre au plus proche en moins de 3 s), `realtime` (positions en moins de 2 s), `rides` (cycle complet, pourboire, évaluation), `invoicing` (facture, PDF, courriel) | Maestro client `01-inscription-reservation` | Couvert par étapes ; l'enchaînement complet sur appareil reste à jouer avec Maestro |
| 2 | Paiement en espèces déclaré par le chauffeur, lignes du relevé | `payments` (paiement direct confirmé, écart = incident), `settlement` (relevé : lignes des courses payées au chauffeur), `driver-account` (fiche de course, paiement direct reçu) | Maestro chauffeur `02-course-especes` | Couvert |
| 3 | Planifiée avec numéro de vol, attribution à 60 min, confirmation, rappels, exécution | `scheduled` (rappel J-1, déclenchement à 60 min, alerte à 30 min, confirmation), `journeys` (numéro de vol sur la fiche du chauffeur) | Maestro client `03-planifiee-vol` | Couvert |
| 4 | Réservation pour un tiers : texto de suivi au tiers | `rides` (parcours 4) | Maestro client `04-tiers` | Couvert |
| 5 | Favori disponible : priorité et supplément ; indisponible : message, sans supplément | `growth-favorites-guarantee` (supplément au devis, retiré si indisponible), `dispatch` (favori seul pendant 120 s, avis `ride.favourite_unavailable`, supplément retiré à la fin) | Maestro client `05-vehicule-precis` | Couvert |
| 6 | Annulation client gratuite dans les 2 min, 5,00 $ ensuite | `rides` (annulation client), `payments` (frais capturés) | Maestro client `06-annulation` | Couvert |
| 7 | Non-présentation après 5 min : 7,00 $, pack non consommé | `rides` (délai et deux contacts, 7,00 $), `journeys` (aucune consommation de pack) | | Couvert |
| 8 | Annulation chauffeur en route : réattribution, score impacté | `rides`, `dispatch` (nouvelle recherche prioritaire, chauffeur exclu), `journeys` (annulation comptée au tableau de conduite) | Maestro chauffeur `08-annulation-chauffeur` | Couvert ; la sanction graduée (annulations tardives) arrive avec l'agent qualité |
| 9 | Aucun chauffeur : `no_driver`, autorisation annulée, alerte opérateur | `dispatch` (trois balayages puis « aucun chauffeur », alerte), `journeys` (autorisation levée, client et exploitation prévenus) | | Couvert |
| 10 | Inscription chauffeur : documents, extraction par l'agent, validation humaine, formation, Connect, en ligne | `driver-account` (parcours 10), `agents` (agent recrutement sur document téléversé), `payments` (Connect Express), `antivirus` | Playwright `hub.spec` (validation des documents), Maestro chauffeur `10-inscription-chauffeur` | Couvert |
| 11 | Document expiré : suspension, nouveau document, réactivation | `compliance` (rappels J-30, J-7, J-1, suspension, réactivation) | Maestro chauffeur `11-document-expire` | Couvert |
| 12 | Pack Pro : consommation, alerte à 3, renouvellement, report | `growth-packs-promotions` | Maestro chauffeur `12-pack` | Couvert |
| 13 | Relevé hebdomadaire : PDF, versement ; net négatif ; échec et suspension | `settlement` (4 tests) | Playwright `hub.spec` (relevés) | Couvert |
| 14 | 3e course offerte jusqu'à 10 km ; code de lancement limité à 1 000 clients | `quotes`, `growth-packs-promotions` ; plafond de clients distincts : test du domaine `promotions.test.ts` | | Couvert (le plafond de 1 000 est vérifié par le domaine, pas avec 1 000 comptes) |
| 15 | Parrainage client : crédits des deux côtés après la première course | `growth-credits-referral` | | Couvert |
| 16 | Garantie modèle : signalement, validation, remboursement | `growth-favorites-guarantee` | Playwright `hub.spec` (incidents) | Couvert |
| 17 | Course par téléphone pour un client sans compte, attribution manuelle, texto | `admin-hub` (création, recherche, annulation), `journeys` (attribution manuelle, texto au client, aucun compte créé) | Playwright `hub.spec` (création d'une course) | Couvert |
| 18 | Agent vocal : prix et course (webhooks signés) | `voice` | | Couvert (fournisseur simulé ; appel réel quand Vapi est ouvert) |
| 19 | Agent relation client : remboursement de 20 $ en mode approbation, approuvé dans My Hub | `agents` (critère des 20 $, décisions simultanées) | Playwright `hub.spec` (approbation) | Couvert |
| 20 | SOS client et chauffeur : alerte immédiate, blocage du chauffeur si plainte | `rides` (SOS, alerte), `voice` (appel du fondateur), `safety-hold` (blocage préventif, décision humaine), `realtime` (alerte My Hub) | Playwright `hub.spec` (SOS reçu, décision) | Couvert |
| 21 | Négociation encadrée | `dispatch` (plancher de 70 %, contre-offres, acceptations simultanées, repli, drapeau désactivé) | | Couvert |
| 22 | Loi 25 : export, suppression, purge des positions à 90 jours | `me` (export, suppression), `retention` (purges après sauvegarde vérifiée, horloge simulée), `ledgers-exports` (droits) | Playwright `public.spec` (page des droits) | Couvert |
| 23 | Facture pour chaque course, transmission simulée, numérotation sans trou | `invoicing` (100 courses en parallèle, SEV simulé) | Playwright `hub.spec` (facturation) | Couvert |
| 24 | Redevance et taxes sur 100 courses mixtes, export mensuel | `ledgers-exports` | Playwright `hub.spec` (export CSV) | Couvert |
| 25 | Mode dégradé : Routes indisponible, devis estimé, course possible | `quotes` (itinéraire estimé), `circuit-breaker` (disjoncteur, santé « dégradée ») | | Couvert |

Transverses : `authorization` (chaque route a une politique, 401 et 403 vérifiés sur toutes), `health`, `stuck-rides` (courses figées, files en échec), `notifications` (matrice 5.14, repli texto, reprise), `messaging`, `audit-export`, `dispatch-concurrency` (courses immédiates simultanées : jamais deux offres en attente au même chauffeur, défaut révélé par le test de charge), `seed-e2e` et `seed-e2e-plan` (jeu de bout en bout), `load-fixtures` (comptes des tests de charge).

## Lancer chaque suite

| Suite | Commande | Durée | Prérequis | Ce qu'elle touche |
|---|---|---|---|---|
| Domaine, base, web, applications | `pnpm test` (Turborepo) | 2 à 3 minutes hors API | `pnpm install`, paquets construits (`pnpm build`) | Rien hors du poste (domaine et web sans base) |
| Vérifications statiques | `pnpm exec turbo run typecheck lint` | 1 à 2 minutes | idem | Rien |
| API (Vitest, intégration) | `pnpm --filter @neomoov/api test` | environ 12 minutes | `DATABASE_URL` (base de développement), aucune API de développement en marche | La base partagée : chaque fichier crée puis retire ses comptes |
| Un fichier de l'API | `pnpm --filter @neomoov/api exec vitest run test/<fichier>.test.ts` | 30 s à 6 minutes (`dispatch` : 6 minutes) | idem | idem |
| Web (Playwright) | `pnpm --filter @neomoov/web e2e` | quelques minutes | API et web locaux démarrés par le script | La base de développement (comptes de test) |
| Mobile (Maestro) | `maestro test apps/mobile-client/maestro` | quelques minutes par parcours | Application installée sur un appareil ou un simulateur, API joignable | La base visée par l'application |
| Jeu de bout en bout | `pnpm seed:e2e`, puis `pnpm seed:e2e --reset` | environ 5 minutes (4 min 30 s d'écriture après la construction de l'API) ; retrait : 30 s | `pnpm db:seed` déjà passé, `DATABASE_URL` | Ses propres données marquées (section suivante) |
| Charge, profil fumée | `pnpm test:load` | 2 à 3 minutes, dont moins d'une minute de k6 | k6, API visée démarrée en mode test (plus bas), `DATABASE_URL` de la même base | Comptes de charge marqués, créés puis retirés |
| Charge, profil complet | `LOAD_PROFILE=full LOAD_CONFIRM_ISOLATED=1 pnpm test:load` | environ 20 minutes | Préproduction isolée seulement (`docs/testing/load-report.md`) | L'environnement isolé |

Règles des tests d'API :

- Chaque fichier crée ses propres comptes (téléphones `+1999…` à 11 chiffres) et les retire à la fin (`cleanupTestData`), jamais par motif : les fichiers tournent en parallèle sur la même base.
- Tests de répartition automatique : isolés par le mode de paiement par terminal ; les autres fichiers attribuent de force (`DISPATCH_MODE=manual` par défaut en test). `dispatch-concurrency` s'isole autrement : chauffeurs et courses au nord-est de l'aire de service (45,69 ; -73,405), loin des positions des autres fichiers, paiement par carte.
- Jamais l'API de développement en marche pendant `pnpm test` : elle partage la base et traiterait les files à la place des tests. Même règle pour une API lancée pour un essai de charge : démarrée juste avant la mesure, arrêtée juste après.
- Ne pas créer d'utilisateur pendant qu'une requête supertest est ouverte (`ECONNREFUSED`).
- Le pooler de session de Supabase (développement) accepte 15 connexions : plusieurs fichiers lourds lancés en même temps, par plusieurs personnes ou agents, finissent en `EMAXCONNSESSION`. Deux exécutions simultanées des tests de répartition (deux branches) se gênent aussi (mêmes positions, chauffeurs qui acceptent le terminal) : un échec isolé de `dispatch` se rejoue seul avant de conclure.

## Jeu de données de bout en bout (`pnpm seed:e2e`)

État réaliste pour les tests et les démonstrations locales : 50 chauffeurs en ligne répartis dans les zones de service (centre-ville, Vieux-Montréal, Plateau, aéroport, reste du Grand Montréal), 200 clients avec une carte simulée, 300 courses passées sur les six semaines qui précèdent la semaine en cours (282 terminées dont 201 évaluées, 12 non-présentations et 6 annulations tardives facturées), 372 paiements par le fournisseur simulé (cartes et Apple Pay capturés, espèces et Interac déclarés par le chauffeur, pourboires séparés), registres de la redevance et des taxes, 300 factures numérotées sans trou par fournisseur et transmises au SEV simulé, 187 relevés hebdomadaires émis le vendredi et réglés (versement ou prélèvement simulé).

```
pnpm db:seed                 # une fois : données de départ (zones, tarifs, réglages)
pnpm seed:e2e                # crée ou complète le jeu (idempotent) ; les chauffeurs passent en ligne
pnpm seed:e2e --online=30    # démonstration : chauffeurs gardés en ligne 30 minutes (ou jusqu'à Ctrl+C), déplacements simulés
pnpm seed:e2e --offline      # retire leur présence en ligne, garde le reste
pnpm seed:e2e --status       # état en base, sans rien écrire
pnpm seed:e2e --reset        # retire exactement les données du jeu
```

- Déterministe : graine fixe, dates relatives au lundi de la semaine en cours (heure de Montréal). Relancé, le script ne crée rien de plus (comptes retrouvés par téléphone, courses par clé d'idempotence, factures, registres et relevés par leurs index uniques) et reprend une exécution interrompue. Mesuré le 26 septembre 2026 contre la base de développement : 268 s pour le jeu complet, 17 s pour une seconde exécution (rien à créer), 27 s pour le retrait.
- Marqué : téléphones `+199955…` à 12 chiffres (les tests en ont 11, aucune collision possible), courriels `@seed-e2e.neomoov.local`, plaques `E2E001` à `E2E050`, numéros de course `NM-AAAA-MM-JJ-Ennn`, clés `seed-e2e-ride-nnnn`. `--reset` ne retire que cela et ce qui s'y rattache (courses faites pendant une démonstration avec ces comptes, positions, offres, notifications, compteurs de factures des chauffeurs du jeu). Le journal d'audit, en ajout seul, reste ; les numéros déjà tirés (numéros globaux de facture, chauffeurs `CH-…`) ne sont pas réutilisés.
- Cohérent : comptes, courses, journal des courses et paiements sont écrits avec leurs dates réelles ; registres, factures (et transmission au SEV simulé), relevés et règlements passent par les services de l'API (`LedgersService`, `InvoicingService`, `SevService`, `StatementsService`, `SettlementPayoutsService`) avec les règles en base ; montants calculés par le moteur de tarification du domaine. Fournisseurs toujours simulés (refus sinon), mode test de l'API (aucune passe périodique sur les données des autres), refusé en production.
- Base partagée : les chauffeurs du jeu refusent le terminal et les réservations planifiées, ils ne prennent donc aucune offre des tests de répartition. Leur présence expire après 60 secondes sans position dès qu'une API tourne ; `--online` la rafraîchit, `--offline` la retire. PDF : ceux des relevés vont dans le stockage simulé (en mémoire, perdus à la fin du script), ceux des factures sont produits par la passe de reprise d'une API hors mode test.
- Démonstration locale : `pnpm seed:e2e`, puis `pnpm dev` (API et My Hub) et `pnpm seed:e2e --online` dans un autre terminal ; My Hub montre les chauffeurs sur la carte, l'historique des courses, les factures, les registres et les relevés. Retirer ensuite avec `pnpm seed:e2e --reset`.
- Réglages facultatifs : `SEED_E2E_POOL` (connexions, 8), `SEED_E2E_CONCURRENCY` (traitements parallèles, 6).

## Tests de charge (`pnpm test:load`, k6)

Scripts dans `tests/load/` (scénarios, client Socket.IO pour k6, profils et cibles) et `scripts/load/run-load.mjs` (lanceur). Le lanceur prépare des comptes de charge dans la base de l'environnement visé (`apps/api/dist/scripts/load-fixtures.js` : chauffeurs prêts à passer en ligne, clients avec carte simulée, jetons de 15 minutes dans un fichier temporaire), lance k6, puis retire les comptes et tout ce que l'essai a produit, même en cas d'échec. Il refuse une adresse de production et exige `LOAD_CONFIRM_ISOLATED=1` pour le profil complet. Résultats : `tests/load/results/<profil>-summary.md` et `.json` (non versionnés) ; rapport commenté et procédure de préproduction : `docs/testing/load-report.md`.

Profil fumée contre une API locale (base de développement : 12 chauffeurs, 3 courses, 2 devis par seconde, moins d'une minute de k6, zone isolée au nord-est de l'aire de service) :

```
pnpm --filter @neomoov/api build
# terminal 1 : API en mode test (aucune passe périodique), répartition automatique sans battement, courses immédiates, fournisseurs simulés
NODE_ENV=test PORT=4105 REDIS_URL= DISPATCH_MODE=auto DISPATCH_TICK_MS=0 FEATURE_IMMEDIATE_RIDES=on DATABASE_POOL_MAX=10 \
  PAYMENT_PROVIDER=mock MAPS_PROVIDER=mock SMS_PROVIDER=mock EMAIL_PROVIDER=mock PUSH_PROVIDER=mock SEV_PROVIDER=mock STORAGE_PROVIDER=mock \
  node apps/api/dist/main.js
# terminal 2, puis arrêter l'API aussitôt après
K6_BIN=<chemin de k6> LOAD_BASE_URL=http://127.0.0.1:4105 pnpm test:load
```

Ces réglages protègent la base partagée : `DISPATCH_TICK_MS=0`, sinon le battement de cette API ferait avancer les répartitions des tests en cours ; `NODE_ENV=test`, sinon elle enverrait les notifications et passerait les files des autres ; chauffeurs de charge sans terminal ni planifiées, placés à plus de 20 km des positions des tests.

Variables (toutes facultatives) : `LOAD_PROFILE` (`smoke`, `full`), `LOAD_SCALE` (0 à 1, profil complet réduit), `LOAD_SCENARIOS` (`drivers,rides,quotes`), `LOAD_DRIVERS`, `LOAD_CLIENTS`, `LOAD_RIDES`, `LOAD_QUOTES_RATE`, `LOAD_DURATION_S`, `LOAD_POSITION_INTERVAL_S`, `LOAD_AREA` (`isolated`, `city`), `LOAD_MAPS` (`mock` : cible de 100 ms ; `real` : 800 ms), `LOAD_RIDE_TYPE` (`immediate`, `scheduled`), `LOAD_SPREAD_IPS=1` (adresses distinctes par utilisateur virtuel, API atteinte sans mandataire), `LOAD_KEEP_FIXTURES=1`, `LOAD_DEBUG=1`, `K6_BIN`. k6 : archive officielle `grafana/k6` (binaire autonome, sans installation système), version 2.3.0 utilisée.

## Reste à faire avant la bêta

- Jouer les parcours Maestro sur un iPhone et un Android réels (comptes des magasins requis).
- Profil complet des tests de charge en préproduction isolée (`docs/testing/load-report.md` : procédure, cibles, points à surveiller). La fumée tourne contre la base de développement partagée et ne mesure pas la production.
