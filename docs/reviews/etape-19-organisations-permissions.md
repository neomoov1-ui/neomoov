# Étape 19 : organisations en arbre et permissions fines

Revue de fin d'étape, 27 septembre 2026. Branche `etape-19-organisations`. Plan : `docs/prompts/19-organisations-permissions.md`.

## Critères d'acceptation

| Critère | Résultat |
|---|---|
| Toutes les routes existantes passent par `@Can` | Oui : 190 routes basculées (personnel, espace chauffeur, outils des agents) ; plus aucun `@Roles` dans les contrôleurs |
| Suite d'API complète verte | Voir le message de fusion |
| Un rôle personnalisé limite réellement l'accès | Oui : `organizations.e2e` (un rôle « lecture des courses » voit `/admin/rides`, reçoit 403 sur `/admin/drivers`, perd tout accès une fois suspendu) |
| Aucun accès changé pour les comptes existants | Oui : empreinte `test/fixtures/legacy-route-roles.json` comparée route par route dans `authorization.e2e` |
| Pas d'escalade | Oui : `PERMISSION_ESCALATION` testé (permission non détenue ; permission de la plateforme pour une organisation cliente) |

## Points vérifiés à la relecture

- Le code d'erreur d'un refus reste `FORBIDDEN_ROLE` : les applications publiées continuent d'afficher le bon message ; la permission manquante est donnée en détail.
- Invitation : jeton rendu une seule fois, seule l'empreinte SHA-256 est gardée ; usage unique sous verrou ; réservée au téléphone ou au courriel invité.
- Permission sensible tenue par une adhésion : active seulement avec une session à double authentification.
- Portée transitoire : seules les adhésions à la racine donnent des droits sur les routes de la plateforme tant que l'isolation des données (étape 20) n'est pas faite.
- Cache des droits (30 secondes) vidé à chaque changement d'adhésion ou de rôle.
- Base de développement : migration 0020 appliquée, organisation existante rattachée comme racine, catalogue et rôles système remplis par les données de départ.

## Reste pour les étapes suivantes

- Étape 20 : `organization_id` sur toutes les tables métier, contexte par transaction, politiques de sécurité au niveau des lignes, tests d'accès croisé.
- Étape 21 : écrans My Hub (arbre, membres, rôles personnalisés, invitations) ; envoi du lien d'invitation par courriel ou texto (aujourd'hui, le jeton est rendu à la personne qui invite).
- Conditions des rôles (`role_permissions.conditions` : montant maximal, zones, lecture seule) : stockées, pas encore appliquées.
- Alerte au propriétaire de l'organisation sur l'usage d'une permission sensible.
