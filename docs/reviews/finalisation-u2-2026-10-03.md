# Finalisation U2 : organisations, permissions, flotte et facturation (API), 3 octobre 2026

Branche `finalisation-u2-organisations`, créée depuis `origin/main` `3208b92`, copie `C:\Users\PC\code\neomoov-wt23`. Mission : `neomoov-outils/agents/U2-organisations-flotte.md` (restes des étapes 19 à 25 et de la revue finale V1, périmètre `apps/api`, `packages/domain`, `packages/db`). Rien n'a été déployé ; aucune base de production ni compte externe n'a été touché ; la base de développement n'a été touchée que sous le verrou `db-lock` (nom `u2`).

## Tableau de bord

| Point | État | Preuve |
|---|---|---|
| 1a. Conditions des rôles (montant maximal, zones, lecture seule) appliquées par la garde | fait | `packages/domain/src/access/role-conditions.ts` ; `AccessService.grantsIn` ; `OrgScopeGuard` (`apps/api/src/modules/auth/guards.ts`) ; `apps/api/src/modules/organizations/org-request-gates.ts` ; essais `packages/domain/test/finalisation-u2.test.ts`, `apps/api/test/finalisation-u2-units.test.ts`, `apps/api/test/finalisation-u2.e2e.test.ts` (« conditions des rôles ») |
| 1b. Conditions écrites et lues par les rôles personnalisés, sans escalade | fait | `roleCreateSchema`, `rolePermissionsUpdateSchema`, `roleViewSchema` (`conditions`) ; `OrganizationsService.assertGrantable` (`refusedConditionGrants`) |
| 1c. Alerte au propriétaire sur l'usage d'une permission sensible | fait | `sensitivePermissionsUsed` (domaine) ; `SensitiveUseService` ; `OrgScopeInterceptor` (après la réussite) ; gabarit `organization.sensitive_permission_used` (`organization-templates.ts`, une ligne d'enregistrement dans `notifications/templates.ts`) ; essai e2e « alerte au propriétaire » |
| 2. Accès temporaire du support (`support_access_grants`) | déjà fait (étape 21) ; ajouté à `docs/isolation.md` | `SupportAccessService`, `OrgHubController`, migration `0027` (politique `org_isolation`, donc couverte par `isolation-coverage`) ; `docs/isolation.md` (famille « colonne directe ») |
| 3a. Créer une course, attribuer, réattribuer, revoir un document par l'organisation | déjà fait (étape 23) | `apps/api/src/modules/fleet/fleet.controller.ts` (`POST quotes`, `rides`, `rides/:id/assign`, `reassign`, `documents/:id/review`) |
| 3b. Annuler une course par l'organisation | fait | `POST /v1/org/:organizationId/rides/:id/cancel` (`rides.cancel`) ; essai e2e |
| 3c. Suspendre et réactiver un chauffeur par l'organisation | fait | `POST .../drivers/:id/suspend` (`drivers.suspend`), `POST .../drivers/:id/reactivate` (`drivers.activate`, 409 `SUSPENDED_BY_PLATFORM`) ; essai e2e |
| 3d. Régler un relevé hors plateforme | déjà fait (étape 23) | `POST .../organization-statements/:id/settle-offline` (`payouts.manage`, `OrganizationStatementsService`, sans toucher à `statements.service.ts`) |
| 4. Envoi du lien d'invitation par courriel ou texto | déjà fait (étape 21) | `OrganizationsService.invite` (outbox après validation, jeton jamais rendu) ; `FleetDriversService.invite` (texto) |
| 5a. `GET /v1/org/:organizationId/billing` | fait | `OrgPlatformBillingController` ; essai e2e « facturation de l'organisation » |
| 5b. `organizationWriteAllowed` appliqué (lecture seule, suspendu), jamais pendant une course | fait | `organizationWriteRefusal`, `restrictiveOrganizationStatus` (domaine) ; garde ; `@OrgWriteExempt` ; essai e2e « statut de facturation » |
| 5c. Portail client Stripe (simulé sans clé) | fait | `BillingProvider.createPortalSession` (réel : `POST /v1/billing_portal/sessions`, simulé) ; `POST /v1/org/:organizationId/billing/portal` |
| 5d. « Après 7 jours de suspension reportée, bloquer les nouvelles courses » | fait, désactivé (décision attendue) | `suspensionForced`, `subscriptions.suspension_postponed_at`, réglage `billing.force_suspension_after_postponed_days` = 0 (proposé : 7) |
| 6a. Avis au gestionnaire de flotte (documents, inspections, entretiens proches) | fait | `FleetNoticesService` (file `fleet`, une fois par jour), gabarit `fleet.compliance_digest` ; essai e2e |
| 6b. Suggestion d'entretien (`aiSuggestion`) sans appel au modèle | fait | `maintenanceSuggestion` (domaine) ; `FleetVehiclesService.maintenance` |
| 6c. Critères Pilote au niveau de la flotte, sans changer l'ordre des offres | fait | `evaluateOfferWithFleet`, `fleetPilotSettingsSchema` (domaine) ; `PilotService` (trois appels d'évaluation) ; `GET`/`PUT .../fleet/pilot` |
| 7. Caddy : route « ask » et configuration commentée | fait (non déployé) | `GET /v1/internal/tls/ask` (`InternalTlsController`, `BrandingService.tlsAllowed`) ; `infra/Caddyfile.domaines-organisations` |
| 8. Préfixe d'organisation des caches Redis et identifiants BullMQ | évalué, non appliqué (note) | `docs/decisions.md`, `docs/isolation.md` : aucune clé partagée ne porte de donnée d'organisation |
| 9a. Clés étrangères manquantes et index utiles | fait (16 clés, 7 index) ; 2 clés non posées (voir plus bas) | `packages/db/drizzle/0040_finalisation-organisations.sql` (rejouable), `down/0040_...` ; schéma Drizzle et instantané `0040_snapshot.json` |
| 9b. Conformité : règle des 60 000 km | fait | `vehicles.mechanical_check_km` ; `mechanicalCertificateDueOn` ; revue d'un certificat (`odometerKm`) ; `ComplianceService` ; essai e2e « conformité » |
| 9c. Conformité : renouvellement des antécédents judiciaires | fait, désactivé (décision attendue) | `backgroundCheckDueOn` ; réglages `compliance.background_check_tracked` (faux) et `compliance.background_check_validity_months` (0) |

