/**
 * Suivi des erreurs des applications mobiles (Sentry, prompt 15 tâche 6), partie sans dépendance à React Native :
 * configuration, options et étiquettes. Actif seulement si `EXPO_PUBLIC_SENTRY_DSN` est renseignée au build : sans DSN,
 * le SDK n'est pas démarré (aucun appel réseau). Version de l'application et numéro de build forment la « release »,
 * l'environnement vient de `EXPO_PUBLIC_SENTRY_ENVIRONMENT` (sinon `development` en développement, `production`
 * sinon). Les secrets et données personnelles sont filtrés avant l'envoi (`scrubErrorEvent`, mêmes clés que le journal
 * de l'API). Le démarrage du SDK est dans `./sentry.ts`.
 */
import { scrubErrorEvent } from '@neomoov/domain';

export type MobileApp = 'mobile-client' | 'mobile-driver';

export interface MobileSentryInput {
  app: MobileApp;
  dsn: string | undefined;
  environment: string | undefined;
  /** Version affichée de l'application (`1.4.0`). */
  version: string | null | undefined;
  /** Numéro de build natif (`12`). */
  build: string | null | undefined;
  /** Vrai en développement (`__DEV__`). */
  isDev: boolean;
}

export interface MobileSentryConfig {
  dsn: string;
  environment: string;
  release: string;
  dist: string | undefined;
  app: MobileApp;
}

/** Identifiant d'application du bundle, pour nommer la version comme les magasins (`com.neomoov.client@1.4.0+12`). */
const BUNDLE_IDS: Record<MobileApp, string> = { 'mobile-client': 'com.neomoov.client', 'mobile-driver': 'com.neomoov.driver' };

/** Configuration du suivi des erreurs ; null sans DSN. */
export function mobileSentryConfig(input: MobileSentryInput): MobileSentryConfig | null {
  const dsn = input.dsn?.trim();
  if (!dsn) return null;
  const version = input.version?.trim() || '0.0.0';
  const build = input.build?.trim() || undefined;
  return {
    dsn,
    environment: input.environment?.trim() || (input.isDev ? 'development' : 'production'),
    release: `${BUNDLE_IDS[input.app]}@${version}${build ? `+${build}` : ''}`,
    dist: build,
    app: input.app,
  };
}

/**
 * Options du SDK : aucune donnée personnelle ajoutée par le SDK (`sendDefaultPii`), ni capture d'écran ni arbre des
 * vues (l'écran montre des adresses et des noms), pas de traces de performance ; événements et fils d'Ariane filtrés.
 */
export function mobileSentryOptions(config: MobileSentryConfig) {
  return {
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    ...(config.dist ? { dist: config.dist } : {}),
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    initialScope: { tags: { service: config.app } },
    beforeSend: <T extends object>(event: T): T => scrubErrorEvent(event),
    beforeBreadcrumb: <T extends object>(breadcrumb: T): T => scrubErrorEvent(breadcrumb),
  };
}

interface ApiErrorLike {
  status: number;
  code: string;
  correlationId?: string | undefined;
}

function isApiErrorLike(error: unknown): error is ApiErrorLike {
  return typeof error === 'object' && error !== null && typeof (error as { status?: unknown }).status === 'number' && typeof (error as { code?: unknown }).code === 'string';
}

/** Étiquettes d'une erreur : l'identifiant de corrélation d'une erreur de l'API relie l'événement aux journaux de l'API. */
export function errorTags(error: unknown, tags: Record<string, string> = {}): Record<string, string> {
  if (!isApiErrorLike(error)) return tags;
  return { ...tags, apiCode: error.code, apiStatus: String(error.status), ...(error.correlationId ? { correlationId: error.correlationId } : {}) };
}

/** Une erreur d'API mérite un signalement : panne côté serveur (5xx), pas un refus attendu ni une coupure réseau. */
export function isReportable(error: unknown): boolean {
  return !isApiErrorLike(error) || error.status >= 500;
}
