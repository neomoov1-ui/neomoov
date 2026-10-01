# Square API — commande autonome CAP CHAUFFEUR

> Note de version : cette proposition décrit la première version isolée. L’intégration locale ultérieure est maintenant assemblée ; consulter **SQUARE-API-RECETTE.md** pour la configuration actuelle, les gardes et les fonctionnalités livrées. Les anciennes constantes d’ouverture et les étapes d’intégration ci-dessous sont historiques, pas la procédure actuelle. Les références API restent utiles.

**Proposition locale non déployée. Les ventes restent fermées.** Module : `square-checkout-api.php`. Aucun changement au fichier Academy principal, aux taxes globales Square, au catalogue ou au lien Square déjà créé. Aucun appel authentifié n’a été effectué ; les identifiants sont absents.

## Résultat proposé

Une commande individuelle comporte une ligne ad hoc « CAP CHAUFFEUR », quantité 1, prix serveur 9 900 cents CAD, puis deux taxes additives explicites : TPS 5 % (495 cents) et TVQ 9,975 % (988 cents). Total attendu **11 383 cents CAD, soit 113,83 $ CA**. Ce calcul applique les taux demandés ; il ne constitue pas une validation du régime fiscal du vendeur.

`CreatePaymentLink` reçoit l’objet `order` avec ces taxes et `pricing_options.auto_apply_taxes=false`, ainsi que `auto_apply_discounts=false`. Aucun `catalog_object_id` n’est envoyé. Le module ne possède aucune opération de modification de taxe globale. Les réponses sont relues et le lien n’est présenté que si montant, taxes, article et quantité sont exactement conformes. [CreatePaymentLink](https://developer.squareup.com/reference/square/checkout-api/create-payment-link), [taxes explicites](https://developer.squareup.com/docs/orders-api/apply-taxes-and-discounts), [options de calcul](https://developer.squareup.com/reference/square/objects/OrderPricingOptions).

Pourboires, coupons et fidélité sont désactivés pour ce checkout. Aucun abonnement. Redirection de confirmation vers `/academy/membre/?squareapi=retour`. Les liens issus de cette API sont à usage unique ; ils ne sont pas les liens réutilisables du Tableau de bord. [Options Checkout](https://developer.squareup.com/reference/square/objects/CheckoutOptions), [différences des liens API](https://developer.squareup.com/docs/checkout-api/common-pitfalls).

## Parcours et protection

Le shortcode `[nma_square_api_checkout]` fournit le formulaire. Il exige un compte connecté, un nonce WordPress, l’acceptation des conditions et une déclaration pays Canada/province Québec. Une autre réponse est rejetée avant de créer le lien. La requête complète et sa clé d’idempotence sont enregistrées avant appel : un timeout/rechargement ne change pas la clé ni le prix. Un verrou utilisateur protège les demandes simultanées ; une seule commande est conservée par membre dans cette version.

L’association est conservée côté serveur : référence aléatoire → commande Square → membre WordPress, puis paiement → membre. L’utilisateur ne fournit jamais d’identifiant de commande ou de paiement pour demander l’accès. Le retour navigateur ne donne aucun droit. Un bouton de vérification authentifié, limité à une demande par 15 secondes, relit `RetrieveOrder` puis `GetPayment`. Un webhook signé déclenche la même vérification. [RetrieveOrder](https://developer.squareup.com/reference/square/orders-api/retrieve-order), [GetPayment](https://developer.squareup.com/reference/square/payments-api/get-payment), [identifiants Tender](https://developer.squareup.com/reference/square/objects/Tender).

Conditions d’activation : commande corrélée, établissement et environnement attendus, ligne unique de 99 CAD, taxes et total exacts, paiement `COMPLETED` de 113,83 CAD, aucun remboursement total et adresse de facturation Canada/Québec renvoyée par Square. Les données de webhook ne suffisent jamais : les objets sont relus auprès de l’API. Toute référence historique Stripe/Square manuel ou prestataire différent bloque la création et l’attribution.

**Limite déterminante :** `Payment.billing_address` peut être incomplet ou absent. Le checkout hébergé ne propose pas ici de contrôle imposant la province de facturation. Une déclaration préalable QC n’est pas une preuve indépendante. Si la réponse Square ne contient pas CA/QC, le module enregistre `billing_review` et ne donne pas l’accès automatiquement, même si le paiement est encaissé. Prévoir une revue humaine avec rapprochement du paiement et justificatif de facturation, un délai annoncé et une procédure de résolution/remboursement. Le module n’inclut pas de bouton de dérogation. Ne pas promettre une activation automatique universelle. [Objet Payment](https://developer.squareup.com/reference/square/objects/Payment).

## Remboursements et synchronisation

Endpoint proposé : `/wp-json/neomoov-academy/v1/square-api`. Configurer `payment.created`, `payment.updated`, `refund.created`, `refund.updated`. La signature est HMAC-SHA256, calculée sur l’URL exacte enregistrée suivie du corps brut, comparée en temps constant. Utiliser exactement la même URL dans la console Square et dans la constante serveur. [Validation officielle des webhooks](https://developer.squareup.com/docs/webhooks/step3validate).

Un remboursement total relu dans `Payment.refunded_money` marque durablement la commande `refunded` et retire uniquement l’accès `square_api` associé. Une ancienne notification ne le réactive pas. Un remboursement partiel conserve l’accès : politique à confirmer. Les erreurs réseau/verrou renvoient 503 pour permettre une relivraison. Les anomalies sémantiques restent fermées et nécessitent revue. Le bouton membre permet un rapprochement supplémentaire ; une réconciliation planifiée et une surveillance des webhooks restent à ajouter avant exploitation soutenue. Aucun remboursement monétaire n’est déclenché par le module.

## Configuration à fournir côté serveur

Ne jamais envoyer un token dans une conversation. Les constantes doivent être renseignées hors des fichiers livrés, dans la configuration serveur protégée :

- `NMA_SQUARE_ACCESS_TOKEN` : token de l’application, permissions nécessaires aux commandes/checkout et lecture paiements.
- `NMA_SQUARE_LOCATION_ID` : établissement concerné.
- `NMA_SQUARE_ENVIRONMENT` : `sandbox` pour recette, puis `production`.
- `NMA_SQUARE_WEBHOOK_SIGNATURE_KEY` et `NMA_SQUARE_WEBHOOK_URL` : secret et URL exacts de l’abonnement webhook.
- `NMA_SQUARE_TERMS_URL` : URL HTTPS des conditions validées.
- `NMA_SQUARE_API_ENABLE` : absent/false par défaut ; true seulement après recette.
- `NMA_SQUARE_API_INTEGRATION_VERIFIED` : absent/false par défaut ; true seulement après adaptation et revue des interactions avec le module principal.

Le mode Sandbox n’attribue jamais `nma_paid=yes` : il enregistre `sandbox_paid`. Utiliser des comptes de recette distincts. La clé, le JSON brut d’erreur API et les coordonnées de facturation ne sont jamais affichés par le module. La version API est épinglée au `2026-09-16`, vérifiée dans la documentation consultée.

## Travail d’intégration restant avant déploiement

1. Ajouter le mode **square_api** dans l’interface/prestataire du module principal ; relier fermeture des ventes, formulaire, confidentialité, conditions et messages de résultat. Le shortcode isolé ne remplace pas encore le bouton existant et le principal actuel ne l’exécute pas sur sa page HTML personnalisée.
2. Adapter les anciennes mutations Stripe/Square manuel pour ignorer et ne pas écraser un accès `square_api`. Le webhook Stripe actuel protège seulement `square_manual`. Le module isolé refuse les comptes déjà porteurs de références historiques, mais cela ne remplace pas cette protection réciproque.
3. Tester dans Sandbox les totaux, deux taxes et refus de changements ; double soumission/timeouts ; fausse signature ; commande d’un autre compte ; paiement en attente ; refus d’historique croisé ; absence/divergence de province ; remboursement complet puis notification ancienne. Ajouter tests d’exécution WordPress/API, pas uniquement le parseur.
4. Confirmer CGV, régime fiscal, durée d’accès et délai de revue ; valider la réponse réelle `billing_address`. Si Square ne la fournit pas, finaliser la procédure humaine ou choisir un parcours de collecte adapté avant toute ouverture.
5. Ajouter interface de suivi des états `pending`, `billing_review`, `paid`, `refunded`, messages lisibles dans l’espace membre, journal d’audit et procédure de rapprochement. Les verrous doivent être inspectés après un crash avant suppression manuelle. Une nouvelle commande après remboursement/cancelation demande une intervention : aucun renouvellement automatique de tentative n’est prévu.

## Validation locale

Le PHP a été analysé avec `php-parser` sans erreur de syntaxe. Ce contrôle ne prouve ni l’exécution sous WordPress ni la réussite des API Square. Aucun token, commande réelle, taxe globale, paiement ou déploiement n’a été créé par cette sous-tâche.
