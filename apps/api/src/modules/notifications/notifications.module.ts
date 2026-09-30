import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { NotificationDeliveryService } from './notification-delivery.service.js';
import { NotificationJobsService } from './notification-jobs.service.js';
import { TwilioWebhooksController } from './notifications.controller.js';

/** Envoi des notifications (prompt 13) : rendu, canaux, repli texto, reçus et statuts de livraison. */
@Module({
  imports: [OrganizationsModule],
  controllers: [TwilioWebhooksController],
  providers: [NotificationDeliveryService, NotificationJobsService],
  exports: [NotificationDeliveryService, NotificationJobsService],
})
export class NotificationsModule {}
