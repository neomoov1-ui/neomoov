/**
 * File `settlements` (prompt 09, tâche 2) : une passe tous les quarts d'heure. Le vendredi à partir de 6 h (heure de
 * Montréal, réglages `settlement.generation_*`), génération des relevés de la semaine précédente, émission et
 * règlement ; le lundi (`settlement.retry_weekday`), nouvel essai des règlements en échec ; chaque jour, revue des
 * soldes impayés (suspension ou réactivation). Chaque étape est rejouable : un relevé émis n'est jamais regénéré, un
 * relevé réglé jamais réglé deux fois. Les PDF sont produits ici, jamais dans une requête HTTP. Avec Redis, c'est le
 * worker qui porte la file ; sans Redis, l'API (hors tests, qui appellent les passes directement).
 */
import { schema } from '@neomoov/db';
import { localDate, periodForGeneration } from '@neomoov/domain';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import { STORAGE_PROVIDER, type StorageProvider } from '../../adapters/types.js';
import { DomainEventsService } from '../../common/domain-events.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { DB, type Database } from '../../infra/db.module.js';
import { QueueService } from '../../infra/queue.module.js';
import { SettlementPayoutsService } from './settlement-payouts.service.js';
import { renderStatementPdf } from './statement-pdf.js';
import { StatementsService } from './statements.service.js';

type SettlementJob = { kind: 'pdf'; statementId: string } | { kind: 'tick' };

export interface SettlementTickReport {
  generated: number;
  issued: number;
  settled: number;
  retried: number;
  reviewed: number;
}

@Injectable()
export class SettlementJobsService implements OnModuleInit {
  private registered = false;

  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly settings: SettingsService,
    private readonly statements: StatementsService,
    private readonly payouts: SettlementPayoutsService,
    private readonly queues: QueueService,
    private readonly events: DomainEventsService,
  ) {}

  onModuleInit() {
    if (this.queues.mode === 'memory') this.register(this.env.NODE_ENV === 'test' ? {} : { everyMs: 900_000 });
    // Émission automatique (vendredi) ou manuelle (My Hub) : le PDF suit, une seule tâche par relevé.
    this.events.on('statement.issued', (p) => {
      this.enqueuePdf(p.statementId).catch((error: unknown) => this.logger.error({ err: error, statementId: p.statementId }, 'PDF du relevé non mis en file'));
    });
  }

  /** Enregistre le traitement de la file (API en mode mémoire, worker avec Redis) ; `everyMs` planifie la passe. */
  register(options: { everyMs?: number } = {}): void {
    if (this.registered) return;
    this.registered = true;
    this.queues.process('settlements', async (job) => this.run(job.data as SettlementJob | { at?: string }), { concurrency: 2, ...(options.everyMs ? { everyMs: options.everyMs, jobName: 'tick' } : {}) });
  }

  async run(job: SettlementJob | { at?: string }): Promise<void> {
    if ('kind' in job && job.kind === 'pdf') return this.renderPdf(job.statementId);
    const report = await this.tick(new Date());
    if (report.generated || report.settled || report.retried) this.logger.info(report, 'règlement hebdomadaire');
  }

  /** Demande le PDF d'un relevé émis (identifiant de tâche stable : une seule production par relevé). */
  async enqueuePdf(statementId: string): Promise<void> {
    await this.queues.add('settlements', 'pdf', { kind: 'pdf', statementId } satisfies SettlementJob, { jobId: `pdf:${statementId}` });
  }

  /** Passe du quart d'heure. `now` permet aux tests de simuler l'horloge (vendredi 6 h, lundi, délai de 7 jours). */
  async tick(now: Date): Promise<SettlementTickReport> {
    const report: SettlementTickReport = { generated: 0, issued: 0, settled: 0, retried: 0, reviewed: 0 };
    const timeZone = await this.statements.timeZone();
    const [generationDay, generationHour, retryWeekday] = await Promise.all([
      this.settings.number('settlement.generation_day', 5), this.settings.number('settlement.generation_hour', 6), this.settings.number('settlement.retry_weekday', 1),
    ]);
    const { weekday } = localDate(now, timeZone);
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now));
    if (hour >= generationHour && weekday === generationDay) {
      const period = periodForGeneration(now, timeZone);
      const generation = await this.statements.generate({ periodStart: period.startDate }, now);
      report.generated = generation.generated;
      for (const id of await this.statements.draftsOf(period.startDate)) {
        await this.statements.issue(id, now);
        report.issued += 1;
      }
      report.settled = await this.payouts.settleIssued(period.startDate, now);
    }
    if (hour >= generationHour && weekday === retryWeekday) report.retried = await this.payouts.retryFailed(now);
    report.reviewed = await this.payouts.reviewBalances(now);
    return report;
  }

  private async renderPdf(statementId: string): Promise<void> {
    const detail = await this.statements.detail(statementId);
    if (detail.status === 'draft') return;
    const [timeZone, companyName] = await Promise.all([this.statements.timeZone(), this.settings.string('company.legal_name', 'Neomoov')]);
    const pdf = await renderStatementPdf(detail, { timeZone, companyName });
    const key = `statements/${detail.driverId}/${detail.periodStart}-${statementId}.pdf`;
    await this.storage.putObject({ key, body: pdf, contentType: 'application/pdf' });
    await this.database.db.update(schema.weeklyStatements).set({ pdfKey: key }).where(eq(schema.weeklyStatements.id, statementId));
  }

  /** PDF stocké d'un relevé ; `null` tant qu'il n'est pas produit. */
  async pdfOf(pdfKey: string | null): Promise<Buffer | null> {
    if (!pdfKey) return null;
    const file = await this.storage.getObject(pdfKey);
    return file?.body ?? null;
  }
}
