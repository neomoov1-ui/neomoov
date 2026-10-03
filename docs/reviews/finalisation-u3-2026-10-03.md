# Finalisation U3 (3 octobre 2026) : exploitation, communications et agents autonomes

Branche `finalisation-u3-exploitation` (copie `neomoov-wt24`), créée depuis `origin/main` (`3208b92`). Mission : `neomoov-outils/agents/U3-exploitation-communications.md`. Périmètre : `apps/api` (boîte unifiée, ventes, marketing, notifications, agents, croissance, courses planifiées, Booster), `apps/worker`, `packages/domain`, `packages/db`. Aucun fichier de Q1 (`auth`, `staff-auth`, `public`, `dispatch.service.ts`, `statements.service.ts`, `payments`), des applications mobiles (Q2), des écrans web (U1) ni des modules de U2 n'a été modifié.

Migration **0039_finalisation-exploitation** (rejouable, inverse dans `down/`, instantané `0039_snapshot.json`) : contraintes de `followups` élargies (cible `missed_call`, canal `voice`), outils déclarés de l'agent `publishing`, cinq réglages. **Appliquée sur la base de développement** sous le verrou `u3-migrate` (entrée 50 de `drizzle.__drizzle_migrations`, `when` 1791031627884). Aucune table nouvelle.

## Points de la mission

