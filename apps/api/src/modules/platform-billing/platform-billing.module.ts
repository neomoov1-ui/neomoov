import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';
import { BillingJobsService } from './billing-jobs.service.js';
import { AdminPlatformBillingController, BillingWebhooksController, OrgPlatformBillingController } from './platform-billing.controller.js';
import { PlatformBillingService } from './platform-billing.service.js';

/**
 * Facturation de la plateforme (étape 25) : abonnements des organisations clientes, factures PF, Stripe Billing par
 * l'adaptateur `BILLING_PROVIDER`, webhook dédié, cycle quotidien (file `billing`). Routes de l'organisation (vue de sa
 * facturation, portail client) depuis la finalisation du 3 octobre 2026.
 */
@Module({
  imports: [AuditModule],
  controllers: [AdminPlatformBillingController, BillingWebhooksController, OrgPlatformBillingController],
  providers: [PlatformBillingService, BillingJobsService, NotificationsOutbox],
  exports: [PlatformBillingService, BillingJobsService],
})
export class PlatformBillingModule {}
