/**
 * File `retention` : une passe par quart d'heure, qui ne travaille qu'une fois par nuit, à partir de 3 h (heure de
 * Montréal). Avec Redis, le worker porte la file ; sans Redis, l'API (hors tests).
 */
import { localDate } from '@neomoov/domain';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Logger } from 'pino';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { QueueService } from '../../infra/queue.module.js';
import { RetentionService } from './retention.service.js';

@Injectable()
export class RetentionJobsService implements OnModuleInit {
  private registered = false;
  private lastRunDay: string | null = null;

  constructor(
    private readonly retention: RetentionService,
    private readonly settings: SettingsService,
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
    this.queues.process('retention', async () => this.tick(new Date()), { concurrency: 1, ...(options.everyMs ? { everyMs: options.everyMs, jobName: 'tick' } : {}) });
  }

  async tick(now: Date): Promise<void> {
    const timeZone = await this.settings.string('service.time_zone', 'America/Toronto');
    const { date } = localDate(now, timeZone);
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now));
    if (hour < 3 || this.lastRunDay === date) return;
    this.lastRunDay = date;
    const results = await this.retention.run(now);
    this.logger.info({ results: results.map((r) => ({ type: r.type, rows: r.rowsProcessed })) }, 'conservation : passe nocturne');
  }
}
