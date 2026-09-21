# Prompt 08. Étape 8 : packs, promotions, parrainage, favoris, garantie modèle (J6)

---

Lis `CLAUDE.md`, puis `docs/cahier-des-charges-v1.md` sections 5.7, 5.9, 5.10, 5.2 (garantie modèle), 7.2 (Promotions, Favoris, Chauffeur : packs) et 11.1 (étape 8). Consulte `docs/decisions.md`.

## Objectif
Le modèle économique côté chauffeur (packs de courses) et les mécanismes d'acquisition côté client (promotions, parrainage, crédits), le chauffeur favori et le traitement de la garantie modèle.

## Tâches
1. `packages/domain/packs` : fonctions pures `consumeRide(purchases, ride)` (pack actif le plus ancien non expiré, Illimité sans décrément), `rolloverOnExpiry(expired, next)` (report une seule fois, dans les 7 jours), `shouldAutoRenew`, `canReceiveOffers(driver)` ; tests unitaires exhaustifs des règles de la section 5.7.
2. Service des packs : `GET /v1/driver/packs` (catalogue et état), `POST /v1/driver/packs/activate` (activation immédiate, facturation différée au relevé : ligne créée avec statut `to_bill`), `PATCH /v1/driver/packs/{id}` (renouvellement automatique, changement de pack à l'épuisement), Découverte offert une seule fois par chauffeur et aux locataires R-LuxeEV (indicateur sur le profil), consommation sur `RideCompleted`, alertes `pack.low` à 3 courses restantes, expiration quotidienne par tâche planifiée, renouvellement automatique.
3. `packages/domain/promotions` : moteur de règles (`percent`, `fixed`, `free_ride`, `nth_ride`) avec conditions (première course, n-ième, distance maximale, catégorie, zone, plage, limite globale, limite par client, budget, validité) ; `evaluate(promotion, context)` au devis et revalidation à la fin de course ; compensation du chauffeur à 100 % du tarif normal (ligne de crédit sur le relevé, étape 9) ; tests unitaires sur toutes les promotions de lancement.
4. Endpoints : `POST /v1/promotions/validate`, application automatique des promotions sans code (3e et 10e course), `GET /v1/me/credits`, `GET /v1/me/referral` (code, lien, statistiques), `POST /v1/me/referral/apply` (à l'inscription), attribution des crédits parrain et filleul après la première course terminée du filleul, parrainage chauffeur (50 $ de crédit de pack après 50 courses du filleul).
5. Favoris : `POST/DELETE /v1/me/favorites/{driverId}` (autorisé après une course notée 4 ou plus avec ce chauffeur), `GET /v1/me/favorites`, `GET /v1/driver/loyal-clients` ; prise en compte dans la répartition (déjà prévue à l'étape 6 : vérifier l'intégration) ; supplément de 300 cents dans le devis quand le favori est demandé et disponible, retiré automatiquement sinon avec message.
6. Garantie modèle : traitement de l'incident `vehicle_mismatch` : `POST /v1/admin/incidents/{id}/decide` (validé : remboursement intégral au client via l'étape 7, tarif normal maintenu au chauffeur si la faute n'est pas la sienne, sinon sanction proposée ; refusé : clôture motivée).
7. Tests d'intégration : activation, consommation, report, renouvellement, alerte, refus d'offres sans pack ; promotions de lancement sur des scénarios réels ; parrainage des deux côtés ; favori disponible et indisponible ; garantie validée et refusée.

## Contraintes
- Le chauffeur ne finance jamais une promotion.
- Un pack n'est jamais facturé d'avance ; la première facturation apparaît sur le premier relevé suivant l'activation.
- Les règles des packs et des promotions sont des données ; le code ne contient aucun montant.

## Critères d'acceptation
- Les tableaux de la section 5.7 et la liste de la section 5.9 sont intégralement couverts par des tests nommés d'après chaque règle.
- Un chauffeur sans pack et sans renouvellement ne reçoit aucune offre et voit le motif dans `status.update`.

## Vérifications à exécuter et à montrer
Sortie des tests, état d'un pack après consommation et report, exemple de devis avec promotion et crédit.

## Fin de l'étape
`/code-review`, corrections, `docs/decisions.md`, commit « Étape 8 : packs, promotions, parrainage, favoris et garantie modèle ».
