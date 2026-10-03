/**
 * Page de saisie de carte `/carte` (étape 26), côté serveur web : session lue auprès de l'API (expirée, altérée ou
 * absente refusée), confirmation relayée par le serveur avec la session et le jeton de carte seulement, jamais avec un
 * jeton d'accès de l'utilisateur. Revue du 2 octobre 2026 (sécurité 16) : la session part dans un corps de requête, jamais
 * dans une adresse ; la page la lit dans le fragment ; une session déjà utilisée est signalée.
 */
import { describe, expect, it } from 'vitest';
import { cardLinkOf } from '../src/lib/card-link';
import { cardPageLanguage, confirmCardSession, loadCardSession } from '../src/lib/server/card-session';

const API = 'http://api.test';
const SESSION = 'AQEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const INFO = { provider: 'square', purpose: 'client_card', expiresAt: '2026-10-01T12:15:00.000Z', squareApplicationId: 'sandbox-sq0idb-x', squareLocationId: 'LTEST', squareEnvironment: 'sandbox', returnUrl: 'neomoov://carte-enregistree' };

function fakeFetch(status: number, json: unknown) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, impl };
}

describe('page de saisie de carte (serveur web)', () => {
  it('session valide : informations publiques du formulaire, lues sans autorisation', async () => {
    const { calls, impl } = fakeFetch(200, INFO);
    expect(await loadCardSession(SESSION, { apiUrl: API, fetchImpl: impl, headers: { 'accept-language': 'en' } })).toEqual({ state: 'ok', info: INFO });
    expect(calls[0]!.url).toBe(`${API}/v1/payment-methods/card-session/info`);
    expect(calls[0]!.url).not.toContain(SESSION);
    expect(calls[0]!.init!.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ session: SESSION });
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers['accept-language']).toBe('en');
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('authorization');
  });

  it('session expirée, altérée, absente ou mal formée : refusée ; API injoignable : indisponible', async () => {
    expect(await loadCardSession(SESSION, { apiUrl: API, fetchImpl: fakeFetch(401, { code: 'CARD_SESSION_EXPIRED' }).impl })).toEqual({ state: 'expired' });
    expect(await loadCardSession(SESSION, { apiUrl: API, fetchImpl: fakeFetch(401, { code: 'CARD_SESSION_INVALID' }).impl })).toEqual({ state: 'invalid' });
    expect(await loadCardSession(SESSION, { apiUrl: API, fetchImpl: fakeFetch(401, { code: 'CARD_SESSION_USED' }).impl })).toEqual({ state: 'used' });
    expect(await loadCardSession(SESSION, { apiUrl: API, fetchImpl: fakeFetch(503, {}).impl })).toEqual({ state: 'unavailable' });
    const unreachable = (async () => {
      throw new Error('réseau');
    }) as typeof fetch;
    expect(await loadCardSession(SESSION, { apiUrl: API, fetchImpl: unreachable })).toEqual({ state: 'unavailable' });
    const untouched = fakeFetch(200, INFO);
    expect(await loadCardSession(null, { apiUrl: API, fetchImpl: untouched.impl })).toEqual({ state: 'missing' });
    expect(await loadCardSession('court', { apiUrl: API, fetchImpl: untouched.impl })).toEqual({ state: 'invalid' });
    expect(await loadCardSession(`${SESSION}<script>`, { apiUrl: API, fetchImpl: untouched.impl })).toEqual({ state: 'invalid' });
    expect(untouched.calls).toHaveLength(0);
  });

  it('confirmation par le serveur : session et jeton de carte seulement, réponse de l\'API rendue telle quelle', async () => {
    const saved = { purpose: 'client_card', card: { id: 'c1', brand: 'visa', last4: '1111' }, debitMethod: null };
    const { calls, impl } = fakeFetch(201, saved);
    const result = await confirmCardSession({ session: SESSION, sourceId: 'cnon:abc', verificationToken: 'verf:xyz', accessToken: 'jeton-a-ne-pas-relayer' }, { apiUrl: API, fetchImpl: impl, headers: { 'x-forwarded-for': '203.0.113.9' } });
    expect(result).toEqual({ status: 201, body: saved });
    expect(calls[0]!.url).toBe(`${API}/v1/payment-methods/card-session/confirm`);
    expect(calls[0]!.init!.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ session: SESSION, sourceId: 'cnon:abc', verificationToken: 'verf:xyz' });
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers['x-forwarded-for']).toBe('203.0.113.9');
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('authorization');

    // Refus de l'API (session expirée, carte refusée) : statut et code relayés.
    expect(await confirmCardSession({ session: SESSION, sourceId: 'cnon:abc' }, { apiUrl: API, fetchImpl: fakeFetch(401, { code: 'CARD_SESSION_EXPIRED' }).impl })).toEqual({ status: 401, body: { code: 'CARD_SESSION_EXPIRED' } });
    expect((await confirmCardSession({ session: SESSION, sourceId: 'cnon:abc' }, { apiUrl: API, fetchImpl: fakeFetch(402, { code: 'PAYMENT_DECLINED' }).impl })).status).toBe(402);
  });

  it('corps invalide refusé sans appel à l\'API ; langue de la page', async () => {
    const { calls, impl } = fakeFetch(201, {});
    expect((await confirmCardSession({ session: SESSION }, { apiUrl: API, fetchImpl: impl })).status).toBe(400);
    expect((await confirmCardSession({ session: 'x', sourceId: 'cnon:abc' }, { apiUrl: API, fetchImpl: impl })).status).toBe(400);
    expect((await confirmCardSession('pas un objet', { apiUrl: API, fetchImpl: impl })).status).toBe(400);
    expect(calls).toHaveLength(0);
    expect(cardPageLanguage('en', 'fr-CA')).toBe('en');
    expect(cardPageLanguage('fr', 'en-US')).toBe('fr-CA');
    expect(cardPageLanguage(null, 'en-US,en;q=0.9')).toBe('en');
    expect(cardPageLanguage(undefined, 'fr-CA,fr;q=0.9,en;q=0.8')).toBe('fr-CA');
    expect(cardPageLanguage('de', null)).toBe('fr-CA');
  });

  it('lien de la page : session et langue dans le fragment, ancienne adresse encore lue', () => {
    expect(cardLinkOf(`#session=${SESSION}&lang=en`, '?v=2')).toEqual({ session: SESSION, lang: 'en' });
    expect(cardLinkOf(`#session=${SESSION}`, '?v=2&lang=fr')).toEqual({ session: SESSION, lang: 'fr' });
    expect(cardLinkOf('', `?session=${SESSION}&lang=en`)).toEqual({ session: SESSION, lang: 'en' });
    expect(cardLinkOf('', '?v=2')).toEqual({ session: null, lang: null });
  });
});
