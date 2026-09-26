# Paiements (étape 7)

Section 5.6 du cahier des charges, prompt 07. Aucune donnée de carte ne transite par l'API Neomoov : seulement des identifiants Stripe (client `cus_…`, méthode `pm_…`, PaymentIntent `pi_…`). Toute opération financière porte une clé d'idempotence.

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
