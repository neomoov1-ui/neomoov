import { Module } from '@nestjs/common';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';
import { DriverPaymentsService } from './driver-payments.service.js';
import { PaymentJobsService } from './payment-jobs.service.js';
import { AdminPaymentsController, DriverPaymentsController, PaymentsController, WebhooksController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';

/**
 * Paiements (prompt 07). Aucune dépendance vers les courses ni les chauffeurs : les courses appellent ce module
 * (autorisation à la création, pourboire, paiement direct) et il réagit à leurs événements par la file `payments`.
 */
@Module({
  controllers: [PaymentsController, DriverPaymentsController, WebhooksController, AdminPaymentsController],
  providers: [PaymentsService, DriverPaymentsService, PaymentJobsService, NotificationsOutbox],
  exports: [PaymentsService, DriverPaymentsService, PaymentJobsService],
})
export class PaymentsModule {}
