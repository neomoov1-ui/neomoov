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
| Application client : navigateur intégré avec Square, parcours Stripe sinon, liste relue au retour, i18n | Oui : écran « Moyens de paiement » ; Stripe : la feuille native n'existait pas dans l'application, un message l'indique |
| Versements sans Connect : relevés à verser hors plateforme, export CSV, `settle-offline`, Connect en 409, écran chauffeur | Oui (`square-mode.e2e`) ; My Hub : carte « Versements à faire hors plateforme » |
| Tests : adaptateur, `payments.e2e` inchangé et vert, bac à sable derrière `RUN_SQUARE_TESTS`, page `/carte` | Oui, sauf le bac à sable non lancé (jeton du bac à sable erroné, voir plus bas) |
| Docs, runbook, décisions, OpenAPI, accès à fournir | Oui |

## Tests lancés

Voir le rapport final de l'agent pour les comptes exacts de la dernière exécution. Fichiers : `square-adapter.test.ts` (16), `env.test.ts`, `adapters.test.ts`, `stripe-adapter.test.ts`, `square.live.test.ts` (ignoré sans `RUN_SQUARE_TESTS=1`), `square-mode.e2e.test.ts` (4, base de développement sous verrou), `payments.e2e.test.ts` et `invoicing.e2e.test.ts` (sous verrou), web `card-session.test.ts`, client `payments-logic.test.ts`, suites des applications et du client d'API.

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
- Écran de confirmation de réservation : pas encore de lien direct vers « Moyens de paiement » quand aucune carte n'est enregistrée (le message d'erreur l'indique).
- Apple Pay et Google Pay par Square : hors périmètre.

## Pièges

- La signature des webhooks Square couvre l'adresse de notification : `SQUARE_WEBHOOK_URL` doit être identique au caractère près à celle déclarée.
- Square refuse un `delay_duration` égal à 7 jours pour une carte absente : ne pas le fixer.
- Le simulateur déclare toutes les capacités (`setupIntent`, `cardToken`, `connect`) : un test qui le met en « mode Square » doit créer ses comptes avant (les aides de test enregistrent une carte par SetupIntent) et remettre les capacités à la fin.
- Dossier temporaire partagé entre agents : un fichier de message de commit peut être remplacé par un autre agent ; nommer ses fichiers avec un préfixe propre.
