/**
 * Chargé par Next.js dans le navigateur avant l'hydratation : suivi des erreurs (Sentry) seulement si
 * `NEXT_PUBLIC_SENTRY_DSN` est renseignée (voir `src/lib/observability.ts`).
 */
import { initBrowserErrorReporting } from '@/lib/observability';

initBrowserErrorReporting();
