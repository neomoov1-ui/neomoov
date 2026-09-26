/**
 * Webhook de l'agent vocal (Vapi) : le secret convenu arrive dans `x-vapi-secret` et est vérifié sur le corps brut avant
 * tout traitement ; la réponse aux appels d'outils est renvoyée pendant l'appel (Vapi l'attend quelques secondes).
 */
import { Controller, Headers, HttpCode, Inject, Post, Req, type RawBodyRequest } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { VOICE_PROVIDER, type VoiceProvider } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { ApiErrors, ZodResponse } from '../../common/openapi.js';
import { NoAudit, Public } from '../auth/actor.js';
import { VoiceService, type VapiMessage } from './voice.service.js';

@ApiTags('webhooks')
@Controller('webhooks')
export class VoiceWebhooksController {
  constructor(
    @Inject(VOICE_PROVIDER) private readonly voice: VoiceProvider,
    private readonly service: VoiceService,
  ) {}

  @Post('vapi')
  @Public()
  @NoAudit()
  @HttpCode(200)
  @ApiOperation({ summary: 'Messages du serveur Vapi : outils de l\'agent vocal (prix, réservation, état, annulation, transfert) et rapport de fin d\'appel' })
  @ZodResponse(200, z.union([z.object({ results: z.array(z.object({ toolCallId: z.string(), result: z.string() })) }), z.object({ received: z.literal(true) })]))
  @ApiErrors(400, 429)
  async vapi(@Req() req: RawBodyRequest<Request>, @Headers('x-vapi-secret') secret: string | undefined) {
    if (!req.rawBody || !secret) throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Signature de webhook absente', 400);
    const { payload } = await this.voice.verifyWebhook(req.rawBody, secret).catch(() => {
      throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Signature de webhook invalide', 400);
    });
    return this.service.handle(payload as VapiMessage);
  }
}
