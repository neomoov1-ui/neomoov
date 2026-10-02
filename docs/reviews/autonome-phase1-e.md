# Revue de la phase 1 « entreprise autonome », agent E : marketing automatisé (2 octobre 2026)

Périmètre : calendrier de contenu hebdomadaire (agent `content`), diffusion, mesures et commentaires (agent `publishing`), plan de référencement (agent `seo`), connecteurs des onze espaces, file `marketing`, écran My Hub « Marketing », documents. Mission : `neomoov-outils/agents/M-autonome-e-marketing.md`.

Branche `autonome-e-marketing` (copie `neomoov-wt20c`). Commits : `e87f64a` (domaine, schéma, adaptateurs, services), puis les commits « En cours » du module, des routes, de l'écran et des tests, puis la fin de mission. Jamais fusionnée dans `main`.

## Migration

`packages/db/drizzle/0032_marketing.sql` (numéro provisoire, à renuméroter à la fusion) et son inverse `down/0032_marketing.sql` : tables `content_items`, `content_comments`, `seo_tasks`, sécurité au niveau des lignes activée sans politique (tables réservées à la plateforme : `PLATFORM_ONLY_TABLES` et `docs/isolation.md`), droits de `neomoov_scoped`. **Appliquée sur la base de développement le 2 octobre 2026 à 22 h 33 (heure du poste), sous le verrou `autonome-e`** (entrée 43 de `drizzle.__drizzle_migrations`, `when` 1790971475183). Données de départ (agents et réglages `marketing.*`, `seo.*`) déjà présentes sur la base de développement.

## Critères et résultat

