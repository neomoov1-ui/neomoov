import { describe, expect, it } from 'vitest';
import { offsetBounds, ServerClock } from '../src/server-clock';

const API_NOON = Date.parse('2026-10-03T12:00:00.000Z');
const header = (ms: number) => new Date(ms).toUTCString();

/** Téléphone en avance de `skewMs` sur l'API (en retard si négatif) ; la requête met `rttMs`, l'API répond au milieu, à `serverMs`. */
function response(serverMs: number, skewMs: number, rttMs = 200) {
  const localAtServer = serverMs + skewMs;
  return { dateHeader: header(serverMs), sentAt: localAtServer - rttMs / 2, receivedAt: localAtServer + rttMs / 2 };
}

describe("horloge de l'API vue du téléphone", () => {
  it("borne l'écart par l'envoi, la réception et la seconde tronquée de l'en-tête Date", () => {
    expect(offsetBounds('Sat, 03 Oct 2026 12:00:00 GMT', API_NOON - 500, API_NOON + 500)).toEqual({ low: -500, high: 1500 });
    expect(offsetBounds(null, 0, 1)).toBeNull();
    expect(offsetBounds('pas une date', 0, 1)).toBeNull();
    expect(offsetBounds('Sat, 03 Oct 2026 12:00:00 GMT', 10, 5)).toBeNull();
  });

  it("sans mesure, garde l'heure du téléphone", () => {
    const clock = new ServerClock(() => 1_000);
    expect(clock.offsetMs()).toBeNull();
    expect(clock.now()).toBe(1_000);
  });

  it('téléphone en avance de 15 s : l\'heure de l\'API est retrouvée à la seconde près, puis plus finement', () => {
    const skew = 15_000;
    const clock = new ServerClock(() => API_NOON + skew);
    clock.observe(response(API_NOON + 300, skew));
    expect(Math.abs(clock.offsetMs()! + skew)).toBeLessThanOrEqual(700);
    // Réponses à d'autres fractions de seconde : l'intervalle se resserre.
    for (const fraction of [50, 550, 900, 120, 700]) clock.observe(response(API_NOON + 5_000 + fraction, skew, 100));
    expect(Math.abs(clock.offsetMs()! + skew)).toBeLessThanOrEqual(150);
    expect(Math.abs(clock.now() - API_NOON)).toBeLessThanOrEqual(150);
  });

  it("horloge du téléphone changée : repart de la dernière réponse", () => {
    const clock = new ServerClock();
    clock.observe(response(API_NOON, 15_000));
    clock.observe(response(API_NOON + 60_000, -120_000));
    expect(Math.abs(clock.offsetMs()! - 120_000)).toBeLessThanOrEqual(700);
  });

  it('ignore une réponse cachable (resservie plus tard avec sa date) ou trop lente', () => {
    const clock = new ServerClock();
    clock.observe({ ...response(API_NOON - 60_000, 0), cacheControl: 'public, max-age=60' });
    clock.observe(response(API_NOON, 0, 20_000));
    expect(clock.offsetMs()).toBeNull();
    clock.observe({ ...response(API_NOON, 0), cacheControl: 'private, no-store' });
    expect(clock.offsetMs()).not.toBeNull();
  });
});
