/**
 * Serveur Next.js : suivi des erreurs (Sentry) des pages rendues côté serveur et des relais `/api/*`, seulement si
 * `NEXT_PUBLIC_SENTRY_DSN` est renseignée ; sans DSN, le SDK n'est pas chargé.
 */
import type { Instrumentation } from 'next';
import { sentryConfig, sentryOptions } from '@/lib/observability';

export async function register(): Promise<void> {
  const config = sentryConfig();
  if (!config || process.env['NEXT_RUNTIME'] !== 'nodejs') return;
  const sdk = await import('@sentry/nextjs');
  sdk.init(sentryOptions(config));
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (!sentryConfig() || process.env['NEXT_RUNTIME'] !== 'nodejs') return;
  const sdk = await import('@sentry/nextjs');
  sdk.captureRequestError(error, request, context);
};
