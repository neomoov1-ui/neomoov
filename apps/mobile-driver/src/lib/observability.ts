/**
 * Suivi des erreurs de l'application (Sentry, prompt 15 tâche 6) : démarré au chargement de la racine, seulement si
 * `EXPO_PUBLIC_SENTRY_DSN` est renseignée. Version de l'application et numéro de build, environnement du profil EAS ;
 * les pannes de l'API vues par l'application sont signalées avec leur identifiant de corrélation.
 */
import { initMobileErrorReporting, reportMobileError } from '@neomoov/mobile-core/sentry';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { SENTRY_DSN, SENTRY_ENVIRONMENT } from './config';

export function initObservability(): boolean {
  return initMobileErrorReporting({
    app: 'mobile-driver',
    dsn: SENTRY_DSN,
    environment: SENTRY_ENVIRONMENT,
    version: Application.nativeApplicationVersion ?? Constants.expoConfig?.version,
    build: Application.nativeBuildVersion,
    isDev: __DEV__,
  });
}

export { reportMobileError };
