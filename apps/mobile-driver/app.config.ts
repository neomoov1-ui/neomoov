import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Configuration Expo : `app.json`, plus les clés cartographiques restreintes par plateforme, lues au build (variables
 * d'environnement EAS ou du poste), jamais écrites dans le dépôt. Sans clé Android, la carte Google n'est pas affichée
 * dans un build autonome (Expo Go fournit la sienne) ; iOS utilise Apple Plans.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const androidKey = process.env.GOOGLE_MAPS_ANDROID_KEY;
  const iosKey = process.env.GOOGLE_MAPS_IOS_KEY;
  return {
    ...config,
    name: config.name ?? 'Neomoov Chauffeur',
    slug: config.slug ?? 'neomoov-driver',
    ios: { ...config.ios, config: { ...config.ios?.config, ...(iosKey ? { googleMapsApiKey: iosKey } : {}) } },
    android: { ...config.android, config: { ...config.android?.config, ...(androidKey ? { googleMaps: { apiKey: androidKey } } : {}) } },
  };
};
