import 'reflect-metadata';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { activeOrgScope, currentOrgScope } from '../src/common/org-scope.context.js';
import { DomainEventsService } from '../src/common/domain-events.js';
import { scopedDatabase, type Database } from '../src/infra/db.module.js';
import { OrgScopeService } from '../src/modules/organizations/org-scope.service.js';

/**
 * Étape 23 : un événement de domaine émis pendant une transaction d'organisation part après sa validation, jamais sur
 * annulation ; celui d'un point de sauvegarde annulé est abandonné, celui d'un point de sauvegarde réussi attend la
 * validation de la transaction englobante. Sans base : transactions simulées.
 */
const A = '00000000-0000-4000-8000-0000000000aa';
const PATH_A = `/00000000-0000-4000-8000-000000000001/${A}/`;

function fakeDatabase(log: string[]): Database {
  const tx = (label: string): unknown => ({
    label,
    execute: async () => [],
    transaction: async (fn: (sp: unknown) => Promise<unknown>) => {
      log.push(`savepoint:${label}`);
      return fn(tx(`${label}/sp`));
    },
  });
  const real = {
    db: {
      transaction: async (fn: (t: unknown) => Promise<unknown>) => {
        log.push('begin');
        try {
          const result = await fn(tx('tx'));
          log.push('commit');
          return result;
        } catch (error) {
          log.push('rollback');
          throw error;
        }
      },
    },
    client: null,
    close: async () => undefined,
  } as unknown as Database;
  return scopedDatabase(real);
}

function setup() {
  const log: string[] = [];
  const database = fakeDatabase(log);
  const logger = pino({ level: 'silent' });
  const scope = new OrgScopeService(database, logger);
  const events = new DomainEventsService(logger, null);
  events.on('dispatch.updated', (p) => {
    log.push(`event:${p.rideId}:${activeOrgScope() ? 'transaction' : 'pool'}:${currentOrgScope()?.organizationId ?? 'plateforme'}`);
  });
  const emit = (rideId: string) => events.emit('dispatch.updated', { rideId, status: 'offering', wave: 1, offersSent: 1, nextActionAt: null });
  return { log, scope, emit };
}

describe('événements de domaine sous contexte d\'organisation (étape 23)', () => {
  it('émis pendant la transaction : livré après la validation, par le pool, avec l\'organisation', async () => {
    const { log, scope, emit } = setup();
    await scope.run(PATH_A, async () => {
      emit('r1');
      log.push('fin du travail');
    });
    expect(log).toEqual(['begin', 'fin du travail', 'commit', `event:r1:pool:${A}`]);
  });

  it('transaction annulée : l\'événement n\'est jamais livré', async () => {
    const { log, scope, emit } = setup();
    await expect(scope.run(PATH_A, async () => {
      emit('r2');
      throw new Error('refus');
    })).rejects.toThrow('refus');
    expect(log).toEqual(['begin', 'rollback']);
  });

  it('points de sauvegarde : réussi, l\'événement attend la validation englobante ; annulé, il est abandonné', async () => {
    const { log, scope, emit } = setup();
    await scope.run(PATH_A, async () => {
      await scope.run(PATH_A, async () => {
        emit('r3');
      });
      await scope.run(PATH_A, async () => {
        emit('r4');
        throw new Error('point de sauvegarde annulé');
      }).catch(() => undefined);
      log.push('fin du travail');
    });
    expect(log).toEqual(['begin', 'savepoint:tx', 'savepoint:tx', 'fin du travail', 'commit', `event:r3:pool:${A}`]);
  });

  it('hors contexte : livré tout de suite (plateforme)', () => {
    const { log, emit } = setup();
    emit('r5');
    expect(log).toEqual(['event:r5:pool:plateforme']);
  });
});
