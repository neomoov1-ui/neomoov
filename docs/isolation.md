# Isolation des données par organisation

Étape 20 (amendement v1.2, section 4). Une organisation cliente (compagnie, flotte, entreprise) ne lit ni n'écrit jamais les données d'une autre ; la plateforme (organisation racine `neomoov`) garde sa vue d'ensemble. Deux barrières : les contrôles de l'API (gardes et routes `/v1/org/...`, voir `docs/reviews/etape-20-isolation-api.md`) et la sécurité au niveau des lignes de PostgreSQL, décrite ici.

Migrations : `0021_organization-isolation` (socle : rôle, fonction, politiques), `0023_isolation-corrections` (défauts d'organisation, politiques manquantes, déclencheurs de dérivation, numérotation sous rôle restreint), `0024_isolation-recipients` (lectures de la plateforme nécessaires sous contexte).

## Principe

- **Rôle restreint `neomoov_scoped`** (`NOLOGIN NOBYPASSRLS`) : le rôle de l'API peut le prendre (`SET LOCAL ROLE`), sans en hériter les droits. Toutes les tables du schéma `public` lui donnent `SELECT, INSERT, UPDATE, DELETE` et ont la sécurité au niveau des lignes activée ; ce sont les politiques qui décident.
- **Contexte par transaction, jamais par connexion** : `OrgScopeService.run(chemin, fn)` ouvre une transaction, prend le rôle restreint et fixe `app.scope_path` (`set_config(..., true)`). Le réglage et le rôle meurent avec la transaction : compatible avec le regroupement de connexions de Supabase.
- **Propagation** : pendant `fn`, `database.db` de tous les services désigne cette transaction (`AsyncLocalStorage`, `apps/api/src/common/org-scope.context.ts`). Aucun service n'a à changer de code pour être filtré.
- **Hors contexte, rien ne change** : le pool de l'API (propriétaire des tables, `BYPASSRLS` sur Supabase) n'est pas soumis aux politiques. Le personnel de la plateforme, les tâches globales et les agents gardent leurs requêtes et leurs plans.
- **Une ligne sans organisation appartient à la plateforme** : `app_scope_allows(NULL)` vaut la racine, invisible dans un contexte client.

### Fonctions

| Fonction | Rôle |
|---|---|
| `app_scope_allows(org)` | Vrai si un contexte est posé et si l'organisation (la racine si `NULL`) est dans le sous-arbre du contexte (`path LIKE scope || '%'`, index `organizations_path_prefix_idx` en `text_pattern_ops`) |
| `app_scope_organization_id()` | Organisation du contexte (dernier segment de `app.scope_path`), `NULL` hors contexte ; défaut des colonnes `organization_id` des tables de données (0022) |
| `app_scope_allows_user(user)` | La personne est membre, chauffeur ou client d'une organisation du contexte (comptes, appareils, consentements) |
| `next_counter`, `ensure_driver_locations_partition` | `SECURITY DEFINER` (0022) : numérotation des courses, factures et chauffeurs, et partitions quotidiennes des positions, aussi sous contexte (la table `counters` reste à la plateforme) |
| `platform_staff_user_ids(rôles)` | `SECURITY DEFINER` (0023) : personnel d'exploitation destinataire des alertes, lisible sous contexte sans ouvrir `user_roles` |
| `notification_recipient(avis)` | `SECURITY DEFINER` (0023) : langue, téléphone, courriel et jetons push du destinataire d'un avis, pour un avis visible dans le contexte courant seulement |

### Contextes imbriqués et travail qui survit

- Même organisation déjà ouverte : point de sauvegarde dans la transaction en cours.
- Autre organisation : transaction à part (une seconde connexion du pool), jamais un point de sauvegarde : son `SET LOCAL` survivrait à la libération du point de sauvegarde et changerait la portée de la transaction englobante.
- Le travail asynchrone lancé pendant un contexte et qui lui survit (abonnés aux événements de domaine, file en mémoire, écriture différée du journal d'audit) ne réutilise jamais une transaction terminée : il retombe sur le contexte englobant encore ouvert, sinon sur le pool de la plateforme, en gardant l'organisation pour étiqueter ce qu'il écrit (`currentOrgScope()`).
- `withoutOrgScope(fn)` sort du contexte (pool de la plateforme) : réservé aux cas rares, car chaque appel sous contexte prend une seconde connexion.
- Étape 23 : un événement de domaine émis sous une transaction restreinte encore ouverte part après sa validation (`afterOrgScopeCommit`, suites gardées sur le contexte, remontées au parent à la libération d'un point de sauvegarde, abandonnées sur annulation) ; ses abonnés travaillent par le pool, l'organisation gardée. Le même mécanisme sert à un envoi (texto) qui ne doit partir que si la transaction est validée.

## Familles de politiques

| Famille | Tables | Règle |
|---|---|---|
| Colonne directe | `drivers`, `vehicles`, `rides`, `clients`, `quotes`, `weekly_statements`, `memberships`, `invitations`, `organization_features`, `audit_log`, `conversations`, `notifications`, `incidents`, `credits`, `leads`, `brands`, `organization_domains` | `app_scope_allows(organization_id)` en lecture et en écriture |
| Par course | `ride_events`, `ride_messages`, `ride_ratings`, `ride_offers`, `ride_dispatches`, `ride_tracks`, `invoices`, `payments`, `scheduled_assignments`, `pack_consumptions`, `credit_uses`, `redevance_ledger`, `promotion_uses`, `tax_ledger` | Organisation de la course |
| Par chauffeur | `driver_documents`, `driver_locations` (partitionnée), `driver_presence`, `driver_scores`, `driver_shifts`, `driver_training_results`, `driver_balances`, `pack_purchases`, `sanctions`, `sanction_appeals` | Organisation du chauffeur |
| Par chauffeur ou véhicule | `compliance_checks` (0022) | Organisation du chauffeur ou du véhicule de l'échéance |
| Par client | `client_payment_methods`, `favorite_drivers`, `client_driver_links`, `saved_places` | Organisation du profil client |
| Par paiement, relevé, conversation, véhicule, facture | `refunds`, `statement_lines`, `conversation_messages`, `vehicle_financings`, `sev_transmissions` | Organisation de la ligne parente |
| Par personne | `users` (lecture), `devices` (0022), `consents` (lecture, 0022) | `app_scope_allows_user` |
| Organisations | `organizations` | Lecture et modification dans le sous-arbre ; création d'une sous-organisation sous le sous-arbre seulement, jamais d'une racine (0022) |
| Rôles et réglages | `roles`, `role_permissions`, `settings` | Rôles système et réglages de la plateforme en lecture ; rôles et réglages de l'organisation en écriture |
| Catalogue partagé (lecture seule) | `cities`, `zones`, `vehicle_categories`, `pricing_rules`, `surcharges`, `flat_rates`, `packs`, `promotions`, `permissions`, `plans`, `feature_flags` | Lisible par toute organisation, jamais modifiable sous contexte |
| Module Flotte (0024, étape 23) | `revenue_share_rules`, `organization_statements` (colonne directe) ; `vehicle_maintenance` (par véhicule, organisation dérivée du véhicule hors contexte) | Mêmes règles que les familles ci-dessus ; voir `docs/fleet.md` |
| Neomoov Booster (0032 provisoire, agent G) | `vehicle_inspections`, `performance_logs`, `driver_alert_settings` (par chauffeur ; `organization_id` des rapports dérivé du chauffeur hors contexte par `org_fill_from_driver`) | Mêmes règles que la famille « par chauffeur » ; voir `docs/booster.md` |

## Tables réservées à la plateforme

Aucune ligne visible sous contexte (sécurité activée, aucune politique pour le rôle restreint). La liste fait foi dans `apps/api/src/modules/organizations/isolation-catalog.ts` (`PLATFORM_ONLY_TABLES`, une raison par table) :

| Table | Pourquoi |
|---|---|
| `agent_prompts`, `agents`, `agent_runs`, `approvals` | Agents IA de la plateforme, coûts et file d'approbation du personnel ; ce qu'un agent crée (incident, conversation, avis) porte l'organisation |
| `api_keys` | Comptes de service de la plateforme |
| `business_accounts`, `business_members`, `partners`, `investors` | Structures de la V1 antérieures aux organisations, à rattacher quand ces modules seront repris |
| `competitor_benchmarks` | Relevés concurrentiels de la tarification de la plateforme (D33) |
| `counters` | Compteurs de numérotation, atteints par les fonctions `next_*` (`SECURITY DEFINER`) |
| `data_requests`, `retention_jobs`, `geolocation_exports` | Loi 25 et registres réglementaires tenus par la plateforme |
| `otp_codes`, `sessions`, `staff_credentials` | Authentification |
| `referrals` | Programme de parrainage de la plateforme (les crédits accordés portent l'organisation) |
| `staff_notes` | Notes internes du personnel de la plateforme |
| `user_roles` | Anciens rôles et personnel de la plateforme (lu sous contexte par `platform_staff_user_ids`) |
| `crm_records` | Correspondance avec le CRM de la plateforme (HubSpot, étape 25) |
| `webhook_events` | File technique des événements des fournisseurs |

## Organisation des lignes créées

`organizationIdFor(repli)` (contexte d'abord, puis l'organisation que le service connaît, puis la plateforme) est appliqué par les services qui créent des avis (`NotificationsOutbox`), des conversations, des incidents (chauffeur, personnel, paiements), des crédits (octroi, remboursement en crédit), des relevés (organisation du chauffeur) et des courses. La base fait la même dérivation pour toute insertion qui ne la donne pas :

- **Défaut** `app_scope_organization_id()` sur `clients`, `drivers`, `vehicles`, `quotes`, `rides`, `credits`, `weekly_statements`, `incidents`, `conversations`, `notifications`, `leads` : sous contexte, la ligne appartient à l'organisation du contexte.
- **Déclencheurs `*_org_fill`** (hors contexte, colonne vide) : incident et conversation depuis la course (sinon le profil client), avis depuis la course, le relevé ou la facture désignés dans `data`, crédit depuis le profil chauffeur ou client de la personne, relevé et véhicule depuis le chauffeur, devis depuis le client.
- Sous contexte, une ligne rattachée à une autre organisation est refusée par `WITH CHECK` ; l'organisation proposée par l'appelant ne l'emporte jamais sur le contexte.

## Tâches de fond

`OrgScopeService.runGrouped(organisations, fn)` exécute `fn` une fois par organisation cliente, dans une transaction sous son contexte (elle ne voit et n'écrit que ses lignes, créées à son nom), puis une fois sans contexte pour la plateforme, qui traite tout ce qui reste comme avant (y compris le travail d'un lot en échec). `runForOrganization(organisation, fn)` fait de même pour un élément.

| Tâche | Regroupement |
|---|---|
| Relevés hebdomadaires (`SettlementJobsService.tick`) | Un lot par organisation qui a des chauffeurs. Un chauffeur d'une organisation cliente qui a aussi une course réglable d'une autre organisation (dont la plateforme) est écarté des lots (`driversWithForeignRides`) : son relevé, qui doit couvrir des courses invisibles de son organisation, est fait par la plateforme, complet. Le PDF est produit sous le contexte de l'organisation du relevé |
| Courses planifiées (`ScheduledService.tick`) | Un lot par organisation qui a une course dans la fenêtre des rappels |
| Conformité (`ComplianceJobsService`) | Un lot par organisation qui a des chauffeurs |
| Envoi des avis (`NotificationJobsService`) | Un avis à la fois, sous le contexte de son organisation (transaction courte : un texto envoyé n'est jamais annulé par l'échec d'un autre envoi) |
| Facturation (`InvoiceJobsService`) | Chaque tâche (facture, note de crédit, transmission, PDF) sous le contexte de l'organisation de la course ; la reprise périodique par lots d'organisations clientes en service |
| Paiements, registres, packs, agents, conservation, confidentialité | Inchangées (plateforme) : elles traitent des événements de la plateforme ou des données réservées à la plateforme. À regrouper quand une organisation cliente aura ses propres paiements (Stripe Connect de l'organisation, étape 23) |

## Fichiers, caches et files

- **Stockage** : sous le contexte d'une organisation cliente, les documents des chauffeurs, les PDF des relevés et des factures sont rangés sous `org/<identifiant>/` (`storageKeyPrefix`) ; les fichiers de la plateforme gardent leurs clés. Les fichiers existants ne sont pas déplacés (leur clé est en base).
- **Restent globaux** (aucune donnée d'une organisation n'y est lisible par une autre, mais les clés ne sont pas préfixées) : la présence des chauffeurs dans Redis (`presence:geo`), les limites de requêtes (`RateLimitService`), le canal des événements de domaine (`neomoov:events`), les identifiants des tâches BullMQ (des identifiants de lignes, uniques), le cache des réglages (seulement les réglages `global`, sans organisation), le cache des droits (par utilisateur, agent A). À préfixer quand une organisation aura sa propre répartition (réseau isolé) ou ses propres réglages.

## Ajouter une table

1. Dans la migration qui la crée : `GRANT SELECT, INSERT, UPDATE, DELETE ON <table> TO neomoov_scoped` et `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY`.
2. Une politique `org_isolation` de la bonne famille (colonne directe : `USING (app_scope_allows(organization_id)) WITH CHECK (app_scope_allows(organization_id))` ; sinon par la ligne parente). Pour une colonne `organization_id`, le défaut `app_scope_organization_id()` et, si la ligne a un parent connu, un déclencheur de dérivation.
3. Ou, si la table n'a aucune donnée d'organisation : l'ajouter à `PLATFORM_ONLY_TABLES` avec sa raison.
4. Lancer `test/isolation-coverage.e2e.test.ts` (il échoue sur toute table non protégée et non listée) et ajouter un cas à `test/isolation-tables.e2e.test.ts`.

## Tests

- `test/isolation.e2e.test.ts` (socle) : lecture, écriture, portée d'un membre.
- `test/isolation-tables.e2e.test.ts` : deux organisations sœurs (et une sous-organisation), chaque table à politique : lecture limitée à A, modification d'une ligne de B sans effet, création d'une ligne rattachée à B refusée, vue complète de la plateforme ; tables partagées et réservées à la plateforme.
- `test/isolation-coverage.e2e.test.ts` : catalogue PostgreSQL (sécurité activée, droits, politique ou liste, liste à jour, fonctions et défauts en place).
- `test/isolation-jobs.e2e.test.ts` : organisation des lignes créées (sous contexte et par la plateforme), contextes imbriqués, passes des relevés, des planifiées, de la conformité, de l'envoi des avis et de la facturation.

## Limites connues

- **Références entre organisations** : une politique par colonne vérifie la ligne, pas les lignes qu'elle désigne (un crédit de A pour une personne de B est admis par la base). La barrière de l'API doit vérifier les cibles. Une course de A dont le profil client ou le chauffeur appartient à une autre organisation est servie par la plateforme pour ce qui est invisible du contexte (profil par organisation : à venir avec « identité unique, profil par organisation »).
- **Lots longs** : un lot d'organisation est une transaction ; pour une grande flotte, la passe des relevés y fait aussi les versements Stripe (clés d'idempotence par relevé, donc sans doublon si le lot est rejoué par la plateforme). Passer à une transaction par chauffeur si les lots grossissent.
- **Contexte imbriqué d'une autre organisation** : une seconde connexion du pool ; à éviter dans une boucle (un pool saturé de transactions qui en attendent une seconde se bloquerait).
- **`FORCE ROW LEVEL SECURITY`** n'est pas posé : le propriétaire des tables (rôle de l'API) n'est pas soumis aux politiques, par choix (critère 2 : plans inchangés hors contexte). La barrière est le passage au rôle restreint.
- **Coût hors contexte** : les déclencheurs de dérivation font au plus quelques lectures par clé primaire à l'insertion d'une ligne sans organisation ; les politiques ne s'appliquent qu'au rôle restreint.
