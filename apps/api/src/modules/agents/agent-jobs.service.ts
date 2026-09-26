/**
 * Déclencheurs des agents (prompt 13) : messages entrants (`conversation.inbound`), documents téléversés
 * (`driver.document_uploaded`), relevés émis (`statement.issued`) et rapports planifiés (07 h chaque jour, lundi pour
 * l'hebdomadaire, heure de Montréal). Chaque événement devient une tâche de la file `agents` avec un identifiant
 * déterministe : avec Redis, l'API et le worker reçoivent l'événement et la même tâche n'est ajoutée qu'une fois, le
 * worker la traite ; sans Redis, l'API la traite elle-même. Les exécutions sont en plus idempotentes en base.
 * En test, les déclencheurs sont coupés sauf `AGENT_TRIGGERS=on` (fichiers de test parallèles sur la même base).
 */
import { reportsDue, type AgentRunView, type Language } from '@neomoov/domain';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Logger } from 'pino';
import { DomainEventsService, type DomainEvents } from '../../common/domain-events.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { QueueService } from '../../infra/queue.module.js';
import { AccountingAgent, AnalyticsAgent, RecruitmentAgent } from './back-office.agents.js';
import { CustomerRelationsAgent } from './customer-relations.agent.js';

@Injectable()
export class AgentJobsService implements OnModuleInit {
  private registered = false;

  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly queues: QueueService,
    private readonly events: DomainEventsService,
    private readonly settings: SettingsService,
    private readonly customerRelations: CustomerRelationsAgent,
    private readonly recruitment: RecruitmentAgent,
    private readonly accounting: AccountingAgent,
    private readonly analytics: AnalyticsAgent,
  ) {}

  get triggersEnabled(): boolean {
    return this.env.AGENT_TRIGGERS ? this.env.AGENT_TRIGGERS === 'on' : this.env.NODE_ENV !== 'test';
  }

  onModuleInit() {
    if (!this.triggersEnabled) return;
    this.events.on('conversation.inbound', (p) => this.enqueue('conversation', `conversation-${p.externalId}`, p));
    this.events.on('driver.document_uploaded', (p) => this.enqueue('document', `document-${p.documentId}`, { documentId: p.documentId }));
    this.events.on('statement.issued', (p) => this.enqueue('statement', `statement-${p.statementId}`, { statementId: p.statementId }));
    // Avec Redis, c'est le worker qui porte la file ; sans Redis, l'API (en test, sans passe périodique des rapports).
    if (this.queues.mode === 'memory') this.register(this.env.NODE_ENV === 'test' ? {} : { tickEveryMs: 300_000 });
  }

  private async enqueue(job: string, jobId: string, data: unknown): Promise<void> {
    try {
      await this.queues.add('agents', job, data, { jobId });
    } catch (error) {
      this.logger.error({ err: error, job, jobId }, 'Tâche d\'agent non mise en file');
    }
  }

  /** Enregistre le traitement de la file `agents` (et la passe des rapports toutes les `tickEveryMs`). */
  register(options: { tickEveryMs?: number } = {}): void {
    if (this.registered) return;
    this.registered = true;
    this.queues.process('agents', async (job) => this.process(job.name, job.data), { concurrency: 3, ...(options.tickEveryMs ? { everyMs: options.tickEveryMs, jobName: 'reports' } : {}) });
  }

  async process(name: string, data: unknown): Promise<void> {
    switch (name) {
      case 'conversation': {
        const p = data as DomainEvents['conversation.inbound'];
        await this.customerRelations.handleInbound({ channel: p.channel, externalId: p.externalId, userId: p.userId, phone: p.phone, text: p.text, language: (p.language ?? null) as Language | null, rideId: p.rideId });
        return;
      }
      case 'document':
        await this.recruitment.handleDocument((data as { documentId: string }).documentId);
        return;
      case 'statement':
        await this.accounting.handleStatement((data as { statementId: string }).statementId);
        return;
      case 'reports':
        await this.reportTick(new Date());
        return;
      default:
        this.logger.warn({ job: name }, 'Tâche d\'agent inconnue');
    }
  }

  /** Passe des rapports : quotidien à partir de 07 h, hebdomadaire le lundi ; une période déjà rapportée n'est pas refaite. */
  async reportTick(now = new Date()): Promise<AgentRunView[]> {
    const [tz, hour, weeklyWeekday] = await Promise.all([
      this.settings.string('service.time_zone', 'America/Toronto'),
      this.settings.number('agents.report_hour', 7),
      this.settings.number('agents.report_weekly_weekday', 1),
    ]);
    const runs: AgentRunView[] = [];
    for (const period of reportsDue(now, tz, { hour, weeklyWeekday })) {
      // Un rapport en échec est repris au plus une fois par heure (pas à chaque passe de 5 minutes).
      if (await this.analytics.failedRecently(period, now, 3_600_000)) continue;
      const execution = await this.analytics.runReport(period, { send: true, scheduled: true });
      if (!execution.replayed) runs.push(execution.run);
    }
    return runs;
  }
}
