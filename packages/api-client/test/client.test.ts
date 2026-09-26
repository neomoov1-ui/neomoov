import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, type HealthReport, type TokenProvider } from '../src/index.js';

interface Call {
  url: string;
  init: RequestInit;
}

type Scripted = Response | ((init: RequestInit) => Response | Promise<Response>);

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** Une réponse par appel, dans l'ordre ; une fonction reçoit les options de la requête (signal, en-têtes). */
function fakeFetch(...responses: Scripted[]) {
  const calls: Call[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const options = init ?? {};
    calls.push({ url: String(input), init: options });
    const next = responses.shift();
    if (!next) throw new Error('réponse simulée manquante');
    return typeof next === 'function' ? next(options) : next;
  });
  return { calls, fetch: impl as unknown as typeof fetch };
}

/** Réponse qui n'arrive jamais : rejette seulement quand le signal est annulé, comme le vrai fetch. */
function neverResolves(init: RequestInit): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    const fail = () => reject(new DOMException('annulée', 'AbortError'));
    if (init.signal?.aborted) fail();
    else init.signal?.addEventListener('abort', fail, { once: true });
  });
}

function headerOf(call: Call | undefined, name: string): string | undefined {
  return (call?.init.headers as Record<string, string> | undefined)?.[name];
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

const healthReport: HealthReport = {
  status: 'ok',
  version: '0.0.0',
  environment: 'test',
  uptimeSeconds: 12,
  checks: {
    database: { status: 'ok', latencyMs: 8 },
    redis: { status: 'not_configured' },
    queues: { status: 'not_configured', mode: 'memory', stats: [] },
  },
  circuits: [{ name: 'maps.routes', state: 'closed', failures: 0 }],
};

describe("client d'API", () => {
  it("construit l'adresse sous /v1 et sérialise la requête (tableaux répétés, valeurs nulles ignorées)", async () => {
    const f = fakeFetch(json(200, { ok: true }));
    const api = createApiClient({ baseUrl: 'https://api.test/', fetch: f.fetch });
    await api.get('rides', { query: { status: ['done', 'cancelled'], page: 2, empty: null, missing: undefined } });
    expect(f.calls[0]?.url).toBe('https://api.test/v1/rides?status=done&status=cancelled&page=2');
    expect(f.calls[0]?.init.method).toBe('GET');
    expect(api.url('/health')).toBe('https://api.test/v1/health');
  });

  it("joint la langue, le jeton, les en-têtes communs et un identifiant de corrélation", async () => {
    const f = fakeFetch(json(200, {}));
    const api = createApiClient({
      baseUrl: 'https://api.test',
      fetch: f.fetch,
      language: () => 'fr-CA',
      headers: { 'x-app-version': '0.1.0' },
      tokens: { getAccessToken: () => 'jeton-1' },
    });
    await api.get('/me');
    expect(headerOf(f.calls[0], 'authorization')).toBe('Bearer jeton-1');
    expect(headerOf(f.calls[0], 'accept-language')).toBe('fr-CA');
    expect(headerOf(f.calls[0], 'x-app-version')).toBe('0.1.0');
    expect(headerOf(f.calls[0], 'accept')).toBe('application/json');
    expect(headerOf(f.calls[0], 'x-correlation-id')).toMatch(/.{8,}/);
  });

  it("envoie le corps en JSON avec la clé d'idempotence", async () => {
    const f = fakeFetch(json(201, { id: 'r1' }));
    const api = createApiClient({ baseUrl: 'https://api.test', fetch: f.fetch });
    await expect(api.post('/rides', { from: 'A', to: 'B' }, { idempotencyKey: 'cle-1' })).resolves.toEqual({ id: 'r1' });
    expect(f.calls[0]?.init.method).toBe('POST');
    expect(f.calls[0]?.init.body).toBe('{"from":"A","to":"B"}');
    expect(headerOf(f.calls[0], 'content-type')).toBe('application/json');
    expect(headerOf(f.calls[0], 'idempotency-key')).toBe('cle-1');
  });

  it('rafraîchit le jeton une seule fois après un 401 et rejoue la requête', async () => {
    const f = fakeFetch(json(401, { code: 'TOKEN_EXPIRED', message: 'Jeton expiré' }), json(200, { id: 'u1' }));
    const tokens: TokenProvider = { getAccessToken: () => 'ancien', refresh: vi.fn(async () => 'nouveau') };
    const api = createApiClient({ baseUrl: 'https://api.test', fetch: f.fetch, tokens });
    await expect(api.get('/me')).resolves.toEqual({ id: 'u1' });
    expect(tokens.refresh).toHaveBeenCalledTimes(1);
    expect(f.calls).toHaveLength(2);
    expect(headerOf(f.calls[1], 'authorization')).toBe('Bearer nouveau');
  });

  it('un identifiant de corrélation par appel, le même pour la nouvelle tentative après rafraîchissement', async () => {
    const f = fakeFetch(json(401, { code: 'TOKEN_EXPIRED', message: 'Jeton expiré' }), json(200, { id: 'u1' }), json(200, {}), json(200, {}));
    let n = 0;
    const api = createApiClient({ baseUrl: 'https://api.test', fetch: f.fetch, correlationId: () => `mobile-${(n += 1).toString().padStart(8, '0')}`, tokens: { getAccessToken: () => 'ancien', refresh: async () => 'nouveau' } });
    await api.get('/me');
    await api.get('/rides');
    await api.get('/me', { headers: { 'x-correlation-id': 'fourni-par-appelant' } });
    expect(f.calls.map((c) => headerOf(c, 'x-correlation-id'))).toEqual(['mobile-00000001', 'mobile-00000001', 'mobile-00000002', 'fourni-par-appelant']);
  });

  it('partage un seul rafraîchissement entre des requêtes parallèles en 401', async () => {
    const expired = () => json(401, { code: 'TOKEN_EXPIRED', message: 'Jeton expiré' });
    const f = fakeFetch(expired(), expired(), expired(), json(200, { id: 'a' }), json(200, { id: 'b' }), json(200, { id: 'c' }));
    const refresh = vi.fn(() => new Promise<string>((resolve) => setTimeout(() => resolve('nouveau'), 10)));
    const api = createApiClient({ baseUrl: 'https://api.test', fetch: f.fetch, tokens: { getAccessToken: () => 'ancien', refresh } });
    const results = await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);
    expect(results).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(f.calls).toHaveLength(6);
    for (const call of f.calls.slice(3)) expect(headerOf(call, 'authorization')).toBe('Bearer nouveau');
  });

  it('ne déconnecte pas quand le rafraîchissement échoue pour cause réseau', async () => {
    const f = fakeFetch(json(401, { code: 'TOKEN_EXPIRED', message: 'a' }));
    const onUnauthorized = vi.fn();
    const api = createApiClient({
      baseUrl: 'https://api.test',
      fetch: f.fetch,
      onUnauthorized,
      tokens: { getAccessToken: () => 'x', refresh: async () => { throw new ApiError(0, 'NETWORK_ERROR', 'hors ligne'); } },
    });
    const error = await failure(api.get('/me'));
    expect(error.code).toBe('NETWORK_ERROR');
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('signale la session perdue quand le rafraîchissement échoue', async () => {
    const f = fakeFetch(json(401, { code: 'UNAUTHORIZED', message: 'Non connecté', correlationId: 'c-1' }));
    const onUnauthorized = vi.fn();
    const api = createApiClient({
      baseUrl: 'https://api.test',
      fetch: f.fetch,
      onUnauthorized,
      tokens: { getAccessToken: () => 'x', refresh: async () => null },
    });
    const error = await failure(api.get('/me'));
    expect(error.status).toBe(401);
    expect(error.code).toBe('UNAUTHORIZED');
    expect(error.correlationId).toBe('c-1');
    expect(error.isUnauthorized).toBe(true);
    expect(onUnauthorized).toHaveBeenCalledWith(error);
    expect(f.calls).toHaveLength(1);
  });

  it('signale aussi la session perdue quand le rejeu échoue encore', async () => {
    const f = fakeFetch(json(401, { code: 'TOKEN_EXPIRED', message: 'a' }), json(401, { code: 'UNAUTHORIZED', message: 'b' }));
    const onUnauthorized = vi.fn();
    const api = createApiClient({ baseUrl: 'https://api.test', fetch: f.fetch, onUnauthorized, tokens: { getAccessToken: () => 'x', refresh: async () => 'y' } });
    const error = await failure(api.get('/me'));
    expect(error.code).toBe('UNAUTHORIZED');
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(f.calls).toHaveLength(2);
  });

  it('ne rejoue pas une requête faite sans authentification', async () => {
    const f = fakeFetch(json(401, { code: 'UNAUTHORIZED', message: 'Non connecté' }));
    const refresh = vi.fn(async () => 'y');
    const api = createApiClient({ baseUrl: 'https://api.test', fetch: f.fetch, tokens: { getAccessToken: () => 'x', refresh } });
    const error = await failure(api.post('/auth/login', { phone: '+15145550100' }, { auth: false }));
    expect(error.status).toBe(401);
    expect(refresh).not.toHaveBeenCalled();
    expect(headerOf(f.calls[0], 'authorization')).toBeUndefined();
  });

  it("convertit le corps d'erreur de l'API en ApiError", async () => {
    const f = fakeFetch(json(409, { code: 'RIDE_ALREADY_ACCEPTED', message: 'Course déjà acceptée', details: { rideId: 'r1' }, correlationId: 'c-9' }));
    const api = createApiClient({ baseUrl: 'https://api.test', fetch: f.fetch });
    const error = await failure(api.post('/rides/r1/accept'));
    expect(error.status).toBe(409);
    expect(error.code).toBe('RIDE_ALREADY_ACCEPTED');
    expect(error.message).toBe('Course déjà acceptée');
    expect(error.details).toEqual({ rideId: 'r1' });
    expect(error.correlationId).toBe('c-9');
    expect(error.isNetwork).toBe(false);
  });

  it("convertit une réponse d'erreur sans corps JSON", async () => {
    const f = fakeFetch(new Response('Bad Gateway', { status: 502, headers: { 'content-type': 'text/plain', 'x-correlation-id': 'c-2' } }));
    const api = createApiClient({ baseUrl: 'https://api.test', fetch: f.fetch });
    const error = await failure(api.get('/health'));
    expect(error.status).toBe(502);
    expect(error.code).toBe('HTTP_502');
    expect(error.correlationId).toBe('c-2');
  });

  it('renvoie undefined pour un 204 et lit un rapport de santé typé', async () => {
    const f = fakeFetch(new Response(null, { status: 204 }), json(200, healthReport));
    const api = createApiClient({ baseUrl: 'https://api.test', fetch: f.fetch });
    await expect(api.delete('/rides/r1')).resolves.toBeUndefined();
    const health = await api.health.get();
    expect(health.status).toBe('ok');
    expect(health.checks.queues.mode).toBe('memory');
    expect(f.calls[1]?.url).toBe('https://api.test/v1/health');
  });

  it('interrompt une requête trop longue avec le code TIMEOUT', async () => {
    const f = fakeFetch(neverResolves);
    const api = createApiClient({ baseUrl: 'https://api.test', fetch: f.fetch, timeoutMs: 20 });
    const error = await failure(api.get('/lent'));
    expect(error.status).toBe(0);
    expect(error.code).toBe('TIMEOUT');
    expect(error.isNetwork).toBe(true);
    expect(error.correlationId).toMatch(/.{8,}/);
  });

  it("distingue l'annulation demandée par l'appelant", async () => {
    const controller = new AbortController();
    const f = fakeFetch(neverResolves);
    const api = createApiClient({ baseUrl: 'https://api.test', fetch: f.fetch });
    const pending = api.get('/lent', { signal: controller.signal });
    controller.abort();
    const error = await failure(pending);
    expect(error.code).toBe('ABORTED');
  });

  it('convertit une panne réseau', async () => {
    const f = fakeFetch(() => Promise.reject(new TypeError('fetch failed')));
    const api = createApiClient({ baseUrl: 'https://api.test', fetch: f.fetch });
    const error = await failure(api.get('/health'));
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.message).toBe('fetch failed');
    expect(error.status).toBe(0);
  });

  it('refuse de se construire sans fetch disponible', () => {
    const saved = globalThis.fetch;
    // @ts-expect-error : simulation d'une plateforme sans fetch
    globalThis.fetch = undefined;
    try {
      expect(() => createApiClient({ baseUrl: 'https://api.test' })).toThrow(/fetch/);
    } finally {
      globalThis.fetch = saved;
    }
  });
});
