/**
 * Abonnement à `ride.completed` (prompt 08 tâche 4) : consommation des crédits appliqués à la course, puis récompense
 * des parrainages (client et chauffeur). L'ordre compte : un crédit de parrainage créé par cette course ne sert pas à
 * la payer. Chaque traitement est idempotent en base (verrous, index uniques, passage `pending` vers `completed`) :
 * avec Redis, chaque processus de l'API reçoit l'événement et le traite sans risque de double mouvement. Un échec
 * passager (base indisponible) est réessayé deux fois avant d'être journalisé.
 */
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Logger } from 'pino';
import { DomainEventsService } from '../../common/domain-events.js';
import { APP_LOGGER } from '../../common/logger.js';
import { CreditsService, type CreditConsumption } from './credits.service.js';
import { ReferralsService } from './referrals.service.js';

const RETRY_DELAYS_MS = [1_000, 5_000];

@Injectable()
export class CreditsEventsService implements OnModuleInit, OnModuleDestroy {
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly credits: CreditsService,
    private readonly referrals: ReferralsService,
    private readonly events: DomainEventsService,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  onModuleInit() {
    this.unsubscribe = this.events.on('ride.completed', (p) => this.handle(p.rideId));
  }

  onModuleDestroy() {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Traitement d'une fin de course (appelé par l'abonnement ; rejouable tel quel). */
  async onRideCompleted(rideId: string): Promise<{ credits: CreditConsumption; referrals: { client: boolean; driver: boolean } }> {
    const credits = await this.credits.consumeForRide(rideId);
    const referrals = await this.referrals.rewardAfterRide(rideId);
    return { credits, referrals };
  }

  private async handle(rideId: string): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.onRideCompleted(rideId);
        return;
      } catch (error) {
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay === undefined) {
          this.logger.error({ err: error, rideId }, 'Crédits et parrainage non traités à la fin de course');
          return;
        }
        this.logger.warn({ err: error, rideId, attempt: attempt + 1 }, 'Crédits et parrainage : nouvel essai');
        await new Promise((resolve) => setTimeout(resolve, delay).unref());
      }
    }
  }
}
