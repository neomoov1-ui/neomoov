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

Transverses : `authorization` (chaque route a une politique, 401 et 403 vérifiés sur toutes), `health`, `stuck-rides` (courses figées, files en échec), `notifications` (matrice 5.14, repli texto, reprise), `messaging`, `audit-export`.

## Lancer les tests

```
pnpm test                                  # domaine, base, web, applications (Turborepo)
pnpm --filter @neomoov/api test            # API : environ 12 minutes, base de développement requise (DATABASE_URL)
pnpm --filter @neomoov/web e2e             # Playwright : API et web locaux démarrés par le script
maestro test apps/mobile-client/maestro    # Maestro : application installée sur un appareil ou un simulateur
```

Règles des tests d'API :

- Chaque fichier crée ses propres comptes (téléphones `+1999…`) et les retire à la fin (`cleanupTestData`), jamais par motif : les fichiers tournent en parallèle sur la même base.
- Tests de répartition automatique : isolés par le mode de paiement par terminal ; les autres fichiers attribuent de force (`DISPATCH_MODE=manual` par défaut en test).
- Jamais l'API de développement en marche pendant `pnpm test` : elle partage la base et traiterait les files à la place des tests.
- Ne pas créer d'utilisateur pendant qu'une requête supertest est ouverte (`ECONNREFUSED`).

## Reste à faire avant la bêta

- Jouer les parcours Maestro sur un iPhone et un Android réels (comptes des magasins requis).
- Tests de charge k6 (`pnpm test:load`) sur le serveur de préproduction : les charges légères actuelles (`dispatch` 200 chauffeurs, `realtime`, `quotes` 20 devis) tournent contre la base de développement partagée et ne mesurent pas la production.
