# Image du web Neomoov (My Hub, réservation web), Next.js en mode autonome. Contexte : la racine du dépôt.
#   docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_BASE_URL=https://api.neomoov.net -t neomoov-web .

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
# Valeurs inscrites dans le bundle au moment de la construction : l'adresse de l'API vue du navigateur, et le suivi des
# erreurs (DSN public du projet Sentry « web », environnement, version ; vides : aucun suivi).
ARG NEXT_PUBLIC_API_BASE_URL=https://api.neomoov.net
ARG NEXT_PUBLIC_SENTRY_DSN=
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT=
ARG NEXT_PUBLIC_APP_VERSION=
# Clé de site Cloudflare Turnstile (publique) : sans elle, la préinscription des chauffeurs et la réservation web refusent en production.
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN NEXT_PUBLIC_SENTRY_ENVIRONMENT=$NEXT_PUBLIC_SENTRY_ENVIRONMENT NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY NEXT_TELEMETRY_DISABLED=1
RUN pnpm install --frozen-lockfile --filter "@neomoov/web..."
COPY packages/config packages/config
COPY packages/domain packages/domain
COPY packages/api-client packages/api-client
COPY apps/web apps/web
RUN pnpm --filter "@neomoov/web..." run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=5 CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]
