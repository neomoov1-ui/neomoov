/**
 * Webhook de statut des textos (Twilio, décision D50) : signature `X-Twilio-Signature` vérifiée sur l'adresse publique
 * et les paramètres reçus ; le statut final (livré, en échec) est reporté sur la notification.
 */
import { Body, Controller, Headers, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { SMS_PROVIDER, type SmsProvider } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { ApiErrors, ZodResponse } from '../../common/openapi.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { NoAudit, Public } from '../auth/actor.js';
import { NotificationDeliveryService } from './notification-delivery.service.js';

@ApiTags('webhooks')
@Controller('webhooks/twilio')
export class TwilioWebhooksController {
  constructor(
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly delivery: NotificationDeliveryService,
  ) {}

  @Post('status')
  @Public()
  @NoAudit()
  @HttpCode(200)
  @ApiOperation({ summary: 'Statut de livraison d\'un texto (Twilio) : signature vérifiée, statut reporté sur la notification' })
  @ZodResponse(200, z.object({ received: z.literal(true), matched: z.boolean() }))
  @ApiErrors(400, 429)
  async status(@Body() body: Record<string, unknown>, @Headers('x-twilio-signature') signature: string | undefined) {
    const params = Object.fromEntries(Object.entries(body ?? {}).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
    const url = `${this.env.APP_BASE_URL.replace(/\/+$/, '')}/v1/webhooks/twilio/status`;
    if (!signature || !this.sms.verifyStatusWebhook({ url, params, signature })) throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Signature de webhook invalide', 400);
    const status = this.sms.parseStatus(params);
    return { received: true as const, matched: status ? await this.delivery.onSmsStatus(status) : false };
  }
}
