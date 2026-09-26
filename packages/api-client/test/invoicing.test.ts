import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/index.js';

describe('facturation (ressource invoicing)', () => {
  it('chemins, verbes, vérification sans jeton et adresses des PDF', async () => {
    const calls: Array<{ url: string; method: string; auth: string | null }> = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input).replace('https://api.neomoov.net', ''), method: init?.method ?? 'GET', auth: (init?.headers as Record<string, string>)['authorization'] ?? null });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof globalThis.fetch;
    const api = createApiClient({ baseUrl: 'https://api.neomoov.net/', fetch, tokens: { getAccessToken: () => 'jeton' } });
    await api.invoicing.rideInvoice('r1');
    await api.invoicing.verify('jeton-qr');
    await api.invoicing.sevStatus();
    await api.invoicing.retrySev('f1');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET /v1/rides/r1/invoice', 'GET /v1/public/invoices/verify/jeton-qr', 'GET /v1/admin/sev/status', 'POST /v1/admin/sev/retry/f1']);
    expect(calls[1]!.auth).toBeNull();
    expect(calls[0]!.auth).toBe('Bearer jeton');
    expect(api.invoicing.rideInvoicePdfUrl('r1')).toBe('https://api.neomoov.net/v1/rides/r1/invoice/pdf');
    expect(api.invoicing.rideInvoicePdfUrl('r1', 'n2')).toBe('https://api.neomoov.net/v1/rides/r1/invoice/pdf?documentId=n2');
    expect(api.invoicing.adminInvoicePdfUrl('f1')).toBe('https://api.neomoov.net/v1/admin/invoices/f1/pdf');
  });
});
