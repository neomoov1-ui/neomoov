/**
 * File `retention` : une passe par quart d'heure, qui ne travaille qu'une fois par nuit, à partir de 3 h (heure de
 * Montréal). Avec Redis, le worker porte la file ; sans Redis, l'API (hors tests). Revue du 2 octobre 2026 (constat 18) :
 * la nuit faite est gardée en base (`claimDailyRun`) : ni redémarrage ni second processus ne relancent les purges ; une
 * passe interrompue (processus tué) est reprise après deux heures, une passe en erreur attend la nuit suivante, comme
 * avant (une ligne `retention_jobs` par tâche faite).
 */
import { localDate } from '@neomoov/domain';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Logger } from 'pino';
import { claimDailyRun, completeDailyRun } from '../../common/daily-run.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { DB, type Database } from '../../infra/db.module.js';
import { QueueService } from '../../infra/queue.module.js';
import { RetentionService } from './retention.service.js';

@Injectable()
export class RetentionJobsService implements OnModuleInit {
  private registered = false;

  constructor(
    private readonly retention: RetentionService,
    private readonly settings: SettingsService,
    private readonly queues: QueueService,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    @Inject(DB) private readonly database: Database,
  ) {}

  onModuleInit() {
    if (this.queues.mode === 'memory' && this.env.NODE_ENV !== 'test') this.register({ everyMs: 900_000 });
  }

  register(options: { everyMs?: number } = {}): void {
    if (this.registered) return;
    this.registered = true;
    this.queues.process('retention', async () => this.tick(new Date()), { concurrency: 1, ...(options.everyMs ? { everyMs: options.everyMs, jobName: 'tick' } : {}) });
  }

  /** Vrai si ce processus a fait la passe de la nuit. */
  async tick(now: Date): Promise<boolean> {
    const timeZone = await this.settings.string('service.time_zone', 'America/Toronto');
    const { date } = localDate(now, timeZone);
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now));
    if (hour < 3 || !(await claimDailyRun(this.database, 'retention', date, now))) return false;
    const results = await this.retention.run(now);
    await completeDailyRun(this.database, 'retention', date, new Date());
    this.logger.info({ results: results.map((r) => ({ type: r.type, rows: r.rowsProcessed })) }, 'conservation : passe nocturne');
    return true;
  }
}
