/**
 * Webhooks des messages entrants : textos reçus sur le numéro Twilio de Neomoov (D50) et WhatsApp Cloud (Meta).
 * Signatures vérifiées (Twilio : adresse et paramètres ; Meta : corps brut) ; réponse immédiate, le traitement est
 * fait par le service des messages entrants.
 */
import { Body, Controller, Get, Headers, HttpCode, Inject, Post, Query, Req, Res, type RawBodyRequest } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { SMS_PROVIDER, WHATSAPP_PROVIDER, type SmsProvider, type WhatsAppProvider } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { ApiErrors, ZodResponse } from '../../common/openapi.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { NoAudit, Public } from '../auth/actor.js';
import { InboundMessagesService } from './inbound-messages.service.js';

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

@ApiTags('webhooks')
@Controller('webhooks')
export class MessagingWebhooksController {
  constructor(
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsapp: WhatsAppProvider,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly inbound: InboundMessagesService,
  ) {}

  @Post('twilio/inbound')
  @Public()
  @NoAudit()
  @HttpCode(200)
  @ApiProduces('text/xml')
  @ApiOperation({ summary: 'Texto reçu (Twilio) : relayé au chauffeur de la course en cours, sinon confié à l\'agent relation client' })
  @ApiErrors(400, 429)
  async twilioInbound(@Body() body: Record<string, unknown>, @Headers('x-twilio-signature') signature: string | undefined, @Res({ passthrough: true }) res: Response) {
    const params = Object.fromEntries(Object.entries(body ?? {}).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
    const url = `${this.env.APP_BASE_URL.replace(/\/+$/, '')}/v1/webhooks/twilio/inbound`;
    if (!signature || !this.sms.verifyStatusWebhook({ url, params, signature })) throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Signature de webhook invalide', 400);
    const message = this.sms.parseInbound(params);
    if (message) await this.inbound.receive({ channel: 'sms', from: message.from, text: message.body, externalId: message.messageId });
    res.setHeader('content-type', 'text/xml; charset=utf-8');
    return EMPTY_TWIML;
  }

  /** Abonnement du webhook WhatsApp : Meta envoie un défi à renvoyer tel quel si le jeton de vérification concorde. */
  @Get('whatsapp')
  @Public()
  @NoAudit()
  @ApiProduces('text/plain')
  @ApiOperation({ summary: 'Vérification de l\'abonnement au webhook WhatsApp (défi de Meta)' })
  @ApiErrors(403, 429)
  whatsappVerify(@Query() query: Record<string, string | undefined>, @Res({ passthrough: true }) res: Response) {
    const challenge = this.whatsapp.verifyWebhook(query);
    if (!challenge) throw AppError.forbidden('WEBHOOK_VERIFY_FAILED', 'Jeton de vérification invalide');
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    return challenge;
  }

  @Post('whatsapp')
  @Public()
  @NoAudit()
  @HttpCode(200)
  @ApiOperation({ summary: 'Messages WhatsApp entrants : signature vérifiée sur le corps brut, confiés à l\'agent relation client' })
  @ZodResponse(200, z.object({ received: z.number().int().min(0) }))
  @ApiErrors(400, 429)
  async whatsappInbound(@Req() req: RawBodyRequest<Request>, @Headers('x-hub-signature-256') signature: string | undefined) {
    if (!req.rawBody || !this.whatsapp.verifySignature(req.rawBody, signature)) throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Signature de webhook invalide', 400);
    const messages = this.whatsapp.parseInbound(req.body);
    for (const m of messages) await this.inbound.receive({ channel: 'whatsapp', from: m.from, text: m.text, externalId: m.messageId, receivedAt: m.timestamp });
    return { received: messages.length };
  }
}
