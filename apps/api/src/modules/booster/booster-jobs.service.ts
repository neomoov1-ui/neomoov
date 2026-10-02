/**
 * File `booster` : une passe par minute pour les alertes de la journée des chauffeurs (début et fin de session,
 * vérification sommaire, périodes et zones de gain). Avec Redis, le worker porte la file ; sans Redis, l'API (hors tests,
 * qui appellent la passe directement avec une horloge choisie).
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Logger } from 'pino';
import { APP_LOGGER } from '../../common/logger.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { QueueService } from '../../infra/queue.module.js';
import { AlertsService } from './alerts.service.js';

@Injectable()
export class BoosterJobsService implements OnModuleInit {
  private registered = false;

  constructor(
    private readonly alerts: AlertsService,
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
    this.queues.process('booster', async () => {
      try {
        await this.alerts.tick(new Date());
      } catch (error) {
        this.logger.error({ err: error }, 'Passe des alertes Booster en échec');
        throw error;
      }
    }, { concurrency: 1, ...(options.everyMs ? { everyMs: options.everyMs, jobName: 'tick' } : {}) });
  }
}
