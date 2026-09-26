import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/index.js';

describe('registres et exports (ressource ledgers)', () => {
  it('chemins, verbes, paramètres et corps des appels', async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input).replace('https://api.neomoov.net', ''), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof globalThis.fetch;
    const api = createApiClient({ baseUrl: 'https://api.neomoov.net/', fetch, tokens: { getAccessToken: () => 'jeton' } });
    await api.ledgers.months();
    await api.ledgers.months('2026-T3');
    await api.ledgers.remitRedevance({ period: '2026-08', reference: 'RQ-1' });
    await api.ledgers.requestSummary('taxes', '2026-T3');
    await api.ledgers.summary('taxes', '2026-T3');
    await api.ledgers.driverTaxReport('d1', '2026-T3');
    await api.ledgers.geolocationExports();
    await api.ledgers.runGeolocationExport('2026-08');
    await api.ledgers.myTaxReport();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /v1/admin/ledgers/months', 'GET /v1/admin/ledgers/months?period=2026-T3', 'POST /v1/admin/ledgers/redevance/remit', 'POST /v1/admin/ledgers/summaries',
      'GET /v1/admin/ledgers/summaries/taxes/2026-T3', 'GET /v1/admin/ledgers/drivers/d1/tax-report?quarter=2026-T3', 'GET /v1/admin/geolocation-exports',
      'POST /v1/admin/geolocation-exports', 'GET /v1/driver/tax-report',
    ]);
    expect(calls[3]!.body).toEqual({ type: 'taxes', period: '2026-T3' });
    expect(calls[7]!.body).toEqual({ month: '2026-08' });
    expect(api.ledgers.exportCsvPath('redevance', '2026-T3')).toBe('/admin/ledgers/exports?type=redevance&period=2026-T3');
    expect(api.ledgers.geolocationFilePath('e1')).toBe('/admin/geolocation-exports/e1/file');
  });
});
