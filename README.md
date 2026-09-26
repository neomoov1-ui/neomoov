# Neomoov, plateforme

Dépôt privé du Groupe NSK Inc. Monorepo de la plateforme Neomoov : API, worker, applications mobiles client et chauffeur, My Hub et réservation web.

- Spécification : `docs/cahier-des-charges-v1.md` (fait foi)
- Prompts du sprint : `docs/prompts/` (00 à 18)
- Architecture réelle : `docs/architecture.md`
- Design : `docs/design/`
- Décisions : `docs/decisions.md`
- Comptes externes et clés : `docs/comptes-externes.md`
- Accès à fournir pour la mise en ligne (serveur, fournisseurs, GitHub, EAS, magasins) : `docs/operations/acces-a-fournir.md`
- Manuels d'exploitation : `docs/runbooks/` ; journée type : `docs/operations/daily.md`
- Magasins et bêta : `docs/store/`, `docs/beta/`
- Règles pour Claude Code : `CLAUDE.md`

## Démarrer

```
pnpm install
cp .env.example .env      # puis DATABASE_URL (Supabase, session pooler) ; le reste peut rester vide
pnpm db:migrate && pnpm db:seed
pnpm dev                  # API http://localhost:4000 (/v1/health, /v1/docs), worker, web http://localhost:3000
pnpm dev:client           # application client (Expo)
pnpm dev:driver           # application chauffeur (Expo)
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

`pnpm db:seed` crée des comptes de démonstration sur une base de développement, jamais en production (`docs/runbooks/base-de-donnees.md`, section 4). En production, l'API refuse de démarrer si un fournisseur est laissé simulé sans être déclaré dans `ALLOW_MOCK_PROVIDERS` (`docs/operations/acces-a-fournir.md`).

État : journal daté des décisions dans `docs/decisions.md` ; au 26 septembre 2026, revue finale de la V1 (étape 17) en cours.

Niveau interne : ce dépôt ne devient jamais public.
