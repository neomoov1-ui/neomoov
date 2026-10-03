# Finalisation U6 (3 octobre 2026) : restes de la revue du 2 octobre, infrastructure et logique métier

Branche `finalisation-u6-revue` (copie `neomoov-wt25b`), créée depuis `origin/main` (`9c0903d`), puis rebasée sur `678818e` après la fusion de la finalisation U1. Mission : `neomoov-outils/agents/U6-revue-infra-metier.md`. Sources : rapports confidentiels « Web, infrastructure et exploitation » (constats web 1 à 25) et « Logique métier, données et tâches » (constats 1 à 22) de la revue du 2 octobre 2026, cités ici par numéro seulement, et `docs/reviews/revue-2026-10-02-a.md`, `-b.md`, `-c.md`. Aucun `.env` lu, aucune commande sur le serveur LWS, aucune base de production touchée ; migration 0039 appliquée sur la base de développement sous le verrou.

## Tableau des constats

### Infrastructure (rapport web)

| Constat | État | Preuve |
|---|---|---|
| 1. Dump avec les schémas de Supabase, restauration jamais essayée | Fait | `infra/scripts/backup.sh` (`--schema=public --schema=drizzle`, `BACKUP_SCHEMAS`) ; `infra/scripts/restore.sh` (PostGIS dans le schéma de la source lu dans `.meta`, rôle `neomoov_scoped` créé avant la restauration, sinon la première politique arrêtait `--exit-on-error`) ; `infra/scripts/restore-test.sh` (conteneur PostGIS 17 jetable sur 127.0.0.1, comptes comparés à la production en lecture seule, ligne « ESSAI | … » pour le tableau) ; cron mensuel dans `infra/server-setup.sh` ; `docs/runbooks/sauvegardes.md`. Premier essai réel : **accès attendu** (serveur) |
| 2. Sauvegardes seulement sur le VPS, rclone absent | Fait (accès attendu pour le seau) | `backup.sh` : copie rclone des quatre fichiers, purge locale et distante seulement après une copie réussie, sortie 4 et alerte en production sans `BACKUP_REMOTE` ; rclone installé par `server-setup.sh` |
| 11. Échec de sauvegarde silencieux | Fait | `backup.sh` : `trap ERR` → `BACKUP_HEARTBEAT_URL/fail`, battement en cas de succès ; adresse passée à curl par son entrée standard (`-K -`), essai local fait |
| 22. Fichier partiel, empreinte non authentifiée | Fait | `backup.sh` : écriture `.part`, vérification, puis `mv` ; `.mac` = SHA-256(clé dérivée de la phrase ‖ SHA-256 du fichier), phrase jamais dans la ligne de commande ; contrôle et refus dans `restore.sh` (ancienne `.sha256` acceptée pour les sauvegardes antérieures) ; essai local : même empreinte des deux scripts, différente avec une autre phrase ou un fichier modifié |
| 5. Workflow vert après un retour arrière | Déjà corrigé en production (lot B), complété | `deploy.yml` (production) comparait déjà la version ; ici : préproduction vérifiée par version aussi, et surtout `deploy.sh` remet `APP_VERSION` à la version précédente au retour arrière (sans cela, `/v1/health` annonçait la version refusée et le workflow passait au vert) |
| 6. Deux déploiements simultanés | Déjà corrigé (lot B) | `infra/deploy.sh` (`flock` sur `infra/.deploy.lock`) |
| 7. Coupure à chaque déploiement | Déjà corrigé en partie (lot B) ; reste noté | Caddy `lb_try_duration 30s`, `COMPOSE_PARALLEL_LIMIT=1` (lot B). Ici : même limite au retour arrière. Bascule « santé avant bascule » non faite : remplacement instance par instance (`--scale api=3 --no-recreate`, attente de santé, arrêt de l'ancienne) impossible à essayer sans serveur ni Docker utilisable sur le poste ; les réessais de Caddy couvrent le redémarrage |
| 12. Caddy, Redis, ClamAV sans mise à jour en mode build | Déjà corrigé (lot B) | `deploy.sh` (`compose pull --ignore-buildable`) ; images non épinglées par condensé, choix consigné dans `docs/decisions.md` |
| 21. Seule l'API vérifiée, `APP_VERSION` faux après retour arrière | Fait | `deploy.sh` : `service_healthy` (sonde Docker et image attendue) pour l'API, le web et le worker, version de l'API, fenêtre portée à 180 s (premier battement du worker) ; `APP_VERSION` rétablie au retour arrière |
| 23. Cron de relance contre la fenêtre de santé | Fait | `infra/scripts/restart-unhealthy.sh` : `flock -n` sur le verrou du déploiement, aucune relance pendant un déploiement |
| 10. Caddy : corps, délais, journal sans données personnelles | Déjà corrigé en partie (lot B : corps, délais, journal JSON), complété | `infra/Caddyfile` : filtre du journal (IP tronquées /16 et /32, en-têtes de requête et de réponse retirés, chaîne de requête et jetons des chemins `/suivi`, `/track`, `/verify`, `/c`, `/d` masqués) ; vérifié avec Caddy 2.10.2 (`caddy adapt`, puis serveur local et requêtes : aucune adresse complète, aucun jeton, aucun courriel dans la sortie) ; HSTS de deux ans comme le web |
| 16. Déploiement en `root` | Fait (script et manuel, non activé) | `infra/scripts/deploy-user.sh`, `docs/runbooks/utilisateur-deploiement.md` ; `deploy.yml` lisait déjà `vars.DEPLOY_USER`. À lancer par le fondateur |
| 17. CI : permissions, étiquettes, `eas-cli@latest`, `curl \| sh` | Fait | `.github/workflows/*.yml` : `permissions` minimales (`release.yml` par tâche), actions épinglées par commit avec l'étiquette en commentaire, gitleaks par condensé, `eas-cli@24.10.0` ; `server-setup.sh` : dépôt APT signé de Docker |

### Web (rapport web, fichiers permis seulement)

| Constat | État | Preuve |
|---|---|---|
| 18. Garde de My Hub : lien profond, témoin non signé, `SameSite=Strict` | Fait en partie ; reste décrit | `hub/(app)/layout.tsx` + `components/hub/login-redirect.tsx` : sans session lisible, la page garde son chemin (`next`) et refait une fois la navigation depuis le site lui-même (les témoins `Strict` absents d'un lien de courriel sont alors envoyés) avant la connexion ; `lib/hub-user-cookie.ts` : témoin mal formé = aucune session. Signature du témoin : voir « Correctifs décrits » |
| 19. Relais `/api/v1` : segments décodés | Fait | `lib/server/relay-path.ts` (liste blanche reprise, `.`, `..`, barre oblique encodée et caractères hors `[A-Za-z0-9._~-]` refusés) branché dans `app/api/v1/[...path]/route.ts` ; le relais public n'accepte que des chemins exacts (non concerné) |
| 20. PDF dans un cadre sans `sandbox` | Fait autrement ; décision attendue (antivirus) | `lib/document-kind.ts` + `components/hub/document-viewer.tsx` : PDF affiché seulement si le type ET les octets `%PDF-` concordent, images matricielles seulement, tout le reste téléchargé en `application/octet-stream`. `sandbox` non posé : essai du 3 octobre dans Edge, un PDF dans un cadre `sandbox` (vide ou `allow-scripts`) est bloqué. Antivirus réel : décision du fondateur (mémoire) |
| 24. Accueil public avec l'état détaillé de l'API | Fait | `components/home-content.tsx` : état global seulement |
| 13. Tuiles OpenStreetMap | Fait (choix du fournisseur attendu) | `lib/map-tiles.ts` (`NEXT_PUBLIC_MAP_TILE_URL`, `NEXT_PUBLIC_MAP_TILE_ATTRIBUTION`, gabarit https avec `{z}{x}{y}` sinon OSM), `position-map.tsx`, `fleet-map.tsx`, `zone-map.tsx` ; variables passées au build (`apps/web/Dockerfile`, `infra/compose.prod.yml`, `images.yml`, `.env.example`). `next.config.ts` non modifié : la politique (déplacée par U1 dans `lib/security-headers.ts`) permet déjà `img-src https:` |

### Logique métier (rapport 02)

| Constat | État | Preuve |
|---|---|---|
| 8. Autorisation libérée si l'après-création échoue | Déjà corrigé (lot B) | `rides.service.ts` (`createFromQuote`, commentaire « constat 8 »), `revue-b-dispatch.e2e` |
| 9. Réassignation depuis `arrived` | Déjà corrigé (lot B) | `state-machine.ts`, `rides.service.ts` (« constat 9 »), `revue-b-dispatch.e2e` |
| 10. `cancelled_by_driver` invisible du chien de garde | Déjà corrigé (lot B) | `stuck-rides.service.ts`, `rides.service.ts` (« constat 10 ») |
| 15. Promotion non libérée sur `interrupted` | Déjà corrigé (lot B) | `promotions.service.ts:72` |
| 21. Relecture sans vérifier l'acteur | Déjà corrigé (lot B) | `rides.service.ts` (« constat 21 ») |
| 16. Forfait : tarif négatif | Fait | `packages/domain/src/pricing/quote.ts` (forfait inférieur aux frais ignoré, calcul au compteur ; `flatRatesBelowFees`), avertissement au chargement dans `pricing-rules.service.ts` ; `packages/domain/test/pricing.test.ts` |
| 17. `ridesMissingInvoice` sans index | Fait | migration `0039` (`rides_invoice_catchup_idx`, partiel), condition reprise dans `invoicing.service.ts` ; `revue-u6-taches.e2e` (plan de la requête sur l'index) |
| 18. Gardes « déjà fait aujourd'hui » en mémoire | Fait | `apps/api/src/common/daily-run.ts` (réservation atomique dans `settings`, portée `jobs`), `compliance-jobs.service.ts`, `retention-jobs.service.ts` ; `revue-u6-taches.e2e` (deux processus, redémarrage, échec, passe interrompue) |
| 20. Déclencheur d'audit désactivé pendant la purge | Fait | migration `0039` (`audit_log_guard()`), `retention.service.ts` (`set_config('neomoov.audit_purge', 'on', true)`) ; `revue-u6-taches.e2e`, `retention.e2e` |
| 22. Rayons décimaux contre contrat entier | Fait | `packages/domain/src/dispatch/scoring.ts` (`parseSearchRadii` arrondit) ; `packages/domain/test/dispatch.test.ts` |
| 2, 3, 6, 7, 11, 12 | Déjà corrigés (lot A) | `revue-2026-10-02-a.md` ; code : `quotes.service.ts:122`, `credits.service.ts`, `statements.service.ts:163`, `settlement-payouts.service.ts`, `organization-statements.service.ts`, `payments.service.ts:537` ; essais : `revue-a-argent.e2e` (constats 2, 3, 6, 7, 11) |
| 19. Facturation plateforme à l'heure exacte | Réservé à U2 (correctif décrit) | voir ci-dessous |
| 5. Packs non obligatoires | En place (décision du fondateur) | `scoring.ts` (`packPriorityTier`, `splitByPackPriority`), `dispatch.service.ts:675-679`, réglage `dispatch.pack_priority_seconds` (120) dans `seed/data.ts`, `drivers.require_active_pack` à `false` ; `packages/domain/test/platform-fee.test.ts` |

## Correctifs décrits pour les fichiers d'autres agents

- **Constat 19 (U2, `apps/api/src/modules/platform-billing/billing-jobs.service.ts`, `tick`)** : remplacer `if (localTimeParts(now, this.env.TIMEZONE).hour !== runHour) return null;` par `if (localTimeParts(now, this.env.TIMEZONE).hour < runHour) return null;` puis réserver la journée avec la garde commune : `const day = localDate(now, this.env.TIMEZONE).date; if (!(await claimDailyRun(this.database, 'billing', day, now))) return null;` (import de `apps/api/src/common/daily-run.ts`, injection `@Inject(DB) private readonly database: Database`), et après `this.run(now)` : `await completeDailyRun(this.database, 'billing', day, new Date())` (`run` isole déjà chaque étape). Un worker démarré après 5 h, ou une passe manquée, rattrape alors le cycle le jour même ; deux processus ne le font jamais ensemble.
- **Constat web 18, reste (`apps/web/src/lib/server/gateway.ts`, `setSession` et `sessionUser`, session principale)** : signer le témoin `nm_hub_user` (HMAC-SHA256 avec une variable serveur `HUB_COOKIE_SECRET` de 32 caractères au moins, passée au seul service `web` dans `infra/compose.prod.yml`), et passer ce seul témoin en `SameSite=Lax` (les témoins `nm_hub_at` et `nm_hub_rt` restent `Strict`). `parseHubUserCookie` vérifierait alors la signature. Le nouvel essai depuis le site de `LoginRedirect` couvre déjà le cas courant du lien de courriel.
- **Point mineur web (`apps/web/Dockerfile`, `HEALTHCHECK`)** : sonder `/robots.txt` plutôt que la page d'accueil rendue à la demande (non fait : hors des points demandés).

## Essais (3 octobre 2026)

| Commande | Résultat |
|---|---|
| `bash -n` et ShellCheck 0.11.0 (`-S style`) sur `infra/deploy.sh`, `infra/server-setup.sh`, `infra/scripts/*.sh` | Aucun avertissement sur les fichiers modifiés ; un avertissement existant (SC2155) dans `env-set.sh`, non touché |
| `caddy adapt` (Caddy 2.10.2) sur `infra/Caddyfile`, puis serveur local avec le même filtre | Configuration valide ; journal sans IP complète, en-têtes, chaîne de requête ni jeton |
| Essai local de l'empreinte authentifiée et du battement (`backup.sh`, `restore.sh`) | Empreintes identiques entre les deux scripts, différentes si la phrase ou le fichier change ; adresse du battement transmise à curl par l'entrée standard |
| Analyse YAML des quatre workflows | Valides ; permissions attendues |
| Essai Edge sans interface : PDF dans un cadre avec et sans `sandbox` | Bloqué avec `sandbox` (vide ou `allow-scripts`), affiché sans |
| `pnpm --filter @neomoov/web typecheck` ; `pnpm --filter @neomoov/web test` | Vert ; 11 fichiers, 51 tests verts (dont `revue-web-durcissement.test.ts`, 10 tests) |
| `pnpm --filter @neomoov/domain test` | 45 fichiers, 611 tests verts ; `quote.ts` et `scoring.ts` à 100 %. Seuil global de couverture non atteint à cause de `marketing/publications.ts`, `marketing/visuals.ts` et `schemas/publications.ts`, déjà sous 100 % dans `main` (publication multiréseau), non touchés ici |
| `pnpm --filter @neomoov/db test` | 6 fichiers, 28 tests verts (journal strictement croissant, un fichier inverse par migration) |
| `pnpm --filter @neomoov/api typecheck` ; `build` puis `pnpm --filter @neomoov/worker typecheck` | Verts |
| `db:migrate` sous le verrou | 0039 appliquée sur la base de développement (index et `audit_log_guard` présents) ; premier essai coupé par la panne de réseau (`ENOTFOUND`), relancé |
| E2E sous le verrou : `revue-u6-taches`, `retention`, `compliance`, `invoicing`, `quotes`, `isolation-coverage` | Voir la section suivante |

## Ce qui reste ou demande une décision

- Décisions du fondateur (inscrites dans `docs/decisions.md`, « À trancher ») : fournisseur des tuiles ; seau de sauvegarde au Canada et moniteurs Better Stack ; antivirus réel des documents ; bascule vers l'utilisateur `deploy`.
- Accès attendus (serveur) : premier essai de restauration (`infra/scripts/restore-test.sh`) et report dans `docs/runbooks/sauvegardes.md` ; relancer `infra/server-setup.sh` (rejouable) pour rclone, le cron mensuel et la rotation des journaux sur le serveur déjà préparé.
- Migration `0039` : à renuméroter par la session principale si un autre agent a pris 0039 ; son `when` (1791042182099) est déjà appliqué sur la base de développement, une migration d'un autre agent avec un `when` plus petit y serait sautée (règle de `COMMUN.md`).
- Bascule bleu-vert de l'API (constat web 7) : non faite, à reprendre avec un serveur d'essai.
