# Prompt 06. Étape 6 : répartition et négociation encadrée (J4 et J5)

---

Lis `CLAUDE.md`, puis `docs/cahier-des-charges-v1.md` sections 5.4, 5.5, 5.2 (garantie modèle, réattribution), 7.2 (Négociation, Chauffeur : offres) et 11.1 (étape 6). Consulte `docs/decisions.md`.

## Objectif
La répartition automatique des courses immédiates et planifiées, le panneau opérateur côté API, et la négociation encadrée livrée complète mais désactivée par le drapeau `FEATURE_NEGOTIATION`.

## Tâches
1. `packages/domain/dispatch` : fonction pure `scoreCandidates(ride, candidates, context)` implémentant exactement la formule de la section 5.4 (poids en paramètres chargés depuis `settings`), `selectWave(scored, waveSize)`, `nextRadius(current)` ; tests unitaires avec cas de favori, d'Illimité sur course VIP, d'équité et de zone.
2. Service de répartition dans le worker, déclenché par `RideRequested` et `RideDriverCancelled` : recherche des candidats via l'index GEO Redis (rayons 2, 5, 10 km puis zone) avec filtres de la section 5.4 (statut, catégorie égale ou supérieure, documents, pack, solde, enchaînement à moins de 5 minutes), calcul des temps d'arrivée par matrice pour les dix meilleurs, score, offres séquentielles de 15 secondes (mode fixe) jusqu'à cinq candidats par vague, vagues de 20 secondes, passage en `no_driver` après épuisement de la zone avec annulation de l'autorisation de paiement (événement) et alerte opérateur.
3. Offres : table `ride_offers`, endpoints chauffeur `GET /v1/driver/offers`, `accept`, `decline`, `counter` (V1.1) ; événements socket `offer.new`, `offer.expired` ; verrou Redis pour éviter la double attribution ; acceptation atomique (première acceptation gagne, les autres reçoivent `offer.expired`).
4. Garantie modèle : filtrage strict des candidats par rang de catégorie ; endpoint `POST /v1/rides/{id}/report-vehicle-mismatch` créant un incident de type `vehicle_mismatch` (traitement à l'étape 8).
5. Réattribution : sur annulation chauffeur ou absence de mouvement 3 minutes après `assigned` (tâche de surveillance), nouvelle vague avec exclusion du chauffeur et priorité.
6. Planifiées : attribution 60 minutes avant aux chauffeurs ayant activé les courses planifiées, favori en priorité, confirmation obligatoire, réattribution à 30 minutes.
7. Panneau opérateur côté API : `POST /v1/admin/rides/{id}/reassign`, `hold`, `release`, `assign` (existant), création de course (existant) ; événements admin.
8. Négociation encadrée (derrière `FEATURE_NEGOTIATION`) : `POST /v1/rides/{id}/proposals` (P' borné entre 85 % et 100 % de P, arrondi au dollar), diffusion simultanée aux cinq meilleurs candidats avec P' et P, fenêtre de 60 secondes, `counter` une seule fois par chauffeur entre P' et P, `GET /v1/rides/{id}/offers` et `POST /v1/rides/{id}/offers/{offerId}/accept` côté client, repli automatique au mode fixe au prix P à la fin de la fenêtre ; exclusions (planifiées, comptes entreprises, forfaits, Neo Limo) ; affectation aléatoire 50/50 des clients éligibles pour le test comparatif, journalisée.
9. Tests : unitaires du score ; intégration des vagues avec horloge simulée (expiration à 15 s, passage au suivant, no_driver) ; double acceptation ; réattribution ; planifiées ; négociation activée en test (proposition, contre-proposition, acceptation, repli, invariant prix final ≤ P vérifié par une assertion de propriété sur 1 000 cas aléatoires).

## Contraintes
- Le prix final ne dépasse jamais le prix maximal consenti : cette règle est un invariant vérifié à l'écriture en base (contrainte `CHECK`) et par test.
- Aucune information de la négociation n'est visible dans les réponses quand le drapeau est désactivé.
- Le score et les rayons sont paramétrés en base.

## Critères d'acceptation
- Première offre émise en moins de 3 secondes après `RideRequested` avec 200 chauffeurs en ligne (test local).
- Tous les scénarios de la section 5.4 et 5.5 couverts par des tests d'intégration.
- Drapeau désactivé : comportement identique à l'étape 5 plus la répartition automatique.

## Vérifications à exécuter et à montrer
Sortie des tests, chronologie d'une attribution avec horodatages, résultat du test de propriété sur l'invariant.

## Fin de l'étape
`/code-review`, corrections, `docs/decisions.md`, commit « Étape 6 : répartition automatique et négociation encadrée sous drapeau ».
