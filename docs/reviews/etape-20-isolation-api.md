# Étape 20 (API) : barrière des routes d'organisation

Revue de fin de mission, 30 septembre 2026. Branche `etape-20b-api` (agent A). Plan : `docs/prompts/20-isolation-organisations.md` ; socle de la session principale : migration 0021, `OrgScopeService`, exécuteur de base propagé par contexte, organisation dans l'audit.

## Critères d'acceptation

| Critère | Résultat |
|---|---|
| Un membre d'une organisation cliente utilise l'API sur les données de son organisation et de ses descendantes, et sur rien d'autre | Oui : 13 routes `/v1/org/:organizationId` (fiche, chauffeurs, véhicules, courses, relevés, membres, invitations, adhésions, rôles, journal), chacune `@OrgScoped` et `@Can`, exécutées dans la transaction restreinte par `OrgScopeInterceptor` ; `isolation-routes.e2e` monte deux organisations sœurs A et B (chauffeur, véhicule, client, course, relevé chacune) et vérifie zéro accès croisé en lecture et en écriture |
| Permissions du rôle dans cette organisation, jamais les anciens rôles du personnel | Oui : `AccessService.permissionsIn` ; un membre du personnel `readonly` propriétaire de A n'a rien dans B (`NOT_A_MEMBER`), l'administrateur de la plateforme non plus ; le lecteur (rôle personnalisé « lecture des courses ») reçoit `FORBIDDEN_ROLE` avec la permission manquante sur chaque autre route |
| Modules de la formule et permissions sensibles | Oui : B limitée au module `rides` par `organization_features` → l'administrateur de B perd `drivers.read` ; un propriétaire connecté par code SMS (sans double authentification) n'a pas `members.manage` |
| Écritures croisées | Oui : inviter dans B (403 `NOT_A_MEMBER`), modifier ou retirer une adhésion de B par la route de A (404), lire une course ou un chauffeur de B par la route de A (404), rôle de B invisible (404), rôle système figé (409), escalade refusée (403 `PERMISSION_ESCALATION`), rôle créé toujours dans l'organisation de la route |
| Journal d'audit par organisation | Oui : l'entrée d'une invitation faite par la route de A porte `organization_id` = A et n'apparaît que dans `GET /v1/org/A/audit` ; une requête d'organisation en échec n'écrit rien |
| Inventaire | Oui : test d'inventaire (toute route sous `/v1/org/` porte `@OrgScoped` et `@Can`, aucun ancien rôle) et contrôle au démarrage (`assertRoutePolicies`) ; empreinte `test/fixtures/legacy-route-roles.json` intacte |
| La plateforme voit tout par `/admin` | Oui (chauffeurs et courses des deux organisations) |
| `GET /v1/me/organizations` | Oui : adhésions actives et non expirées, organisation (identifiant, code, nom, type, chemin, statut) et rôle (code, nom), portée, statut ; une adhésion suspendue disparaît |
| OpenAPI | Régénérée : 270 chemins, étiquette `org`, `GET /v1/me/organizations` ; le client d'API compile et ses tests passent |

## Tests lancés

