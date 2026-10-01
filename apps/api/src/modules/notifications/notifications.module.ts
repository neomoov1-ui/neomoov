import { Module } from '@nestjs/common';
import { BrandingModule } from '../branding/branding.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { NotificationDeliveryService } from './notification-delivery.service.js';
import { NotificationJobsService } from './notification-jobs.service.js';
import { TwilioWebhooksController } from './notifications.controller.js';

/** Envoi des notifications (prompt 13) : rendu, canaux, repli texto, reçus et statuts de livraison ; expéditeur et nom de la marque de l'organisation (étape 22). */
@Module({
  imports: [BrandingModule, OrganizationsModule],
  controllers: [TwilioWebhooksController],
  providers: [NotificationDeliveryService, NotificationJobsService],
  exports: [NotificationDeliveryService, NotificationJobsService],
})
export class NotificationsModule {}
