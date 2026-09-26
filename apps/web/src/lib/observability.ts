/**
 * Suivi des erreurs du web (Sentry, prompt 15 tâche 6) : navigateur (`instrumentation-client.ts`) et serveur Next.js
 * (`instrumentation.ts`). Actif seulement si `NEXT_PUBLIC_SENTRY_DSN` est renseignée : sans DSN, le SDK n'est jamais
 * chargé (aucun code téléchargé, aucun appel réseau). Version (`NEXT_PUBLIC_APP_VERSION`) et environnement
 * (`NEXT_PUBLIC_SENTRY_ENVIRONMENT`, sinon NODE_ENV) accompagnent chaque événement ; les secrets et données
 * personnelles sont filtrés avant l'envoi (`scrubErrorEvent`, mêmes clés que le journal de l'API). Seules les
 * erreurs partent : ni traces de performance, ni rejeu de session.
 */
import { ApiError } from '@neomoov/api-client';
import { scrubErrorEvent } from '@neomoov/domain';

export interface WebSentryConfig {
  dsn: string;
  environment: string;
  release: string;
}

/** Configuration tirée des variables publiques (inscrites au build) ; null sans DSN. */
export function sentryConfig(
  env: { dsn?: string | undefined; environment?: string | undefined; release?: string | undefined; nodeEnv?: string | undefined } = {
    dsn: process.env['NEXT_PUBLIC_SENTRY_DSN'],
    environment: process.env['NEXT_PUBLIC_SENTRY_ENVIRONMENT'],
    release: process.env['NEXT_PUBLIC_APP_VERSION'],
    nodeEnv: process.env['NODE_ENV'],
  },
): WebSentryConfig | null {
  const dsn = env.dsn?.trim();
  if (!dsn) return null;
  return { dsn, environment: env.environment?.trim() || env.nodeEnv || 'development', release: env.release?.trim() || '0.0.0' };
}

/** Options communes au navigateur et au serveur : aucune donnée personnelle collectée, événements filtrés. */
export function sentryOptions(config: WebSentryConfig) {
  return {
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    initialScope: { tags: { service: 'web' } },
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, databaseQueryData: false, stackFrameVariables: false },
    beforeSend: <T extends object>(event: T): T => scrubErrorEvent(event),
    beforeBreadcrumb: <T extends object>(breadcrumb: T): T => scrubErrorEvent(breadcrumb),
  };
}

type SentrySdk = typeof import('@sentry/nextjs');
let browserSdk: Promise<SentrySdk | null> | null = null;

/** Démarre le suivi des erreurs du navigateur (une fois) ; sans DSN, ne fait rien. */
export function initBrowserErrorReporting(config = sentryConfig()): boolean {
  if (!config) return false;
  browserSdk ??= import('@sentry/nextjs')
    .then((sdk) => {
      sdk.init(sentryOptions(config));
      return sdk;
    })
    .catch(() => null);
  return true;
}

/** Étiquettes d'une erreur : l'identifiant de corrélation d'une erreur de l'API relie l'événement aux journaux de l'API. */
export function errorTags(error: unknown, tags: Record<string, string> = {}): Record<string, string> {
  if (!(error instanceof ApiError)) return tags;
  return { ...tags, apiCode: error.code, apiStatus: String(error.status), ...(error.correlationId ? { correlationId: error.correlationId } : {}) };
}

/** Une erreur d'API mérite un signalement : panne côté serveur (5xx), pas un refus attendu ni une coupure réseau. */
export function isReportable(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status >= 500;
}

/** Signale une erreur du navigateur (sans effet si le suivi n'est pas actif). */
export function reportBrowserError(error: unknown, tags: Record<string, string> = {}): void {
  if (!browserSdk || !isReportable(error)) return;
  void browserSdk.then((sdk) => sdk?.captureException(error, { tags: errorTags(error, tags) }));
}
