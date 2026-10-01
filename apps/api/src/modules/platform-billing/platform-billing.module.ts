import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';
import { BillingJobsService } from './billing-jobs.service.js';
import { AdminPlatformBillingController, BillingWebhooksController } from './platform-billing.controller.js';
import { PlatformBillingService } from './platform-billing.service.js';

/**
 * Facturation de la plateforme (étape 25) : abonnements des organisations clientes, factures PF, Stripe Billing par
 * l'adaptateur `BILLING_PROVIDER`, webhook dédié, cycle quotidien (file `billing`). `PlatformBillingService` est exporté
 * pour la route d'organisation `GET /v1/org/:organizationId/billing` (branchée à la fusion).
 */
@Module({
  imports: [AuditModule],
  controllers: [AdminPlatformBillingController, BillingWebhooksController],
  providers: [PlatformBillingService, BillingJobsService, NotificationsOutbox],
  exports: [PlatformBillingService, BillingJobsService],
})
export class PlatformBillingModule {}
