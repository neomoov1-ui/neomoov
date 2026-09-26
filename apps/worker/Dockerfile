# Image du worker Neomoov (files BullMQ). Contexte de construction : la racine du dépôt.
#   docker build -f apps/worker/Dockerfile -t neomoov-worker .

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
RUN pnpm install --frozen-lockfile --filter "@neomoov/worker..."
COPY packages/config packages/config
COPY packages/domain packages/domain
COPY packages/db packages/db
COPY apps/api apps/api
COPY apps/worker apps/worker
RUN pnpm --filter "@neomoov/worker..." run build

FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter "@neomoov/worker..."

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /repo ./
COPY --from=build /repo/packages/domain/dist packages/domain/dist
COPY --from=build /repo/packages/db/dist packages/db/dist
COPY --from=build /repo/packages/db/drizzle packages/db/drizzle
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/worker/dist apps/worker/dist
USER node
WORKDIR /app/apps/worker
# Sain tant que le battement de la minute écrit son fichier (planification et files en marche) : 3 minutes de tolérance.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 CMD node -e "const s=require('fs').statSync('/tmp/neomoov-worker-heartbeat');process.exit(Date.now()-s.mtimeMs<180000?0:1)"
CMD ["node", "--enable-source-maps", "dist/main.js"]