## Ce qui est fait, en détail

### Conditions des rôles (étapes 19 à 21)
- Domaine (`role-conditions.ts`) : `roleConditionsSchema` (`readOnly`, `maxAmountCents`, `zones`), lecture tolérante (`parseRoleConditions` : vide = sans condition, illisible = refus), `conditionRefusal`, `admittedPermissions` (une tenue sans refus suffit), `conditionsWithin` et `refusedConditionGrants` (pas d'escalade), `SENSITIVE_PERMISSIONS`, `sensitivePermissionsUsed`.
- `AccessService.grantsIn` garde, pour chaque permission, une tenue par adhésion avec ses conditions (mêmes règles qu'avant : adhésion active, non expirée, portée, modules, double authentification) ; `permissionsIn` en dérive (même cache).
- Garde : pour une écriture, le montant (prix maximal consenti de la course ou du devis) et les zones (zones actives qui contiennent le départ) sont lus sur l'objet déclaré par la route, sur le sous-arbre seulement (`@ActsOnRide` : assigner, réattribuer, annuler ; `@ActsOnQuote` : créer une course ; `@ActsOnPlace` : devis, zones seulement). Refus 403 `PERMISSION_CONDITION_UNMET` avec la raison par permission.
- Rôles personnalisés : `conditions` facultatives à la création et à la mise à jour (clés = permissions accordées, sinon 400 `CONDITIONS_ON_UNGRANTED_PERMISSION`), rendues par les vues ; escalade par les conditions refusée (403 `PERMISSION_ESCALATION`, `conditions: true`).

### Alerte au propriétaire
- Une requête admise seulement par une permission sensible est notée par la garde, puis, après la réussite du gestionnaire, journalisée (`organization.sensitive_permission_used`) et signalée aux propriétaires de l'organisation et de ses ancêtres clients (sauf l'auteur), par courriel ou texto, une fois par membre, permission et organisation par heure (`organizations.sensitive_alert_cooldown_minutes`, `organizations.sensitive_use_alerts`).

### Écritures de l'organisation, facturation
- Annulation d'une course, suspension et réactivation d'un chauffeur (voir le tableau). Créer, attribuer, réattribuer, revoir un document et régler un relevé d'organisation existaient.
- Statut de facturation appliqué par la garde, le plus restrictif de l'arbre ; routes de régularisation et de protection permises (`@OrgWriteExempt` : portail, décisions sur l'accès du support, retrait d'un membre ou d'une invitation) ; une course en cours n'est jamais bloquée.
- `GET .../billing`, `POST .../billing/portal` (retour vers My Hub seulement, chemin sous `/hub` validé, sans `..`).
- Passe de facturation : début du report gardé, effacé au changement de statut ou au paiement ; suspension forcée au-delà du délai réglé (désactivé).

