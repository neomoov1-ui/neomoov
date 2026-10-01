# Étape 23 : module Flotte et partage des revenus

Revue de fin de mission, 1er octobre 2026. Branche `etape-23-flotte` (agent G), partie de la branche terminée de l'agent A (`etape-20b-api`, routes `/v1/org/:organizationId`) avec la fusion de `etape-20c-tables-jobs` (agent B : tâches de fond par organisation, migrations 0022 et 0023 déjà appliquées sur la base partagée). Plan : amendement v1.2, section 6, et étape 23 (critère : « parcours complet gestionnaire, chauffeur, versement »). Documentation : `docs/fleet.md`. Décision D1 du fondateur respectée : uniquement les courses Neomoov, aucune lecture ni action sur Uber ou Lyft.

## Critères d'acceptation

| Critère | Résultat |
|---|---|
| Le gestionnaire invite un chauffeur, le chauffeur accepte et est rattaché | Oui : invitation par texto (jeton `drv_...` jamais rendu à la personne qui invite, refusé par le parcours générique), acceptation par la personne invitée seulement (même téléphone), profil existant rattaché, véhicule personnel qui suit le chauffeur, invitation à usage unique (`fleet.e2e`, étapes 1 et 2) |
| Véhicule créé et affecté | Oui : véhicule de l'organisation créé en attente, inspecté par la plateforme (`/admin/vehicles/:id/review`), affecté au chauffeur (véhicule courant) ; entretien enregistré avec échéances (étapes 3) |
| Course reçue par l'organisation et attribuée à ce chauffeur par le répartiteur interne | Oui : devis et course saisis par le répartiteur de l'organisation (la course lui appartient) ; attribution à un chauffeur d'une autre organisation refusée (404 `DRIVER_NOT_FOUND`) ; attribution interne, réattribution (nouvelle recherche : offres aux seuls chauffeurs de l'organisation), nouvelle attribution ; carte en direct (étape 5) |
| Course terminée | Oui : départ, arrivée, début, fin par l'application chauffeur (étape 6) |
| Relevé hebdomadaire avec la ligne de partage | Oui : relevé du chauffeur avec une ligne `fleet_share` de 20 % du tarif chauffeur (règle de l'organisation), relevé à l'organisation, visible par elle (part de l'organisation), introuvable pour B (étape 7) |
| Versement simulé à l'organisation | Oui : compte Stripe Connect de l'organisation ouvert (simulé), relevé de l'organisation versé par transfert du montant exact, passe rejouée sans second transfert, export CSV des virements (étape 8) ; rapport de la semaine (courses, revenus, part) par chauffeur et par véhicule (étape 9) |
| Accès croisé : une organisation B ne voit ni n'attribue rien de A | Oui : chauffeurs, course, véhicule, entretien, relevés, règles, carte, rapport, règlement hors plateforme ; B ne vise pas A (`NOT_A_MEMBER`), le répartiteur de A n'a pas les droits du propriétaire (`FORBIDDEN_ROLE`) |
| `network_mode` : course non pourvue qui repart au réseau avec les seuls champs permis | Oui : avant le délai, la répartition de A ne propose pas la course hors de A ; après le délai, partagée une seule fois, journal limité à `NETWORK_SHARED_FIELDS` (prénom seul), offre reçue par un chauffeur de la plateforme sans demandes particulières ni identité du client |
| `settlement.e2e` et `dispatch.e2e` après les changements | Voir « Tests lancés » |
| OpenAPI régénérée, `docs/decisions.md`, `docs/fleet.md`, note de revue | Oui : 295 chemins, client d'API compilé et testé ; neuf décisions datées du 30 septembre (règle de COMMUN) |

## Tests lancés

| Commande | Résultat |
|---|---|
| `pnpm --filter @neomoov/domain test` | 33 fichiers, 446 tests verts, couverture 100 % (lignes, branches, fonctions) avec `fleet/fleet.ts` et `schemas/fleet.ts` |
| `vitest run test/org-scope-events.test.ts test/org-scope.test.ts` (sans base) | 2 fichiers, 8 tests verts (dont 4 nouveaux : événements après validation, annulation, points de sauvegarde, hors contexte) |
| Sous le verrou `agent-g` : `vitest run --no-file-parallelism test/fleet.e2e.test.ts` | 3 tests verts en 126 s (parcours complet, accès croisé, mode réseau) |
| Sous le verrou : `settlement.e2e`, `dispatch.e2e`, `isolation-jobs.e2e` (un seul `vitest run --no-file-parallelism`) | 29 tests verts sur 30 en 825 s : `settlement.e2e` 6 sur 6, `isolation-jobs.e2e` 9 sur 9, `dispatch.e2e` 14 sur 15. L'échec (« réservation planifiée : favori seul pendant 120 s… », ligne 455) vient de deux chauffeurs de test orphelins de la base partagée (`175c1314-ebf8-46e2-860a-3dc608b6aa9d` et `8bd32c32-fdfb-44c0-a1ac-fb6bb35fc057`, téléphones `+1999…`, créés le 30 septembre à 15 h 32 UTC par une exécution interrompue, sans course ni session depuis) : chauffeurs de la plateforme (organisation nulle), actifs, qui acceptent le terminal et les planifiées, ils reçoivent l'offre à la place du seul chauffeur attendu. Ils sont éligibles avec ou sans le filtre de l'étape 23 ; leur retrait m'a été refusé (ressource partagée) : à faire par la session principale avant la suite complète |
| Sous le verrou (après les dernières modifications) : `fleet.e2e` (complété du tableau du propriétaire de véhicule), `isolation-routes.e2e`, `organizations.e2e` (un seul `vitest run --no-file-parallelism`) | 3 fichiers, 11 tests verts en 299 s (`fleet.e2e` 3, `isolation-routes.e2e` 6, `organizations.e2e` 2) |
| `pnpm --filter @neomoov/api typecheck`, `@neomoov/web`, `@neomoov/domain`, `@neomoov/db`, `tsc` du worker | Verts |
| `pnpm --filter @neomoov/web test` | 3 fichiers, 9 tests verts (dont la parité des clés fr-CA et en) |
| `pnpm --filter @neomoov/api openapi:export` puis `pnpm openapi` ; `pnpm --filter @neomoov/api-client build` et `test` | 295 chemins ; client compilé, 5 fichiers et 29 tests verts |

## Points vérifiés à la relecture

- Toutes les routes de la flotte sont `@OrgScoped` (classe) et `@Can` (route) : le contrôle au démarrage (`assertRoutePolicies`) et le test d'inventaire de l'étape 20 les couvrent. `GET /v1/org/:id/drivers` passe du contrôleur de l'agent A au module Flotte (même chemin, réponse enrichie, mêmes filtres) ; la route des échéances est `compliance/expiring` pour ne pas être prise par `drivers/:id` (enregistré avant).
- Écritures sous la transaction restreinte : chaque table touchée a une politique qui l'accepte (véhicules, entretien par véhicule, règles et relevés d'organisation, courses, devis, offres, attributions planifiées, avis) ; l'organisation proposée par l'appelant ne l'emporte jamais sur le contexte (défauts `app_scope_organization_id()`).
- Travail asynchrone : les événements de domaine émis pendant une route ou une tâche d'organisation partent après la validation (`afterOrgScopeCommit`), jamais sur annulation ; le texto d'invitation suit la même règle. Les abonnés travaillent alors par le pool de la plateforme, l'organisation gardée pour l'étiquetage.
- Répartition : seuls des filtres et des appels ajoutés à `dispatch.service.ts` (`organizationAllows` dans les deux recherches de candidats, demandes particulières et vol vides dans l'offre d'une course partagée) ; verrous, ordre et cadence des offres inchangés.
- Règlement : le recalcul d'un brouillon recalcule la ligne de partage ; une course déjà portée par un relevé émis n'entre pas deux fois dans la base ; la course dont la garantie modèle a été validée contre le chauffeur n'y entre pas.
- Démarrage : la réunion des branches A et B créait un cycle d'imports (courses → organisations → My Hub → courses) et `AdminModule` recevait un module indéfini ; corrigé par `OrgScopeModule` (voir décisions). Ce problème touchera aussi la branche d'intégration à la fusion de B si cette branche-ci n'est pas fusionnée avec.
- Relecture automatique (`/code-review`, effort faible, sur `fb43c6f..HEAD`) : trois constats. Corrigé : les réglages du réseau testaient la valeur plutôt que sa présence (sans effet réel, le schéma impose au moins une minute). Non retenus : le signe des lignes `fleet_share` (montants stockés positifs, le débit vient du type ; le test vérifie le montant transféré) et le préfixe des chemins d'organisation (chemins `/<uuid>/.../` à barre finale, sans collision possible).
- Base de développement : migration 0024 appliquée (entrée 37 de `drizzle.__drizzle_migrations`, `when` 1790853142614, au-dessus des migrations des autres agents au moment de l'application).

## Reste à faire

- Intégration avec l'étape 21 (agent F) : connexion des membres d'organisation à My Hub (téléphone et code) et espace `hub/(app)/org/...` ; mes pages sont sous `hub/(app)/flotte/`, avec leur propre sélecteur d'organisation (`GET /v1/me/organizations`). En attendant, elles servent aux comptes du personnel qui ont une adhésion à une organisation cliente.
- Acceptation de l'invitation : la page web `/chauffeurs/rejoindre` (le lien du texto y mène : connexion par code puis acceptation) est faite ; un écran équivalent dans l'application chauffeur reste à faire (textes de l'application dans un seul fichier partagé avec les agents C et D, non touché ici).
- Suggestion d'entretien par l'agent IA : reportée (aucun point d'extension simple ; `aiSuggestion` toujours `null`).
- Relances des échéances : faites au chauffeur par la passe de conformité, par lots d'organisation (agent B) ; le gestionnaire les voit dans la liste et `compliance/expiring`, sans message qui lui soit adressé (à ajouter si souhaité).
- Données de départ : le catalogue des permissions et le rôle `vehicle_owner` sont recopiés par `seedAccess` ; à relancer au déploiement. Sur la base partagée, le test les ajoute sans rien retirer (un `seedAccess` lancé depuis une autre branche retire les permissions qu'il ne connaît pas).
- Stripe Connect réel pour les organisations : dépend de la validation du compte Stripe de Neomoov ; d'ici là, règlement hors plateforme.
- Saisie d'une course par le répartiteur d'une organisation dans My Hub : la route existe (`POST /v1/org/:id/quotes` puis `/rides`) ; l'écran « Nouvelle course » côté organisation relève de l'étape 21.

## Décisions à faire trancher par le fondateur

- **Avance de la part de l'organisation** : elle est versée dès l'émission des relevés des chauffeurs ; si le net d'un chauffeur est négatif (courses payées en direct, loyer), Neomoov l'avance et la récupère par le prélèvement du chauffeur. Alternative : ne verser que ce qui a été encaissé.
- **Loyer sans activité** : un chauffeur sans aucune course ni ligne dans la semaine n'a pas de relevé, donc pas de loyer cette semaine-là. Faut-il un relevé « loyer seul » ?
- **Chauffeurs des flottes sur les courses de la plateforme** : ils les reçoivent (cas d'usage d'une flotte qui roule sur Neomoov) et l'organisation prend sa part sur ces courses. À confirmer, ainsi que l'inverse : en mode isolé, les courses de l'organisation ne vont jamais aux chauffeurs de la plateforme.
- **Revue des documents par l'organisation** : un refus est définitif (le chauffeur téléverse à nouveau), une approbation reste une recommandation. À confirmer.
- Numérotation des migrations à la fusion : `0024_fleet` suit `0022_isolation-corrections` et `0023_isolation-recipients` de l'agent B dans cette branche ; les migrations 0022 des agents C (`brands`), D (`pilot`), E (`crm`) et H (`payment-provider`) existent aussi.

## Pièges rencontrés

- Verrou de la base très demandé (six agents) : plusieurs dizaines de minutes d'attente par passage ; le verrou n'est pas une file (le premier qui interroge après la libération le prend).
- Cycle d'imports de modules Nest après la réunion des branches de l'étape 20 : `vitest` se termine par un code 134 (abandon de Nest à l'initialisation) sans message ; pour voir l'erreur, créer l'application avec `abortOnError: false` et le journal `error`.
- `tsgo` (TypeScript 7) a planté une fois en mémoire pendant la vérification des types de l'API (poste chargé) ; relancé, il passe.
- Les scripts Node écrits par heredoc avec des apostrophes échappées échouent : passer par l'outil d'édition pour les chaînes avec apostrophes.
- `test/org-scope.test.ts` (agent A) ne compilait plus après la fusion de B (`OrgScopeContext` a gagné `ended` et `parent`) : corrigé.
