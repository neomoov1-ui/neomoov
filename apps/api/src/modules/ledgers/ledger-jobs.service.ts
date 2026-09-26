/**
 * Tâches des registres et des exports par la file `exports` (prompt 09, tâches 7 et 8) : lignes des registres à la fin
 * de chaque course (tâche d'identifiant stable par course : avec Redis, plusieurs processus reçoivent le même événement,
 * BullMQ n'en garde qu'une), rapports de synthèse PDF, exports de géolocalisation demandés dans My Hub, et une passe
 * horaire qui comble les courses terminées sans ligne et produit l'export de géolocalisation du mois précédent dès le
 * 1er du mois (heure de Montréal). Avec Redis, le worker traite la file ; sans Redis, le processus de l'API.
 */
import type { LedgerType } from '@neomoov/domain';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Logger } from 'pino';
import { DomainEventsService } from '../../common/domain-events.js';
import { APP_LOGGER } from '../../common/logger.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { QueueService } from '../../infra/queue.module.js';
import { GeolocationExportService } from './geolocation-export.service.js';
import { LedgerExportsService } from './ledger-exports.service.js';
import { LedgersService, type LedgerSweepReport } from './ledgers.service.js';

export type ExportJob =
  | { kind: 'ledger'; rideId: string }
  | { kind: 'summary'; type: LedgerType; period: string }
  | { kind: 'geolocation'; month: string; force: boolean; requestedBy: string | null };

/** Passe horaire : reprise des registres et export de géolocalisation dû. */
export const EXPORTS_TICK_MS = 3_600_000;

@Injectable()
export class LedgerJobsService implements OnModuleInit {
  private registered = false;

  constructor(
    private readonly ledgers: LedgersService,
    private readonly exports: LedgerExportsService,
    private readonly geolocation: GeolocationExportService,
    private readonly queues: QueueService,
    private readonly events: DomainEventsService,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  onModuleInit() {
    // En mode mémoire, le processus qui ajoute une tâche la traite ; la passe horaire n'y tourne pas en test (les tests
    // appellent la reprise sur leurs propres courses : une passe globale toucherait les courses des autres fichiers).
    if (this.queues.mode === 'memory') this.register(this.env.NODE_ENV === 'test' ? {} : { everyMs: EXPORTS_TICK_MS });
    this.events.on('ride.completed', (p) => this.enqueue({ kind: 'ledger', rideId: p.rideId }, `ledger-${p.rideId}`));
  }

  /** Enregistre le traitement de la file (API en mode mémoire, worker avec Redis) ; `everyMs` planifie la passe horaire. */
  register(options: { everyMs?: number } = {}): void {
    if (this.registered) return;
    this.registered = true;
    this.queues.process('exports', async (job) => this.run((job.data ?? {}) as ExportJob | { at?: string }), { concurrency: 2, ...(options.everyMs ? { everyMs: options.everyMs, jobName: 'tick' } : {}) });
  }

  private enqueue(job: ExportJob, jobId: string): void {
    this.queues.add('exports', job.kind, job, { jobId }).catch((error: unknown) => this.logger.error({ err: error, job }, 'Tâche des registres non mise en file'));
  }

  async run(job: ExportJob | { at?: string }): Promise<void> {
    if (!('kind' in job)) {
      await this.tick(new Date());
      return;
    }
    switch (job.kind) {
      case 'ledger':
        await this.ledgers.record(job.rideId);
        return;
      case 'summary':
        await this.exports.produceSummary(job.type, job.period);
        return;
      case 'geolocation':
        await this.geolocation.produce(job.month, { force: job.force, requestedBy: job.requestedBy });
        return;
    }
  }

  /** Passe horaire : chaque partie est indépendante (une panne de l'une n'empêche pas l'autre). */
  async tick(now: Date): Promise<{ ledgers: LedgerSweepReport | null; geolocation: string | null }> {
    const ledgers = await this.ledgers.sweep().catch((error: unknown) => {
      this.logger.error({ err: error }, 'Reprise des registres en échec');
      return null;
    });
    const geolocation = await this.geolocation.runDue(now).then(
      (result) => `${result.month} ${result.status}`,
      (error: unknown) => {
        this.logger.error({ err: error }, 'Export de géolocalisation planifié en échec');
        return null;
      },
    );
    return { ledgers, geolocation };
  }
}
