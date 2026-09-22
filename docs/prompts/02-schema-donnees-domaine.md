# Prompt 02. Étape 2 : schéma de données, migrations, données de départ, domaine partagé (J1 et J2)

---

Lis `CLAUDE.md`, puis `docs/cahier-des-charges-v1.md` sections 4 (en entier), 5.1, 5.7, 5.9 (pour les données de départ) et 11.1 (étape 2). Consulte `docs/decisions.md`.

## Objectif
Créer le modèle de données complet de la section 4 avec Drizzle ORM et PostGIS, les migrations, les données de départ, et le socle du domaine partagé (types, schémas Zod, énumérations, machines à états déclarées) dans `packages/domain`.

## Tâches
1. Dans `apps/api/src/db/schema/`, un fichier par groupe de tables (identité, clients, chauffeurs, tarification, courses, paiements, facturation, partenaires, agents). Toutes les tables de la section 4 avec leurs colonnes, types, index, clés étrangères, contraintes (`CHECK` sur les montants positifs, unicité du téléphone, numérotation séquentielle des factures par fournisseur via une séquence par chauffeur). Colonnes PostGIS `geography(Point, 4326)` pour les positions et `geography(Polygon, 4326)` pour les zones, avec index GiST. Partitionnement par jour de `driver_locations`. Tables en ajout seul (`audit_log`, `ride_events`) protégées par un déclencheur qui interdit `UPDATE` et `DELETE`.
2. Migrations drizzle-kit versionnées, avec migration inverse ; script `pnpm db:migrate`, `pnpm db:rollback`, `pnpm db:reset`. Activation de l'extension PostGIS dans la première migration.
3. Données de départ (`pnpm db:seed`, idempotentes) : ville Montréal ; zones (aire de service Grand Montréal, aéroport YUL, centre-ville, Vieux-Montréal, Plateau) en polygones approximatifs mais réalistes ; catégories Neo Premium, Neo Prestige, Neo XL (Neo Limo inactive) avec rangs et modèles admis (liste de la section 6.1 du document de référence : Tesla Model 3, Model Y, Model S, Model X, Hyundai Ioniq 5 et 6, Kia EV6 et EV9, Polestar 2, Mercedes EQE et EQS, BMW i5, Audi e-tron GT, Lucid Air, Volvo EX90) ; grille tarifaire de la section 5.1 ; suppléments ; forfaits aéroport ; packs (Découverte, Essentiel, Pro, Élite, Illimité) ; promotions de lancement ; paramètres (`settings`) : frais de service 200, redevance 90, TPS 5 %, TVQ 9,975 %, fenêtre d'annulation gratuite 120 s, frais d'annulation 500, non-présentation 700, attente gratuite 300 s, attente 50 par minute, rayons de recherche, durées d'offre, seuils de sanction, seuil de solde négatif 15000, délai d'impayé 7 jours ; utilisateurs de démonstration (un admin, un opérateur, trois chauffeurs avec véhicules et documents valides, cinq clients) ; agents (codes et modes).
4. `packages/domain` : énumérations (états de course, rôles, catégories, modes de paiement, types de documents), types des entités, schémas Zod des objets d'API (devis, course, offre, relevé, facture, pack), machine à états des courses déclarée comme table de transitions typée (états, événements, gardes nommées) et fonction `canTransition`, sans logique d'infrastructure. Tests unitaires de la machine à états (toutes les transitions valides et invalides de la section 5.2).
5. Fonctions d'accès aux données de base (dépôt par entité) dans l'API, avec tests d'intégration contre la base Docker : création, lecture, requêtes géographiques (chauffeurs dans un rayon, point dans une zone).

## Contraintes
- Les montants sont des entiers en cents ; les taux sont stockés en millièmes ou en nombres décimaux exacts (`numeric`), jamais en flottants.
- Pas de suppression physique sauf tables prévues par la section 5.15.
- Les seeds n'écrasent jamais des données réelles : ils vérifient l'existence par code.

## Critères d'acceptation
- `pnpm db:reset && pnpm db:migrate && pnpm db:seed` réussit deux fois de suite sans erreur ni doublon.
- `pnpm db:rollback` sur la dernière migration puis `pnpm db:migrate` réussit.
- Les tests de la machine à états et des dépôts passent ; une requête « chauffeurs à moins de 2 km d'un point » utilise l'index GiST (plan d'exécution montré).
- `packages/domain` compile sans dépendance d'exécution autre que Zod.

## Vérifications à exécuter et à montrer
Sortie des commandes de base, liste des tables créées (`\dt`), plan d'exécution de la requête géographique, sortie des tests.

## Fin de l'étape
`/code-review`, corrections, `docs/decisions.md` (choix de partitionnement, précision des géométries, format des montants), commit « Étape 2 : schéma de données, migrations, seeds et domaine partagé ».

## Adaptation du 22 septembre 2026 : ce qui est déjà fait

Les tâches 1 à 4 ont été réalisées en avance, hors ligne, avant la création de la base Supabase :
- Le schéma est dans **`packages/db/src/schema/`** (paquet partagé par l'API et le worker), pas dans `apps/api/src/db/`. Voir `packages/db/README.md` et `docs/decisions.md`.
- Migrations `drizzle/0000_schema-initial.sql` et `drizzle/0001_postgis-triggers-partitions.sql`, inverses dans `drizzle/down/`, scripts `pnpm db:generate|migrate|rollback|reset|seed` à la racine.
- Données de départ dans `packages/db/src/seed/`. Domaine partagé (énumérations, machine à états, schémas Zod) dans `packages/domain`, 197 tests.

**Reste à faire dans cette étape**, dès que `DATABASE_URL` est renseignée : exécuter `pnpm db:migrate && pnpm db:seed` deux fois de suite, `pnpm db:rollback` puis `pnpm db:migrate`, corriger ce que la vraie base révèle, puis la tâche 5 (dépôts par entité et tests d'intégration, requête « chauffeurs à moins de 2 km » avec plan d'exécution via `drivers_within`). Ne pas réécrire ce qui existe.
