# Prompt 07. Étape 7 : paiements Stripe et Connect (J5)

---

Lis `CLAUDE.md`, puis `docs/cahier-des-charges-v1.md` sections 5.6, 5.2 (fin de course, frais d'annulation), 7.2 (Paiements, Chauffeur : Connect et méthode de paiement), 8 (données de carte) et 11.1 (étape 7). Consulte `docs/decisions.md`.

## Objectif
Tout l'encaissement et la base des versements : méthodes de paiement, autorisation à la demande et capture à la fin de course, pourboires, paiements directs au chauffeur, comptes Stripe Connect Express, webhooks idempotents, remboursements. Le règlement hebdomadaire lui-même vient à l'étape 9.

## Tâches
1. Adaptateur `PaymentProvider` (Stripe, avec implémentation simulée complète pour les tests) : clients Stripe liés aux `users`, SetupIntent pour enregistrer une carte, liste et suppression des méthodes, PaymentIntent à capture différée (`capture_method: manual`) pour le prix maximal consenti augmenté de la marge (section 5.6), capture partielle du montant final, annulation de l'autorisation, paiement hors session pour le pourboire sur la méthode enregistrée, remboursements partiels et totaux, création de comptes Connect Express, lien d'inscription, état de vérification, transferts vers un compte connecté, prélèvement sur la méthode enregistrée d'un chauffeur (pour les relevés négatifs, utilisé à l'étape 9).
2. Endpoints : `POST /v1/payment-methods/setup-intent`, `GET /v1/payment-methods`, `DELETE /v1/payment-methods/{id}` ; Apple Pay et Google Pay via Stripe (configuration serveur, les clients mobiles utilisent le SDK Stripe React Native à l'étape 10) ; `POST /v1/rides/{id}/tip` ; `POST /v1/driver/connect/onboarding-link`, `GET /v1/driver/connect/status`, `POST /v1/driver/payment-method` (SetupIntent chauffeur pour les prélèvements).
3. Abonnements aux événements de domaine : `RideRequested` avec carte : créer l'autorisation (échec = course non demandée, message clair) ; `RideAssigned` pour une planifiée : créer l'autorisation ; `RideCompleted` : capture du montant final, ou enregistrement du paiement direct avec confirmation du montant par le chauffeur (`POST /v1/driver/rides/{id}/complete` accepte `paidDirect: { method, amount }`) ; `RideCancelled` et `RideNoShow` : capture des frais d'annulation ou de non-présentation, sinon annulation de l'autorisation ; `RideNoDriver` : annulation de l'autorisation.
4. Webhook `POST /v1/webhooks/stripe` : vérification de signature, idempotence par identifiant d'événement, traitement des événements de paiement, de méthode, de compte Connect, de transfert, de litige ; file de retraitement en cas d'échec.
5. Échecs de capture : nouvelle tentative, puis ticket (incident de type `payment_failed`), blocage des nouvelles courses du client jusqu'à régularisation (paiement du solde dû via `POST /v1/me/settle`).
6. Remboursements : `POST /v1/admin/rides/{id}/refund` (montant, motif, remboursement ou crédit), utilisable par les agents dans les plafonds (étape 13).
7. Modes de paiement compatibles : `GET /v1/quotes` renvoie les modes disponibles selon les chauffeurs en ligne de la zone ; carte via application toujours présente.
8. Tests : intégration avec l'adaptateur simulé pour tous les flux ; tests contre Stripe en mode test derrière une variable `RUN_STRIPE_TESTS` (clés de test) pour : SetupIntent, autorisation, capture partielle, pourboire, remboursement, webhook signé (charge générée avec la clé de test).

## Contraintes
- Aucune donnée de carte ne transite par l'API : uniquement des identifiants Stripe.
- Toute opération financière porte une clé d'idempotence ; les tests rejouent chaque opération deux fois et vérifient l'absence de doublon.
- Les montants capturés ne dépassent jamais l'autorisation ; le pourboire est un paiement séparé.

## Critères d'acceptation
- Parcours complet carte : autorisation, capture, pourboire, reçu de paiement dans `payments` ; parcours espèces : `paid_direct` avec montant confirmé.
- Webhook idempotent démontré (même événement envoyé trois fois, une seule écriture).
- Compte Connect Express créé et lien d'inscription obtenu en test.

## Vérifications à exécuter et à montrer
Sortie des tests, journal d'un webhook rejoué, tableau des états de paiement pour chaque scénario.

## Fin de l'étape
`/code-review`, corrections, `docs/decisions.md`, commit « Étape 7 : paiements Stripe, pourboires, paiements directs et Connect ».
