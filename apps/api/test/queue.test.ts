import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { bullJobId, QueueService } from '../src/infra/queue.module.js';
import { CHECK_TIMEOUT_MS, withTimeout } from '../src/modules/health/health.service.js';

describe('identifiants de tâche BullMQ', () => {
  it('un identifiant lisible à deux segments devient acceptable pour BullMQ (aucun « : »)', () => {
    expect(bullJobId('completed:5b0c')).toBe('completed-5b0c');
    expect(bullJobId('released:5b0c:1790000000')).toBe('released-5b0c-1790000000');
    expect(bullJobId('pdf-5b0c')).toBe('pdf-5b0c');
  });
});

describe('files en mode mémoire (sans Redis)', () => {
  it('compte et journalise les tâches ajoutées sans traitement enregistré, au lieu de les perdre en silence', async () => {
    const logger = pino({ level: 'silent' });
    const warn = vi.spyOn(logger, 'warn');
    const queues = new QueueService(null, logger);
    await queues.add('notifications', 'ride-confirmed', { rideId: 'r1' });
    await queues.add('notifications', 'ride-confirmed', { rideId: 'r2' });
    const stats = await queues.stats();
    expect(stats.find((s) => s.name === 'notifications')).toEqual({ name: 'notifications', waiting: 0, active: 0, failed: 0, dropped: 2 });
    expect(warn).toHaveBeenCalledTimes(2);
    await queues.onModuleDestroy();
  });

  it('exécute immédiatement le traitement enregistré et compte les échecs', async () => {
    const queues = new QueueService(null, pino({ level: 'silent' }));
    let seen = 0;
    queues.process('exports', async (job) => {
      seen += 1;
      if ((job.data as { fail?: boolean }).fail) throw new Error('échec simulé');
    });
    await queues.add('exports', 'csv', {});
    await queues.add('exports', 'csv', { fail: true });
    expect(seen).toBe(2);
    expect((await queues.stats()).find((s) => s.name === 'exports')).toEqual({ name: 'exports', waiting: 0, active: 0, failed: 1, dropped: 0 });
    await queues.onModuleDestroy();
  });

  it('le minuteur périodique maintient le processus en vie et s\'arrête à la destruction', async () => {
    const queues = new QueueService(null);
    let ticks = 0;
    queues.process('heartbeat', async () => {
      ticks += 1;
    }, { everyMs: 5 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(ticks).toBeGreaterThan(0);
    await queues.onModuleDestroy();
    const after = ticks;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ticks).toBe(after);
  });
});

describe('sonde de santé : délai maximal', () => {
  it('rend la valeur quand la dépendance répond à temps', async () => {
    await expect(withTimeout(Promise.resolve('ok'), CHECK_TIMEOUT_MS, 'test')).resolves.toBe('ok');
  });

  it('rejette après le délai quand la dépendance ne répond jamais (Redis hors ligne)', async () => {
    const never = new Promise<never>(() => undefined);
    await expect(withTimeout(never, 20, 'Redis')).rejects.toThrow(/Redis : aucune réponse en 20 ms/);
  });
});
