import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/index.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('ressources de la marque (étape 22)', () => {
  it('chemins, verbes, corps et jeton des appels', async () => {
    const calls: Array<{ url: string; method: string; body: unknown; auth: boolean }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: 'authorization' in headers });
      return json(200, {});
    }) as unknown as typeof globalThis.fetch;
    const api = createApiClient({ baseUrl: 'https://api.neomoov.net', fetch: fetchImpl, tokens: { getAccessToken: () => 'jeton' } });
    await api.branding.publicByCode('ABCDEF23');
    await api.branding.publicByDomain('reservation.taxi-alpha.test');
    await api.branding.attach('abcd-ef23');
    await api.branding.get('org/1');
    await api.branding.update('org1', { displayName: 'Taxi Alpha', colors: { primary: '#123456' } });
    await api.branding.domains('org1');
    await api.branding.addDomain('org1', { domain: 'hub.taxi-alpha.test', kind: 'hub' });
    await api.branding.removeDomain('org1', 'dom1');
    await api.branding.verifyDomain('org1', 'dom1');
    expect(calls.map((c) => `${c.method} ${c.url.replace('https://api.neomoov.net/v1', '')}${c.auth ? '' : ' (sans jeton)'}`)).toEqual([
      'GET /public/brand?code=ABCDEF23 (sans jeton)',
      'GET /public/brand?domain=reservation.taxi-alpha.test (sans jeton)',
      'POST /me/organizations/attach',
      'GET /admin/organizations/org%2F1/brand',
      'PUT /admin/organizations/org1/brand',
      'GET /admin/organizations/org1/domains',
      'POST /admin/organizations/org1/domains',
      'DELETE /admin/organizations/org1/domains/dom1',
      'POST /admin/organizations/org1/domains/dom1/verify',
    ]);
    expect(calls[2]!.body).toEqual({ code: 'abcd-ef23' });
    expect(calls[4]!.body).toEqual({ displayName: 'Taxi Alpha', colors: { primary: '#123456' } });
    expect(calls[6]!.body).toEqual({ domain: 'hub.taxi-alpha.test', kind: 'hub' });
  });
});
