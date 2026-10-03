import { Module } from '@nestjs/common';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';
import { CreditsEventsService } from './credits-events.service.js';
import { MeCreditsController } from './credits.controller.js';
import { CreditsService } from './credits.service.js';
import { ReferralsService } from './referrals.service.js';

/**
 * Crédits et parrainage (prompt 08 tâche 4). Aucune dépendance vers les courses : le module réagit à `ride.completed`
 * (consommation des crédits, récompense des parrainages) ; les chauffeurs l'appellent à la candidature. La boîte d'envoi
 * des notifications (avis de parrainage, finalisation du 3 octobre 2026) est fournie ici, comme dans les paiements.
 */
@Module({
  controllers: [MeCreditsController],
  providers: [CreditsService, ReferralsService, CreditsEventsService, NotificationsOutbox],
  exports: [CreditsService, ReferralsService, CreditsEventsService],
})
export class CreditsModule {}
