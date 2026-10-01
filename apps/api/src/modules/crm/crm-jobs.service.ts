/**
 * File `crm` (étape 25) : chaque prospect, compte d'affaires ou organisation créé (événements de domaine) donne une
 * tâche de synchronisation d'identifiant stable (dédoublonnée entre l'API et le worker), relancée par BullMQ en cas
 * de panne du fournisseur ; une passe toutes les 10 minutes reprend les fiches en erreur et rattrape les prospects
 * récents jamais présentés au CRM. Avec Redis, le worker porte la file ; sans Redis, l'API. En test, rien n'est
 * automatique : le test enregistre le traitement et appelle la passe.
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Logger } from 'pino';
import { DomainEventsService } from '../../common/domain-events.js';
import { APP_LOGGER } from '../../common/logger.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { QueueService } from '../../infra/queue.module.js';
import { CrmSyncService, type CrmEntityType } from './crm-sync.service.js';

type CrmJob = { kind: 'sync'; entityType: CrmEntityType; entityId: string; reason: string } | { kind: 'sweep' };

export interface CrmSweepReport {
  retried: number;
  caughtUp: number;
  failed: number;
}

@Injectable()
export class CrmJobsService implements OnModuleInit {
  private registered = false;

  constructor(
    private readonly sync: CrmSyncService,
    private readonly queues: QueueService,
    private readonly events: DomainEventsService,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  onModuleInit() {
    this.events.on('lead.created', (p) => {
      if (p.consent) void this.enqueue('lead', p.leadId, 'created');
    });
    this.events.on('organization.created', (p) => {
      if (p.parentId) void this.enqueue('organization', p.organizationId, 'created');
    });
    this.events.on('organization.subscribed', (p) => void this.enqueue('organization', p.organizationId, `subscribed-${p.planCode}`));
    this.events.on('business_account.created', (p) => void this.enqueue('business_account', p.businessAccountId, 'created'));
    if (this.env.NODE_ENV === 'test') return;
    if (this.queues.mode === 'memory') this.register({ everyMs: 600_000 });
  }

  /** Met une synchronisation en file ; un échec de mise en file est journalisé, jamais propagé (la passe rattrape). */
  async enqueue(entityType: CrmEntityType, entityId: string, reason = 'manual'): Promise<void> {
    try {
      await this.queues.add('crm', 'sync', { kind: 'sync', entityType, entityId, reason } satisfies CrmJob, {
        jobId: `crm-sync-${entityType}-${entityId}-${reason}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 60_000 },
      });
    } catch (error) {
      this.logger.error({ err: error, entityType, entityId }, 'Synchronisation CRM non mise en file');
    }
  }

  /** Enregistre le traitement de la file (API sans Redis, worker avec Redis) ; `everyMs` planifie la passe de reprise. */
  register(options: { everyMs?: number } = {}): void {
    if (this.registered) return;
    this.registered = true;
    this.queues.process('crm', async (job) => this.run(job.data as CrmJob | { at?: string }), { concurrency: 2, ...(options.everyMs ? { everyMs: options.everyMs, jobName: 'sweep' } : {}) });
  }

  async run(job: CrmJob | { at?: string }): Promise<void> {
    if ('kind' in job && job.kind === 'sync') {
      await this.sync.sync(job.entityType, job.entityId);
      return;
    }
    const report = await this.sweep(new Date());
    if (report.retried || report.caughtUp || report.failed) this.logger.info(report, 'passe CRM');
  }

  /**
   * Reprise des fiches en erreur, puis rattrapage des prospects et comptes d'affaires récents (48 heures, ou depuis
   * `since`) jamais présentés au CRM (hors test, sauf demande) ; une erreur est comptée, jamais propagée.
   */
  async sweep(now: Date, options: { catchUp?: boolean; since?: Date } = {}): Promise<CrmSweepReport> {
    const report: CrmSweepReport = { retried: 0, caughtUp: 0, failed: 0 };
    for (const { entityType, entityId } of await this.sync.pendingRetries()) {
      try {
        await this.sync.sync(entityType, entityId, now);
        report.retried += 1;
      } catch {
        report.failed += 1;
      }
    }
    if (options.catchUp ?? this.env.NODE_ENV !== 'test') {
      const since = options.since ?? new Date(now.getTime() - 48 * 3_600_000);
      const missed: Array<[CrmEntityType, string]> = [
        ...(await this.sync.unsyncedLeads(since)).map((id): [CrmEntityType, string] => ['lead', id]),
        ...(await this.sync.unsyncedBusinessAccounts(since)).map((id): [CrmEntityType, string] => ['business_account', id]),
      ];
      for (const [entityType, id] of missed) {
        try {
          await this.sync.sync(entityType, id, now);
          report.caughtUp += 1;
        } catch {
          report.failed += 1;
        }
      }
    }
    return report;
  }
}
