/**
 * Démarrage du suivi des erreurs dans une application Expo (SDK `@sentry/react-native`, version recommandée par
 * Expo SDK 57). Sans DSN, rien n'est démarré. Les erreurs JavaScript non rattrapées et les promesses rejetées sont
 * captées par le SDK ; les pannes de l'API vues par l'application le sont par `reportMobileError`.
 */
import * as Sentry from '@sentry/react-native';
import { errorTags, isReportable, mobileSentryConfig, mobileSentryOptions, type MobileSentryInput } from './observability';

let active = false;

/** Démarre le suivi des erreurs (une fois) ; renvoie vrai s'il est actif. N'échoue jamais. */
export function initMobileErrorReporting(input: MobileSentryInput): boolean {
  if (active) return true;
  const config = mobileSentryConfig(input);
  if (!config) return false;
  try {
    Sentry.init(mobileSentryOptions(config));
    active = true;
  } catch {
    active = false;
  }
  return active;
}

/** Signale une erreur (sans effet si le suivi n'est pas actif), avec l'identifiant de corrélation d'une erreur de l'API. */
export function reportMobileError(error: unknown, tags: Record<string, string> = {}): void {
  if (!active || !isReportable(error)) return;
  Sentry.captureException(error, { tags: errorTags(error, tags) });
}
