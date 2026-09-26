import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MockMapsProvider } from '../src/adapters/mock/index.js';
import { MAPS_PROVIDER } from '../src/adapters/types.js';
import { CircuitBreaker, CircuitBreakers, CircuitOpenError } from '../src/common/circuit-breaker.js';
import { bearer, cleanupTestData, loginByOtp, startTestApp } from './helpers.js';

describe('disjoncteur des fournisseurs', () => {
  it('s\'ouvre après 5 échecs consécutifs, échoue aussitôt pendant le délai, un seul essai ensuite', async () => {
    let now = 0;
    const circuit = new CircuitBreaker('essai', { failureThreshold: 5, cooldownMs: 30_000 }, () => now);
    const failing = () => Promise.reject(new Error('panne'));
    let calls = 0;
    const counted = () => { calls += 1; return failing(); };
    for (let i = 0; i < 4; i += 1) await expect(circuit.run(counted)).rejects.toThrow('panne');
    expect(circuit.state).toBe('closed');
    await expect(circuit.run(counted)).rejects.toThrow('panne');
    expect(circuit.state).toBe('open');
    await expect(circuit.run(counted)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(calls).toBe(5);
    now = 30_000;
    expect(circuit.state).toBe('half_open');
    await expect(circuit.run(counted)).rejects.toThrow('panne');
    expect(circuit.state).toBe('open');
    now = 60_000;
    expect(await circuit.run(async () => 'ok')).toBe('ok');
    expect(circuit.snapshot()).toEqual({ name: 'essai', state: 'closed', failures: 0 });
    // Un succès remet le compteur à zéro : des échecs isolés n'ouvrent jamais le circuit.
    for (let i = 0; i < 4; i += 1) await expect(circuit.run(failing)).rejects.toThrow();
    await circuit.run(async () => 'ok');
    for (let i = 0; i < 4; i += 1) await expect(circuit.run(failing)).rejects.toThrow();
    expect(circuit.state).toBe('closed');
  });

  describe('devis et santé (intégration)', () => {
    let app: NestExpressApplication | null = null;
    beforeAll(async () => {
      app = await startTestApp();
    });
    afterAll(async () => {
      if (app) await cleanupTestData(app);
      await app?.close();
    });

    it('Routes en panne : devis estimés, puis plus aucun appel à Routes une fois le circuit ouvert ; santé « dégradée »', async ({ skip }) => {
      if (!app) return skip('DATABASE_URL absente');
      const server = app.getHttpServer();
      const client = await loginByOtp(app);
      const maps = app.get<MockMapsProvider>(MAPS_PROVIDER);
      const routeCalls = () => maps.calls.filter((c) => c.method === 'route').length;
      maps.failRoutes = true;
      try {
        const quote = () => request(server).post('/v1/quotes').set(bearer(client)).send({
          category: 'neo_premium', requestedAt: new Date(Date.now() + 5 * 3_600_000).toISOString(),
          origin: { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } },
          destination: { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } },
        }).expect(201);
        const before = routeCalls();
        for (let i = 0; i < 5; i += 1) expect((await quote()).body.estimated).toBe(true);
        expect(routeCalls() - before).toBe(5);
        const open = await quote();
        expect(open.body.estimated).toBe(true);
        expect(routeCalls() - before).toBe(5);
        const health = await request(server).get('/v1/health');
        expect(health.body.status).toBe('degraded');
        expect(health.body.circuits).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'maps.routes', state: 'open' })]));
      } finally {
        maps.failRoutes = false;
        // Referme le circuit pour les autres tests de ce processus.
        const circuit = app.get(CircuitBreakers).get('maps.routes');
        (circuit as unknown as { openedAt: number | null; failures: number }).openedAt = null;
        (circuit as unknown as { failures: number }).failures = 0;
      }
    });
  });
});
