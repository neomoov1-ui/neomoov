/**
 * Cadrage de la carte du trajet (revue du 2 octobre 2026, constat mobile 16), sans React Native (testé par vitest) :
 * la carte n'est plus recadrée avec animation à chaque position du chauffeur, seulement quand il approche du bord.
 */

/** Zone affichée par la carte : centre et étendue en degrés, comme la donne `react-native-maps`. */
export interface MapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

/**
 * Le point est-il dans la zone affichée, à distance du bord ? `margin` : part de la demi-étendue gardée en réserve de
 * chaque côté (15 % par défaut), pour recadrer avant que le marqueur ne sorte de l'écran.
 */
export function isInsideRegion(point: { lat: number; lng: number }, region: MapRegion, margin = 0.15): boolean {
  const keep = 1 - Math.min(Math.max(margin, 0), 0.9);
  return Math.abs(point.lat - region.latitude) <= (region.latitudeDelta / 2) * keep && Math.abs(point.lng - region.longitude) <= (region.longitudeDelta / 2) * keep;
}
