# Neomoov, plateforme

Dépôt privé du Groupe NSK Inc. Monorepo de la plateforme Neomoov : API, worker, applications mobiles client et chauffeur, My Hub et réservation web.

- Spécification : `docs/cahier-des-charges-v1.md` (fait foi)
- Prompts du sprint : `docs/prompts/` (00 à 18)
- Architecture réelle : `docs/architecture.md`
- Design : `docs/design/`
- Décisions : `docs/decisions.md`
- Comptes externes et clés : `docs/comptes-externes.md`
- Manuels d'exploitation : `docs/runbooks/`
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

État au 24 septembre 2026 : étapes 0, 1 et 2 faites. Monorepo complet (API NestJS avec santé, OpenAPI, adaptateurs simulés ; worker BullMQ ; web Next.js avec accueil et My Hub verrouillé ; deux applications Expo ; client d'API ; Docker Compose ; intégration continue GitHub). Schéma Drizzle de 72 tables migré et semé sur Supabase `neomoov-dev` (Canada central). Étape suivante : prompt 03 (authentification et comptes), puis l'infrastructure de déploiement LWS (décision D48) dès réception du serveur.

Niveau interne : ce dépôt ne devient jamais public.
