/**
 * File `sales` (phase 1 « entreprise autonome ») : une passe toutes les 5 minutes (worker avec Redis, API sans Redis ;
 * rien en test, où les tests appellent les passes directement) qui lance les appels sortants échus aux heures de bureau,
 * la passe des relances à partir de `sales.followups_hour` et la passe de prospection les jours et à partir de l'heure
 * réglés. Chaque passe quotidienne est idempotente (référence = date de Montréal, journal des agents).
 */
import { localClock } from '@neomoov/domain';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Logger } from 'pino';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { QueueService } from '../../infra/queue.module.js';
import { FollowupsService } from './followups.service.js';
import { OutboundCallsService } from './outbound-calls.service.js';
import { ProspectingAgent } from './prospecting.agent.js';

export interface SalesTickReport {
  callsLaunched: number;
  followupsRun: boolean;
  prospectingRun: boolean;
}

@Injectable()
export class SalesJobsService implements OnModuleInit {
  private registered = false;

  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly queues: QueueService,
    private readonly settings: SettingsService,
    private readonly prospecting: ProspectingAgent,
    private readonly followups: FollowupsService,
    private readonly calls: OutboundCallsService,
  ) {}

  onModuleInit() {
    if (this.env.NODE_ENV === 'test') return;
    if (this.queues.mode === 'memory') this.register({ everyMs: 300_000 });
  }

  /** Enregistre la passe périodique (worker avec Redis, API sans Redis). */
  register(options: { everyMs?: number } = {}): void {
    if (this.registered) return;
    this.registered = true;
    this.queues.process('sales', async () => {
      const report = await this.tick(new Date());
      if (report.callsLaunched || report.followupsRun || report.prospectingRun) this.logger.info(report, 'passe des ventes');
    }, { concurrency: 1, ...(options.everyMs ? { everyMs: options.everyMs, jobName: 'tick' } : {}) });
  }

  async tick(now = new Date()): Promise<SalesTickReport> {
    const report: SalesTickReport = { callsLaunched: 0, followupsRun: false, prospectingRun: false };
    try {
      report.callsLaunched = await this.calls.launchDue(now);
    } catch (error) {
      this.logger.error({ err: error }, 'Appels sortants échus non lancés');
    }
    const [tz, followupsHour] = await Promise.all([this.settings.string('service.time_zone', 'America/Toronto'), this.settings.number('sales.followups_hour', 8)]);
    if (localClock(now, tz).hour >= followupsHour) {
      try {
        const execution = await this.followups.run(now);
        report.followupsRun = !execution.replayed;
      } catch (error) {
        this.logger.error({ err: error }, 'Passe des relances en échec');
      }
    }
    if (await this.prospecting.due(now)) {
      try {
        const execution = await this.prospecting.run(now);
        report.prospectingRun = !execution.replayed;
      } catch (error) {
        this.logger.error({ err: error }, 'Passe de prospection en échec');
      }
    }
    return report;
  }
}
