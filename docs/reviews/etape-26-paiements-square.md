# Étape 26 : encaissement par Square en attendant Stripe

Revue de fin d'étape, 1er octobre 2026. Branche `etape-26-paiements-square` (agent H, repris par l'agent H2 après l'arrêt du premier). Mission : `neomoov-outils/agents/H-paiements-square.md` (décision du fondateur du 1er octobre : compte Square canadien, CAD). Documentation : `docs/paiements.md` (section « Square en attendant Stripe »), `docs/runbooks/square.md`.

## Critères d'acceptation

| Critère | Résultat |
|---|---|
| Choix par `PAYMENT_PROVIDER=square\|stripe\|mock`, rien de cassé pour Stripe | Oui : capacités du fournisseur dans l'interface ; `stripe-adapter.test` vert ; `real` reste Stripe ; `payments.e2e` (simulateur) relancé sans modification (résultat ci-dessous) |
| Adaptateur Square REST (`Square-Version`, `fetch`) : clients, cartes par jeton, liste et retrait, carte par défaut chez nous | Oui (`adapters/real/square.ts`), `square-adapter.test` |
| Empreinte `autocomplete: false`, délai maximal, clé d'idempotence = la nôtre | Oui : délai par défaut de Square (le maximum, 7 jours) ; clé condensée de façon déterministe au-delà de 45 caractères |
| Capture plafonnée, rejouable ; annulation de l'empreinte | Oui : baisse du montant par `UpdatePayment` si permise, sinon complétion puis remboursement de la différence ; rejeu sans double effet (test) ; `CancelPayment` idempotent |
| Frais, pourboire, solde dû : paiement direct ; remboursements partiels | Oui (`autocomplete: true`, `RefundPayment`) |
| Webhook `POST /v1/webhooks/square` : signature, idempotence, transitions identiques à Stripe | Oui : HMAC-SHA256 de l'adresse et du corps brut, `webhook_events`, traduction en événements internes (tests unitaires et `square-mode.e2e`) |
| Variables, `.env.example`, `env-check.mjs`, démarrage refusé en production sans elles | Oui (`env.test`, `adapters.test`) ; `env:check` contrôle aussi la forme des clés |
| Montants en cents CAD, erreurs traduites | Oui (`PAYMENT_DECLINED`, `PAYMENT_PROVIDER_ERROR`, codes de Square en minuscules) |
| `setup-intent` porte `provider`, identifiants Square, `cardFormUrl` ; `confirm` accepte `{ setupIntentId }` ou `{ sourceId, verificationToken? }` | Oui (schémas du domaine, OpenAPI) |
| Page `/carte` : session signée de 15 minutes liée à l'utilisateur, Web Payments SDK, confirmation par le serveur web, « Carte enregistrée », lien profond | Oui (`apps/web/src/app/carte`, `/api/carte`) ; aucune donnée de carte ni jeton d'accès sur nos serveurs ou dans l'adresse |
| Application client : navigateur intégré avec Square, parcours Stripe sinon, liste relue au retour, i18n | Oui : écran « Moyens de paiement » (Profil, et bouton « Ajouter une carte » à la confirmation d'une réservation prépayée sans carte) ; Stripe : la feuille native n'existait pas dans l'application, un message l'indique |
| Versements sans Connect : relevés à verser hors plateforme, export CSV, `settle-offline`, Connect en 409, écran chauffeur | Oui (`square-mode.e2e`) ; My Hub : carte « Versements à faire hors plateforme » |
| Tests : adaptateur, `payments.e2e` inchangé et vert, bac à sable derrière `RUN_SQUARE_TESTS`, page `/carte` | Oui, sauf le bac à sable non lancé (jeton du bac à sable erroné, voir plus bas) |
| Docs, runbook, décisions, OpenAPI, accès à fournir | Oui |

## Tests lancés (1er octobre 2026)

| Commande | Résultat |
|---|---|
| `vitest run test/square-adapter.test.ts test/env.test.ts test/adapters.test.ts test/stripe-adapter.test.ts test/square.live.test.ts` (API, sans base) | 4 fichiers verts, 1 ignoré ; 34 tests verts, 2 ignorés (bac à sable) |
| `square-mode.e2e.test.ts` (base de développement, sous verrou) | 4 sur 4 verts (après le changement du lien de retour du chauffeur) |
| `payments.e2e.test.ts` (fichier inchangé, sous verrou) | 15 sur 15 verts |
| `invoicing.e2e.test.ts` (sous verrou) | 8 sur 8 verts après correction du test de numérotation (deux exécutions précédentes : 6 sur 8, voir Pièges) |
| `settlement.e2e.test.ts` (règlement des relevés modifié, sous verrou) | 6 sur 6 verts |
| `driver-account.e2e.test.ts` (état du compte de versement, sous verrou) | 7 sur 7 verts |
| `pnpm --filter @neomoov/domain test` | 32 fichiers, 429 tests verts |
| Web `vitest run` | 5 fichiers, 14 tests verts (dont `card-session.test.ts`, `card-csp.test.ts`) |
| Client `vitest run` | 5 fichiers, 25 tests verts (dont `payments-logic.test.ts`) |
| Chauffeur `vitest run` | 3 fichiers, 17 tests verts |
| Client d'API `test` | 5 fichiers, 29 tests verts |
| Types (`tsc --noEmit`) | Verts : API, worker, web, client, chauffeur, domaine, base, client d'API |
| `drizzle-kit generate` | « No schema changes » : instantané 0022 cohérent avec le schéma |

## Points vérifiés à la relecture

- Aucune valeur de clé dans le code, les tests, les journaux, les commits ; le jeton d'accès Square est un champ privé (absent de `JSON.stringify` et `util.inspect`, testé).
- Jamais d'appel à l'API Square de production : tests avec faux `fetch`, test réel limité au bac à sable (jeton `SQUARE_SANDBOX_ACCESS_TOKEN`, environnement forcé).
- Les identifiants de carte Square contiennent « : » (`ccof:…`) : gardés tels quels dans les chemins.
- Session de carte : comparaison en temps constant, clé dérivée propre (pas de réemploi direct d'`ENCRYPTION_KEY`), expiration vérifiée, objet (client ou chauffeur) dans la signature ; la page coupe le référent (la session ne part pas vers le CDN de Square).
- Remboursement d'un paiement d'un ancien fournisseur refusé proprement (`PAYMENT_PROVIDER_MISMATCH`).
- Données de charge et `seed-e2e` : cartes et paiements simulés marqués `mock` (sinon `stripe` par défaut et cartes ignorées par le simulateur).
- Migration 0022 appliquée sur la base de développement (date du journal remise à l'heure courante : une migration plus récente d'un autre agent était passée avant) ; fichier inverse présent.

## Reste à faire

- Test en bac à sable non lancé : `SQUARE_SANDBOX_ACCESS_TOKEN` contient l'identifiant d'application du bac à sable (`sandbox-sq0idb-…`), pas le jeton d'accès (`EAAA…`). À corriger par le fondateur, puis `RUN_SQUARE_TESTS=1` (`docs/runbooks/square.md`, section 8). `SQUARE_SANDBOX_LOCATION_ID` à fournir pour développer avec Square (le test s'en passe).
- Déclarer le webhook chez Square et poser `SQUARE_WEBHOOK_URL` au déploiement (`square.md`, section 2).
- Page `/carte` non essayée dans un vrai navigateur avec le SDK de Square (pas de jeton de bac à sable valide, pas de serveur lancé par l'agent) : à vérifier en bac à sable dès le jeton corrigé.
- Application client : `expo-web-browser` ajouté, prochain build natif nécessaire (sur un ancien binaire, repli sur le navigateur du système). Avec Stripe, feuille de paiement native toujours absente.
- Apple Pay et Google Pay par Square : hors périmètre.

## Pièges

- La signature des webhooks Square couvre l'adresse de notification : `SQUARE_WEBHOOK_URL` doit être identique au caractère près à celle déclarée.
- Square refuse un `delay_duration` égal à 7 jours pour une carte absente : ne pas le fixer.
- Le simulateur déclare toutes les capacités (`setupIntent`, `cardToken`, `connect`) : un test qui le met en « mode Square » doit créer ses comptes avant (les aides de test enregistrent une carte par SetupIntent) et remettre les capacités à la fin.
- `invoicing.e2e` échouait deux fois de suite sur la suite complète (« tâche perdue » : délai de 120 s dépassé ; « SEV : échec puis reprise » : facture déjà accusée), sans lien avec les paiements : le test de numérotation supprimait ses 100 factures en laissant 100 courses terminées sans facture ; deux minutes plus tard, la passe périodique du test « tâche perdue » en reprenait 50 et, encore en cours après le délai, consommait l'échec SEV préparé par le test suivant. Sur un poste peu chargé, les tests 4 à 6 durent moins de deux minutes et le problème ne se voyait pas. Correction : ces courses sont sorties de la fenêtre de rattrapage (`updated_at` à J-3) ; suite verte (8 sur 8).
- Dossier temporaire partagé entre agents : un fichier de message de commit peut être remplacé par un autre agent ; nommer ses fichiers avec un préfixe propre.
