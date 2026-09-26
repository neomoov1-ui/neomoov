/**
 * File `compliance` : une passe toutes les 15 minutes, qui ne travaille qu'une fois par jour (heure de Montréal) peu
 * après minuit : un document échu la veille suspend donc le chauffeur à minuit. Avec Redis, le worker porte la file ;
 * sans Redis, l'API (hors tests, qui appellent la passe directement avec une horloge simulée).
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Logger } from 'pino';
import { APP_LOGGER } from '../../common/logger.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { QueueService } from '../../infra/queue.module.js';
import { ComplianceService } from './compliance.service.js';

@Injectable()
export class ComplianceJobsService implements OnModuleInit {
  private registered = false;
  private lastRunDay: string | null = null;

  constructor(
    private readonly compliance: ComplianceService,
    private readonly queues: QueueService,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  onModuleInit() {
    if (this.queues.mode === 'memory' && this.env.NODE_ENV !== 'test') this.register({ everyMs: 900_000 });
  }

  register(options: { everyMs?: number } = {}): void {
    if (this.registered) return;
    this.registered = true;
    this.queues.process('compliance', async () => this.tick(new Date()), { concurrency: 1, ...(options.everyMs ? { everyMs: options.everyMs, jobName: 'tick' } : {}) });
  }

  /** Une passe par jour civil ; rejouer la même journée ne renvoie pas les rappels (compteur par échéance). */
  async tick(now: Date): Promise<void> {
    const today = await this.compliance.today(now);
    if (this.lastRunDay === today) return;
    const report = await this.compliance.run(now);
    this.lastRunDay = today;
    this.logger.info(report, 'conformité : passe quotidienne');
  }
}