### Flotte et Pilote
- Relevé quotidien au gestionnaire : `FleetNoticesService.maybeRun` sur le battement de la file `fleet` (worker avec Redis, API sinon), à 7 h ; un relevé par organisation et par jour (marqueur `fleet.manager_notice_sent`).
- Suggestion d'entretien déterministe, en français ou en anglais selon la langue de la requête.
- Critères Pilote de la flotte (`organizations.settings.pilot`) : `default` (pour un chauffeur sans critère) ou `minimum` (la décision la plus prudente des deux évaluations) ; seule l'acceptation automatique change.

### Domaines (Caddy)
- `GET /v1/internal/tls/ask?domain=` : 200 `{ allowed: true }` pour un domaine vérifié d'une organisation ouverte, 404 sinon (nom normalisé, adresses IP refusées). Publique : elle ne dit rien de plus que la marque publique par domaine. `infra/Caddyfile.domaines-organisations` : blocs `on_demand_tls` et `https://` commentés, avec la marche à suivre ; `infra/Caddyfile` n'est pas modifié.

### Revue finale V1 : clés étrangères, index, conformité
- Migration 0040 : 16 clés étrangères posées `NOT VALID` puis validées une à une dans un bloc qui n'échoue jamais (avis sur les orphelins) ; mise à nul à la suppression du parent (cascade pour les favoris et les liens client-chauffeur). Base de développement vérifiée avant : un seul écart, 12 devis rattachés à des organisations de test supprimées (`quotes.organization_id`, clé laissée non validée sur la base de développement, avis rendu par la migration).
- Non posées : `invoices.credit_note_of_id` (la mise à nul d'une note de crédit heurterait l'index unique d'une facture par course ; à reprendre avec la passe de conservation) et `statement_lines.ride_id` (l'essai de l'agent comptable insère volontairement une ligne vers une course absente ; à poser en changeant ce scénario).
- Index : `rides_driver_active_idx`, `rides_driver_finished_idx`, `ride_offers_driver_pending_idx` (rapport de charge, point 4 ; proposés là « à valider par EXPLAIN ANALYZE » : posés car partiels et petits), `drivers_org_idx`, `vehicles_org_idx`, `rides_org_idx`, `weekly_statements_org_idx`.
- Règle des 60 000 km et antécédents judiciaires (voir le tableau).

## Essais

Résultats en fin de rapport (section « Résultats »).

## Ce qui reste, décisions du fondateur

- **À trancher** (aussi dans `docs/decisions.md`) : suspension forcée après 7 jours de report ; durée légale du renouvellement des antécédents judiciaires ; modes des critères Pilote de la flotte et alerte d'une zone surveillée exclue par une flotte ; lecture d'une organisation suspendue (gardée).
- **Session principale** : appliquer la migration 0040 avec les autres (déjà appliquée sur la base de développement par le script de l'agent, sans entrée au journal de drizzle : le migrateur la rejouera sans effet) ; à la fusion avec U3 (`0039_finalisation-exploitation`, antérieure), l'entrée du journal de cette migration passe de l'index 39 à 40 et les instantanés `0039` (U3) puis `0040` (U2) sont à rechaîner (`prevId`), au besoin par une migration vide régénérée ; relancer la suite complète (les nouvelles clés étrangères mettent à nul ou en cascade, jamais ne bloquent un nettoyage d'essai) ; `pnpm db:seed` pour les nouveaux réglages.
- **Écrans My Hub** (agent U1) : conditions d'un rôle, critères Pilote de la flotte, facturation et portail, champ « kilométrage » à l'approbation d'un certificat mécanique.
- Clés étrangères non posées (ci-dessus) ; nettoyage des 12 devis orphelins de la base de développement puis `ALTER TABLE quotes VALIDATE CONSTRAINT quotes_organization_id_organizations_id_fk`.
- Préfixe Redis : à revoir avec la répartition par réseau isolé (`dispatch.service.ts`, agent Q1).