- `pnpm --filter @neomoov/domain test` : 32 fichiers, 425 tests, couverture 100 % (lignes, branches, fonctions).
- Sous le verrou (`db-lock.cjs run agent-a`), un seul `vitest run --no-file-parallelism` sur `isolation.e2e` (3), `isolation-routes.e2e` (6), `authorization.e2e` (7) et `organizations.e2e` (2) : 18 tests verts en 484 s.
- `vitest run test/org-scope.test.ts` (sans base) : 4 tests (décorateur, résolution de l'organisation par paramètre ou en-tête, `permissionsIn` sur une base simulée, cache revidé après la validation).
- `pnpm --filter @neomoov/api-client test` : 29 tests ; typecheck verts sur `domain`, `api`, `worker`, `api-client`, `web`.
- Après les corrections de la relecture (1er octobre), sous le verrou, un seul `vitest run --no-file-parallelism` sur `isolation-routes.e2e` (6), `authorization.e2e` (7), `organizations.e2e` (2) et `audit-export.e2e` (1) : 16 tests verts en 687 s. OpenAPI régénérée de nouveau : identique.

## Points vérifiés à la relecture

- Ordre des gardes : limite par adresse, authentification, propriété (module d'identité), puis `OrgScopeGuard` (enregistré par le module des organisations, pour ne pas faire dépendre le module d'identité de celui des organisations). `AuthGuard` ne juge plus `@Can` sur une route `@OrgScoped` ; les comptes de service y sont refusés dès `AuthGuard` (`SERVICE_ACCOUNT_NOT_ALLOWED`).
- Ordre des intercepteurs : l'intercepteur d'audit (module d'audit, enregistré avant) enveloppe `OrgScopeInterceptor` : les entrées sont écrites après la validation de la transaction restreinte, par le pool de la plateforme, avec l'organisation prise dans `req.orgScope` (`AuditContext.organizationId`) ; `currentOrgScope()` reste le repli pour les tâches en arrière-plan. Une exception annule la transaction : aucune entrée n'est écrite pour la route d'organisation (rien n'a changé).
- Les services de My Hub sont réutilisés sans changement : tous lisent `database.db` à chaque appel (aucun ne met l'exécuteur en cache à la construction), donc passent par la transaction restreinte. `staff_notes` n'a pas de politique : la fiche d'un chauffeur lue par une organisation montre des notes vides (table fermée par défaut, rien à contourner).
- `GET /v1/org/:organizationId` porte `@Can(...ORGANIZATION_PERMISSIONS)` : ouvert à tout membre qui détient au moins une permission d'organisation (les rôles système répartiteur, comptable et gestionnaire de flotte n'ont pas `organizations.read`).
- Réponse vide (`DELETE memberships/:id`, 204) sous l'intercepteur : `lastValueFrom(..., { defaultValue: undefined })`.
- Un membre du personnel qui a une adhésion à la racine avec la portée `subtree` couvrirait toute organisation par ces routes (vue d'ensemble de la plateforme) : aucune adhésion de ce type n'est créée aujourd'hui.
- Aucune migration ajoutée : aucune table nécessaire aux routes n'était sans politique.
- Cache des droits : un changement d'adhésion ou de rôle fait par une route d'organisation n'est visible qu'à la validation de la transaction ; `AccessService.invalidate` vide le cache tout de suite et une seconde fois après la validation (`afterScopedCommit`, appelé par `OrgScopeInterceptor`), sinon une requête concurrente remettait l'état d'avant en cache pour 30 secondes (test unitaire).
- Journal d'une organisation : `audit_log` compte 65 127 lignes sur la base de développement ; sans filtre, `GET org/:id/audit` évaluait la politique ligne par ligne sur tout le journal. `AuditService.list` ajoute un filtre explicite sur les organisations du sous-arbre (index `organization_id, occurred_at`).
- Réglages : le cache de `SettingsService` peut être rechargé pendant une transaction restreinte ; les 175 réglages globaux ont `organization_id` nul, donc visibles sous la politique, la relecture donne les mêmes valeurs. Règle à garder : un réglage global garde `organization_id` nul.
- Courses d'une organisation : le nom et le téléphone du client ne sont montrés que si son profil (`clients.organization_id`) est dans le sous-arbre ; sinon la liste montre le nom de l'invité ou rien.

## Reste à faire

- En-tête `X-Organization-Id` : pris en charge par la garde (test unitaire), mais aucune route ne s'en sert encore ; utile pour la résolution par domaine (étape 22) et l'application unique.
- Écritures métier par les routes d'organisation (créer une course, attribuer, suspendre un chauffeur, revoir un document, régler un relevé) : hors de cette mission ; même motif à reproduire route par route (`@OrgScoped`, `@Can`, service de My Hub).
- Conditions des rôles (`role_permissions.conditions`) toujours non appliquées ; alerte au propriétaire sur l'usage d'une permission sensible.
- Sélecteur d'organisation dans les applications (consomme `GET /v1/me/organizations`) : étapes 21 et 22.
- Accès temporaire du support (`support_access_grants`) : non commencé.
- Tâches en arrière-plan d'organisation, politiques par table, `docs/isolation.md` : agent B.

## Pièges rencontrés

- Copie de travail sans `dist` : `@neomoov/db`, `@neomoov/domain` et `@neomoov/api-client` sont introuvables par vitest et par le typecheck du web tant que `pnpm --filter <paquet> build` n'a pas été lancé.
- Le test d'autorisation appelle chaque route avec un identifiant d'exemple : sur une route d'organisation, l'organisation est résolue avant toute permission, un client obtient donc 404 `ORGANIZATION_NOT_FOUND` et non 403 ; le test le documente.
- Sous la transaction restreinte, une ligne d'une autre organisation « n'existe pas » : les services répondent 404 (`RIDE_NOT_FOUND`, `DRIVER_NOT_FOUND`, `MEMBERSHIP_NOT_FOUND`, `ROLE_NOT_FOUND`), jamais 403 ; à garder à l'esprit pour les messages des applications.
- Une permission sensible tenue par un rôle d'organisation n'est active qu'avec une session à double authentification : un propriétaire connecté par code SMS ne gère ni membres ni rôles tant que la double authentification n'existe pas pour lui (décision à trancher).
- Tout traitement asynchrone lancé pendant une route d'organisation (événement de domaine, réaction différée) hérite du contexte et donc de la transaction restreinte ; s'il se termine après la validation, ses requêtes visent une transaction close. Aucune route actuelle n'en lance ; à traiter (sortie du contexte par `orgScopeStorage.exit`) avant d'ouvrir des écritures métier par ces routes.
- Session coupée deux fois (limite d'utilisation, réseau) : un `git push` a expiré après 300 s sans erreur visible dans la sortie du commit ; vérifier `git status -sb` après chaque poussée.

## Décisions à faire trancher

- Portée « organisation seule » d'une adhésion : elle limite les organisations que le membre peut viser, mais les routes de A montrent aussi les données des descendantes de A (contexte par sous-arbre, comme le demande la mission). Si la portée doit aussi limiter les données, il faut un mode « organisation exacte » dans `app_scope_allows` (migration 0022, périmètre de l'agent B).
- Double authentification pour les membres des organisations clientes (sans elle, aucune permission sensible : gestion des membres et des rôles, remboursements, relevés).
- Le propriétaire d'une organisation peut suspendre ou retirer un autre propriétaire ; l'amendement demande un transfert préalable : règle à préciser.
