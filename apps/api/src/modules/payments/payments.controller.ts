/** Paiements (section 7.2, prompt 07) : cartes du client, pourboire, reçu, solde dû ; chauffeur (Connect, prélèvement) ; webhook ; remboursements. */
import {
  balanceSchema, connectStatusSchema, paymentMethodViewSchema, paymentViewSchema, refundInputSchema, refundViewSchema, settleInputSchema, settleResultSchema,
  setupIntentConfirmSchema, setupIntentResponseSchema, tipInputSchema, uuid,
} from '@neomoov/domain';
import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Req, type RawBodyRequest } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { ApiErrors, ZodBody, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { Audit, Authenticated, CurrentUser, NoAudit, Owns, Public, Roles, STAFF_READ_ROLES, type UserActor } from '../auth/actor.js';
import { DriverPaymentsService } from './driver-payments.service.js';
import { PaymentJobsService } from './payment-jobs.service.js';
import { PaymentsService } from './payments.service.js';

@ApiTags('payments')
@ApiBearerAuth()
@Authenticated()
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('payment-methods/setup-intent')
  @HttpCode(201)
  @ApiOperation({ summary: 'SetupIntent pour enregistrer une carte (feuille de paiement Stripe, Apple Pay, Google Pay) ; aucune donnée de carte ne passe par l\'API' })
  @ZodResponse(201, setupIntentResponseSchema)
  @ApiErrors(401, 403, 429)
  setupIntent(@CurrentUser() user: UserActor) {
    return this.payments.setupIntent(user.userId);
  }

  @Post('payment-methods/confirm')
  @HttpCode(201)
  @Audit('payment_method.confirmed', 'client_payment_methods')
  @ApiOperation({ summary: 'Enregistre la carte d\'un SetupIntent confirmé : relue chez Stripe (marque et 4 derniers chiffres seulement)' })
  @ZodBody(setupIntentConfirmSchema)
  @ZodResponse(201, paymentMethodViewSchema)
  @ApiErrors(400, 401, 403, 409, 429)
  confirm(@Body(zodPipe(setupIntentConfirmSchema)) body: z.infer<typeof setupIntentConfirmSchema>, @CurrentUser() user: UserActor) {
    return this.payments.confirmSetupIntent(user.userId, body);
  }

  @Get('payment-methods')
  @ApiOperation({ summary: 'Cartes enregistrées, la carte par défaut d\'abord' })
  @ZodResponse(200, z.array(paymentMethodViewSchema))
  @ApiErrors(401, 403, 429)
  list(@CurrentUser() user: UserActor) {
    return this.payments.listMethods(user.userId);
  }

  @Delete('payment-methods/:id')
  @HttpCode(204)
  @Audit('payment_method.removed', 'client_payment_methods')
  @ApiOperation({ summary: 'Retire une carte (détachée chez Stripe) ; une autre devient la carte par défaut' })
  @ApiErrors(401, 403, 404, 429)
  async remove(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor) {
    await this.payments.removeMethod(user.userId, id);
  }

  @Post('rides/:id/tip')
  @HttpCode(201)
  @Audit('ride.tip', 'rides')
  @ApiOperation({ summary: 'Pourboire après la course : paiement séparé hors session sur la carte de la course ou la carte par défaut ; une seule fois' })
  @ZodBody(tipInputSchema)
  @ZodResponse(201, paymentViewSchema)
  @ApiErrors(400, 401, 402, 403, 404, 409, 429)
  tip(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(tipInputSchema)) body: z.infer<typeof tipInputSchema>, @CurrentUser() user: UserActor) {
    return this.payments.tip(id, user.userId, body.amountCents);
  }

  @Get('rides/:id/payments')
  @Owns('ride')
  @ApiOperation({ summary: 'Paiements de la course (reçu) : autorisation, capture, pourboire, frais, remboursements ; carte masquée' })
  @ZodResponse(200, z.array(paymentViewSchema))
  @ApiErrors(401, 403, 404, 429)
  ridePayments(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor) {
    return this.payments.ridePaymentsFor(id, user.userId);
  }

  @Get('me/balance')
  @ApiOperation({ summary: 'Solde dû après un échec de paiement, par course' })
  @ZodResponse(200, balanceSchema)
  @ApiErrors(401, 403, 429)
  balance(@CurrentUser() user: UserActor) {
    return this.payments.balance(user.userId);
  }

  @Post('me/settle')
  @HttpCode(200)
  @Audit('payment.settle', 'clients')
  @ApiOperation({ summary: 'Règle le solde dû sur une carte enregistrée ; les nouvelles courses sont de nouveau possibles' })
  @ZodBody(settleInputSchema)
  @ZodResponse(200, settleResultSchema)
  @ApiErrors(400, 401, 402, 403, 429)
  settle(@Body(zodPipe(settleInputSchema)) body: z.infer<typeof settleInputSchema>, @CurrentUser() user: UserActor) {
    return this.payments.settle(user.userId, body.paymentMethodId);
  }
}

