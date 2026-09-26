import type { ConfigContext, ExpoConfig } from 'expo/config';
import { withInfoPlist } from 'expo/config-plugins';

/** Identifiant d'un projet EAS (UUID), tel que l'affiche `eas project:info`. */
const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Modes d'arrière-plan iOS que l'application n'utilise pas : Apple refuse un mode déclaré sans usage (règle 2.5.4).
 * `expo-task-manager` ajoute toujours `fetch` alors que sa seule tâche est la localisation (mode `location`) ; aucune
 * notification silencieuse n'est envoyée (`remote-notification`). Restent `location` (position en ligne, écran verrouillé)
 * et `audio` (ajouté par `expo-audio` : sonnerie d'une offre jouée en boucle même application en arrière-plan).
 */
const UNUSED_BACKGROUND_MODES: readonly string[] = ['fetch', 'remote-notification'];

/** Mod de l'Info.plist, enregistré avant les greffons : il passe après eux et retire ce qu'ils ont ajouté. */
function withoutUnusedBackgroundModes(config: ExpoConfig): ExpoConfig {
  return withInfoPlist(config, (next) => {
    const modes = next.modResults['UIBackgroundModes'];
    if (Array.isArray(modes)) next.modResults['UIBackgroundModes'] = modes.filter((mode) => typeof mode !== 'string' || !UNUSED_BACKGROUND_MODES.includes(mode));
    return next;
  });
}

/**
 * Configuration Expo : `app.json`, plus ce qui est lu au build dans l'environnement (variables EAS ou du poste), jamais
 * écrit dans le dépôt :
 * - les clés cartographiques restreintes par plateforme. Sans clé Android, la carte Google n'est pas affichée dans un
 *   build autonome (Expo Go fournit la sienne) ; iOS utilise Apple Plans ;
 * - `EAS_PROJECT_ID` : projet EAS lié (`extra.eas.projectId`, exigé aussi par les notifications push) et adresse des
 *   mises à jour à la volée (EAS Update). Sans lui, la configuration reste valide et les mises à jour sont désactivées :
 *   le build garde le JavaScript qu'il embarque.
 * Version d'exécution : politique `appVersion`, une mise à jour ne s'installe que sur un build de même version affichée
 * (`expo.version`), jamais sur un build natif différent. Canal fixé par le profil de `eas.json` (preview, production).
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const androidKey = process.env.GOOGLE_MAPS_ANDROID_KEY;
  const iosKey = process.env.GOOGLE_MAPS_IOS_KEY;
  const projectId = process.env.EAS_PROJECT_ID?.trim() || null;
  if (projectId && !PROJECT_ID.test(projectId)) throw new Error('EAS_PROJECT_ID : identifiant de projet EAS (UUID) attendu');
  return withoutUnusedBackgroundModes({
    ...config,
    name: config.name ?? 'Neomoov Chauffeur',
    slug: config.slug ?? 'neomoov-driver',
    runtimeVersion: { policy: 'appVersion' },
    // Vérification au lancement, sans attendre : la mise à jour téléchargée s'applique au lancement suivant.
    updates: projectId
      ? { ...config.updates, enabled: true, url: `https://u.expo.dev/${projectId}`, checkAutomatically: 'ON_LOAD', fallbackToCacheTimeout: 0 }
      : { ...config.updates, enabled: false },
    extra: { ...config.extra, ...(projectId ? { eas: { ...config.extra?.['eas'], projectId } } : {}) },
    ios: { ...config.ios, config: { ...config.ios?.config, ...(iosKey ? { googleMapsApiKey: iosKey } : {}) } },
    android: { ...config.android, config: { ...config.android?.config, ...(androidKey ? { googleMaps: { apiKey: androidKey } } : {}) } },
  });
};
