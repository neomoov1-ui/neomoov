# Prompt 01. Étape 1 : initialisation du monorepo et de l'outillage (J1)

---

Nous démarrons la construction de la plateforme Neomoov. Lis d'abord `CLAUDE.md` puis `docs/cahier-des-charges-v1.md`, sections 1, 2, 3 (en entier) et 11.1 (ligne de l'étape 1). Ne lis pas encore les autres sections.

## Objectif
Mettre en place le monorepo complet, vide de logique métier mais prêt à recevoir chaque étape suivante : outillage, structure, configurations partagées, environnement local Docker, squelettes des cinq applications, intégration continue, scripts.

## Tâches
1. Initialise le monorepo avec pnpm workspaces et Turborepo selon l'arborescence de la section 3.3. Crée `packages/config` (ESLint, Prettier, tsconfig de base strict), `packages/domain`, `packages/api-client`, `packages/mobile-core`, `apps/api`, `apps/worker`, `apps/web`, `apps/mobile-client`, `apps/mobile-driver`, `infra`, `docs`.
2. `apps/api` : NestJS 11 avec validation Zod (pipe global), module de configuration typé (schéma Zod des variables de la section 3.6, échec au démarrage si une variable obligatoire manque), journalisation pino avec identifiant de corrélation, endpoint `GET /v1/health` (base, Redis, files), génération OpenAPI sur `/v1/docs`, gestion d'erreurs au format `{ code, message, details, correlationId }`, structure `src/modules/`, `src/adapters/` (interfaces vides des dix fournisseurs de `CLAUDE.md` avec implémentations simulées et sélection par variable d'environnement), `src/common/`.
3. `apps/worker` : même base NestJS, connecté à Redis et BullMQ, une file de démonstration `heartbeat` planifiée chaque minute.
4. `apps/web` : Next.js (App Router) avec Tailwind et shadcn/ui, i18next (`fr-CA`, `en`), une page d'accueil, une page `/hub` protégée par un garde minimal (à remplacer à l'étape 3), TanStack Query.
5. `apps/mobile-client` et `apps/mobile-driver` : Expo (SDK stable le plus récent), Expo Router, TypeScript strict, i18next, thème partagé dans `packages/mobile-core` (couleurs de la section 6, typographie, composants Bouton, Champ, Carte de contenu, Feuille modale), configuration EAS (`eas.json` avec profils `development`, `preview`, `production`), identifiants `com.neomoov.client` et `com.neomoov.driver`, écran de démarrage avec le logo (placeholder si le fichier n'est pas encore fourni).
6. `infra/docker-compose.yml` : PostgreSQL avec `postgis/postgis:16-3.4`, Redis 7, Mailpit, MinIO ; scripts `pnpm db:up`, `db:down`, `db:reset`.
7. `.github/workflows/ci.yml` : installation, lint, typecheck, tests, build sur chaque poussée, avec services PostgreSQL et Redis ; cache pnpm et Turborepo.
8. Scripts racine de `CLAUDE.md` (dev, test, lint, typecheck, build, db). `.env.example` complet avec toutes les variables de la section 3.6, sans valeur. `.gitignore` (node_modules, .env, builds, caches, fichiers Expo locaux).
9. `docs/architecture.md` (résumé de la section 3 avec l'arborescence réelle), `docs/decisions.md` (vide, avec le format d'entrée : date, décision, motif, alternatives), `docs/runbooks/README.md`.
10. Un test unitaire et un test d'intégration de démonstration par application pour vérifier l'outillage.

## Adaptation du 22 septembre 2026 (décision du fondateur)
La base de développement est hébergée : PostgreSQL et PostGIS chez Supabase (région ca-central-1), Redis chez Railway. Les valeurs sont dans `.env` (`DATABASE_URL` par le session pooler de Supabase, `REDIS_URL`). Crée quand même `infra/docker-compose.yml` pour l’intégration continue et pour un poste qui aurait Docker, mais aucune commande de développement ne doit exiger Docker : `pnpm db:migrate`, `pnpm db:seed` et `pnpm dev` travaillent sur la base hébergée. Les tests d’intégration lisent `TEST_DATABASE_URL` (un schéma dédié de la même base en local, les services Docker dans l’intégration continue). Le paquet `packages/domain` existe déjà avec trois moteurs testés : ne le réécris pas, branche-le.

## Contraintes
- Aucune logique métier dans cette étape.
- Toutes les versions de dépendances sont épinglées dans `package.json` (pas de plages larges).
- Le dépôt doit démarrer avec `pnpm install && pnpm db:up && pnpm dev` sur une machine Windows 11 avec Node 24 et Docker Desktop.

## Critères d'acceptation
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` passent.
- `pnpm dev:api` répond sur `GET /v1/health` avec l'état de la base et de Redis ; `/v1/docs` affiche l'OpenAPI.
- `pnpm dev:web` affiche la page d'accueil en français et en anglais.
- Les deux applications Expo démarrent dans Expo Go ou en build de développement et affichent l'écran de démarrage.
- L'intégration continue passe sur GitHub.

## Vérifications à exécuter et à montrer
Sortie de `pnpm build`, `pnpm test`, appel de `GET /v1/health`, capture de l'OpenAPI, liste des fichiers créés.

## Fin de l'étape
Lance `/code-review`, corrige les constats bloquants, complète `docs/decisions.md` (choix de versions, choix d'outils), puis crée un commit « Étape 1 : initialisation du monorepo et de l'outillage ».
