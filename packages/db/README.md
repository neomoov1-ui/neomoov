# @neomoov/db

Schéma de la base PostgreSQL (PostGIS) avec Drizzle ORM, migrations, données de départ et connexion partagée par l'API et le worker. Référence : cahier des charges, section 4.

## Contenu

| Dossier | Rôle |
|---|---|
| `src/schema/` | Un fichier par groupe de tables : `identity`, `clients`, `drivers`, `pricing`, `rides`, `payments`, `billing`, `partners`, `agents` ; `enums.ts` (types PostgreSQL alignés sur `@neomoov/domain`) ; `_helpers.ts` (identifiants, horodatages, colonnes PostGIS) |
| `drizzle/` | Migrations SQL versionnées (`0000` schéma généré, `0001` PostGIS, déclencheurs, partitions, compteurs), `meta/` (journal et instantanés), `down/` (migrations inverses écrites à la main) |
| `src/seed/` | Données de départ idempotentes (`data.ts` : valeurs ; `index.ts` : insertion) |
| `src/pricing-rules.ts` | `buildPricingRules` : assemble les règles du moteur de tarification à partir des tables |
| `src/migrate.ts`, `rollback.ts`, `reset.ts` | Scripts `pnpm db:*` |
| `scripts/fix-migration.js` | Retire les guillemets que drizzle-kit place autour des types PostGIS |

## Commandes (depuis la racine du dépôt)

```
pnpm db:generate   # génère une migration à partir du schéma (hors ligne)
pnpm db:migrate    # applique les migrations à DATABASE_URL
pnpm db:rollback   # annule la dernière migration (drizzle/down)
pnpm db:reset      # vide la base (refusé si l'URL ne ressemble pas à une base de développement ou de test)
pnpm db:seed       # données de départ, relançable sans doublon
```

`DATABASE_URL` vient de `.env` à la racine (Supabase, « session pooler » en IPv4, extension PostGIS activée dans le projet). Pour les tests d'intégration : `TEST_DATABASE_URL`.

## Points d'attention

- Les montants sont des entiers en cents, les taux des entiers en ppm, les multiplicateurs des points de base. Aucun flottant monétaire.
- `driver_locations` est partitionnée par jour : le worker appelle `ensure_driver_locations_partition(date)` chaque nuit pour le lendemain et `purge_driver_locations(90)` pour la rétention.
- La position courante des chauffeurs en ligne est dans `driver_presence` (une ligne par chauffeur, index GiST) ; `drivers_within(lng, lat, rayon_m, catégorie)` renvoie les candidats triés par distance.
- Numéros sans trou : `next_invoice_number()`, `next_invoice_supplier_sequence(chauffeur)`, `next_ride_public_number(fuseau)`, `next_driver_public_number()` (table `counters`, transactionnelle).
- `audit_log` et `ride_events` sont en ajout seul (déclencheur).
- Les colonnes `geography` se lisent avec `ST_AsGeoJSON(colonne)` dans les requêtes ; le type `geoPoint` attend du GeoJSON en lecture.

## État au 22 septembre 2026

Schéma complet (65 tables, 37 énumérations, 103 index), migrations 0000 et 0001 avec inverses, données de départ, 11 tests hors ligne (dont l'exemple de contrôle 24,55 $ et 31,56 $ recalculé à partir des données de départ). **Les migrations n'ont pas encore été exécutées contre une vraie base** : à faire dès que `DATABASE_URL` (Supabase) est renseignée, avec `pnpm db:migrate && pnpm db:seed`, puis les tests d'intégration des dépôts (tâche 5 du prompt 02).
