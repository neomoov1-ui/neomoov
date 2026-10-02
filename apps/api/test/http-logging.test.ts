import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pinoHttp } from 'pino-http';
import { describe, expect, it } from 'vitest';
import { createLogger, httpLoggerOptions, LOG_REDACT_PATHS, pathWithoutQuery, REDACTED_REQUEST_HEADERS, serializeRequest } from '../src/common/logger.js';

/** Journal écrit dans un tableau : chaque ligne JSON est relue. */
function capturedLogger() {
  const lines: Array<Record<string, unknown>> = [];
  const logger = createLogger('test', 'info', { write: (line: string) => lines.push(JSON.parse(line) as Record<string, unknown>) });
  return { logger, lines };
}

// Valeurs de test reconnaissables (aucun secret réel).
const SESSION = 'sess-TEST-ABCDEF0123456789';
const VAPI = 'vapi-TEST-secret-0123456789';
const SIGNATURE = 't=1700000000,v1=TESTdeadbeefcafe';
const FORWARDED = '203.0.113.9';
const BEARER = 'Bearer jeton-TEST-123456789';

describe('journal HTTP (revue du 2 octobre 2026, sécurité 3)', () => {
  it('sérialise une requête en identifiant, méthode et chemin sans chaîne de requête, rien d\'autre', () => {
    expect(pathWithoutQuery(`/v1/payments/card?session=${SESSION}&x=1`)).toBe('/v1/payments/card');
    expect(pathWithoutQuery('/v1/public/track/jeton#fragment')).toBe('/v1/public/track/jeton');
    expect(pathWithoutQuery(undefined)).toBeUndefined();
    const serialized = serializeRequest({ id: 7, method: 'GET', url: `/v1/payments/card?session=${SESSION}`, headers: { 'x-vapi-secret': VAPI }, query: { session: SESSION }, remoteAddress: FORWARDED } as never);
    expect(serialized).toEqual({ id: 7, method: 'GET', url: '/v1/payments/card' });
  });

  it('les chemins masqués couvrent les en-têtes de signature et de secret, les adresses d\'origine et la chaîne de requête', () => {
    for (const header of ['authorization', 'cookie', 'x-api-key', 'x-vapi-secret', 'stripe-signature', 'x-square-hmacsha256-signature', 'x-twilio-signature', 'x-hub-signature-256', 'x-forwarded-for']) {
      expect(REDACTED_REQUEST_HEADERS, header).toContain(header);
      expect(LOG_REDACT_PATHS, header).toContain(`req.headers["${header}"]`);
    }
    expect(LOG_REDACT_PATHS).toContain('req.query');
    expect(LOG_REDACT_PATHS).toContain('req.remoteAddress');
    // Un objet `req` journalisé par un autre chemin que pino-http est masqué de la même façon.
    const { logger, lines } = capturedLogger();
    logger.info(
      { req: { id: 1, method: 'POST', url: '/v1/voice/webhook', headers: { 'x-vapi-secret': VAPI, 'stripe-signature': SIGNATURE, 'x-forwarded-for': FORWARDED, authorization: BEARER, accept: 'application/json' }, query: { session: SESSION }, remoteAddress: FORWARDED } },
      'objet req journalisé directement',
    );
    const text = JSON.stringify(lines[0]);
    for (const secret of [SESSION, VAPI, SIGNATURE, FORWARDED, BEARER]) expect(text).not.toContain(secret);
    expect(lines[0]).toMatchObject({
      req: { headers: { 'x-vapi-secret': '[masqué]', 'stripe-signature': '[masqué]', 'x-forwarded-for': '[masqué]', authorization: '[masqué]', accept: 'application/json' }, query: '[masqué]', remoteAddress: '[masqué]' },
    });
  });

  it('pino-http : une requête avec ?session= et x-vapi-secret ne laisse ni l\'un ni l\'autre dans la sortie ; niveau selon le statut', async () => {
    const { logger, lines } = capturedLogger();
    const middleware = pinoHttp(httpLoggerOptions(logger, true));
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      middleware(req, res);
      res.statusCode = req.url?.startsWith('/v1/erreur') ? 500 : 200;
      res.setHeader('content-type', 'application/json');
      res.end('{}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const headers = { 'x-vapi-secret': VAPI, 'stripe-signature': SIGNATURE, 'x-forwarded-for': FORWARDED, authorization: BEARER };
      const ok = await fetch(`http://127.0.0.1:${port}/v1/payments/card?session=${SESSION}&token=TEST-xyz`, { headers });
      expect(ok.status).toBe(200);
      await ok.text();
      const failed = await fetch(`http://127.0.0.1:${port}/v1/erreur?session=${SESSION}`, { headers });
      expect(failed.status).toBe(500);
      await failed.text();
      // Les lignes « request completed » sont écrites à la fin de la réponse.
      for (let i = 0; i < 50 && lines.length < 2; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
      expect(lines.length).toBeGreaterThanOrEqual(2);
      const text = JSON.stringify(lines);
      for (const secret of [SESSION, VAPI, SIGNATURE, FORWARDED, BEARER, 'token=TEST-xyz']) expect(text, secret).not.toContain(secret);
      const completed = lines.find((l) => (l['req'] as { url?: string } | undefined)?.url === '/v1/payments/card');
      expect(completed).toBeDefined();
      expect(completed!['req']).toEqual({ id: expect.anything(), method: 'GET', url: '/v1/payments/card' });
      expect(completed!['level']).toBe(30);
      const error = lines.find((l) => (l['req'] as { url?: string } | undefined)?.url === '/v1/erreur');
      expect(error!['level']).toBe(50);
      expect(Object.keys(completed!['req'] as object).sort()).toEqual(['id', 'method', 'url']);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
