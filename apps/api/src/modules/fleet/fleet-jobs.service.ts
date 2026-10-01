/**
 * File `fleet` (étape 23) : passe du réseau Neomoov chaque minute. Une course d'une organisation en mode réseau, encore
 * sans chauffeur après le délai réglé par l'organisation, repart au réseau (`FleetDispatchService.networkPass`). Avec
 * Redis, le worker porte la file ; sans Redis, l'API (hors tests, qui appellent la passe directement avec une horloge
 * simulée).
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Logger } from 'pino';
import { APP_LOGGER } from '../../common/logger.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { QueueService } from '../../infra/queue.module.js';
import { FleetDispatchService } from './fleet-dispatch.service.js';

@Injectable()
export class FleetJobsService implements OnModuleInit {
  private registered = false;

  constructor(
    private readonly fleet: FleetDispatchService,
    private readonly queues: QueueService,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  onModuleInit() {
    if (this.queues.mode === 'memory' && this.env.NODE_ENV !== 'test') this.register({ everyMs: 60_000 });
  }

  register(options: { everyMs?: number } = {}): void {
    if (this.registered) return;
    this.registered = true;
    this.queues.process('fleet', async () => this.tick(new Date()), { concurrency: 1, ...(options.everyMs ? { everyMs: options.everyMs, jobName: 'network' } : {}) });
  }

  async tick(now: Date): Promise<{ shared: string[] }> {
    const report = await this.fleet.networkPass(now);
    if (report.shared.length) this.logger.info({ shared: report.shared.length }, 'réseau Neomoov : courses d\'organisations partagées');
    return report;
  }
}
