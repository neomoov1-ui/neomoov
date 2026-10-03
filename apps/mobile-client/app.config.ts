import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';

/** Identifiant d'un projet EAS (UUID), tel que l'affiche `eas project:info`. */
const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fichier Firebase des notifications Android (FCM), jamais commité (`.gitignore`) : copie `google-services.json` dans le
 * dossier de l'application (sur le poste, ou posée sur les serveurs d'EAS par le script `eas-build-pre-install`), sinon
 * chemin donné par la variable EAS de type fichier `GOOGLE_SERVICES_JSON`. Sans fichier, rien n'est ajouté : la
 * configuration reste celle d'avant, et un build Android n'obtient pas de jeton de notification.
 */
function googleServicesFile(projectRoot: string): string | undefined {
  if (existsSync(join(projectRoot, 'google-services.json'))) return './google-services.json';
  const fromEas = process.env.GOOGLE_SERVICES_JSON?.trim();
  return fromEas && existsSync(fromEas) ? fromEas : undefined;
}

/**
 * Configuration Expo : `app.json`, plus ce qui est lu au build dans l'environnement (variables EAS ou du poste), jamais
 * écrit dans le dépôt :
 * - les clés cartographiques restreintes par plateforme. Sans clé Android, la carte Google n'est pas affichée dans un
 *   build autonome (Expo Go fournit la sienne) ; iOS utilise Apple Plans ;
 * - `EAS_PROJECT_ID` : projet EAS lié (`extra.eas.projectId`, exigé aussi par les notifications push) et adresse des
 *   mises à jour à la volée (EAS Update). Sans lui, la configuration reste valide et les mises à jour sont désactivées :
 *   le build garde le JavaScript qu'il embarque ;
 * - le fichier Firebase des notifications Android (`googleServicesFile`, ci-dessus).
 * Version d'exécution : politique `fingerprint` (revue du 2 octobre 2026, constat mobile 5), empreinte de la partie
 * native (modules, greffons, réglages natifs) calculée par `@expo/fingerprint` avec `fingerprint.config.js` ; une mise à
 * jour ne s'installe que sur un build de même empreinte. Canal fixé par le profil de `eas.json` (preview, production).
 */
/**
 * Revue du 2 octobre 2026, constat mobile 21 : un build EAS de prévisualisation ou de production ne doit jamais garder
 * l'adresse de repli `http://localhost:4000` de `src/lib/config.ts` (ni l'émulateur `10.0.2.2`). Le build échoue tôt si
 * `EXPO_PUBLIC_API_BASE_URL` (variable du profil de `eas.json`) manque ou ne désigne pas une API en HTTPS.
 */
export function assertReleaseApiUrl(env: Readonly<Record<string, string | undefined>> = process.env): void {
  const profile = env['EAS_BUILD_PROFILE'];
  if (profile !== 'preview' && profile !== 'production') return;
  const url = env['EXPO_PUBLIC_API_BASE_URL']?.trim() ?? '';
  if (!/^https:\/\/[^/]+/.test(url) || /localhost|127\.0\.0\.1|10\.0\.2\.2/.test(url)) {
    throw new Error(`EXPO_PUBLIC_API_BASE_URL : adresse HTTPS de l'API attendue pour le profil ${profile}`);
  }
}

export default ({ config, projectRoot }: ConfigContext): ExpoConfig => {
  assertReleaseApiUrl();
  const androidKey = process.env.GOOGLE_MAPS_ANDROID_KEY;
  const iosKey = process.env.GOOGLE_MAPS_IOS_KEY;
  const projectId = process.env.EAS_PROJECT_ID?.trim() || null;
  if (projectId && !PROJECT_ID.test(projectId)) throw new Error('EAS_PROJECT_ID : identifiant de projet EAS (UUID) attendu');
  const firebase = googleServicesFile(projectRoot);
  return {
    ...config,
    name: config.name ?? 'Neomoov',
    slug: config.slug ?? 'neomoov-client',
    runtimeVersion: { policy: 'fingerprint' },
    // Vérification au lancement, sans attendre : la mise à jour téléchargée s'applique au lancement suivant.
    updates: projectId
      ? { ...config.updates, enabled: true, url: `https://u.expo.dev/${projectId}`, checkAutomatically: 'ON_LOAD', fallbackToCacheTimeout: 0 }
      : { ...config.updates, enabled: false },
    extra: { ...config.extra, ...(projectId ? { eas: { ...config.extra?.['eas'], projectId } } : {}) },
    // Liens universels (étape 22, revue du 2 octobre 2026, constat mobile 12) : `https://neomoov.net/c/<code>` ouvre
    // l'application client (écran `c/[code]`), `/d/<code>` est réservé à l'application chauffeur. Fichiers d'association
    // à publier sur neomoov.net : `infra/well-known/` (apple-app-site-association, assetlinks.json).
    ios: { ...config.ios, associatedDomains: [...(config.ios?.associatedDomains ?? []), 'applinks:neomoov.net'], config: { ...config.ios?.config, ...(iosKey ? { googleMapsApiKey: iosKey } : {}) } },
    android: {
      ...config.android,
      ...(firebase ? { googleServicesFile: firebase } : {}),
      intentFilters: [...(config.android?.intentFilters ?? []), { action: 'VIEW', autoVerify: true, data: [{ scheme: 'https', host: 'neomoov.net', pathPrefix: '/c/' }], category: ['BROWSABLE', 'DEFAULT'] }],
      config: { ...config.android?.config, ...(androidKey ? { googleMaps: { apiKey: androidKey } } : {}) },
    },
  };
};
