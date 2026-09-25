import { describe, expect, it, vi } from 'vitest';
import { API_BATCH_MAX, handleLocations, thinLocations, toQueuedPosition, type PositionStore, type QueuedPosition, type RawLocation } from '../src/lib/location-buffer';

const at = (seconds: number, north = 0, speed: number | null = 10): RawLocation => ({
  timestamp: Date.UTC(2026, 8, 26, 12, 0, 0) + seconds * 1000,
  coords: { latitude: 45.5 + north / 111_195, longitude: -73.6, speed, heading: 90, accuracy: 5 },
});

function memoryStore(initial: QueuedPosition[] = []): PositionStore & { data: QueuedPosition[] } {
  const store = { data: initial, read: async () => store.data, write: async (p: QueuedPosition[]) => void (store.data = p) };
  return store;
}

describe('positions du chauffeur', () => {
  it('hors ligne : aucune position envoyée ni gardée, la file est vidée (règle absolue du prompt 11)', async () => {
    const send = vi.fn(async () => undefined);
    const store = memoryStore([toQueuedPosition(at(0))]);
    const outcome = await handleLocations({ presence: 'offline', locations: [at(5), at(10)], store, send });
    expect(send).not.toHaveBeenCalled();
    expect(store.data).toEqual([]);
    expect(outcome).toEqual({ sent: 0, kept: 0, dropped: 3 });
  });

  it('en ligne ou en pause : envoi immédiat, dans l\'ordre chronologique', async () => {
    for (const presence of ['online', 'paused'] as const) {
      const batches: QueuedPosition[][] = [];
      const store = memoryStore();
      const outcome = await handleLocations({ presence, locations: [at(10), at(5)], store, send: async (b) => void batches.push(b) });
      expect(outcome).toEqual({ sent: 2, kept: 0, dropped: 0 });
      expect(batches[0]!.map((p) => p.recordedAt)).toEqual([new Date(at(5).timestamp).toISOString(), new Date(at(10).timestamp).toISOString()]);
    }
  });

  it('coupure réseau : la file est gardée puis renvoyée par lots de 100 au retour du réseau', async () => {
    const store = memoryStore();
    const failing = vi.fn(async () => {
      throw new Error('réseau');
    });
    await handleLocations({ presence: 'online', locations: Array.from({ length: 150 }, (_, i) => at(i * 5)), store, send: failing });
    expect(store.data).toHaveLength(150);
    const batches: number[] = [];
    const outcome = await handleLocations({ presence: 'online', locations: [at(800)], store, send: async (b) => void batches.push(b.length) });
    expect(batches).toEqual([API_BATCH_MAX, 51]);
    expect(outcome).toEqual({ sent: 151, kept: 0, dropped: 0 });
  });

  it('file bornée : au-delà du maximum, les plus anciennes positions sont abandonnées', async () => {
    const store = memoryStore();
    const outcome = await handleLocations({ presence: 'online', locations: Array.from({ length: 12 }, (_, i) => at(i * 5)), store, max: 10, send: async () => Promise.reject(new Error('réseau')) });
    expect(outcome).toEqual({ sent: 0, kept: 10, dropped: 2 });
    expect(store.data[0]!.recordedAt).toBe(new Date(at(10).timestamp).toISOString());
  });

  it('valeurs impossibles du système ramenées à null', () => {
    const p = toQueuedPosition({ timestamp: 0, coords: { latitude: 45.5, longitude: -73.6, speed: -1, heading: -1, accuracy: -1 } });
    expect(p).toMatchObject({ speedMps: null, headingDegrees: null, accuracyMeters: null, coordinates: { lat: 45.5, lng: -73.6 } });
    expect(toQueuedPosition(at(0)).speedMps).toBe(10);
  });

  it('« toutes les 5 secondes ou 50 mètres » : les positions plus rapprochées sont écartées', () => {
    // iOS livre environ une position par seconde : à l'arrêt, une sur cinq est gardée.
    const still = Array.from({ length: 11 }, (_, i) => at(i));
    expect(thinLocations(still, null).kept.map((l) => (l.timestamp - still[0]!.timestamp) / 1000)).toEqual([0, 5, 10]);
    // En mouvement rapide (60 m par seconde), chaque position compte.
    const fast = Array.from({ length: 4 }, (_, i) => at(i, i * 60));
    expect(thinLocations(fast, null).kept).toHaveLength(4);
    // La dernière position gardée d'un lot précédent sert de référence.
    const previous = at(0);
    expect(thinLocations([at(2), at(6)], previous).kept.map((l) => l.timestamp)).toEqual([at(6).timestamp]);
  });
});
