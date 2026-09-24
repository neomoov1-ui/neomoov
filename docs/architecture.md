# Architecture de la plateforme Neomoov

Résumé de la section 3 du cahier des charges v1.1, avec l'arborescence réelle du dépôt. Le cahier des charges fait foi ; ce document décrit ce qui existe.

## Vue d'ensemble

Un monorepo pnpm et Turborepo. Cinq applications et cinq paquets partagés, en TypeScript strict partout.

| Application | Rôle | Technologie | Hébergement V1 |
|---|---|---|---|
| `apps/api` | API REST `/v1`, OpenAPI sur `/v1/docs`, temps réel (Socket.IO), adaptateurs des fournisseurs | NestJS 12, Zod, pino | VPS LWS (Docker Compose, deux instances derrière Caddy) |
| `apps/worker` | Tâches de fond : notifications, facturation, règlements hebdomadaires, exports, agents | NestJS 12, BullMQ | VPS LWS |
| `apps/web` | My Hub (back-office), réservation web publique | Next.js 16 (App Router), Tailwind 4, TanStack Query, i18next | VPS LWS |
| `apps/mobile-client` | Application client « Neomoov » (`com.neomoov.client`) | Expo SDK 57, Expo Router, React Native 0.86 | App Store, Google Play |
| `apps/mobile-driver` | Application « Neomoov Chauffeur » (`com.neomoov.driver`) | Expo SDK 57, Expo Router | App Store, Google Play |

| Paquet | Rôle |
|---|---|
| `packages/domain` | Fonctions pures, sans dépendance d'infrastructure : énumérations, moteur de tarification, moteur de packs, moteur de règlement, machine à états des courses, schémas Zod des objets d'API. Couverture de 100 % exigée sur la tarification et le règlement |
| `packages/db` | Schéma Drizzle (72 tables, PostGIS), migrations et leurs inverses, données de départ, `buildPricingRules` |
| `packages/api-client` | Client HTTP typé de l'API pour le web et les mobiles (jeton, rafraîchissement, corrélation, erreurs), description OpenAPI exportée |
| `packages/mobile-core` | Thème (couleurs, typographie), composants (Bouton, Champ, Carte, Feuille), i18n partagés par les deux applications mobiles |
| `packages/config` | `tsconfig` de base strict, partagé |

## Arborescence réelle

```
neomoov/
  apps/
    api/            src/{bootstrap,main,app.module,core.module}.ts, src/config/env.ts, src/common/ (erreurs, journal, corrélation, validation Zod),
                    src/infra/ (db, redis, files), src/adapters/ (interfaces des dix fournisseurs, mock/ et real/), src/modules/health/, src/scripts/export-openapi.ts
    worker/         src/main.ts, src/worker.module.ts (file heartbeat chaque minute)
    web/            src/app/ (accueil, /hub, /hub/connexion), src/components/, src/lib/i18n.ts
    mobile-client/  app.json, eas.json, src/app/ (Expo Router), src/i18n.ts, assets/images/
    mobile-driver/  même structure
  packages/
    domain/         src/{enums,pricing,packs,settlement,rides,schemas}
    db/             src/schema/, src/seed/, drizzle/ (migrations) et drizzle/down/ (inverses), scripts/
    api-client/     src/{client,errors,types,index}.ts, src/openapi.json, scripts/generate.mjs
    mobile-core/    src/{theme,components,i18n,index}
    config/         tsconfig.base.json
  infra/
    docker-compose.yml   PostGIS, Redis, Mailpit, MinIO (intégration continue et postes avec Docker)
    scripts/             outils (icônes des applications)
  docs/
    cahier-des-charges-v1.md, decisions.md, comptes-externes.md, architecture.md, prompts/, design/, runbooks/
  .github/workflows/ci.yml
```

## Données

- PostgreSQL 16 avec PostGIS, hébergé chez Supabase, région Canada (Central). Connexion par le « session pooler » (IPv4), TLS exigé hors localhost. Développement : projet `neomoov-dev` ; test et production : projets distincts à venir.
- Montants en cents (entiers), devise CAD. Dates en UTC en base, affichage en `America/Toronto`.
- Tous les nombres d'exploitation (frais, redevance, taxes, seuils, rayons, heures de pointe) sont en base (`settings`, `pricing_rules`, `packs`, `promotions`), jamais dans le code.
- Positions et zones en `geography` (SRID 4326), historique des positions partitionné par jour, position courante dans `driver_presence`.
- Numérotation sans trou par table de compteurs ; `audit_log` et `ride_events` en ajout seul.

## Fournisseurs externes

Chaque service externe est derrière une interface dans `apps/api/src/adapters/`, avec une implémentation réelle et une implémentation simulée choisie par variable d'environnement (`*_PROVIDER=mock|real`) : paiement (Stripe Connect), cartes (Google Maps Platform), textos (Telnyx ou Twilio), courriels (Resend ou Brevo), notifications (Expo), WhatsApp (Meta), voix (Vapi), facturation certifiée (SEV, simulée en V1), agents IA (Anthropic), stockage (S3 compatible : Supabase Storage). Les tests utilisent toujours les implémentations simulées.

## Files et temps réel

- Sans `REDIS_URL` (développement) : files en mémoire, exécution immédiate, avertissement au démarrage.
- Avec Redis : BullMQ, trois tentatives avec délai exponentiel, files `heartbeat`, `notifications`, `invoicing`, `settlements`, `exports`, `agents`.
- Temps réel des courses par Socket.IO (adaptateur Redis dès qu'il y a plusieurs instances).

## Hébergement (décision D48 du 24 septembre 2026)

- Serveurs applicatifs : VPS KVM chez LWS (Ubuntu 24.04, Docker, Compose, Caddy avec TLS automatique). Images publiées sur GHCR par GitHub Actions. Redis tourne sur ce serveur. Aucun PostgreSQL sur le VPS.
- Sous-domaines : `api.neomoov.net`, `hub.neomoov.net`, `reserver.neomoov.net`. Le site vitrine `neomoov.net` (WordPress) ne bouge pas.
- Les centres de données LWS sont en France : la base et les documents restent au Canada ; la résidence des serveurs applicatifs est une décision à prendre avec l'avocat avant le lancement commercial (section 10.3). `infra/compose.prod.yml` doit fonctionner à l'identique sur un hôte canadien.
- Railway et Vercel : secours documenté seulement.

## Qualité

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` passent avant tout commit ; l'intégration continue les rejoue sur une base PostGIS de service avec migrations et données de départ. Une tâche est terminée selon la définition de `CLAUDE.md`.
