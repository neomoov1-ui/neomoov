import { describe, expect, it } from 'vitest';
import { GoogleMapsProvider, MapsUnavailableError, parseDuration } from '../src/adapters/real/google-maps.js';

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

/** Fetch simulé : une file de réponses ou une fonction ; enregistre les appels. */
function fakeFetch(handler: Handler | Array<{ status: number; body?: unknown } | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init: init ?? {} });
    if (typeof handler === 'function') return handler(u, init ?? {});
    const next = handler.shift();
    if (!next) throw new Error('Aucune réponse préparée');
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body ?? {}), { status: next.status, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

const noSleep = () => Promise.resolve();
const provider = (f: typeof fetch, extra: Record<string, unknown> = {}) => new GoogleMapsProvider('cle-de-test', { fetch: f, sleep: noSleep, retries: 2, breakerThreshold: 3, breakerCooldownMs: 30_000, now: () => 1_000_000, ...extra });

describe('adaptateur Google Maps Platform', () => {
  it('itinéraire : distance, durée avec trafic à l\'heure prévue, péages en CAD, polyligne', async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, body: { routes: [{ distanceMeters: 8000, duration: '1080s', polyline: { encodedPolyline: 'abc' }, travelAdvisory: { tollInfo: { estimatedPrice: [{ currencyCode: 'CAD', units: '3', nanos: 500_000_000 }, { currencyCode: 'USD', units: '9' }] } } }] } }]);
    const route = await provider(fetch).route({ origin: { lat: 45.5, lng: -73.6 }, destination: { lat: 45.47, lng: -73.74 }, departureTime: new Date(1_000_000 + 7_200_000) });
    expect(route).toEqual({ distanceMeters: 8000, durationSeconds: 1080, tollsCents: 350, polyline: 'abc' });
    const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
    expect(body['routingPreference']).toBe('TRAFFIC_AWARE');
    expect(body['departureTime']).toBe(new Date(1_000_000 + 7_200_000).toISOString());
    expect(body['extraComputations']).toEqual(['TOLLS']);
    expect((calls[0]!.init.headers as Record<string, string>)['X-Goog-Api-Key']).toBe('cle-de-test');
    expect((calls[0]!.init.headers as Record<string, string>)['X-Goog-FieldMask']).toContain('tollInfo');
  });

  it('réessaie sur 503 et sur erreur réseau, puis réussit ; pas de nouvelle tentative sur 400', async () => {
    const { fetch, calls } = fakeFetch([{ status: 503 }, new Error('ECONNRESET'), { status: 200, body: { routes: [{ distanceMeters: 100, duration: '10s' }] } }]);
    const route = await provider(fetch).route({ origin: { lat: 0, lng: 0 }, destination: { lat: 0, lng: 1 } });
    expect(route.distanceMeters).toBe(100);
    expect(calls).toHaveLength(3);
    const rejected = fakeFetch([{ status: 400, body: { error: { message: 'API key not valid' } } }]);
    await expect(provider(rejected.fetch).geocode('x')).rejects.toMatchObject({ code: 'MAPS_REQUEST_REJECTED', status: 502 });
    expect(rejected.calls).toHaveLength(1);
  });

  it('ouvre le disjoncteur après des échecs répétés et le referme après le repos', async () => {
    let now = 1_000_000;
    const { fetch, calls } = fakeFetch(() => new Response('', { status: 500 }));
    const p = provider(fetch, { now: () => now, retries: 0 });
    for (let i = 0; i < 3; i += 1) await expect(p.geocode('x')).rejects.toBeInstanceOf(MapsUnavailableError);
    expect(calls).toHaveLength(3);
    expect(p.breakerOpen).toBe(true);
    await expect(p.geocode('x')).rejects.toMatchObject({ code: 'MAPS_UNAVAILABLE', status: 503 });
    expect(calls).toHaveLength(3); // refusé sans appel réseau
    now += 31_000;
    expect(p.breakerOpen).toBe(false);
    await expect(p.geocode('x')).rejects.toBeInstanceOf(MapsUnavailableError);
    expect(calls).toHaveLength(4);
    expect(p.toJSON()).toEqual({ name: 'google-maps', configured: true, breakerOpen: true });
  });

  it('autocomplétion, détails d\'un lieu, géocodage et matrice de temps d\'arrivée', async () => {
    const { fetch, calls } = fakeFetch((url) => {
      if (url.includes('places:autocomplete')) return new Response(JSON.stringify({ suggestions: [{ placePrediction: { placeId: 'p1', text: { text: '204 rue du Saint-Sacrement' } } }, { placePrediction: { placeId: 'p2' } }, {}] }), { status: 200 });
      if (url.includes('/v1/places/p1')) return new Response(JSON.stringify({ id: 'p1', formattedAddress: '204 rue du Saint-Sacrement, Montréal', location: { latitude: 45.5033, longitude: -73.5586 } }), { status: 200 });
      if (url.includes('/v1/places/inconnu')) return new Response(JSON.stringify({ id: 'inconnu' }), { status: 200 });
      if (url.includes('geocode/json?address=')) return new Response(JSON.stringify({ status: 'OK', results: [{ formatted_address: 'A, Montréal', place_id: 'g1', geometry: { location: { lat: 1, lng: 2 } } }] }), { status: 200 });
      if (url.includes('geocode/json?latlng=')) return new Response(JSON.stringify({ results: [] }), { status: 200 });
      if (url.includes('computeRouteMatrix')) return new Response(JSON.stringify([{ originIndex: 1, destinationIndex: 0, duration: '300s', condition: 'ROUTE_EXISTS' }, { originIndex: 0, destinationIndex: 0, condition: 'ROUTE_NOT_FOUND' }]), { status: 200 });
      return new Response('{}', { status: 404 });
    });
    const p = provider(fetch);
    const suggestions = await p.autocomplete('204 rue', 'session-1', { lat: 45.5, lng: -73.56 });
    expect(suggestions).toEqual([{ placeId: 'p1', description: '204 rue du Saint-Sacrement' }, { placeId: 'p2', description: 'p2' }]);
    const autocompleteBody = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
    expect(autocompleteBody['sessionToken']).toBe('session-1');
    expect(autocompleteBody['locationBias']).toBeDefined();
    expect(await p.placeDetails('p1', 'session-1')).toEqual({ lat: 45.5033, lng: -73.5586, formattedAddress: '204 rue du Saint-Sacrement, Montréal', placeId: 'p1' });
    await expect(p.placeDetails('inconnu')).rejects.toMatchObject({ code: 'PLACE_NOT_FOUND' });
    expect(await p.geocode('A')).toEqual({ lat: 1, lng: 2, formattedAddress: 'A, Montréal', placeId: 'g1' });
    expect((await p.reverseGeocode({ lat: 1, lng: 2 })).formattedAddress).toBe('1.00000, 2.00000');
    expect(await p.etaMatrix([{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }], { lat: 1, lng: 1 })).toEqual([Number.POSITIVE_INFINITY, 300]);
    expect(await p.etaMatrix([], { lat: 1, lng: 1 })).toEqual([]);
    expect(parseDuration('12.6s')).toBe(13);
    expect(parseDuration('n/a')).toBe(0);
  });

  it('une réponse sans itinéraire ou un délai dépassé est une indisponibilité', async () => {
    const empty = fakeFetch([{ status: 200, body: { routes: [] } }]);
    await expect(provider(empty.fetch).route({ origin: { lat: 0, lng: 0 }, destination: { lat: 0, lng: 1 } })).rejects.toBeInstanceOf(MapsUnavailableError);
    const abort = Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
    const slow = fakeFetch([abort, abort, abort]);
    await expect(provider(slow.fetch).geocode('x')).rejects.toBeInstanceOf(MapsUnavailableError);
    expect(slow.calls).toHaveLength(3);
  });
});
