# Étape 21 : My Hub côté organisation cliente et journal d'accès du support

Revue de fin de mission, 1er octobre 2026. Branche `etape-21-myhub-organisations` (agent F), partie de `etape-20b-api` (2e93053). Sources : amendement v1.2 (sections 1 à 4, étape 21 : « un administrateur N1 crée une sous-organisation, un rôle limité et invite un agent, sans aide »), décisions du fondateur transmises avec la mission (visibilité par sous-arbre inchangée, double authentification des membres, dernier propriétaire).

## Critères d'acceptation

| Critère | Résultat |
|---|---|
| Un administrateur N1 crée une sous-organisation, un rôle limité et invite un agent, sans aide | Oui, par l'API (`org-hub.e2e`, dernier test) : connexion par code SMS, sélecteur (`GET /v1/me/organizations`), sous-organisation, rôle « répartiteur lecture seule » (double authentification demandée puis inscrite), invitation par texto, lien reçu par le fournisseur de textos, l'agent se connecte et accepte, ne voit que les courses de sa sous-organisation, reçoit 403 sur les membres, les invitations et le journal, « non membre » sur l'organisation parente ; l'administrateur voit tout son sous-arbre et son journal (création, rôle, invitation, acceptation). Même parcours dans l'interface : onglet « Organisation », pages Sous-organisations, Rôles, Membres, Sécurité du compte. Test Playwright non écrit : l'API locale ne peut pas tourner pendant le travail parallèle |
| Connexion des membres à My Hub | Onglet « Organisation » (code SMS, comptes existants ; un compte se crée par le lien d'invitation), relais `/api/org-auth` (témoins `httpOnly`), espace `/hub/organisation` avec sélecteur mémorisé et menu limité aux permissions de la fiche `GET /v1/org/:id` ; le personnel garde son parcours ; un membre sans rôle du personnel est conduit vers l'espace de son organisation |
| Pages d'organisation sur `/v1/org/:id/...` seulement | Tableau de bord (`GET .../overview`), courses (liste et fiche), chauffeurs, véhicules (tableau de la plateforme en lecture), relevés, membres (inviter, changer de rôle, suspendre, retirer, transférer la propriété), rôles (catalogue `GET .../permissions` limité aux permissions détenues, avertissement sur les sensibles), sous-organisations (`GET`/`POST .../organizations`, arbre, « Gérer »), journal, accès du support, sécurité du compte |
| Routes ajoutées avec `@OrgScoped`, `@Can`, accès croisé testé | 12 routes d'organisation (overview, organizations GET/POST, permissions, invitations GET/DELETE, ownership/transfer, support-access GET et approve/deny/revoke) ; le test d'inventaire et le test « chaque route : NOT_A_MEMBER, FORBIDDEN_ROLE, 404 » de `isolation-routes.e2e` les couvrent automatiquement (verts) ; accès croisé propre à chaque route dans `org-hub.e2e` (invitation, accès du support, sous-organisation d'une autre branche : 404) |
| Invitations par courriel et texto | Lien `<WEB_BASE_URL>/rejoindre?token=...` envoyé après la validation (gabarit `organization.invitation` FR-CA et anglais, avis rattaché à l'organisation) ; jeton jamais rendu sauf `INVITATION_TOKEN_IN_RESPONSE=on` hors production ; `/rejoindre` accepte `?token=` ; liste et révocation |
| Journal d'accès du support | Table `support_access_grants` (migration 0022, politique d'isolation, inverse), permission `support.access` (sensible, plateforme) ; demande, approbation, accès pendant la durée seulement, refus après révocation et après expiration, fin anticipée, tout journalisé dans le journal de l'organisation (`support_access.requested/approved/denied/revoked/ended/used`) ; bandeau « Accès support en cours » ; page plateforme « Accès du support » |
| Double authentification des membres | `/v1/auth/mfa/start|enroll|confirm|verify|backup` ; session `amr` = premier facteur et `mfa` ; refus d'une permission sensible avec `details.mfaRequired` ; jamais de rôle du personnel par cette voie |
| Dernier propriétaire | 409 `LAST_OWNER` (suspendre, retirer, changer de rôle ; plateforme comme organisation) ; `POST /v1/org/:id/ownership/transfer` journalisé |
| OpenAPI, décisions, note | OpenAPI régénérée (287 chemins, +17) ; client d'API : ressources `org`, `supportAccess`, `memberMfa` ; 10 lignes dans `docs/decisions.md` ; descriptions d'écrans `docs/screens/hub/33-espace-organisation.md` |

## Tests lancés

- `pnpm --filter @neomoov/domain test` : 33 fichiers, 432 tests, couverture 100 % (lignes, branches, fonctions, instructions). Nouveau fichier `support-access.test.ts` (7 tests).
- Sans base : `vitest run test/org-hub.test.ts test/org-scope.test.ts` : 6 tests verts (traitements après validation, réglage du jeton d'invitation, résolution de l'organisation).
- Sous le verrou `agent-f`, premier passage de `org-hub.e2e` : 5 verts sur 6 (152 s) ; le sixième (modules de la formule) corrigé dans le test.
- Sous le verrou, un seul `vitest run --no-file-parallelism` sur `org-hub.e2e`, `organizations.e2e`, `isolation-routes.e2e`, `staff.e2e`, `authorization.e2e` : 26 verts sur 27 en 693 s ; l'échec restant venait du test (parent sans formule restreinte), corrigé.
- Dernier passage sous le verrou de `org-hub.e2e`, `org-hub.test` et `org-scope.test` : voir le rapport final de l'agent (résultat exact).
- `pnpm --filter @neomoov/api-client test` : 5 fichiers, 29 tests verts ; `pnpm --filter @neomoov/web exec vitest run` : 3 fichiers, 9 tests verts.
- Types verts : `domain`, `db`, `api` (code et tests), `api-client`, `web`, `worker`.
- Migration 0022 appliquée sur la base de développement sous le verrou (table, colonne facultative, permission vérifiées par requête).

## Points vérifiés à la relecture

- Piège de l'étape 20 (traitement asynchrone sous transaction restreinte) : l'avis d'invitation et l'avis aux propriétaires partent par `afterScopeCommit`, après la validation et hors du contexte ; une insertion dans `notifications` sous la transaction restreinte aurait échoué (politique) et annulé la requête.
- Sous la transaction restreinte, une ligne d'une autre organisation donne 404 (`SUPPORT_GRANT_NOT_FOUND`, `INVITATION_NOT_FOUND`, `ORGANIZATION_NOT_FOUND`), jamais 403.
- La politique de `organizations` (lecture et mise à jour seulement pour le rôle restreint) n'est pas modifiée : la création d'une sous-organisation écrit la ligne par le pool de la plateforme après vérification du parent dans le sous-arbre.
- Permissions et fiche : `mfaPermissionsIn` est calculé hors de la transaction restreinte (les adhésions des ancêtres y seraient invisibles).
- Jetons de passage : `member_mfa_*` refusés par `/v1/auth/staff/mfa/*` (testé) ; une ligne `staff_credentials` sans mot de passe n'ouvre jamais de session du personnel ; un membre du personnel sans TOTP ne peut pas l'inscrire par le code SMS (409 `MFA_STAFF_ENROLLMENT_REQUIRED`, testé) ; au rafraîchissement, rôles du personnel seulement avec `pwd` et `mfa` (testé).
- Accès du support : le demandeur ne décide jamais (403 `SUPPORT_ACCESS_FORBIDDEN`, testé, aussi pendant l'accès), ne transfère pas la propriété (403 `OWNER_REQUIRED`, testé) ; permissions limitées à celles d'une organisation cliente (ni `support.access` ni `staff.manage`, testé) ; aucune entrée « used » pour une requête refusée faute d'accès.
- Nettoyage des tests : `cleanupTestData` retire les accès du support des comptes de test (clés étrangères vers `users`), puis les comptes ; le fichier retire ses organisations (enfants d'abord), rôles, modules.
- Relais web : seules les routes `org/<uuid>/*` et `me/organizations` s'ajoutent à la liste ; écritures toujours avec l'en-tête anti-CSRF.

## Reste à faire

- Test Playwright du parcours dans `apps/web` et captures des écrans décrits dans `docs/screens/hub/33-espace-organisation.md`, dès que l'API locale peut tourner.
- Sélecteur d'organisation dans les applications mobiles (étape 22, avec la marque).
- Écritures métier par les routes d'organisation (créer, attribuer, annuler une course ; suspendre un chauffeur ; régler un relevé) : même motif route par route, avec `afterScopeCommit` pour les événements.
- Alerte au propriétaire sur l'usage d'une permission sensible (amendement, section 3.2) ; conditions des rôles (`role_permissions.conditions`) toujours non appliquées.
- `docs/isolation.md` (agent B) : ajouter `support_access_grants` aux tables isolées par organisation.
- `packages/api-client/src/openapi.json` : l'ordre des chemins a changé (ordre d'enregistrement des contrôleurs), d'où un grand écart textuel à la fusion ; régénérer après la fusion.

## Pièges rencontrés

- Une formule restreinte (`organization_features`) sans le module `organization` retire `organizations.manage` au propriétaire : il ne peut plus créer de sous-organisation (premier échec du test).
- Une sous-organisation reçoit les modules de son parent à sa création seulement : un parent restreint après coup ne restreint pas ses enfants (copie, pas héritage).
- Le verrou de la base a été tenu jusqu'à 10 minutes par d'autres agents ; une suite de cinq fichiers prend environ 11 minutes.
- `heredoc` de Bash et `node -e` avec apostrophes échappées échouent sur ce poste : écrire les scripts dans un fichier `.cjs` (règle commune confirmée).
- L'outil d'édition réécrit parfois un fichier CRLF en LF : sans effet sur Git (`autocrlf`), mais vérifier qu'aucun fichier n'a de fins de ligne mêlées.

## Décisions à faire trancher par le fondateur

- Pendant un accès du support, le personnel agit avec ses permissions de la plateforme (limitées à celles d'une organisation cliente) : un administrateur peut donc écrire dans l'organisation. Faut-il un accès en lecture seule par défaut, ou un niveau choisi par l'organisation à l'approbation ?
- Qui approuve un accès du support : aujourd'hui `members.manage` (le propriétaire par défaut, double authentification). Faut-il une permission dédiée (`support.grants.manage`) à confier à l'administrateur ?
- Durées : accès de 15 minutes à 24 heures (1 heure par défaut) ; demande sans réponse expirée après 24 heures (réglage `support.request_ttl_hours`). Avis aux propriétaires par texto (coût) : garder, ou courriel ?
- Un membre du personnel qui est aussi membre d'une organisation cliente utilise le même secret TOTP dans les deux cas (une seule application d'authentification) : à confirmer.
