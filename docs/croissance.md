# Packs, promotions, crédits, parrainage, favoris et garantie modèle (étape 8)

Sections 5.2, 5.7, 5.9 et 5.10 du cahier des charges, prompt 08. Aucun montant ni seuil dans le code : les packs viennent de la table `packs`, les promotions de la table `promotions`, tout le reste de `settings` (modifiables dans My Hub).

## Packs de courses du chauffeur

| Moment | Ce qui se passe | Réglage ou donnée |
|---|---|---|
| Activation (`POST /v1/driver/packs/activate`) | Pack actif tout de suite, facturé au relevé suivant (`billing = to_bill`, ou `free`). Avec un pack en cours : changement programmé à l'épuisement (`nextPackCode`) | `packs` (prix, courses, validité) |
| Découverte | Offert aux 100 premiers chauffeurs inscrits et aux locataires R-LuxeEV (case de la fiche chauffeur dans My Hub), une seule fois par chauffeur, jamais renouvelé | `packs.discovery_free_first_drivers` |
| Fin de course | Une unité consommée (les courses reportées d'abord), une seule fois par course ; Illimité ne décompte rien | |
| Il reste 3 courses | Avis `pack.low` et alerte sur l'accueil de l'application | `packs.low_threshold` |
| Épuisement | Renouvellement immédiat (pack demandé en changement, sinon le même) si l'option est active ; sinon avis `pack.exhausted` | |
| Échéance (passe horaire) | Pack passé en `expired`, renouvelé si l'option est active (Illimité aussi), sinon avis `pack.expired` | |
| Nouveau pack dans les 7 jours après l'échéance | Courses non utilisées reportées une seule fois ; au-delà, perdues | `packs.rollover_window_days`, colonne `rollover_allowed` des packs |
| Sans pack utilisable ni renouvellement | Aucune offre ; motif `pack_required`, `pack_exhausted` ou `pack_expired` au passage en ligne | `drivers.require_active_pack` |

Exemple vérifié par `apps/api/test/growth-packs-promotions.e2e.test.ts` : Essentiel expiré avec 5 courses non utilisées, Pro activé une heure plus tard, l'application affiche 55 courses (50 du pack, 5 reportées) ; la ligne expirée garde `rolloverDone = true` et 0 course.

## Promotions

Règles en données (`promotions`) : type `percent`, `fixed`, `free_ride` ou `nth_ride`, remise plafonnée, conditions (`firstRideOnly`, `maxDistanceMeters`, `categories`, `zones`, `timeWindow`, `maxClients`, `autoApply`), limite globale, limite par client, budget, validité.

- **Au devis** : le code saisi s'il est admissible, sinon une promotion automatique (`autoApply`). Promotions de lancement : `BIENVENUE3` (troisième course offerte jusqu'à 10 km), `MERCI10` (dixième course offerte), `LANCEMENT30` (30 % plafonnés à 15 $, trois courses par client).
- **Refus** : motif stable (`budget_exhausted`, `client_limit`, `wrong_rank`, `distance`, `category`, …) dans `details.reason`, aussi donné par `POST /v1/promotions/validate`.
- **Création de la course** : usage et budget réservés ; rendus si le client annule, en cas d'absence ou si aucun chauffeur n'est trouvé.
- **Fin de course** : la remise promise est gardée (prix fixe garanti). Le chauffeur est compensé à 100 % (`promotion_uses.driver_compensation_cents`, porté au relevé à l'étape 9) : il ne finance jamais une promotion.

## Crédits et parrainage

- `GET /v1/me/credits` : crédits du compte. Le devis les déduit, la fin de course les consomme (le plus proche de son expiration d'abord). Validité : `credits.validity_days` (365).
- `GET /v1/me/referral` : code personnel, lien (`referral.link_base_url`), statistiques. `POST /v1/me/referral/apply` : code saisi par un nouveau client, dans les `referral.apply_window_days` (30) jours et avant sa première course.
- Client : 10 $ au parrain et 10 $ au filleul après la première course terminée du filleul (`referral.client_*`).
- Chauffeur : code donné à la candidature ; 50 $ de crédit de pack au parrain après 50 courses du filleul (`referral.driver_*`). Ce crédit (origine `driver_pack`) n'est jamais déduit d'une course ; il sera déduit des packs au relevé (étape 9).

## Favoris

`POST` et `DELETE /v1/me/favorites/{driverId}`, `GET /v1/me/favorites`. Ajout possible après une course terminée avec ce chauffeur notée au moins `favorites.min_rating` (4). Au devis : supplément de 3 $ (`pricing.favourite_driver_cents`, versé en entier au chauffeur) si le favori demandé est disponible ; sinon supplément retiré et option signalée dans `ignoredOptions`.

## Garantie modèle

`POST /v1/admin/incidents/{id}/guarantee` (administrateur, opérateur), fenêtre « Garantie modèle » des incidents dans My Hub.

- **Validée** : remboursement intégral de ce que le client a payé pour la course (carte, ou crédit si le client le préfère ou a payé le chauffeur). Chauffeur sans faute : tarif normal maintenu (`rides.driver_fare_protected`). Chauffeur en faute : sanction proposée par une note interne, jamais appliquée automatiquement.
- **Refusée** : clôture motivée, communiquée au client.

## Reste à faire

- Étape 9 : compensation des promotions, crédits de pack et tarifs protégés sur le relevé hebdomadaire.
- Étape 13 : envoi réel des avis (`pack.low`, `pack.renewed`, `pack.expired`, `pack.renewal_failed`) ; avis de parrainage.
- Écrans clients : saisie d'un code promo et d'un code de parrainage, « Mes chauffeurs » dans l'application client (les routes sont prêtes).
