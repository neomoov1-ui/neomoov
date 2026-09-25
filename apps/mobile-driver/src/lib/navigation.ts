/**
 * Navigation externe (prompt 11, écran de course) : Google Maps ou Waze par lien profond, avec repli sur le lien web
 * universel (qui ouvre l'application installée ou le navigateur). Sans dépendance à React Native (testé par vitest).
 */

export type NavigationApp = 'google' | 'waze';
export type Platform = 'ios' | 'android' | 'web';

export interface Target {
  lat: number;
  lng: number;
}

/** Liens à essayer dans l'ordre : l'application native d'abord, le lien universel en dernier (toujours ouvrable). */
export function navigationLinks(app: NavigationApp, target: Target, platform: Platform): string[] {
  const at = `${target.lat},${target.lng}`;
  if (app === 'waze') return [...(platform === 'web' ? [] : [`waze://?ll=${at}&navigate=yes`]), `https://waze.com/ul?ll=${at}&navigate=yes`];
  const universal = `https://www.google.com/maps/dir/?api=1&destination=${at}&travelmode=driving`;
  if (platform === 'android') return [`google.navigation:q=${at}&mode=d`, universal];
  if (platform === 'ios') return [`comgooglemaps://?daddr=${at}&directionsmode=driving`, universal];
  return [universal];
}

/**
 * Ouvre le premier lien disponible. `canOpen` et `open` sont ceux de `expo-linking` ; le dernier lien est ouvert sans
 * vérification (lien web).
 */
export async function openNavigation(app: NavigationApp, target: Target, platform: Platform, linking: { canOpen: (url: string) => Promise<boolean>; open: (url: string) => Promise<unknown> }): Promise<string> {
  const links = navigationLinks(app, target, platform);
  for (const url of links.slice(0, -1)) {
    if (await linking.canOpen(url).catch(() => false)) {
      await linking.open(url);
      return url;
    }
  }
  const fallback = links.at(-1)!;
  await linking.open(fallback);
  return fallback;
}
