/**
 * Facturation de la plateforme (étape 25) : routes du personnel de la plateforme (`billing.view`, `billing.manage`) et
 * webhook dédié de Stripe Billing. La route de l'organisation (`GET /v1/org/:organizationId/billing`) est branchée à la
 * fusion avec la garde des organisations, sur `PlatformBillingService.billingForOrganization`.
 */
import {
  billingOverviewQuerySchema, billingOverviewSchema, billingRunReportSchema, platformInvoiceMarkPaidSchema, platformInvoiceViewSchema, platformPlanViewSchema,
  subscriptionCancelSchema, subscriptionUpsertResultSchema, subscriptionUpsertSchema, subscriptionViewSchema, uuid,
} from '@neomoov/domain';
import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, Res, StreamableFile, type RawBodyRequest } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { ApiErrors, ZodBody, ZodQuery, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { Can, CurrentUser, NoAudit, Public, type UserActor } from '../auth/actor.js';
import { BillingJobsService } from './billing-jobs.service.js';
import { PlatformBillingService } from './platform-billing.service.js';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
export class AdminPlatformBillingController {
  constructor(
    private readonly billing: PlatformBillingService,
    private readonly jobs: BillingJobsService,
  ) {}

  @Get('billing/plans')
  @Can('billing.view', 'billing.manage')
  @ApiOperation({ summary: 'Formules de la plateforme (Solo, Pro, Entreprise) : prix, véhicules inclus, modules' })
  @ZodResponse(200, z.array(platformPlanViewSchema))
  @ApiErrors(401, 403, 429)
  plans() {
    return this.billing.plans();
  }

  @Get('billing/overview')
  @Can('billing.view', 'billing.manage')
  @ApiOperation({ summary: 'Revenu mensuel récurrent, abonnements par statut, impayés, lectures seules et suspensions à venir' })
  @ZodQuery(billingOverviewQuerySchema)
  @ZodResponse(200, billingOverviewSchema)
  @ApiErrors(400, 401, 403, 429)
  overview(@Query(zodPipe(billingOverviewQuerySchema)) query: z.infer<typeof billingOverviewQuerySchema>) {
    return this.billing.overview(new Date(), query.horizonDays);
  }

  @Post('billing/run')
  @Can('billing.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Lance tout de suite le cycle quotidien : essais, renouvellements, transmissions, relances, lecture seule, suspension, réactivation' })
  @ZodResponse(200, billingRunReportSchema)
  @ApiErrors(401, 403, 429)
  run() {
    return this.jobs.run(new Date());
  }

  @Get('organizations/:id/subscription')
  @Can('billing.view', 'billing.manage')
  @ApiOperation({ summary: 'Abonnement en cours d\'une organisation cliente' })
  @ZodResponse(200, subscriptionViewSchema)
  @ApiErrors(401, 403, 404, 429)
  subscription(@Param('id', zodPipe(uuid)) id: string) {
    return this.billing.getSubscription(id);
  }

  @Post('organizations/:id/subscription')
  @Can('billing.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Crée l\'abonnement (première facture tout de suite, ou à la fin de l\'essai) ou change de formule et de période (à la prochaine facture)' })
  @ZodBody(subscriptionUpsertSchema)
  @ZodResponse(200, subscriptionUpsertResultSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  upsert(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(subscriptionUpsertSchema)) body: z.infer<typeof subscriptionUpsertSchema>, @CurrentUser() user: UserActor) {
    return this.billing.upsertSubscription(id, body, user);
  }

  @Post('organizations/:id/subscription/cancel')
  @Can('billing.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Résilie l\'abonnement : plus de facture, les impayés restent dus, l\'organisation passe en lecture seule' })
  @ZodBody(subscriptionCancelSchema)
  @ZodResponse(200, subscriptionViewSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  cancel(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(subscriptionCancelSchema)) body: z.infer<typeof subscriptionCancelSchema>, @CurrentUser() user: UserActor) {
    return this.billing.cancelSubscription(id, body.reason, user);
  }

  @Get('organizations/:id/platform-invoices')
  @Can('billing.view', 'billing.manage')
  @ApiOperation({ summary: 'Factures de la plateforme d\'une organisation (PF-AAAA-NNNNNN), les plus récentes d\'abord' })
  @ZodResponse(200, z.array(platformInvoiceViewSchema))
  @ApiErrors(401, 403, 404, 429)
  invoices(@Param('id', zodPipe(uuid)) id: string) {
    return this.billing.invoices(id);
  }

  @Get('platform-invoices/:id/pdf')
  @Can('billing.view', 'billing.manage')
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'PDF d\'une facture de la plateforme' })
  @ApiErrors(401, 403, 404, 409, 429)
  async pdf(@Param('id', zodPipe(uuid)) id: string, @Res({ passthrough: true }) res: Response) {
    const file = await this.billing.pdf(id);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `inline; filename="${file.filename}"`);
    res.setHeader('cache-control', 'private, no-store');
    return new StreamableFile(file.body);
  }

  @Post('platform-invoices/:id/mark-paid')
  @Can('billing.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Règlement hors plateforme (virement, chèque, Interac) avec sa référence ; réactive l\'organisation si plus rien n\'est en retard' })
  @ZodBody(platformInvoiceMarkPaidSchema)
  @ZodResponse(200, platformInvoiceViewSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429, 502)
  markPaid(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(platformInvoiceMarkPaidSchema)) body: z.infer<typeof platformInvoiceMarkPaidSchema>, @CurrentUser() user: UserActor) {
    return this.billing.markPaid(id, body, user);
  }
}

@ApiTags('webhooks')
@Controller('webhooks')
export class BillingWebhooksController {
  constructor(private readonly billing: PlatformBillingService) {}

  /**
   * Webhook de Stripe Billing, distinct de celui des paiements : signature vérifiée sur le corps brut avec son propre
   * secret, événement appliqué une seule fois (`webhook_events`), traité tout de suite ; un échec rend une erreur et
   * Stripe renvoie l'événement plus tard.
   */
  @Post('stripe-billing')
  @Public()
  @NoAudit()
  @HttpCode(200)
  @ApiOperation({ summary: 'Webhook Stripe Billing (invoice.paid, invoice.payment_failed, invoice.voided) : signature vérifiée, appliqué une seule fois' })
  @ZodResponse(200, z.object({ received: z.literal(true), duplicate: z.boolean(), status: z.enum(['processed', 'ignored']) }))
  @ApiErrors(400, 429, 501)
  async stripeBilling(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature: string | undefined) {
    if (!signature || !req.rawBody) throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Signature de webhook absente', 400);
    const event = await this.billing.verifyWebhook(req.rawBody, signature);
    const { duplicate, status } = await this.billing.handleWebhook(event);
    return { received: true as const, duplicate, status };
  }
}
