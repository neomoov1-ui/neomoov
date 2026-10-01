# Étape 20 : isolation des données par organisation

Source : amendement v1.2, section 4, et critères de l'étape 20. Ce document ne décrit que le socle technique.

## Objectif

Qu'une organisation cliente ne puisse jamais lire ni écrire les données d'une autre, par deux barrières : les contrôles de l'API et la sécurité au niveau des lignes de PostgreSQL. La plateforme (organisation racine) garde sa vue d'ensemble.

## Choix

- **Contexte par transaction, jamais par connexion** : `set_config('app.scope_path', <chemin>, true)` au début d'une transaction ouverte pour la requête d'un membre d'une organisation cliente. Compatible avec le regroupement de connexions (le réglage meurt avec la transaction).
- **Politique par défaut ouverte pour la plateforme** : sans contexte (`current_setting('app.scope_path', true)` nul ou vide), la politique laisse tout passer. Les chemins de code existants (personnel de la plateforme, tâches en arrière-plan, agents) restent inchangés et sans coût ; les routes des organisations clientes posent toujours un contexte. `FORCE ROW LEVEL SECURITY` pour que le propriétaire des tables y soit soumis.
- **Politique** : ligne visible si `organization_id` désigne une organisation dont le chemin commence par le chemin du contexte (index sur `organizations.path` en `text_pattern_ops`). Une ligne sans organisation appartient à la plateforme : invisible dans un contexte client.
- **Barrière de l'API** : `OrgScopeService.run(orgPath, fn)` ouvre la transaction et pose le contexte ; les services des routes « organisation » reçoivent l'exécuteur de cette transaction ; garde qui résout l'organisation courante (paramètre de route ou en-tête `X-Organization-Id`) et vérifie l'adhésion et sa portée (`inScope`).

## Données (migration 0021)

- `organization_id` ajouté (nullable, rempli avec la racine pour l'existant) sur : `clients`, `quotes`, `payments`, `refunds`, `invoices`, `driver_documents`, `ride_messages`, `ride_events`, `notifications`, `conversations`, `incidents`, `sanctions`, `credits`, `leads`. Déjà présent : `drivers`, `vehicles`, `rides`, `weekly_statements`, `settings`.
- Politiques `org_isolation` sur ces tables ; fonction `app_scope_allows(uuid)` (SQL, stable) pour ne pas répéter la sous-requête.

## Critères d'acceptation

1. Suite d'isolation : pour chaque table métier et chaque route « organisation », deux organisations de test, zéro accès croisé (lecture et écriture).
2. Sans contexte, requêtes et plans inchangés : suite complète verte, durée à 5 % près.
3. Tâches en arrière-plan d'une organisation cliente (relevés, rappels) : contexte posé par la tâche.
