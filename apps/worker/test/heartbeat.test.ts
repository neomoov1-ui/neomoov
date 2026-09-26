import { createLogger, QueueService, runWithCorrelation } from '@neomoov/api';
import { pino } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeartbeatService } from '../src/worker.module.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('worker : file heartbeat en mémoire', () => {
  it('exécute le traitement enregistré à chaque tâche ajoutée', async () => {
    const queues = new QueueService(null);
    const heartbeat = new HeartbeatService(queues, pino({ level: 'silent' }));
    heartbeat.onModuleInit();
    expect(queues.mode).toBe('memory');
    await queues.add('heartbeat', 'tick', { at: new Date().toISOString() });
    await queues.add('heartbeat', 'tick', { at: new Date().toISOString() });
    expect(heartbeat.ticks).toBe(2);
    const stats = await queues.stats();
    expect(stats.find((s) => s.name === 'heartbeat')?.failed).toBe(0);
    await queues.onModuleDestroy();
  });

  it('chaque battement prévient le moniteur Better Stack quand son adresse est configurée, sans jamais bloquer', async () => {
    const fetch = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const queues = new QueueService(null);
    const heartbeat = new HeartbeatService(queues, pino({ level: 'silent' }), { BETTERSTACK_HEARTBEAT_URL: 'https://battement.exemple.invalid/abc' });
    heartbeat.onModuleInit();
    await queues.add('heartbeat', 'tick', {});
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('https://battement.exemple.invalid/abc', expect.objectContaining({ method: 'GET' }));
    // Better Stack injoignable : le battement est journalisé, la tâche ne tombe pas en échec.
    fetch.mockRejectedValueOnce(new Error('réseau coupé'));
    await queues.add('heartbeat', 'tick', {});
    fetch.mockResolvedValueOnce(new Response('non', { status: 500 }));
    expect(await heartbeat.ping()).toBe(false);
    expect((await queues.stats()).find((s) => s.name === 'heartbeat')?.failed).toBe(0);
    await queues.onModuleDestroy();
  });

  it('sans adresse, aucun appel réseau ; la ligne du battement porte l\'identifiant de corrélation de sa tâche', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const lines: Array<Record<string, unknown>> = [];
    const logger = createLogger('worker', 'info', { write: (line: string) => lines.push(JSON.parse(line) as Record<string, unknown>) });
    const queues = new QueueService(null);
    const heartbeat = new HeartbeatService(queues, logger);
    heartbeat.onModuleInit();
    await runWithCorrelation('tache-planifiee-01', () => queues.add('heartbeat', 'tick', {}));
    expect(fetch).not.toHaveBeenCalled();
    expect(await heartbeat.ping()).toBe(false);
    expect(heartbeat.ticks).toBe(1);
    expect(lines.find((l) => l['msg'] === 'battement du worker')).toMatchObject({ correlationId: 'tache-planifiee-01' });
    await queues.onModuleDestroy();
  });
});
