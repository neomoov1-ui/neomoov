/**
 * Suivi des erreurs (Sentry, prompt 15 tâche 6) pour l'API et le worker. Actif seulement si `SENTRY_DSN` est
 * renseignée : sans DSN, le SDK n'est même pas chargé (aucun appel réseau, aucun coût). Chaque événement porte la
 * version (`APP_VERSION`), l'environnement (`SENTRY_ENVIRONMENT`, sinon NODE_ENV), le service et l'identifiant de
 * corrélation de la requête ou de la tâche. Les secrets et données personnelles sont filtrés avant l'envoi
 * (`scrubErrorEvent`, mêmes clés que le journal). Seules les erreurs partent : ni traces de performance, ni données
 * de requête, ni variables locales, ni fil d'Ariane des appels sortants (leurs adresses portent des clés).
 */
import { scrubErrorEvent } from '@neomoov/domain';
import type { Logger } from 'pino';
import type { AppEnv } from '../config/env.js';
import { currentCorrelationId } from './logger.js';

type SentryModule = typeof import('@sentry/node');

let sentry: SentryModule | null = null;

/** Version et environnement du déploiement, pour la santé et le suivi des erreurs. */
export function releaseInfo(env: Pick<AppEnv, 'NODE_ENV' | 'APP_VERSION' | 'SENTRY_ENVIRONMENT'>): { version: string; environment: string } {
  return { version: env.APP_VERSION ?? process.env['npm_package_version'] ?? '0.0.0', environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV };
}

export interface ErrorReportingOptions {
  dsn: string | undefined;
  service: 'api' | 'worker';
  environment: string;
  release: string;
  logger?: Logger | undefined;
  /** Chargement du SDK (remplacé dans les tests). */
  load?: () => Promise<SentryModule>;
}

/** Démarre le suivi des erreurs si un DSN est fourni ; renvoie vrai s'il est actif. N'échoue jamais. */
export async function initErrorReporting(options: ErrorReportingOptions): Promise<boolean> {
  if (!options.dsn) return false;
  try {
    const sdk = await (options.load ?? (() => import('@sentry/node')))();
    sdk.initWithoutDefaultIntegrations({
      dsn: options.dsn,
      environment: options.environment,
      release: options.release,
      // Aucune donnée personnelle collectée par le SDK : ni utilisateur, ni témoins, ni en-têtes, ni corps, ni paramètres
      // d'URL, ni requêtes SQL, ni données des tâches, ni variables locales.
      dataCollection: {
        userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, databaseQueryData: false, queues: false,
        stackFrameVariables: false, genAI: { inputs: false, outputs: false },
      },
      integrations: [
        sdk.eventFiltersIntegration(), sdk.functionToStringIntegration(), sdk.linkedErrorsIntegration(), sdk.dedupeIntegration(),
        sdk.onUncaughtExceptionIntegration(), sdk.onUnhandledRejectionIntegration(), sdk.nodeContextIntegration(),
      ],
      initialScope: { tags: { service: options.service } },
      beforeSend: (event) => scrubErrorEvent(event),
      beforeBreadcrumb: (breadcrumb) => scrubErrorEvent(breadcrumb),
    });
    sentry = sdk;
    options.logger?.info({ environment: options.environment, release: options.release, service: options.service }, 'Suivi des erreurs (Sentry) actif');
    return true;
  } catch (error) {
    options.logger?.error({ err: error }, 'Suivi des erreurs (Sentry) non démarré : le service continue sans');
    return false;
  }
}

export function errorReportingActive(): boolean {
  return sentry !== null;
}

/**
 * Signale une erreur au suivi des erreurs (sans effet s'il n'est pas actif), avec l'identifiant de corrélation courant
 * et des étiquettes (code d'erreur, file, tâche). Les données jointes sont filtrées comme le reste de l'événement.
 */
export function reportError(error: unknown, context: { tags?: Record<string, string | number | undefined>; extra?: Record<string, unknown> } = {}): void {
  if (!sentry) return;
  const tags: Record<string, string | number> = {};
  for (const [key, value] of Object.entries({ correlationId: currentCorrelationId(), ...context.tags })) if (value !== undefined) tags[key] = value;
  sentry.captureException(error, context.extra ? { tags, extra: context.extra } : { tags });
}

/** Envoie les événements en attente (arrêt du processus). */
export async function flushErrorReporting(timeoutMs = 2_000): Promise<void> {
  if (sentry) await sentry.flush(timeoutMs).catch(() => false);
}

/** Tests seulement : oublie le SDK chargé. */
export function resetErrorReporting(): void {
  sentry = null;
}
