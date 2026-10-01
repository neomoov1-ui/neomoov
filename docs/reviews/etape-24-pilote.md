# Étape 24 : Neomoov Pilote, acceptation automatique des courses Neomoov

Revue de fin d'étape, 1er octobre 2026. Branche `etape-24-pilote`. Plan : `docs/prompts/24-neomoov-pilote.md` (source : amendement v1.2, section 7). Décision D1 du fondateur : Pilote n'agit que sur les courses Neomoov ; il ne lit rien et ne fait rien sur une autre plateforme (les revenus d'ailleurs sont un total saisi à la main par le chauffeur, sans nom ni logo).

## Livré

- Domaine `packages/domain/src/pilot/` (fonctions pures) : `pilotCriteriaSchema`, `evaluateOffer` (décision, score, raisons, métriques de gain net), exclusions de zones, `netProfitability`, `chainAgenda`, texte d'information versionné (Loi 25, article 12.1) en français et en anglais ; schémas de l'API dans `schemas/pilot.ts` ; `pilotScore` sur l'offre du chauffeur ; préférence de course `assistanceAnimal` ; permission `pilot.zones.read` ; gabarits `pilot.auto_accepted` et `alert.pilot_zone_exclusion` dans la matrice.
- Base : migration `0022_pilot` (tables `driver_pilot_settings`, `driver_pilot_decisions`, `driver_cost_entries`, droits et politique `org_isolation` par chauffeur pour `neomoov_scoped`, inverse dans `drizzle/down/`) ; réglages `pilot.*` dans les données de départ.
- API, module `apps/api/src/modules/pilot/` : `GET` et `PUT /v1/driver/pilot`, `GET /v1/driver/pilot/decisions`, `POST /v1/driver/rides/{id}/pilot-cancel`, `GET /v1/driver/agenda`, `GET` et `PUT /v1/driver/costs/{month}`, `GET /v1/driver/profitability`, `GET /v1/admin/pilot/zone-exclusions`. Crochet `PilotHook` (un seul appel dans `DispatchService.sendOffer`), score Pilote sur `GET /v1/driver/offers` et sur le socket `offer.new`. Module chargé par l'API et par le worker.
- Application chauffeur : écran « Pilote » (interrupteur, critères, mode multi-applications, texte d'information et consentement, dernières décisions), pastille de score sur l'offre (accueil et écran d'offre), bandeau « Acceptée par Pilote » avec compte à rebours et annulation sans frais sur la course, onglet « Agenda » dans Courses (départ conseillé depuis la position), écran « Coûts et rentabilité », liens depuis le profil, pastille « Animal d'assistance » ; textes `fr-CA` et `en`.
- OpenAPI régénérée (9 opérations ajoutées, aucune retirée), client d'API (`driver.pilot`, `updatePilot`, `pilotDecisions`, `pilotCancel`, `agenda`, `costs`, `saveCosts`, `profitability` ; `admin.pilotZoneExclusions`).

## Critères d'acceptation

| Critère | Résultat |
|---|---|
| Acceptation automatique selon les critères | Oui : `pilot.e2e` (course planifiée attribuée par `DispatchService.accept`, offre `accepted`, décision `accept`/`green`/`criteria_met`, avis `pilot.auto_accepted` et aucun `offer.new`, événements `offer_sent`, `offer_accepted`, `pilot_auto_accepted`, historique paginé) |
| Rien n'est accepté quand les critères échouent | Oui : décision `reject`/`red` enregistrée, offre toujours `sent`, avis `offer.new` envoyé, score rouge avec `fare_below_min` sur `GET /v1/driver/offers` |
| Score sur chaque offre, Pilote activé ou non | Oui : chauffeur sans Pilote, score calculé avec des critères vides (`accept`, `enabled: false`, `autoAccept: false`), aucune décision enregistrée |
| Annulation sans pénalité dans le délai de grâce | Oui : hors délai 409 `PILOT_GRACE_EXPIRED` ; dans le délai, course remise en demande sans chauffeur, réattribution demandée, `cancelled_in_grace_at` posé, événement `driver_cancels` marqué `pilotGrace`, aucune sanction, aucun journal `ride.driver_cancellation_after_en_route`, frais nuls ; un second appel reçoit 403 |
| Animal d'assistance jamais rejeté | Oui : les critères qui rejettent une offre ordinaire donnent `manual`/`yellow` avec `protected_request` (`assistance_animal`) ; l'accessibilité est couverte par les tests du domaine |
| Mode multi-applications | Oui : immédiate `manual` (`multi_app_immediate`), fenêtre de réponse de 30 s, non attribuée ; planifiée acceptée (`green`) |
| Information sur la décision automatisée (Loi 25, art. 12.1) | Oui : activation refusée sans consentement (409 `PILOT_CONSENT_REQUIRED`), version périmée refusée (409 `PILOT_CONSENT_OUTDATED`), consentement journalisé (`pilot.consent_given`), texte en français et en anglais selon `Accept-Language` |
| Surveillance des exclusions de zones | Oui : deux enregistrements des mêmes critères, un seul marqueur d'audit et une alerte par courriel au personnel ; rapport de la plateforme (zones, nombres, chauffeurs ; aire de service hors du tableau) ; 403 pour un chauffeur |
| Coûts et rentabilité nette | Oui : saisie par poste, revenus externes en un total, net et marge calculés ; mois invalide refusé (400) |
| Pas de course double par Pilote | Oui : une offre réclamée dont la course n'est pas encore attribuée compte comme réservation prévue ; la seconde offre qui la chevauche est rejetée (`schedule_conflict`), la course n'est pas attribuée |
| Répartition inchangée après le crochet | `dispatch.e2e` : 14 sur 15, l'échec vient d'un chauffeur de test orphelin de la base partagée (voir « Reste à faire ») ; `dispatch-concurrency.e2e` non lancé dans cette session |

## Montants et facteurs proposés (à faire valider par le fondateur)

Tous sont des réglages (`settings`, données de départ), modifiables sans déploiement.

| Réglage | Valeur proposée | Effet |
|---|---|---|
| `pilot.enabled` | vrai | Pilote offert aux chauffeurs (interrupteur général) |
| `pilot.grace_seconds` | 60 | Délai d'annulation sans frais, sans sanction ni effet sur le dossier, après une acceptation par Pilote |
| `pilot.multi_app_factor` | 1,25 | Seuils minimaux (montant, gain net au kilomètre et à l'heure) relevés de 25 % en mode multi-applications ; maximums inchangés |
| `pilot.multi_app_response_seconds` | 30 | Fenêtre de réponse d'une offre en mode multi-applications (au lieu des 15 s de `dispatch.offer_seconds`) |
| `pilot.near_miss_percent` | 10 | Seuil chiffré manqué de moins de 10 % : score jaune (le chauffeur décide) plutôt que rouge |
| `pilot.watched_zones` | liste vide | Zones dont l'exclusion alerte le personnel : à choisir par l'équipe (par exemple les quartiers à surveiller pour la discrimination indirecte) |
| `pilot.departure_buffer_minutes` | 5 | Marge ajoutée au trajet pour l'heure de départ conseillée de l'agenda |
| `pilot.departure_alert_minutes` | 15 | Alerte « partez bientôt » 15 minutes avant l'heure de départ conseillée |
| Critère `scheduleMarginMinutes` (par défaut) | 30 | Marge gardée autour des réservations déjà planifiées du chauffeur |

Le texte d'information (`PILOT_INFORMATION_VERSION` = `2026-10-01`) est à faire relire par le conseiller juridique ; toute modification change la version et redemande le consentement.

## Points vérifiés à la relecture

- Un seul crochet dans `dispatch.service.ts`, après l'insertion de l'offre : verrou consultatif des offres et ordre des offres inchangés. Chauffeur sans réglage Pilote : une lecture, offre et avis inchangés. Erreur de Pilote : journalisée, répartition inchangée.
- L'acceptation automatique passe par `DispatchService.accept` (offre réclamée, puis verrou de la course, première acceptation gagnante) ; verrou occupé plus de 5 s : l'offre est rendue au chauffeur avec l'avis « nouvelle offre » ; tâches en cours attendues à l'arrêt du processus.
- L'échéance allongée du mode multi-applications est écrite en base ; l'étape suivante de la répartition relit les offres vivantes, donc la fenêtre est respectée sans toucher au calcul des vagues.
- Une proposition de prix du client (négociation) n'est jamais acceptée automatiquement ; des critères illisibles en base donnent une décision manuelle.
- L'annulation de grâce est ignorée par l'agent qualité, le tableau de conduite et le compte d'annulations du dossier chauffeur dans My Hub ; le module `fairness` n'est pas modifié (il ne compte pas les annulations) ; l'autorisation de paiement du client est gardée (comportement existant de l'annulation chauffeur) ; la réattribution exclut le chauffeur.
- Tables nouvelles : `GRANT` au rôle `neomoov_scoped`, sécurité au niveau des lignes et politique `org_isolation` par chauffeur (jointure sur `drivers.organization_id`) dans la même migration ; fichier inverse.
- Migration appliquée sur la base de développement (identifiant 33, hachage identique au fichier, `when` = 1790814266133, la plus récente) ; tables, politiques et droits vérifiés.
- Le journal d'audit ne reçoit pas le détail des montants saisis (seulement le mois).
- L'avis push `pilot.auto_accepted` porte `rideId` : le toucher ouvre la course et son bandeau de grâce.
- Application chauffeur : le socket ignore une offre que Pilote accepte (`pilotScore.autoAccept`), la course arrive par `ride.updated`.

## Revue de code (niveau moyen) et corrections

- Course double (corrigé) : entre la réclamation d'une offre par Pilote et l'attribution (attente du verrou de la course, jusqu'à 5 s avec Redis), une seconde offre qui la chevauchait n'était pas vue comme un conflit, ni par Pilote (qui ne comptait que les courses attribuées) ni par la répartition. La décision est maintenant enregistrée sous un verrou consultatif par chauffeur, et une offre que Pilote accepterait est réévaluée avec les acceptations en cours comptées comme réservations prévues. Test ajouté dans `pilot.e2e` (« pas de course double »).
- Agenda (corrigé) : les 10 réservations prises étaient les dernières créées, triées ensuite par heure ; ce sont maintenant les 10 plus proches.

## Tests lancés

- `apps/api/test/pilot.e2e.test.ts` (base de développement, sous le verrou `agent-d`) : premier passage 6 sur 6 (186,8 s) ; après les corrections de la revue, 6 sur 6 (157,7 s) ; avec le test « pas de course double », 7 sur 7 (179,6 s).
- `apps/api/test/dispatch.e2e.test.ts` (sous le verrou) : 14 verts, 1 en échec (« réservation planifiée : favori seul pendant 120 s… », ligne 429) : la première offre de la réservation de contrôle est partie chez `CH-12451`, chauffeur de test orphelin (actif, terminal accepté, créé le 30 septembre à 17 h 32, heure de Paris, par une suite interrompue) ; l'ordre des candidats planifiés est déterministe (note, puis nombre de courses), il passe devant le chauffeur du test. Sans réglage Pilote, le crochet ne change rien pour lui.
- `apps/api/test/dispatch-concurrency.e2e.test.ts` : non lancé (lancement refusé par le contrôle des autorisations de la session après la tentative de neutraliser les orphelins).
- Domaine : 33 fichiers, 452 tests verts, couverture 100 % (instructions, branches, fonctions, lignes).
- Application chauffeur : types verts ; 4 fichiers, 21 tests verts.
- Client d'API : types verts ; 5 fichiers, 29 tests verts. API : types verts.

## Reste à faire

- Session principale : neutraliser les chauffeurs de test orphelins puis relancer `dispatch.e2e` et `dispatch-concurrency.e2e`. Orphelins `+1999…` relevés le 1er octobre : `CH-12450` et `CH-12451` (actifs, terminal accepté, 30 septembre 17 h 31-32), `CH-12448`, `CH-12449` (actifs, 30 septembre), `CH-12172` à `CH-12177` (actifs, 27 septembre), `CH-02080` à `CH-02085` et `CH-02562` à `CH-02567` (retirés, 26 septembre).
- À la fusion : renuméroter `0022_pilot` (sans changer son `when`, déjà appliqué) ; rejouer `pnpm db:seed` (idempotent) pour ajouter les réglages `pilot.*` et la permission `pilot.zones.read` au catalogue et aux rôles `platform_admin` et `platform_dispatcher` (absents de la base de développement : les comptes du personnel y ont accès par la correspondance des anciens rôles, pas encore les rôles système).
- My Hub : écran du rapport des exclusions de zones et choix des zones surveillées (route et client d'API prêts).
- Application client et réservation web : proposer l'option « animal d'assistance » (schéma prêt, affichée chez le chauffeur).
- Critères au niveau de la flotte (« critères du chauffeur ou de la flotte » de l'amendement) : à faire avec le module Flotte (étape 23) ; aujourd'hui, critères par chauffeur.
- Tests d'écran (Maestro) des nouveaux écrans de l'application chauffeur.

## Pièges

- `String.replace` interprète `$'` dans le texte de remplacement : « 0,00 $' » avait recopié la fin de l'objet de textes dans `i18n.ts` (fichier illisible). Utiliser `split`/`join`.
- Un script `.cjs` écrit par un heredoc a perdu la barre oblique inverse devant une apostrophe : passer par l'outil d'écriture de fichiers ou `String.fromCharCode(92)`, et relire le résultat avec `node`.
- `grep` et `sed` de Git Bash masquent les retours chariot : vérifier les fins de ligne CRLF avec `node`.
- Base partagée : les chauffeurs laissés par une suite interrompue reçoivent les offres des suites suivantes (`cleanupTestData` ne nettoie que les utilisateurs créés par le même processus).
