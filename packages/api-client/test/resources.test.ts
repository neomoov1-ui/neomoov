import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, OfflineQueue, type OfflineStorage } from '../src/index.js';

interface Call {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Réponses scriptées ; une `Error` simule une panne réseau (fetch rejeté). */
function fakeFetch(...responses: Array<Response | Error>) {
  const calls: Call[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: (init?.headers ?? {}) as Record<string, string> });
    const next = responses.shift();
    if (!next) throw new Error('réponse simulée manquante');
    if (next instanceof Error) throw next;
    return next;
  });
  return { calls, fetch: impl as unknown as typeof fetch };
}

function memoryStorage(): OfflineStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('ressources typées', () => {
  it('chemins, verbes, corps et paramètres des appels de l\'application client', async () => {
    const { calls, fetch } = fakeFetch(...Array.from({ length: 9 }, () => json(200, {})));
    const api = createApiClient({ baseUrl: 'https://api.neomoov.net/', fetch, tokens: { getAccessToken: () => 'jeton' } });
    await api.config.get();
    await api.places.autocomplete('4500 Saint-Denis', { sessionToken: 's1', near: { lat: 45.5, lng: -73.6 } });
    await api.quotes.vehicles('q/1');
    await api.rides.create({ quoteId: 'q1', type: 'scheduled', paymentMethod: 'cash', paymentChoice: 'pay_driver_after', maxConsentedCents: 3500, preferences: {} } as never, 'cle-1');
    await api.rides.list({ limit: 5 });
    await api.rides.acceptOffer('r1', 'o1');
    await api.me.setPreferences({ conversation: 'silence', music: 'none', temperature: 'cool', luggageHelp: false });
    await api.me.remove('Je quitte Montréal');
    await api.auth.verifyOtp({ phone: '+15145550000', code: '123456' } as never);
    expect(calls.map((c) => `${c.method} ${c.url.replace('https://api.neomoov.net', '')}`)).toEqual([
      'GET /v1/config',
      'GET /v1/places/autocomplete?input=4500+Saint-Denis&sessionToken=s1&lat=45.5&lng=-73.6',
      'GET /v1/quotes/q%2F1/vehicles',
      'POST /v1/rides',
      'GET /v1/rides?limit=5',
      'POST /v1/rides/r1/offers/o1/accept',
      'PUT /v1/me/preferences',
      'DELETE /v1/me',
      'POST /v1/auth/otp/verify',
    ]);
    // Configuration et connexion sans jeton ; création de course avec sa clé d'idempotence.
    expect(calls[0]!.headers['authorization']).toBeUndefined();
    expect(calls[8]!.headers['authorization']).toBeUndefined();
    expect(calls[3]!.headers['idempotency-key']).toBe('cle-1');
    expect(calls[3]!.headers['authorization']).toBe('Bearer jeton');
    expect(calls[7]!.body).toEqual({ reason: 'Je quitte Montréal' });
    expect(calls[5]!.body).toEqual({});
  });
});

describe('ressources de My Hub', () => {
  it('métriques d\'exploitation : GET /v1/admin/metrics', async () => {
    const { calls, fetch } = fakeFetch(json(200, { windowHours: 24 }));
    const api = createApiClient({ baseUrl: 'https://hub.neomoov.net/api', fetch });
    await expect(api.admin.metrics()).resolves.toEqual({ windowHours: 24 });
    expect(calls[0]).toMatchObject({ url: 'https://hub.neomoov.net/api/v1/admin/metrics', method: 'GET' });
  });
});

