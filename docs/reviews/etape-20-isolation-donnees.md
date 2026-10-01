# Étape 20 : isolation des données, partie données (tables, tâches de fond, couverture)

Revue de fin d'étape, 1er octobre 2026 (travail du 30 septembre). Branche `etape-20c-tables-jobs` (agent B), à partir du socle `etape-20-isolation` (migration 0021). Plan : `docs/prompts/20-isolation-organisations.md`, mission `neomoov-outils/agents/B-etape-20c-tables-jobs.md`. Documentation : `docs/isolation.md`. La barrière de l'API (gardes, routes `/v1/org/...`) est l'objet de `etape-20-isolation-api.md` (agent A).

## Critères d'acceptation

| Critère | Résultat |
|---|---|
| 1. Suite d'isolation : pour chaque table métier, deux organisations de test, zéro accès croisé (lecture et écriture) | Oui : `isolation-tables.e2e` (deux organisations sœurs A et B sous la racine, une sous-organisation A1, jeu de données complet par organisation). Pour les 52 tables des familles colonne directe (15), par course (14), par chauffeur (11, dont `compliance_checks`), par client et par personne (7, dont `users`, `devices`, `consents`) et par ligne parente (5) : sous le contexte de A, lecture limitée à A, modification d'une ligne de B sans effet (0 ligne), création d'une ligne rattachée à B refusée (`row-level security`) ; hors contexte, la plateforme voit A et B. Puis `organizations`, `roles`, `role_permissions`, `settings` (56 tables en tout) : sous-arbre (A voit A1, A1 ne voit que lui), sous-organisation créée seulement sous A, rôles système et de A seulement, réglages globaux et de A. Catalogue partagé échantillonné (4 tables lisibles, écriture refusée), tables réservées à la plateforme à zéro ligne (11 échantillonnées, dont `counters`). Les deux tables de l'agent C (`brands`, `organization_domains`) sont couvertes par le test de couverture, pas par cette suite |
| 2. Sans contexte, requêtes et plans inchangés | Les politiques ne s'appliquent qu'au rôle restreint ; le rôle de l'API (`postgres`, `BYPASSRLS` sur Supabase) n'y est pas soumis. Ajouts hors contexte : les défauts et déclencheurs de 0022 (quelques lectures par clé primaire à l'insertion d'une ligne sans organisation) et une lecture des organisations clientes par passe de tâche de fond. La mesure de la durée de la suite complète revient à la session principale (fusion) |
| 3. Tâches en arrière-plan d'une organisation cliente : contexte posé par la tâche | Oui : relevés, planifiées, conformité, envoi des avis et facturation par lots (`runGrouped`, `runForOrganization`) ; `isolation-jobs.e2e` vérifie qu'une passe sous le contexte de A ne touche que A, qu'une passe sans contexte traite tout, que les lignes créées portent l'organisation, que le journal d'audit et les PDF suivent |
| Couverture durable : toute table future sans politique fait échouer un test | Oui : `isolation-coverage.e2e` lit `pg_class`, `pg_policies` et `information_schema.role_table_grants` ; `PLATFORM_ONLY_TABLES` (21 tables, une raison chacune) ; la liste ne doit pas vieillir |
| `organization_id` posé à la création des avis, conversations, incidents, crédits (et prospects) | Oui, par les services (`organizationIdFor`) et par la base (défaut sous contexte, déclencheurs hors contexte) ; un test par table, sous contexte et par la plateforme pour une course de A |

## Tests lancés (base de développement, sous le verrou `agent-b`)

