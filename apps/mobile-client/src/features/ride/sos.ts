/**
 * Alerte SOS du client (revue du 2 octobre 2026, constat mobile 8), sans React Native (testée par vitest) : la position
 * envoyée à l'équipe est celle du téléphone du client, pas celle du chauffeur.
 */
import type { RideView } from '@neomoov/domain';

export interface Coordinates {
  lat: number;
  lng: number;
}

/**
 * Position jointe à l'alerte : celle du téléphone du client ; à défaut, celle du chauffeur seulement quand le client
 * est à bord (course en cours), sinon aucune (le client peut être loin du véhicule).
 */
export function sosCoordinates(input: { device: Coordinates | null; driver: Coordinates | null; rideState: RideView['state'] }): Coordinates | null {
  if (input.device) return input.device;
  if (input.driver && input.rideState === 'in_progress') return input.driver;
  return null;
}

/** Résultat d'une promesse dans le délai donné, sinon null (une alerte n'attend jamais une position plus de quelques secondes). */
export function withinDelay<T>(promise: Promise<T>, delayMs: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), delayMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}
