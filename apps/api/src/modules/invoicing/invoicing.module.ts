import { Module } from '@nestjs/common';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';
import { InvoiceJobsService } from './invoice-jobs.service.js';
import { AdminSevController, PublicInvoicesController, RideInvoicesController } from './invoicing.controller.js';
import { InvoicingService } from './invoicing.service.js';
import { SevService } from './sev.service.js';

/**
 * Facturation certifiée (prompt 09, tâches 5 et 6). Aucune dépendance vers les courses ni les paiements : elle réagit à
 * leurs événements (`ride.completed`, `ride.cancelled_by_client`, `ride.no_show`, `payment.refunded`) par la file `invoicing`.
 */
@Module({
  controllers: [RideInvoicesController, PublicInvoicesController, AdminSevController],
  providers: [InvoicingService, SevService, InvoiceJobsService, NotificationsOutbox],
  exports: [InvoicingService, SevService, InvoiceJobsService],
})
export class InvoicingModule {}