| Critère (mission, points 1 à 7) | Résultat |
|---|---|
| `content_items` : espace parmi les onze codes, format, titre, corps, légende, mots-clics, média, créneau, états, identifiant externe, mesures, sensible, version du prompt ; table plateforme | Fait ; état `rejected` ajouté (refus motivé) ; `content_comments` en plus (commentaires reçus et réponses) |
| `seo_tasks` : cible, action, état, justification, mesures avant et après | Fait (actions `new_page`, `new_article`, `fix_title`, `fix_description`, `faq_question`, `internal_link`) |
| Agent `content` : vendredi 9 h (`marketing.content_day`, `marketing.content_hour`), 2 à 5 contenus par espace, sortie structurée, lignes éditoriales, preuves par `queryMetrics`, `draft`, sensible → approbation | Fait ; seuls les espaces dont le connecteur est configuré sont demandés ; en mode `auto`, les contenus sûrs passent `scheduled`, les sensibles ou bloqués attendent un humain |
| Visuels de marque et vidéo courte (TTS) | Fait en différé : gabarit HTML par format, photo réelle de la médiathèque, rendu PNG par `BROWSER_BIN` ; vidéo par `TtsProvider` (Piper ou Azure, simulé en test) et ffmpeg. Sans navigateur, état `html` (les connecteurs simulés l'acceptent) |
| Agent `publishing` : créneaux (`marketing.slots`), `SocialPublisher`, WordPress, Academy, Brevo (brouillon), Meta réels ; six autres simulés avec variables et droits documentés ; mesures J+1 et J+7 ; réponses aux commentaires simples ; le reste vers la relation client ou un humain | Fait ; réponses par textes fixes du domaine (aucun appel au modèle) ; `conversation.inbound` canal `social` dès que l'agent D l'offre, sinon alerte `alert.agent_escalation` |
| Agent `seo` : lundi 6 h, pages WordPress, `seo.keywords`, Search Console (simulée sans clés), tâches justifiées, application des balises et brouillons | Fait ; constats déterministes du domaine puis propositions du modèle ; un lien interne approuvé reste manuel |
| My Hub « Marketing » : calendrier par espace, approbation en un clic, aperçu, état, mesures ; onglet « Référencement » ; i18n FR et EN ; `marketing.read`, `marketing.manage` | Fait (`/hub/marketing`, onglets Calendrier, Référencement, Espaces) ; approbation directe (pas la file `approvals`, décision consignée) |
| Tests e2e et domaine (couverture 100 %) | Faits, verts (section suivante) |
| `docs/marketing/lignes-editoriales.md`, `docs/marketing/connecteurs.md`, `docs/decisions.md`, cette note | Faits ; prompts `docs/agents/content.v1.md` et `docs/agents/seo.v1.md` |
| OpenAPI régénérée, `api-client` compilé | Fait : 12 chemins `/v1/admin/marketing/...`, ressource `marketing` de l'api-client |

## Routes (`/v1/admin/marketing`)

`GET spaces`, `GET content` (semaine, espace), `POST content/plan`, `GET content/:id`, `GET content/:id/media`, `PATCH content/:id`, `POST content/:id/approve`, `POST content/:id/reject`, `POST content/:id/publish`, `GET seo/tasks`, `POST seo/plan`, `POST seo/tasks/:id/approve`, `POST seo/tasks/:id/reject`. Lecture : `marketing.read` ; actions : `marketing.manage`.

## Tests lancés (2 octobre 2026)

- Constructions `@neomoov/domain`, `@neomoov/db`, `@neomoov/api-client` : vertes.
- Types : `@neomoov/api`, `@neomoov/domain`, `@neomoov/web`, `@neomoov/worker` : verts.
- `packages/domain` : `vitest run --coverage` : 39 fichiers, 527 tests verts, seuils de 100 % respectés.
- `apps/api` sans base : `test/marketing-adapters.test.ts`, `test/env.test.ts`, `test/mock-webhooks-production.test.ts` : 20 tests verts (après correction du test Square, voir pièges).
- `apps/api` sous le verrou : `test/autonome-e-marketing.e2e.test.ts` : 7 tests verts (100 s) ; `test/isolation-coverage.e2e.test.ts` : 2 verts, 2 en échec à cause de tables d'autres agents présentes sur la base partagée et absentes de cette branche (`prospects`, `followups`, `outbound_calls`, `prospect_touches` sans politique ; `performance_logs`, `vehicle_inspections` dans la liste des tables à politique) ; `content_items`, `content_comments` et `seo_tasks` passent (sécurité activée, droits, entrée plateforme).
- `packages/api-client` : 30 tests verts ; `packages/db` : `journal.test.ts`, `agent-prompts.test.ts`, `seed-data.test.ts`, `plans-data.test.ts` : 22 tests verts.

## Reste à faire

- Connecteurs réels LinkedIn, TikTok, YouTube, X, Fiche Google et Snapchat : interfaces et variables prêtes, implémentation à écrire sur le modèle de `real/meta-graph.ts` quand les accès sont obtenus (droits à demander : `docs/marketing/connecteurs.md`).
- Agent `publishing` : ses actes sont journalisés dans son exécution (`recordToolCall`, `socialPublish`) mais ne passent pas par des outils déclarés de `AgentToolsService` ; à aligner si la session principale l'exige. Pas de prompt `publishing.v1` (aucun appel au modèle).
- Rendu PNG et MP4 sur le serveur : `BROWSER_BIN`, `FFMPEG_BIN` et la voix (Piper ou Azure) à installer et renseigner ; sans eux, Instagram, TikTok, YouTube et Snapchat refusent de publier en mode réel.
- Vérification du connecteur WordPress réel en brouillon, seulement quand `WORDPRESS_*` sera renseigné (non faite : pas d'accès au `.env`).
- Envoi automatique de l'infolettre : décision du fondateur (campagne Brevo en brouillon d'ici là).

## Pièges

- **Production** : `MARKETING_PROVIDER` vaut `mock` par défaut ; en production, l'API refuse de démarrer tant que `marketing` n'est pas dans `ALLOW_MOCK_PROVIDERS` ou que `MARKETING_PROVIDER=real` n'est pas posé (en mode réel sans clés, chaque espace refuse clairement, aucune donnée simulée). À poser dans `/opt/neomoov/.env` avant de déployer cette branche.
- `test/env.test.ts` (Square, étape 26) listait les alias sans `marketing` : corrigé.
- Sortie simulée du modèle : un champ `nullable` du schéma doit être présent (`title: null`), sinon `invalid_output` et aucun contenu.
- Le premier `Intl.DateTimeFormat` avec fuseau est lent sous couverture : formateurs en cache, délai de 20 s sur le test des instants locaux.
- `db:migrate` n'applique une migration que si son `when` dépasse la dernière appliquée : le `when` de 0032 a été remonté une fois (1790971475183) ; ne plus le changer.
