import { Module } from '@nestjs/common';
import { CreditsEventsService } from './credits-events.service.js';
import { MeCreditsController } from './credits.controller.js';
import { CreditsService } from './credits.service.js';
import { ReferralsService } from './referrals.service.js';

/**
 * Crédits et parrainage (prompt 08 tâche 4). Aucune dépendance vers les courses : le module réagit à `ride.completed`
 * (consommation des crédits, récompense des parrainages) ; les chauffeurs l'appellent à la candidature.
 */
@Module({
  controllers: [MeCreditsController],
  providers: [CreditsService, ReferralsService, CreditsEventsService],
  exports: [CreditsService, ReferralsService, CreditsEventsService],
})
export class CreditsModule {}