| Commande (`pnpm exec vitest run --no-file-parallelism ...`) | Résultat |
|---|---|
| `test/isolation.e2e.test.ts` (socle, avant tout changement) | 3 tests verts, 41 s |
| `test/isolation.e2e.test.ts test/isolation-coverage.e2e.test.ts test/isolation-tables.e2e.test.ts` (après 0022 et 0023) | 3 fichiers, 14 tests verts, 766 s |
| `test/isolation-jobs.e2e.test.ts` | 9 tests verts, 180 s |
| Non-régression des suites touchées : `settlement`, `notifications`, `scheduled`, `invoicing`, `compliance`, `queue-resilience` | Voir le rapport de l'agent (passe lancée après la rédaction de cette note) |
| `pnpm --filter @neomoov/api typecheck`, `pnpm --filter @neomoov/db typecheck`, `pnpm exec turbo run typecheck --filter=@neomoov/worker` | Verts |

Aucune route n'a changé : l'OpenAPI n'est pas régénérée.

## Migrations

- **0023_isolation-corrections** (appliquée sur la base de développement) : fonction `app_scope_organization_id()` et défaut sur les onze colonnes `organization_id` des tables de données ; `next_counter(text)` et `ensure_driver_locations_partition(date)` en `SECURITY DEFINER` ; `app_scope_allows_user(uuid)` ; politiques `compliance_checks` (toutes opérations, par chauffeur ou véhicule), `devices` (toutes opérations, par personne), `consents` (lecture, par personne), `org_insert` sur `organizations` ; déclencheurs `*_org_fill` sur `incidents`, `conversations`, `notifications`, `credits`, `weekly_statements`, `vehicles`, `quotes` ; reprise des relevés, véhicules, crédits, devis et avis existants. Fichier inverse dans `drizzle/down/`.
- **0024_isolation-recipients** (appliquée) : `platform_staff_user_ids(text[])` et `notification_recipient(uuid)` en `SECURITY DEFINER`. Fichier inverse.
- La première application de 0022 a été ignorée par le migrateur (la migration de l'agent C, `brands` et `organization_domains`, était passée avant avec un `when` plus récent) : `when` de l'entrée 0022 remonté à l'heure courante, puis appliquée. Numérotation à revoir à la fusion par la session principale.

## Points vérifiés à la relecture

- Les trois vérifications par table se font dans une seule transaction restreinte, le refus de création dans un point de sauvegarde (la transaction continue) ; les lignes de B sont visées par leur identifiant, l'absence d'effet est prouvée par `RETURNING`.
- Un contexte imbriqué d'une autre organisation n'ouvre jamais un point de sauvegarde : `SET LOCAL` survit à la libération d'un point de sauvegarde et aurait changé la portée de la transaction englobante (vérifié par le test « contexte imbriqué »). Même organisation : point de sauvegarde.
- Le travail asynchrone qui survit à un contexte (événements de domaine, file en mémoire, journal d'audit différé) ne réutilise jamais un exécuteur mort : contexte englobant ouvert, sinon pool ; l'organisation reste disponible pour l'étiquetage.
- Relevés : un chauffeur d'une organisation cliente qui a servi une course de la plateforme dans la fenêtre est écarté des lots d'organisation et réglé par la plateforme, avec toutes ses courses (`driversWithForeignRides`) ; sinon le lot de son organisation aurait émis un relevé incomplet, immuable.
- Alertes au personnel parties d'un contexte client : personnel lu par `platform_staff_user_ids`, avis créés dans le contexte (au nom de l'organisation concernée), envoi possible sous ce contexte grâce à `notification_recipient` (texto reçu dans le test).
- Client Stripe d'une personne : gardé hors contexte (`withoutOrgScope`), sinon `users` (lecture seule sous contexte) perdrait la référence et Stripe recevrait un client par appel.
- Les déclencheurs de dérivation tournent sous le rôle restreint avec les politiques : sous contexte, le défaut a déjà posé l'organisation ; hors contexte, la plateforme voit tout.
- Partitions de `driver_locations` : les politiques du parent s'appliquent (insertion pour B refusée par le parent) ; le test de couverture exclut les partitions (`relispartition`).
- `spatial_ref_sys` (PostGIS, propriété de `supabase_admin`) et le schéma `drizzle` sont hors du périmètre du rôle restreint (vérifié).
- Les réglages lus par `SettingsService` sont tous `global` sans organisation : le cache partagé reste juste sous contexte.
- Aucune permission ni route n'a changé ; les fichiers de l'agent A (`guards.ts`, `actor.ts`, `access.service.ts`, `organizations.controller.ts`) n'ont pas été touchés.

## Reste à faire

- **À faire trancher par le fondateur** : à qui appartient une course. Aujourd'hui toute course créée par la plateforme porte la racine, même si son client ou son chauffeur appartient à une organisation cliente ; sous contexte, la course appartient à l'organisation du contexte. Quand une organisation aura ses propres clients ou chauffeurs sans passer par ses routes (application unique, réseau Neomoov), il faudra décider si la course suit le client (réservation), le chauffeur (exécution) ou le canal.
- Références entre organisations : une politique vérifie la ligne, pas les lignes qu'elle désigne (un crédit de A pour une personne de B passe la base). La barrière de l'API (agent A, puis étapes 21 à 23) doit vérifier les cibles.
- `users` et `user_roles` sont en lecture (ou réservés) sous contexte : une organisation ne peut pas encore créer un compte ni le rôle `driver` d'un chauffeur depuis ses routes (étape 23, invitations de chauffeurs) ; `staff_notes`, `data_requests`, `api_keys`, `referrals` restent à la plateforme tant que les permissions correspondantes ne sont pas ouvertes aux organisations.
- Tâches non regroupées (plateforme) : paiements, registres et exports, packs, agents, conservation, confidentialité. À regrouper quand une organisation cliente aura son propre compte Stripe Connect (étape 23) ou ses propres agents.
- Caches et files : présence Redis, limites, canal des événements, identifiants BullMQ et caches restent sans préfixe d'organisation (aucune fuite possible, mais pas de cloisonnement) ; à préfixer avec la répartition par réseau isolé.
- Les fichiers déjà stockés gardent leurs clés ; seul le nouveau stockage sous contexte est préfixé.
- Mesure de la durée de la suite complète avant et après l'étape (critère 2, à 5 % près) : session principale.
- Snapshots Drizzle : 0022 a été générée par `drizzle-kit` (snapshot à jour), 0023 est une migration personnalisée ; à renuméroter avec celles des autres agents à la fusion.

## Pièges rencontrés

- Le migrateur n'applique que les entrées dont `when` dépasse la dernière migration appliquée : une migration d'un autre agent passée avant fait ignorer la sienne sans message ; remonter `when` et relancer (COMMUN).
- Une coupure réseau pendant `db:migrate` échoue proprement (`ENOTFOUND`), rien n'est appliqué (transaction) ; relancer.
- Sous le rôle restreint, une table sans politique ne donne pas d'erreur en lecture (0 ligne) mais refuse toute écriture : un service qui lit `user_roles`, `devices` ou `counters` sous contexte se trompe en silence. D'où les fonctions `SECURITY DEFINER` et les politiques ajoutées.
- `withoutOrgScope` dans une transaction restreinte prend une seconde connexion du pool (15 au plus sur le pooler de développement) : à réserver aux cas rares ; préférer une fonction `SECURITY DEFINER`.
- Un `SET LOCAL` posé dans un point de sauvegarde survit à sa libération : jamais de point de sauvegarde pour changer d'organisation.
- Les heredocs Bash avec `$$` ou apostrophes échouent sur ce poste : écrire les fichiers par l'outil d'écriture ; `node -e` interdit (accents graves).
- Les copies de travail n'ont pas de `dist` : construire `@neomoov/domain` et `@neomoov/db` avant toute suite d'API (sinon « Failed to resolve entry for package @neomoov/db »).
- Les dates des jeux de données des suites doivent rester loin de celles des autres fichiers (`settlement.e2e` règle juin 2026) : la passe du vendredi génère les relevés de tous les chauffeurs candidats de la base.
- Deux coupures de session (limite d'utilisation) et une coupure réseau pendant la mission : commits « En cours » fréquents et relance des passes.
