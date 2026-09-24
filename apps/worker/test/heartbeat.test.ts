import { QueueService } from '@neomoov/api';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { HeartbeatService } from '../src/worker.module.js';

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
});