| Point | État | Preuve (fichier, essai) |
|---|---|---|
| 1. Rappel d'un appel manqué dans `followups` (au lieu d'une tâche BullMQ différée perdue sans Redis) | Fait | `inbox/missed-calls.service.ts` (`scheduleCallback`), `inbox/inbox-jobs.service.ts` (`callbacksDue`, à chaque passe de la file `inbox`), `sales/followups.service.ts` (relances commerciales filtrées sur leurs cibles) ; `autonome-d-boite.e2e` (scénario de l'appel manqué réécrit) |
| 1. Fenêtre de 24 heures de Meta (Messenger, Instagram) : étiquette autorisée, sinon autre canal, sinon personnel, jamais d'erreur muette | Fait ; étiquette `HUMAN_AGENT` derrière `inbox.meta_human_agent_tag` (faux, accès Meta attendu) | Domaine `inbox/meta-window.ts` ; `agents/conversations.service.ts` (`send`, `deliverElsewhere`, `conversation.delivery_failed`) ; `notifications/notification-delivery.service.ts` (refus `SOCIAL_WINDOW_CLOSED` sans nouvel essai) ; `adapters/real/meta-social.ts` (`MESSAGE_TAG`, sous-codes 2018278 et 2534022) ; `finalisation-u3.e2e` (deux scénarios), `inbox-units.test` |
| 1. Webhook Tidio vers la boîte (secret, simulé sans clé, documenté) | Fait ; secret et réglage chez Tidio à poser (accès attendu), garder Tidio : décision attendue | `POST /v1/webhooks/tidio` (`inbox/inbox.controller.ts`, `inbox/tidio-inbox.service.ts`), domaine `inbox/tidio.ts`, `TIDIO_WEBHOOK_SECRET` (`.env.example`, `config/env.ts`), `docs/runbooks/boite-unifiee.md` (3.1) ; `finalisation-u3.e2e` |
| 1. Temps de première réponse par canal au rapport quotidien | Fait | `agents/agent-tools.service.ts` (`queryMetrics` → `inbox.firstReplyByChannel`), domaine `inbox/metrics.ts` ; `finalisation-u3.e2e` |
| 2. « STOP » ou réponse d'un prospect par courriel → `markDoNotContact` ou `incomingReply` | Fait | `inbox/inbound-email.service.ts` (`fromProspect`), `sales/prospects.service.ts` (`findByEmail`), domaine `isOptOutReply` ; `finalisation-u3.e2e` |
| 3. Actes de l'agent `publishing` par des outils déclarés d'`AgentToolsService` | Fait | `marketing/publishing.service.ts` (`socialPublish`, `socialMetrics`, `replyComment`, `forwardComment`), `TOOL_NAMES`, données de départ et migration 0039 ; `autonome-e-marketing.e2e`, `connecteurs-avis.e2e`, `finalisation-u3.e2e` |
| 3. Envoi automatique de l'infolettre Brevo derrière un réglage désactivé | Fait ; décision du fondateur attendue | `marketing.newsletter_auto_send` (faux), `adapters/real/brevo.ts` (`sendNow` seulement si demandé) ; `marketing-adapters.test`, `finalisation-u3.e2e` |
| 4. `scheduled.dispatch_due` rattrapé après un signal perdu, sans modifier `dispatch.service.ts` | Fait | `rides/scheduled.service.ts` (`dispatchDueToRecover`), `apps/worker/src/worker.module.ts` (`SchedulingWorker.recoverDispatchDue` → `DispatchService.start`) ; `apps/worker/test/scheduling.test.ts`, `finalisation-u3.e2e` |
| 4. Avis `ride.removed_by_operator` au chauffeur d'une course figée en `cancelled_by_driver` | Non retenu (note) | Le chauffeur a lui-même annulé et reçu la confirmation de son annulation : un avis « retiré par l'opérateur » le contredirait. Rien à changer (et l'avis vivrait dans `dispatch.service.ts`, fichier de Q1) |
| 5. Envoi réel des avis de pack | Déjà fait | `rides/pack-lifecycle.service.ts` (avis en file à chaque événement), matrice `pack.*` (push), `notifications/templates.ts` ; `growth-packs-promotions.e2e`, `notifications.e2e` |
| 5. Avis de parrainage | Fait | `credits/referrals.service.ts` (`notifyReward`), gabarits `referral.rewarded` et `referral.driver_rewarded`, matrice ; `growth-credits-referral.e2e` (assertions ajoutées) |
| 5. Compensation des promotions, crédits de pack et tarifs protégés sur le relevé hebdomadaire | Déjà fait (aucune note pour Q1) | `settlement/statements.service.ts` : ligne `promotion_compensation` (`classifyRideForStatement`), `referral_credit` appliqué aux packs, garantie modèle sans retenue quand `driver_fare_protected` ; `settlement.e2e` |
| 6. Rappel sous 4 heures des problèmes de compte ou de paiement mesuré au rapport quotidien | Fait | Motifs `account` et `payment` de `escalateToHuman` (`ESCALATION_REASONS`), `queryMetrics` → `inbox.accountCallbacks` (cible `inbox.account_callback_hours`) ; `finalisation-u3.e2e` |
| 7. Analyse Booster par la file `agents`, état « en cours » lisible par les routes existantes | Fait ; mode par défaut derrière `booster.analysis_async` (faux) jusqu'à l'application chauffeur | `booster/booster-async.ts`, `booster/inspections.service.ts`, `booster/performance.service.ts`, `agents/agent-jobs.service.ts` (`registerHandler`), `?async=true` sur les deux routes d'analyse ; `booster.e2e` (scénario ajouté) |
| 8. `pnpm audit --prod`, vulnérabilités élevées ou critiques | Analysé : aucune correction mineure sûre | Voir « Dépendances » |

## Choix

- **Rappels d'appels manqués** : même table que les relances commerciales (proposition du rapport D), cible `missed_call` = la conversation, canal `voice`, `max_attempts` 1. L'énumération du domaine `FOLLOWUP_TARGETS` (écran « Ventes ») n'est pas élargie : les requêtes des ventes filtrent sur leurs cibles, l'écran de U1 n'est pas touché.
- **Fenêtre de Meta** : la décision est prise avant l'envoi (dernier message reçu), et un refus de Meta à l'envoi suit le même repli par l'événement `conversation.delivery_failed` (une seule reprise par message, réservée dans ses métadonnées : l'événement arrive à l'API et au worker avec Redis). Une réponse de l'agent n'est jamais étiquetée `HUMAN_AGENT` (règle de Meta). Sans autre canal : message « à relayer » (le circuit existant de la boîte) et escalade.
- **Tidio** : la plateforme n'écrit pas dans Tidio. Visiteur avec courriel : réponse par courriel depuis contact@ ; sans courriel : conversation `web` remise au personnel (une seule alerte par conversation). Le format exact du webhook Tidio n'a pas pu être vérifié contre un compte réel : lecture tolérante et documentée.
- **Prospects** : une réponse d'un prospect n'est jamais confiée à l'agent relation client (prix ou conditions B2B à ne pas improviser) : remise au personnel.
- **Diffusion** : entrées des outils réduites aux identifiants ; le texte d'un commentaire passe par une table en mémoire de la passe, jamais par le journal. Un outil refusé avant d'agir compte comme un échec de publication (visible, nouvelle tentative, puis alerte).
- **Attribution planifiée** : balayage du worker plutôt qu'une tâche BullMQ (la file `dispatch` est traitée dans `dispatch.service.ts`, fichier de Q1, qui ne connaît que la tâche de démarrage) ; marge égale au délai de grâce pour l'écart d'horloge entre le worker et la base ; sans Redis, les signaux de la passe sont relancés aussitôt (personne ne les écoute).
- **Booster** : mise en file après la validation de la transaction (`afterOrgScopeCommit`), sinon le worker pourrait lire le rapport avant l'état `pending` ; analyse perdue rendue en échec après 10 minutes ; défaut synchrone pour ne pas casser les applications installées.

## Essais (3 octobre 2026)

RESULTATS_A_COMPLETER

## Dépendances (`pnpm audit --prod`)

4 vulnérabilités, **toutes dans la chaîne d'outils Expo de `apps/mobile-driver`** (compilation de l'application, jamais exécutée par l'API, le worker ni le site) :

| Gravité | Paquet | Chemin | Correctif |
|---|---|---|---|
| Élevée | `node-forge` ≤ 1.4.0 (GHSA-86w9-cpqp-85rv) | `expo` > `@expo/cli` (signature du code) | Aucune version corrigée publiée |
| Élevée | `braces` ≤ 3.0.3 (GHSA-vfj7-8cjw-p6xm) | `react-native` > `metro` > `micromatch` | Aucune version corrigée publiée |
| Modérée | `uuid` < 11.1.1 (GHSA-w5hq-g745-h8pq) | `@expo/config-plugins` > `xcode` | 11.1.1 : changement de version majeure (xcode utilise uuid 7) |
| Modérée | `decode-uri-component` ≤ 0.4.2 (GHSA-vcc3-ghjq-m6fr) | `expo-router` > `query-string` | 0.5.0 : version 0.x incompatible pour `query-string` |

Aucune mise à jour mineure sûre n'existe ; une surcharge (`pnpm.overrides`) toucherait les applications mobiles (Q2) et la compilation EAS. Rien n'est changé ; à revoir à la prochaine montée d'Expo.

## Reste à faire ou à trancher

- **Fondateur** : envoi automatique de l'infolettre (`marketing.newsletter_auto_send`) ; garder Tidio ou le remplacer (le webhook est prêt) ; voir `docs/decisions.md`, section « À trancher ».
- **Accès** : permission « Human Agent » de Meta (puis `inbox.meta_human_agent_tag` à vrai) ; `TIDIO_WEBHOOK_SECRET` et l'URL du webhook dans Tidio (formule qui offre les webhooks).
- **Q2 (application chauffeur)** : appeler `POST .../analyse?async=true` et relire le rapport tant que `analysis.status` vaut `pending` (écrans `booster/inspection.tsx`, `booster/performance.tsx`) ; ensuite `booster.analysis_async` à vrai.
- **U1 (My Hub)** : l'état `pending` de l'analyse s'affiche aujourd'hui comme « aucune analyse » dans la fiche d'inspection ; un libellé « analyse en cours » serait plus juste.
- **Session principale** : renuméroter 0039 si un autre agent a pris ce numéro ; à la fusion, la couverture du domaine est sous 100 % sur `main` à cause de fichiers de la publication multiréseau (`marketing/publications.ts`, `marketing/social-accounts.ts`, `marketing/visuals.ts`, `schemas/publications.ts`), antérieure à cette branche.

## Pièges

- Le cache des réglages (60 s) : les essais forcent un réglage en espionnant `SettingsService.get`, jamais en écrivant dans la base partagée.
- `QueueService.add` en mode mémoire attend la fin du traitement : la mise en file de l'analyse Booster est détachée de la requête (après la validation), sinon la route attendrait deux minutes sans Redis.
- Dans un script Node passé par `node -e` entre guillemets doubles de Bash, `\'` perd sa barre oblique : les apostrophes des chaînes TypeScript se cassent (corrigé à la main dans `seed/data.ts`).
- `drizzle.config.ts` charge `.env` : l'instantané 0039 a été produit à partir de 0038 par un script, sans lancer `drizzle-kit`.
