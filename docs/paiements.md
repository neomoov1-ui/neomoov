# Paiements (étape 7)

Section 5.6 du cahier des charges, prompt 07. Aucune donnée de carte ne transite par l'API Neomoov : seulement des identifiants Stripe (client `cus_…`, méthode `pm_…`, PaymentIntent `pi_…`). Toute opération financière porte une clé d'idempotence. Depuis l'étape 26, Square peut remplacer Stripe en attendant la validation du compte Stripe : voir la dernière section.

## Montants

- **Autorisation** : prix maximal consenti + 15 % (`payments.authorization_margin_ppm`), marge plafonnée à 20 $ (`payments.authorization_margin_cap_cents`). Exemple : 50,00 $ consentis, 57,50 $ autorisés.
- **Capture** : le montant dû (prix final moins les crédits), jamais plus que l'autorisation. Un dépassement éventuel devient un solde dû.
- **Pourboire** : paiement séparé hors session, une fois par course, plafonné (`rides.tip_max_cents`, 100 $).

## Tableau des états par scénario

État de la ligne `payments` de la course (nature `ride`, sauf mention), vérifié par `apps/api/test/payments.e2e.test.ts` avec le fournisseur simulé, sauf la ligne marquée (non couverte : même chemin que l'annulation avec frais).

| Scénario | À la réservation | À l'attribution | À la fin ou à la clôture | Autres lignes |
|---|---|---|---|---|
| Carte, course planifiée | `pending` (carte choisie) | `authorized` (autorisation) | `captured` (montant final) | `tip` : `captured` |
| Carte, planifiée à plus de 6 jours | `pending` | `pending` (signal `payment_authorization_deferred`) | autorisée par la reprise quand la prise en charge approche | |
| Carte, course immédiate | `authorized` avant la création | `authorized` | `captured` | |
| Carte refusée, immédiate | aucune course (402 `PAYMENT_DECLINED`) | | | |
| Carte refusée à l'attribution | `pending` | `failed` + incident `payment_failed` + avis au client | | |
| Capture refusée une fois | | `authorized` | `captured` à la seconde tentative (`attempts` = 2) | |
| Capture refusée deux fois | | `authorized` | `failed` + incident + solde dû (réservations bloquées, 402 `BALANCE_DUE`) | `balance` : `captured` après `POST /v1/me/settle` |
| Annulation après le départ du chauffeur | `pending` | `authorized` | nature `cancellation_fee`, `captured` (frais) | |
| Annulation gratuite, aucun chauffeur, annulation par le chauffeur | `pending` | `authorized` | `cancelled` (autorisation levée) | |
| Absence du client (non couverte) | | `authorized` | nature `no_show_fee`, `captured` | |
| Paiement direct (espèces, Interac, terminal) | aucune ligne | aucune ligne | `paid_direct`, montant confirmé par le chauffeur ; un écart ouvre un incident | |
| Remboursement sur la carte | | | `captured`, puis `refunded` quand tout est rendu | ligne `refunds` (`mode` = `refund`) |
| Crédit (paiement direct ou au choix du client) | | | inchangé | ligne `refunds` (`mode` = `credit`) et `credits` (`origin` = `refund`) |

## Webhook rejoué

`POST /v1/webhooks/stripe` vérifie la signature sur le corps brut, enregistre l'événement par son identifiant dans `webhook_events`, répond tout de suite et le fait traiter par la file `payments`. Journal du test (même événement envoyé trois fois) :

| Envoi | Réponse | `webhook_events` |
|---|---|---|
| 1 | `200 { received: true, duplicate: false }` | ligne créée, traitée : `status = processed`, `attempts = 1` |
| 2 | `200 { received: true, duplicate: true }` | inchangée |
| 3 | `200 { received: true, duplicate: true }` | inchangée |
| signature fausse | `400 WEBHOOK_SIGNATURE_INVALID` | aucune ligne |

Événements traités : PaymentIntent (`amount_capturable_updated`, `succeeded`, `canceled`, `payment_failed`), remboursements (`charge.refunded`, `refund.updated`), litiges (`charge.dispute.created`, incident), méthodes (`payment_method.detached`), comptes Connect (`account.updated`), versements (`transfer.*`, `payout.failed`, journalisés pour l'étape 9). Un traitement en échec reste `failed` et est repris par la file (toutes les 5 minutes, ou `POST /v1/admin/payments/webhooks/retry`), jusqu'à `payments.webhook_max_attempts` essais.

## Routes

| Route | Rôle |
|---|---|
| `POST /v1/payment-methods/setup-intent` | SetupIntent pour la feuille de paiement Stripe (carte, Apple Pay, Google Pay) |
| `POST /v1/payment-methods/confirm` | Enregistre la carte d'un SetupIntent confirmé, relue chez Stripe |
| `GET /v1/payment-methods`, `DELETE /v1/payment-methods/{id}` | Cartes enregistrées, retrait |
| `POST /v1/rides/{id}/tip` | Pourboire (aussi débité par `POST /v1/rides/{id}/rate` avec `tipCents`) |
| `GET /v1/rides/{id}/payments` | Reçu (le chauffeur voit les montants, jamais la carte) |
| `GET /v1/me/balance`, `POST /v1/me/settle` | Solde dû et règlement |
| `POST /v1/driver/connect/onboarding-link`, `GET /v1/driver/connect/status` | Compte Stripe Connect Express du chauffeur |
| `POST /v1/driver/payment-method`, `POST /v1/driver/payment-method/confirm` | Méthode de prélèvement du chauffeur (relevés négatifs, étape 9) |
| `POST /v1/driver/rides/{id}/complete` avec `paidDirect` | Paiement direct confirmé à la fin de course |
| `POST /v1/admin/rides/{id}/refund`, `GET /v1/admin/rides/{id}/payments` | Remboursement ou crédit, paiements d'une course (My Hub) |

## Passer au vrai Stripe

1. Dans `.env` : `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, puis `PAYMENT_PROVIDER=real`.
2. Dans le tableau de bord Stripe : point de terminaison `https://api.neomoov.net/v1/webhooks/stripe` avec les événements listés plus haut ; Connect activé (comptes Express, Canada).
3. Apple Pay : identifiant marchand dans le réglage `payments.apple_pay_merchant_id` et domaine vérifié chez Stripe.
4. Vérification avec les cartes de test : `RUN_STRIPE_TESTS=1 pnpm --filter @neomoov/api exec vitest run test/stripe.live.test.ts` (clé `sk_test_…` seulement).

## Square en attendant Stripe (étape 26)

Décision du fondateur du 1er octobre 2026 : le compte Stripe de Neomoov n'est pas encore validé ; le compte Square canadien du fondateur (encaissement en CAD) encaisse les courses dès maintenant, puis Stripe reprend quand son compte est validé. Le choix se fait par `PAYMENT_PROVIDER` : `stripe` (ou `real`, même chose), `square`, `mock`. Rien ne change pour Stripe. Procédures (clés, webhook, bascule, versements) : `docs/runbooks/square.md`.

### Ce que fait l'adaptateur Square

`apps/api/src/adapters/real/square.ts` implémente `PaymentProvider` avec l'API REST de Square (version datée dans l'en-tête `Square-Version`, `fetch`, aucun SDK), comme `stripe.ts`. Le service des paiements s'adapte aux **capacités** du fournisseur (`capabilities` : `setupIntent`, `cardToken`, `connect`), jamais à son nom.

| Besoin | Stripe | Square |
|---|---|---|
| Client | `cus_…` | Client Square retrouvé par `reference_id` (notre identifiant d'utilisateur), sinon créé |
| Carte enregistrée | SetupIntent confirmé par la feuille de paiement native | Jeton de carte du Web Payments SDK (page `/carte` du web) puis `CreateCard` (`ccof:…`) |
| Empreinte à la réservation ou à l'attribution | PaymentIntent `capture_method: manual` | `CreatePayment` `autocomplete: false`, délai par défaut de Square (7 jours pour une carte absente, le maximum), annulation à l'échéance |
| Capture du montant final | Capture partielle | Montant baissé par `UpdatePayment` quand Square le permet (`EDIT_AMOUNT_DOWN`), puis `CompletePayment` ; sinon complétion du montant autorisé puis remboursement immédiat de la différence |
| Course annulée sans frais | Annulation du PaymentIntent | `CancelPayment` (sans effet si l'empreinte est déjà annulée) |
| Frais, pourboire, solde dû, prélèvement d'un chauffeur | Paiement hors session | `CreatePayment` `autocomplete: true` sur la carte enregistrée |
| Remboursement, partiel compris | `refunds` | `RefundPayment` |
| Versements aux chauffeurs | Stripe Connect | Aucun : virement ou Interac hors plateforme |

Montants en cents CAD. Clés d'idempotence : les nôtres, condensées de façon déterministe au-delà de 45 caractères (limite de Square). La capture est rejouable : un paiement déjà complété n'est pas recomplété ; le remboursement de la différence porte une clé fixée par le paiement et le montant final (`adjust:<paiement>:<montant>`), jamais par la tentative. Erreurs de Square traduites : refus de carte (`PAYMENT_METHOD_ERROR`) en échec typé avec le code de Square en minuscules (`insufficient_funds`, `generic_decline`…), `402 PAYMENT_DECLINED` à l'enregistrement d'une carte ; panne en `502 PAYMENT_PROVIDER_ERROR`.

### Cartes et paiements marqués par fournisseur

Migration 0022 : colonne `provider` (`stripe`, `square`, `mock`) sur `client_payment_methods` et `payments` (droits et politique `neomoov_scoped` inchangés). Seules les cartes du fournisseur actif sont listées, proposées et débitées. Un remboursement par carte ne passe que par le fournisseur du paiement : après une bascule, un paiement de l'ancien fournisseur se rembourse dans son tableau de bord ou en crédit (`409 PAYMENT_PROVIDER_MISMATCH`). La référence du client (`users.stripe_customer_id`) ne vaut que pour le fournisseur qui l'a émise : un nouveau client est créé chez le fournisseur actif au premier besoin.

### Parcours de saisie de carte (sans module natif de paiement)

1. L'application appelle `POST /v1/payment-methods/setup-intent` (chauffeur : `POST /v1/driver/payment-method`). La réponse porte `provider` et, pour Square, `squareApplicationId`, `squareLocationId`, `squareEnvironment` et `cardFormUrl` (`<web>/carte?session=<jeton>`) ; `setupIntentId` et `clientSecret` sont nuls.
2. La session est un jeton court signé (HMAC-SHA256, clé dérivée d'`ENCRYPTION_KEY` par HKDF sous l'étiquette `neomoov/card-session/v1`), valable 15 minutes, lié à l'utilisateur et à son objet (carte du client ou carte de prélèvement du chauffeur). Le jeton d'accès de l'utilisateur ne figure jamais dans l'adresse.
3. L'application ouvre la page dans le navigateur intégré (`expo-web-browser`, navigateur du système en repli). Le serveur web vérifie la session auprès de l'API (`GET /v1/payment-methods/card-session`) puis affiche le formulaire de carte du Web Payments SDK (champs dans les cadres de Square). La tokenisation demande la vérification de l'acheteur (intention `STORE`, 3-D Secure si la banque l'exige) ; seul le jeton de carte quitte le navigateur.
4. Le navigateur envoie la session et le jeton au serveur web (`POST /api/carte`), qui les relaie à l'API (`POST /v1/payment-methods/card-session/confirm`) : la carte est créée chez Square et rattachée au client (ou enregistrée comme carte de prélèvement du chauffeur), marque et 4 derniers chiffres seulement.
5. La page affiche « Carte enregistrée » et renvoie à l'application par lien profond (`neomoov://carte-enregistree`, chauffeur : `neomoov-driver://payout`) ; l'application relit la liste des cartes.

`POST /v1/payment-methods/confirm` accepte aussi `{ sourceId, verificationToken? }` (route authentifiée, même effet). Session expirée : `401 CARD_SESSION_EXPIRED` ; altérée : `401 CARD_SESSION_INVALID` ; fournisseur sans jeton de carte (Stripe) : `409 CARD_TOKEN_UNAVAILABLE`. Politique de sécurité du contenu : les sources de Square ne sont permises que sur `/carte`, servie sans référent.

### Webhooks Square

`POST /v1/webhooks/square` : signature `x-square-hmacsha256-signature` = HMAC-SHA256 (clé de signature de l'abonnement) de l'adresse de notification (`SQUARE_WEBHOOK_URL`, au caractère près) suivie du corps brut, comparée en temps constant. Événement enregistré une seule fois dans `webhook_events` (identifiant `event_id`), traduit dans le vocabulaire interne puis traité par la même file que Stripe :

| Événement Square | Traduit en | Effet |
|---|---|---|
| `payment.created` / `payment.updated` / `payment.completed`, statut `APPROVED` | `payment_intent.amount_capturable_updated` | Paiement en attente passé à « autorisé » |
| idem, `COMPLETED` | `payment_intent.succeeded` (montant net des remboursements) | Paiement « encaissé » |
| idem, `CANCELED` | `payment_intent.canceled` | Autorisation levée |
| idem, `FAILED` | `payment_intent.payment_failed` | Paiement en échec avec le code de Square |
| `refund.created` / `refund.updated` | `refund.updated` | État du remboursement ; note de crédit quand il réussit |
| `card.disabled` | `payment_method.detached` | Carte retirée |
| `dispute.created` | `charge.dispute.created` | Incident « litige » |

Le point de réception du fournisseur inactif répond `404 WEBHOOK_PROVIDER_INACTIVE` (`/v1/webhooks/stripe` quand Square est actif, et inversement) ; le simulateur accepte les deux.

### Versements aux chauffeurs sans Connect

Avec Square, `capabilities.connect` est faux :

- `POST /v1/driver/connect/onboarding-link` répond `409 CONNECT_UNAVAILABLE` (« vos relevés positifs sont réglés par virement ou Interac chaque semaine ») ; `GET /v1/driver/payout` et `GET /v1/driver/connect/status` portent `payoutMode: "offline"` ; l'application chauffeur affiche « Versement par virement chaque semaine » à la place du parcours Connect ; le réglage `drivers.require_payout_account` est ignoré (inscription, accueil, passage en ligne).
- Le règlement d'un relevé positif (`/pay`, règlement du vendredi) ne verse rien : le relevé reste « émis », sans tentative ni alerte d'échec, journalisé `statement.offline_payout_due`.
- `GET /v1/admin/payouts/offline` liste les versements à faire (relevés positifs émis ou en échec), `GET /v1/admin/payouts/offline/export` en donne le CSV (séparateur point-virgule, montants en cents, total en dernière ligne, téléchargement journalisé). Référence du virement : `NM-AAAAMMJJ-<numéro du chauffeur>`.
- `POST /v1/admin/statements/{id}/settle-offline` (existant) clôture le relevé avec le moyen et la référence. My Hub, Relevés : carte « Versements à faire hors plateforme » et bouton d'export.
- Relevés négatifs : prélèvement sur la carte de prélèvement du chauffeur (page de saisie), comme avec Stripe.

### Limites

- Apple Pay et Google Pay par Square : non branchés (plus tard).
- Avec Stripe, l'application client n'a pas encore la feuille de paiement native : l'ajout de carte y affiche un message (paiement au chauffeur possible).
- Square n'accepte pas une empreinte de plus de 7 jours : une réservation planifiée est autorisée à l'approche (`payments.authorization_lead_days`, 6 jours), comme avec Stripe.
- Test en bac à sable (`square.live.test.ts`) : lancé seulement avec `RUN_SQUARE_TESTS=1` et un jeton du bac à sable (`EAAA…`).

### Bascule

Square vers Stripe : `docs/runbooks/square.md`, section 5. Les cartes Square cessent d'être proposées, les clients en ajoutent une chez Stripe ; les paiements Square se remboursent dans Square Dashboard ou en crédit ; les relevés encore à verser hors plateforme restent listés.
