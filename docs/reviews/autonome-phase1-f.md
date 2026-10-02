# Revue : phase 1 « entreprise autonome », agent F (direction commerciale automatisée)

2 octobre 2026. Branche `autonome-f-ventes` (copie `neomoov-wt22`, depuis `main` 7415616). Migration provisoire **0032_sales**, appliquée sur la base de développement sous le verrou `autonome-f` (`when` remis à l'heure courante, 1790970839389, après qu'une migration d'un autre agent soit passée avant ; à renuméroter à la fusion).

## Critères et résultat

| Livrable (prompt `N-autonome-f-ventes.md`) | Résultat |
|---|---|
| 1. Données : `prospects`, `prospect_touches`, `followups`, `outbound_calls` | Fait (schéma `packages/db/src/schema/sales.ts`, migration et inverse `down/0032_sales.sql`) ; tables réservées à la plateforme (droits du rôle restreint, sécurité des lignes activée sans politique, `PLATFORM_ONLY_TABLES`, `docs/isolation.md`) ; entité `prospect` ajoutée à `crm_records` |
| 2. Agent `b2b_prospecting` | Fait : seed (mode approbation, `claude-opus-5-5`, outils déclarés), prompt `docs/agents/b2b-prospecting.v1.md`, passe du lundi au vendredi dès 9 h (`sales.prospecting_days`, `sales.prospecting_hour`), sources `sales.sources` (Google Places par `PlacesProvider` réel ou simulé ; CSV importés ; demandes entreprise et partenaire de `leads`), plafond `sales.daily_new_prospects` (20), qualification structurée, HubSpot par `CrmSyncService` (file `crm`), séquences approuvées `docs/sales/sequences.md` par la file des notifications, jamais de particulier, retrait respecté |
| 3. Agent `outbound_calls` | Fait : outil `scheduleCall`, file BullMQ `sales` (passe toutes les 5 minutes, heures `sales.call_hours`, fuseau America/Toronto), `VoiceProvider.startOutboundCall` étendu (`phoneNumberId`), Vapi `POST /call` avec `VAPI_SALES_ASSISTANT_ID` et `VAPI_SALES_PHONE_NUMBER_ID`, simulé en test ; rapport reçu par le webhook Vapi existant (appel connu ou assistant commercial) → `outbound_calls`, `prospect_touches`, note HubSpot ; rendez-vous → `CalendarProvider` (Google Calendar réel si clés, simulé sinon) et courriel de confirmation ; script de l'assistant dans `docs/voice-agent.md` |
| 4. Agent `followups` | Fait : passe à 8 h (`sales.followups_hour`), J+3, J+10, J+30 (`sales.followup_days`), rédaction structurée par le modèle à partir du gabarit et du fil, envoi par la file des notifications, clôture après la dernière ; prospects, devis entreprise, candidatures de chauffeurs incomplètes (documents manquants). Réservations web abandonnées : aucune trace avec coordonnées (devis anonymes), noté dans `docs/sales/prospection.md` |
| 5. Exécution des demandes | Fait : `createBusinessQuote` (grille `sales.business_grid`, défauts documentés), `openBusinessAccount` (organisation cliente `business` et invitation du propriétaire par `OrganizationsService`), `scheduleMeeting`, `markDoNotContact`, `proposeSalesDecision` ; hors grille → approbation |
| 6. My Hub, page « Ventes » | Fait (`/hub/ventes`) : liste filtrée (étape, source, segment, score), fiche (fil, appels, relances, devis), boutons appeler, relancer, devis, ouvrir le compte, ne plus contacter, changement d'étape, import CSV, passes à la demande ; i18n FR et EN ; permissions `sales.read` et `sales.manage` (fin du catalogue, plateforme seulement) |
| 7. Tests `apps/api/test/autonome-f-ventes.e2e.test.ts` | 7 scénarios : import, prospection et qualification, séquence, appel et rapport, relances et clôture, devis dans et hors grille, compte entreprise, retrait. **7 sur 7 verts** (2 octobre, 22 h 40, sous le verrou `autonome-f`) |
| 8. Documentation | `docs/sales/sequences.md`, `docs/sales/prospection.md`, `docs/voice-agent.md` (assistant commercial), `docs/decisions.md` (4 lignes du 2026-10-02), `docs/isolation.md`, cette note |

## Points vérifiés

- Domaine : `test/sales.test.ts` (règles pures : contact admissible, adresses professionnelles, score, échéances, heures de bureau, grille, résultats d'appel), `access.test.ts` (tailles des anciens rôles mises à jour), `notifications.test.ts`.
- `packages/db` : `test/journal.test.ts` (journal monotone).
- Types : `@neomoov/domain`, `@neomoov/db`, `@neomoov/api`, `@neomoov/web`, `@neomoov/worker`, `@neomoov/api-client` verts (le worker exige un `pnpm --filter @neomoov/api build` préalable : il lit les types de `apps/api/dist`).
- Domaine : `pnpm --filter @neomoov/domain test` : 39 fichiers, 522 tests verts, couverture 100 % (cas « aucun jour ouvrable » de `nextBusinessSlot` ajouté).
- `packages/db` : `test/journal.test.ts` 2 sur 2.
- API, sous le verrou : `autonome-f-ventes.e2e.test.ts` 7 sur 7 ; fichiers voisins touchés (`crm.e2e`, `crm-adapters`, `voice.e2e`, `agents.e2e`, `env`, `mock-webhooks-production`, `isolation-tables.e2e`, `isolation-coverage.e2e`) : 49 sur 51. Les 2 échecs sont dans `isolation-coverage.e2e` et viennent de tables d'autres agents déjà appliquées sur la base partagée (`performance_logs`, `vehicle_inspections` sans entrée dans la liste attendue ; `content_comments`, `content_items`, `seo_tasks` sans politique ni entrée dans `PLATFORM_ONLY_TABLES`) : aucune des quatre tables des ventes n'y figure ; vert après la fusion des branches correspondantes.
- OpenAPI régénérée (352 chemins, 11 occurrences de `/admin/sales`), `api-client` compilé.

## Reste à faire

- Écran « Ventes » vérifié par les types seulement (aucun essai dans un navigateur : jamais de serveur de développement sur la base partagée).
- Boîte unifiée : une réponse « STOP » ou une réponse d'un prospect arrive par l'agent D ; `ProspectsService.incomingReply` et `markDoNotContact` sont prêts à être appelés par son canal `email`.
- Assistant Vapi commercial et numéro dédié, client OAuth Google Calendar, API Places (New) sur la clé des cartes : à créer par le fondateur (`docs/sales/prospection.md`).
- Relancer `crm:setup` après fusion (options `b2b` et `prospect` ajoutées au modèle HubSpot).

## Pièges

- `db:migrate` affiche « Migrations appliquées. » même quand il saute une migration dont le `when` est antérieur à la dernière appliquée : vérifier la présence des tables.
- `AgentToolsService.specs` est désormais partiel (outils enregistrés par d'autres modules) : un outil non enregistré dans le processus est refusé proprement.
- Le webhook Vapi traite d'abord les rapports d'appels sortants : un rapport de l'assistant commercial sans appel connu n'est pas journalisé comme appel entrant.
- Base partagée : la passe des relances découvre aussi les candidats chauffeurs d'autres jeux de tests ; les tests comptent par chaîne, jamais au total.
- `localDayMinutes` construisait un `Intl.DateTimeFormat` à chaque appel : `nextBusinessSlot` parcourt jusqu'à plusieurs milliers de minutes (soir, fin de semaine), d'où des secondes de calcul par appel planifié ; un formateur par fuseau est désormais gardé en mémoire.
