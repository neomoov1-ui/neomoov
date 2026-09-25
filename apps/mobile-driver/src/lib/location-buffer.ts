/**
 * File locale des positions du chauffeur (prompt 11, tâche 3), sans dépendance à React Native (testée par vitest).
 * Règle absolue : hors ligne, aucune position n'est envoyée ni gardée. En ligne ou en pause, chaque position reçue du
 * système est ajoutée à la file puis envoyée par lots (au plus 100, limite de l'API) ; en cas de coupure, la file est
 * gardée (au plus `max` positions, les plus anciennes sont abandonnées) et renvoyée à la position suivante.
 */

export type Presence = 'online' | 'paused' | 'offline';

export interface QueuedPosition {
  coordinates: { lat: number; lng: number };
  speedMps: number | null;
  headingDegrees: number | null;
  accuracyMeters: number | null;
  recordedAt: string;
}

/** Forme minimale d'une position `expo-location` (`LocationObject`). */
export interface RawLocation {
  timestamp: number;
  coords: { latitude: number; longitude: number; speed: number | null; heading: number | null; accuracy: number | null };
}

export interface PositionStore {
  read(): Promise<QueuedPosition[]>;
  write(positions: QueuedPosition[]): Promise<void>;
}

export interface FlushOutcome {
  sent: number;
  kept: number;
  dropped: number;
}

export const API_BATCH_MAX = 100;

function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Règle d'envoi (« toutes les 5 secondes ou 50 mètres ») : une position n'est gardée que si 5 secondes se sont écoulées
 * depuis la précédente gardée, ou si le chauffeur a parcouru 50 mètres. iOS livre environ une position par seconde.
 */
export function thinLocations(locations: readonly RawLocation[], last: RawLocation | null, rule = { intervalMs: 5_000, distanceMeters: 50 }): { kept: RawLocation[]; last: RawLocation | null } {
  const kept: RawLocation[] = [];
  let previous = last;
  for (const location of [...locations].sort((a, b) => a.timestamp - b.timestamp)) {
    const far = previous ? metersBetween({ lat: previous.coords.latitude, lng: previous.coords.longitude }, { lat: location.coords.latitude, lng: location.coords.longitude }) >= rule.distanceMeters : true;
    if (!previous || location.timestamp - previous.timestamp >= rule.intervalMs || far) {
      kept.push(location);
      previous = location;
    }
  }
  return { kept, last: previous };
}

/** Valeurs impossibles (vitesse négative quand elle est inconnue, cap hors bornes) ramenées à null. */
export function toQueuedPosition(location: RawLocation): QueuedPosition {
  const { latitude, longitude, speed, heading, accuracy } = location.coords;
  return {
    coordinates: { lat: latitude, lng: longitude },
    speedMps: speed !== null && speed >= 0 && speed <= 80 ? speed : null,
    headingDegrees: heading !== null && heading >= 0 && heading <= 360 ? heading : null,
    accuracyMeters: accuracy !== null && accuracy >= 0 ? accuracy : null,
    recordedAt: new Date(location.timestamp).toISOString(),
  };
}

/**
 * Traite les positions livrées par le système. `send` envoie un lot à l'API (`POST /driver/locations`) et rejette en
 * cas d'échec ; il n'est jamais appelé hors ligne.
 */
export async function handleLocations(input: {
  presence: Presence;
  locations: readonly RawLocation[];
  store: PositionStore;
  send: (batch: QueuedPosition[]) => Promise<void>;
  max?: number;
}): Promise<FlushOutcome> {
  const max = input.max ?? 500;
  if (input.presence === 'offline') {
    const pending = await input.store.read();
    if (pending.length) await input.store.write([]);
    return { sent: 0, kept: 0, dropped: pending.length + input.locations.length };
  }
  const queued = [...(await input.store.read()), ...input.locations.map(toQueuedPosition)].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  const dropped = Math.max(0, queued.length - max);
  let pending = queued.slice(dropped);
  let sent = 0;
  while (pending.length) {
    const batch = pending.slice(0, API_BATCH_MAX);
    try {
      await input.send(batch);
    } catch {
      break;
    }
    sent += batch.length;
    pending = pending.slice(batch.length);
  }
  await input.store.write(pending);
  return { sent, kept: pending.length, dropped };
}
