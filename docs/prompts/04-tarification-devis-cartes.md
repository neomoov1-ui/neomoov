# Prompt 04. Étape 4 : moteur de tarification, devis, zones, cartes (J3)

---

Lis `CLAUDE.md`, puis `docs/cahier-des-charges-v1.md` sections 5.1, 5.9 (application des promotions au devis), 4.4, 7.2 (Lieux et devis), 2.2 et 11.1 (étape 4). Consulte `docs/decisions.md`.

## Objectif
Le moteur de tarification comme fonctions pures dans `packages/domain/pricing`, couvert à 100 %, et le service de devis de l'API qui l'utilise avec l'adaptateur cartographique Google (Routes, Geocoding, Places) et son implémentation simulée.

## Tâches
1. `packages/domain/pricing` : `computeQuote(input, rules)` qui renvoie le détail complet (lignes : tarif de base, distance, durée, minimum appliqué, suppléments nommés, options Flex et Priorité, chauffeur favori, forfait, promotion, crédits, frais de service, redevance, TPS, TVQ, total, montant chauffeur, prix maximal consenti avec marge d'attente et d'arrêts, plafond 20 $) ; arrondi au cent ligne par ligne ; règles chargées depuis les objets de la base (pas de constante) ; fonction `isNightTime`, `isPeakHours` (pour l'Offre Flex), `matchFlatRate(originZone, destinationZone)`, `applySurcharges`, `applyPromotion` ; tout en entiers de cents.
2. Tests unitaires : au moins 40 cas issus de la section 5.1 (dont l'exemple Neo Premium 8 km et 18 minutes qui doit donner exactement 24,55 $ de tarif et 31,56 $ affiché ; forfaits aéroport ; minimum ; nuit ; Flex hors pointe refusée en pointe ; Priorité ; favori ; promotion troisième course jusqu'à 10 km acceptée à 9,9 km et refusée à 10,1 km ; crédits ; arrondis). Couverture 100 %.
3. Adaptateur `MapsProvider` : `autocomplete(text, sessionToken, location)`, `placeDetails(id)`, `geocode(address)`, `computeRoute(origin, destination, waypoints, departureTime)` (distance, durée avec trafic, polyline), `computeEtaMatrix(origins, destinations)`. Implémentation Google (Routes API, Geocoding, Places nouvelle version) avec délais d'attente, nouvelles tentatives, disjoncteur ; implémentation simulée déterministe (distance à vol d'oiseau × 1,3, vitesse 30 km/h) utilisée en test et en mode dégradé.
4. Service de zones : `zoneOf(point)` avec PostGIS, cache mémoire des polygones.
5. Endpoints : `GET /v1/places/autocomplete`, `GET /v1/places/details`, `POST /v1/quotes` (origine, destination, arrêts, catégorie ou toutes les catégories, heure, options, code promo), `GET /v1/quotes/{id}` ; le devis est persisté avec son détail, une empreinte et une validité de 5 minutes ; réponse en moins de 800 ms au 95e centile avec l'adaptateur réel (mesure en test local avec l'adaptateur simulé, structure prête pour la mesure réelle).
6. Mode dégradé : si Routes échoue après nouvelles tentatives, devis calculé avec l'estimation interne et marqué `estimated: true` ; le client en est informé.
7. Simulation de devis pour My Hub : `POST /v1/admin/pricing/simulate`.

## Contraintes
- Aucune majoration dynamique liée à la demande : il n'existe aucun multiplicateur de pointe dans le code.
- Le client ne voit jamais un prix différent de celui calculé par l'API : le mobile et le web affichent le détail renvoyé, ils ne recalculent rien.
- Clé Google côté serveur uniquement ; les clés mobiles ne servent qu'à l'affichage des cartes.

## Critères d'acceptation
- 100 % de couverture sur `packages/domain/pricing`, tous les cas passent.
- `POST /v1/quotes` renvoie les trois catégories avec détail et temps d'arrivée estimé (temps d'arrivée provisoire à partir des chauffeurs en ligne, ou « selon disponibilité » si aucun).
- Tests d'intégration des endpoints, y compris le mode dégradé.

## Vérifications à exécuter et à montrer
Rapport de couverture, sortie du test de l'exemple 24,55 $ et 31,56 $, exemple de réponse JSON d'un devis, mesure de latence locale.

## Fin de l'étape
`/code-review`, corrections, `docs/decisions.md`, commit « Étape 4 : moteur de tarification, devis et cartes ».
