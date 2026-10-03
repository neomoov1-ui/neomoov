/**
 * Position du téléphone du client pour une alerte SOS (revue du 2 octobre 2026, constat mobile 8). Seulement si
 * l'autorisation « pendant l'utilisation » est déjà donnée : aucune demande système au milieu d'une urgence. Position
 * actuelle en quelques secondes au plus, sinon la dernière position connue (deux minutes au plus), sinon aucune.
 */
import * as Location from 'expo-location';
import { withinDelay, type Coordinates } from '@/features/ride/sos';

const CURRENT_DELAY_MS = 4_000;
const LAST_KNOWN_MAX_AGE_MS = 120_000;

const toCoordinates = (position: Location.LocationObject): Coordinates => ({ lat: position.coords.latitude, lng: position.coords.longitude });

export async function devicePositionForAlert(): Promise<Coordinates | null> {
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted) return null;
    const current = await withinDelay(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), CURRENT_DELAY_MS);
    if (current) return toCoordinates(current);
    const last = await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS });
    return last ? toCoordinates(last) : null;
  } catch {
    return null;
  }
}
