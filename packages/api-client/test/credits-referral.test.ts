import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/index.js';

describe('crédits et parrainage (ressource me)', () => {
  it('chemins, verbes, paramètre `kind` et corps des appels', async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input).replace('https://api.neomoov.net', ''), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof globalThis.fetch;
    const api = createApiClient({ baseUrl: 'https://api.neomoov.net/', fetch, tokens: { getAccessToken: () => 'jeton' } });
    await api.me.credits();
    await api.me.referral();
    await api.me.referral('driver');
    await api.me.applyReferral('ABC234');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET /v1/me/credits', 'GET /v1/me/referral', 'GET /v1/me/referral?kind=driver', 'POST /v1/me/referral/apply']);
    expect(calls[3]!.body).toEqual({ code: 'ABC234' });
  });
});
