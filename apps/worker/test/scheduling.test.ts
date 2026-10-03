import { QueueService } from '@neomoov/api';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { SchedulingWorker } from '../src/worker.module.js';

/**
 * Courses planifiées (finalisation du 3 octobre 2026) : le signal d'attribution à 60 minutes, non persistant, est rattrapé
 * par le worker quand il est resté sans suite, par un appel au service de répartition existant.
 */
function worker(options: { due?: string[]; recover?: string[]; mode?: 'auto' | 'manual'; failing?: string[] } = {}) {
  const scheduled = {
    tick: vi.fn(async () => ({ reminders: [], driverReminders: [], dispatchDue: options.due ?? [], operatorAlerts: [] })),
    dispatchDueToRecover: vi.fn(async () => options.recover ?? []),
  };
  const stuck = { alert: vi.fn(async () => 0) };
  const dispatch = {
    start: vi.fn(async (rideId: string) => {
      if (options.failing?.includes(rideId)) throw new Error('panne de la base');
      return rideId.startsWith('deja') ? null : { rideId };
    }),
  };
  const queues = new QueueService(null);
  const scheduling = new SchedulingWorker(scheduled as never, stuck as never, queues, pino({ level: 'silent' }), dispatch as never, { DISPATCH_MODE: options.mode ?? 'auto' });
  return { scheduling, scheduled, dispatch, queues };
}

describe('worker : attribution planifiée rattrapée', () => {
  it('relance par la répartition les signaux restés sans suite ; sans Redis, aussi ceux de la passe', async () => {
    const { scheduling, scheduled, dispatch, queues } = worker({ due: ['r1'], recover: ['r1', 'r2', 'deja-1'] });
    expect(queues.mode).toBe('memory');
    const now = new Date('2026-10-03T15:00:00Z');
    expect(await scheduling.pass(now)).toEqual({ recovered: ['r1', 'r2'] });
    expect(scheduled.tick).toHaveBeenCalledWith(now);
    expect(scheduled.dispatchDueToRecover).toHaveBeenCalledWith(now);
    // Chaque course une seule fois, avec le motif et la source du rattrapage.
    expect(dispatch.start.mock.calls.map((c) => c[0])).toEqual(['r1', 'r2', 'deja-1']);
    expect(dispatch.start).toHaveBeenCalledWith('r1', { reason: 'scheduled_due', source: 'sweep' });
  });

  it('une course en échec n\'empêche pas les autres ; rien en répartition manuelle', async () => {
    const failing = worker({ recover: ['x', 'y'], failing: ['x'] });
    expect(await failing.scheduling.recoverDispatchDue(new Date())).toEqual(['y']);
    const manual = worker({ recover: ['z'], mode: 'manual' });
    expect(await manual.scheduling.recoverDispatchDue(new Date(), ['z'])).toEqual([]);
    expect(manual.dispatch.start).not.toHaveBeenCalled();
    expect(manual.scheduled.dispatchDueToRecover).not.toHaveBeenCalled();
  });

  it('la file scheduling passe par la même passe', async () => {
    const { scheduling, scheduled, queues } = worker();
    scheduling.onModuleInit();
    await queues.add('scheduling', 'tick', {});
    expect(scheduled.tick).toHaveBeenCalledTimes(1);
    expect((await queues.stats()).find((s) => s.name === 'scheduling')?.failed).toBe(0);
    await queues.onModuleDestroy();
  });
});
