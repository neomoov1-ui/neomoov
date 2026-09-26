# Image de l'API Neomoov. Contexte de construction : la racine du dépôt.
#   docker build -f apps/api/Dockerfile -t neomoov-api .
# Trois étapes : dépendances complètes et construction, dépendances de production seules, image finale minimale.

FROM node:24-alpine AS base
RUN npm install -g pnpm@12.5.1 --no-audit --no-fund
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/config/package.json packages/config/
COPY packages/domain/package.json packages/domain/
COPY packages/db/package.json packages/db/
COPY packages/api-client/package.json packages/api-client/
COPY packages/mobile-core/package.json packages/mobile-core/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY apps/mobile-client/package.json apps/mobile-client/
COPY apps/mobile-driver/package.json apps/mobile-driver/

FROM base AS build
RUN pnpm install --frozen-lockfile --filter "@neomoov/api..."
COPY packages/config packages/config
COPY packages/domain packages/domain
COPY packages/db packages/db
COPY apps/api apps/api
RUN pnpm --filter "@neomoov/api..." run build

FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter "@neomoov/api..."

FROM node:24-alpine AS runtime
ENV NODE_ENV=production PORT=4000
WORKDIR /app
COPY --from=prod-deps /repo ./
COPY --from=build /repo/packages/domain/dist packages/domain/dist
COPY --from=build /repo/packages/db/dist packages/db/dist
COPY --from=build /repo/packages/db/drizzle packages/db/drizzle
COPY --from=build /repo/apps/api/dist apps/api/dist
# Prompts système des agents, lus par les données de départ (`db:seed` lancé depuis cette image) : sans eux, agents sans prompt.
COPY docs/agents docs/agents
USER node
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=5 CMD wget -qO- http://127.0.0.1:4000/v1/health >/dev/null || exit 1
CMD ["node", "--enable-source-maps", "dist/main.js"]