describe('fetch des navigateurs', () => {
  it('est appelé sur l\'objet global, pas comme méthode du client (« Illegal invocation » sinon)', async () => {
    const browserFetch = function (this: unknown): Promise<Response> {
      if (this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      return Promise.resolve(json(200, { ok: true }));
    };
    const api = createApiClient({ baseUrl: 'https://api', fetch: browserFetch as unknown as typeof fetch });
    await expect(api.get('/health')).resolves.toEqual({ ok: true });
  });
});

describe('file hors ligne', () => {
  it('envoie tout de suite quand le réseau répond', async () => {
    const { calls, fetch } = fakeFetch(json(200, { id: 'm1' }));
    const queue = new OfflineQueue(createApiClient({ baseUrl: 'https://api', fetch }), memoryStorage());
    const result = await queue.send('POST', '/rides/r1/messages', { body: 'Je suis devant' });
    expect(result).toEqual({ status: 'sent', result: { id: 'm1' } });
    expect(calls[0]!.headers['idempotency-key']).toBeTruthy();
    expect(await queue.pending()).toEqual([]);
  });

  it('garde les écritures sans réseau, les rejoue dans l\'ordre avec la même clé, abandonne un refus de l\'API', async () => {
    const storage = memoryStorage();
    const { calls, fetch } = fakeFetch(new TypeError('réseau'), new TypeError('réseau'), new TypeError('réseau'), json(200, {}), json(409, { code: 'RIDE_CLOSED', message: 'Course close' }), json(200, {}));
    const queue = new OfflineQueue(createApiClient({ baseUrl: 'https://api', fetch }), storage);
    const first = await queue.send('POST', '/rides/r1/rate', { score: 5 });
    const second = await queue.send('POST', '/rides/r1/messages', { body: 'Merci' });
    expect(first.status).toBe('queued');
    expect(second.status).toBe('queued');
    const keys = (await queue.pending()).map((w) => w.idempotencyKey);
    // Toujours pas de réseau : rien ne part, la file reste intacte.
    expect(await queue.flush()).toEqual({ sent: 0, remaining: 2, dropped: 0 });
    // Réseau revenu : la première passe, la seconde est refusée (409) et abandonnée.
    expect(await queue.flush()).toEqual({ sent: 1, remaining: 0, dropped: 1 });
    const replays = calls.slice(3);
    expect(replays.map((c) => c.url)).toEqual(['https://api/v1/rides/r1/rate', 'https://api/v1/rides/r1/messages']);
    expect(replays.map((c) => c.headers['idempotency-key'])).toEqual(keys);
    expect(JSON.parse(storage.data.get('neomoov.offline-queue')!)).toEqual([]);
  });

  it('ne perd pas une écriture ajoutée pendant un rejeu ; garde un refus passager (429) ; clear() vide la file', async () => {
    const storage = memoryStorage();
    let releaseFirst!: () => void;
    const firstReplay = new Promise<Response>((resolve) => {
      releaseFirst = () => resolve(json(200, {}));
    });
    let call = 0;
    const fetch = (async () => {
      call += 1;
      if (call === 1) throw new TypeError('réseau');
      if (call === 2) return firstReplay;
      if (call === 3) throw new TypeError('réseau');
      if (call === 4) return json(429, { code: 'RATE_LIMITED', message: 'Trop de demandes' });
      return json(200, {});
    }) as unknown as typeof globalThis.fetch;
    const queue = new OfflineQueue(createApiClient({ baseUrl: 'https://api', fetch }), storage);
    await queue.send('POST', '/rides/r1/rate', { score: 5 });
    const flushing = queue.flush();
    await new Promise((r) => setTimeout(r, 10));
    // Pendant le rejeu de la première, une seconde écriture est mise en file.
    expect((await queue.send('POST', '/rides/r1/messages', { body: 'Merci' })).status).toBe('queued');
    releaseFirst();
    expect(await flushing).toEqual({ sent: 1, remaining: 1, dropped: 0 });
    expect((await queue.pending()).map((w) => w.path)).toEqual(['/rides/r1/messages']);
    // 429 : l'écriture reste, avec une tentative de plus.
    expect(await queue.flush()).toEqual({ sent: 0, remaining: 1, dropped: 0 });
    expect((await queue.pending())[0]!.attempts).toBe(2);
    await queue.clear();
    expect(await queue.pending()).toEqual([]);
  });

  it('un délai dépassé n\'est pas mis en file (l\'API a pu traiter la requête) : l\'erreur revient à l\'appelant', async () => {
    const neverAnswers = ((_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('annulée', 'AbortError'))))) as unknown as typeof fetch;
    const queue = new OfflineQueue(createApiClient({ baseUrl: 'https://api', fetch: neverAnswers, timeoutMs: 20 }), memoryStorage());
    await expect(queue.send('POST', '/rides/r1/messages', { body: 'Allo' })).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(await queue.pending()).toEqual([]);
  });

  it('rend à l\'appelant une erreur de l\'API sans la mettre en file', async () => {
    const { fetch } = fakeFetch(json(400, { code: 'VALIDATION_FAILED', message: 'Note invalide' }));
    const queue = new OfflineQueue(createApiClient({ baseUrl: 'https://api', fetch }), memoryStorage());
    await expect(queue.send('POST', '/rides/r1/rate', { score: 9 })).rejects.toBeInstanceOf(ApiError);
    expect(await queue.pending()).toEqual([]);
  });
});

describe('ressource chauffeur', () => {
  it('chemins et verbes de l\'application chauffeur ; le document part en multipart, sans en-tête JSON', async () => {
    const seen: Array<{ method: string; url: string; body: unknown; headers: Record<string, string> }> = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ method: init?.method ?? 'GET', url: String(input).replace('https://api.neomoov.net', ''), body: init?.body, headers: (init?.headers ?? {}) as Record<string, string> });
      return json(200, {});
    }) as unknown as typeof globalThis.fetch;
    const api = createApiClient({ baseUrl: 'https://api.neomoov.net', fetch, tokens: { getAccessToken: () => 'jeton' } });
    const form = new FormData();
    form.append('type', 'licence');
    form.append('file', new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'permis.jpg');
    await api.driver.uploadDocument(form);
    await api.driver.earnings({ period: 'week', date: '2026-09-25' });
    await api.driver.submitTraining('service', { 'service-1': 1 });
    await api.driver.paymentReceived('r/1', 4200);
    await api.driver.setStatus({ status: 'online', coordinates: { lat: 45.5, lng: -73.6 } });
    await api.driver.locations([{ coordinates: { lat: 45.5, lng: -73.6 } }]);
    expect(seen.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /v1/driver/documents',
      'GET /v1/driver/earnings?period=week&date=2026-09-25',
      'POST /v1/driver/training/service/submit',
      'POST /v1/driver/rides/r%2F1/payment-received',
      'POST /v1/driver/status',
      'POST /v1/driver/locations',
    ]);
    expect(seen[0]!.body).toBe(form);
    expect(seen[0]!.headers['content-type']).toBeUndefined();
    expect(seen[1]!.body).toBeUndefined();
    expect(JSON.parse(String(seen[2]!.body))).toEqual({ answers: { 'service-1': 1 } });
    expect(seen[3]!.headers['content-type']).toBe('application/json');
    expect(JSON.parse(String(seen[5]!.body))).toEqual({ positions: [{ coordinates: { lat: 45.5, lng: -73.6 } }] });
  });
});