@ApiTags('driver')
@ApiBearerAuth()
@Roles('driver')
@Controller('driver')
export class DriverPaymentsController {
  constructor(private readonly drivers: DriverPaymentsService) {}

  // Le lien d'inscription Connect est servi par le contrôleur des chauffeurs (même route, même service).

  @Get('connect/status')
  @ApiOperation({ summary: 'État du compte de versement (inscription, versements possibles) et méthode de prélèvement' })
  @ZodResponse(200, connectStatusSchema)
  @ApiErrors(401, 403, 404, 429)
  status(@CurrentUser() user: UserActor) {
    return this.drivers.status(user.userId);
  }

  @Post('payment-method')
  @HttpCode(201)
  @ApiOperation({ summary: 'SetupIntent de la méthode de prélèvement du chauffeur (relevés négatifs, étape 9)' })
  @ZodResponse(201, setupIntentResponseSchema)
  @ApiErrors(401, 403, 404, 429)
  paymentMethod(@CurrentUser() user: UserActor) {
    return this.drivers.debitSetupIntent(user.userId);
  }

  @Post('payment-method/confirm')
  @HttpCode(200)
  @Audit('driver.debit_method', 'drivers')
  @ApiOperation({ summary: 'Enregistre la méthode de prélèvement d\'un SetupIntent confirmé (relue chez Stripe)' })
  @ZodBody(setupIntentConfirmSchema)
  @ZodResponse(200, connectStatusSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  confirmPaymentMethod(@Body(zodPipe(setupIntentConfirmSchema)) body: z.infer<typeof setupIntentConfirmSchema>, @CurrentUser() user: UserActor) {
    return this.drivers.confirmDebitMethod(user.userId, body.setupIntentId);
  }
}

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly jobs: PaymentJobsService,
  ) {}

  /**
   * Webhook Stripe : signature vérifiée sur le corps brut, enregistrement par identifiant d'événement (un événement
   * reçu trois fois n'est écrit et traité qu'une fois), traitement par la file, réponse immédiate.
   */
  @Post('stripe')
  @Public()
  @NoAudit()
  @HttpCode(200)
  @ApiOperation({ summary: 'Webhook Stripe : signature vérifiée sur le corps brut, un événement n\'est enregistré et traité qu\'une fois' })
  @ZodResponse(200, z.object({ received: z.literal(true), duplicate: z.boolean() }))
  @ApiErrors(400, 429)
  async stripe(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature: string | undefined) {
    if (!signature || !req.rawBody) throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Signature de webhook absente', 400);
    const event = await this.payments.verifyWebhook(req.rawBody, signature);
    const { duplicate } = await this.payments.ingestWebhook(event);
    if (!duplicate) await this.jobs.enqueueWebhook(event.id);
    return { received: true, duplicate };
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
export class AdminPaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly jobs: PaymentJobsService,
  ) {}

  @Get('rides/:id/payments')
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'Paiements d\'une course pour My Hub (états, carte masquée, remboursements)' })
  @ZodResponse(200, z.array(paymentViewSchema))
  @ApiErrors(401, 403, 404, 429)
  ridePayments(@Param('id', zodPipe(uuid)) id: string) {
    return this.payments.ridePayments(id);
  }

  @Post('rides/:id/refund')
  @Roles('admin', 'operator', 'finance')
  @HttpCode(201)
  @ApiOperation({ summary: 'Remboursement (carte) ou crédit sur le compte du client, motif obligatoire ; idempotent (en-tête Idempotency-Key facultatif)' })
  @ZodBody(refundInputSchema)
  @ZodResponse(201, refundViewSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  refund(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(refundInputSchema)) body: z.infer<typeof refundInputSchema>, @CurrentUser() user: UserActor, @Headers('idempotency-key') key: string | undefined) {
    if (key && !/^[A-Za-z0-9_-]{8,80}$/.test(key)) throw new AppError('IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key : 8 à 80 caractères sûrs', 400);
    return this.payments.refund(id, body, { userId: user.userId }, key);
  }

  @Post('payments/webhooks/retry')
  @Roles('admin', 'finance')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reprend tout de suite les webhooks de paiement en attente ou en échec (sinon repris par le worker)' })
  @ZodResponse(200, z.object({ retried: z.number().int().min(0), authorized: z.number().int().min(0) }))
  @ApiErrors(401, 403, 429)
  retryWebhooks() {
    return this.jobs.sweep();
  }
}
