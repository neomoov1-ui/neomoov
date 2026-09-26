# Étape 19 : organisations en arbre, permissions fines, rôles, adhésions, invitations

Source : amendement v1.2 du cahier des charges (sections 1 à 3), décisions D11 (tout est centralisé) et D12 du fondateur (26 septembre 2026). Ce document ne décrit que le socle technique.

## Objectif

Remplacer le modèle à quatre rôles du personnel (`admin`, `operator`, `finance`, `readonly`) par des permissions atomiques, attribuées par des rôles (système ou personnalisés) à des adhésions d'utilisateurs à des organisations rangées en arbre. Rien ne doit casser : les rôles actuels deviennent des rôles système de l'organisation racine `neomoov`.

## Données (migration 0020)

- `organizations` : `parent_id`, `path` (chemin matérialisé `/<id>/<id>/`, index), `status` (`trial`, `active`, `read_only`, `suspended`, `closed`), `plan_code`, `legal_name`, `gst_number`, `qst_number` ; types élargis (`platform`, `taxi_company`, `vtc_company`, `fleet`, `business`, `establishment`, `solo`, `sub_org`, `white_label`). La racine `neomoov` a `path = /<id>/`.
- `permissions` : catalogue (`code` clé primaire, `module`, `description`, `sensitive`). Rempli par les données de départ depuis le domaine (source unique).
- `roles` : `organization_id` (null = rôle système), `code`, `name`, `level` (0 à 4), unique (`organization_id`, `code`).
- `role_permissions` : (`role_id`, `permission_code`) et `conditions` JSON (lecture seule, montant maximal, zones).
- `memberships` : `user_id`, `organization_id`, `role_id`, `scope` (`organization` ou `subtree`), `status` (`active`, `suspended`), `invited_by`, `expires_at` ; unique (`user_id`, `organization_id`, `role_id`).
- `invitations` : `organization_id`, `role_id`, `email` ou `phone`, `token_hash`, `expires_at`, `accepted_at`, `invited_by` ; jeton à usage unique, haché.
- `plans`, `plan_features`, `organization_features` : fonctionnalités effectives d'une organisation (formule, options, dérogations).
- Reprise : chaque `user_roles` du personnel devient une adhésion à la racine avec le rôle système correspondant (`platform_admin`, `platform_dispatcher`, `platform_finance`, `platform_readonly`).

## Domaine (`packages/domain/src/access/`)

- `PERMISSIONS` : catalogue typé (code, module, sensible), `Permission` = union des codes.
- `SYSTEM_ROLES` : permissions de chaque rôle système (N0 plateforme, N1 propriétaire et administrateur d'organisation, N2 répartiteur, gestionnaire de flotte, comptable, agent).
- `LEGACY_ROLE_PERMISSIONS` : correspondance transitoire ancien rôle → permissions (un `admin` a tout, `operator` l'exploitation, `finance` les finances, `readonly` les lectures).
- Fonctions pures, testées à 100 % : `effectivePermissions(memberships, features)`, `canGrant(granter, permissions)` (pas d'escalade : on n'accorde que ce qu'on détient), `inScope(orgPath, membershipPath, scope)`, `featureAllows(permission, features)`.

## API

- Décorateur `@Can(...permissions)` : toute permission listée suffit ; conservé à côté de `@Roles` le temps de la bascule, puis `@Roles` du personnel retiré.
- `AuthGuard` : pour un utilisateur, permissions = union des adhésions actives (et des anciens rôles par la correspondance) ; refus `FORBIDDEN_PERMISSION` (403) avec la permission manquante. Cache court par session.
- `assertRoutePolicies` : toute route du personnel porte `@Can` ; test d'autorisation qui parcourt chaque route.
- Routes (My Hub) : organisations (arbre, création de sous-organisation), rôles (système en lecture, personnalisés en écriture), adhésions, invitations (création, acceptation par jeton), permissions (catalogue).
- Journal d'audit sur chaque changement de rôle, d'adhésion ou d'invitation ; permission sensible = alerte au propriétaire.

## Critères d'acceptation

1. Toutes les routes existantes passent par `@Can` ; suite d'API complète verte.
2. Un rôle personnalisé limite réellement l'accès (test : un rôle « lecture des courses » voit les courses et reçoit 403 ailleurs).
3. Pas d'escalade : un administrateur ne peut pas créer un rôle avec une permission qu'il n'a pas.
4. Les comptes du personnel existants gardent exactement leurs accès (test de non-régression par rôle).
