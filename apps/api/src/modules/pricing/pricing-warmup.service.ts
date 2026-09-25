import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { Logger } from 'pino';
import { APP_LOGGER } from '../../common/logger.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { DEFAULT_CITY, PricingRulesService } from './pricing-rules.service.js';
import { ZonesService } from './zones.service.js';

/**
 * Préchauffage au démarrage : zones et règles de tarification chargées avant le premier devis (sinon le premier client
 * attend leur chargement, plusieurs secondes avec une base distante). Sans attendre et sans bloquer le démarrage ;
 * jamais en test.
 */
@Injectable()
export class PricingWarmupService implements OnApplicationBootstrap {
  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly zones: ZonesService,
    private readonly rules: PricingRulesService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.env.NODE_ENV === 'test') return;
    const started = Date.now();
    void Promise.all([this.zones.all(), this.rules.rulesFor(DEFAULT_CITY)])
      .then(() => this.logger.info({ ms: Date.now() - started }, 'Zones et règles de tarification préchargées'))
      .catch((error: unknown) => this.logger.warn({ err: error }, 'Préchargement de la tarification impossible : chargement au premier devis'));
  }
}
