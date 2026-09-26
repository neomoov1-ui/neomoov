/**
 * Assistance du client dans l'application et la réservation web (section 6.1, écran Assistance ; prompt 13 tâche 6) :
 * le message devient un événement `conversation.inbound` traité par l'agent relation client (accusé de réception immédiat,
 * puis réponse) ; la conversation en cours, escalade comprise, est relue par l'application. Débit limité par client
 * (réglage `agents.client_messages_per_hour`) : chaque message coûte un appel au modèle.
 */
import { randomUUID } from 'node:crypto';
import { schema } from '@neomoov/db';
import { conversationSchema, supportMessageAcceptedSchema, supportMessageSchema } from '@neomoov/domain';
import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { DomainEventsService } from '../../common/domain-events.js';
import { ApiErrors, ZodBody, ZodResponse } from '../../common/openapi.js';
import { RateLimitService } from '../../common/rate-limit.service.js';
import { SettingsService } from '../../common/settings.service.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { DB, type Database } from '../../infra/db.module.js';
import { Authenticated, CurrentUser, NoAudit, type UserActor } from '../auth/actor.js';
import { ConversationsService } from './conversations.service.js';

@ApiTags('me')
@ApiBearerAuth()
@Authenticated()
@Controller('me/support')
export class SupportController {
  constructor(
    @Inject(DB) private readonly database: Database,
    private readonly conversations: ConversationsService,
    private readonly events: DomainEventsService,
    private readonly rateLimit: RateLimitService,
    private readonly settings: SettingsService,
  ) {}

  @Post('messages')
  @HttpCode(202)
  @ApiOperation({ summary: 'Message à l\'assistance : accusé de réception immédiat puis réponse de l\'agent relation client (FR ou EN), escalade humaine au besoin' })
  @ZodBody(supportMessageSchema)
  @ZodResponse(202, supportMessageAcceptedSchema)
  @ApiErrors(400, 401, 404, 429)
  async send(@Body(zodPipe(supportMessageSchema)) body: z.infer<typeof supportMessageSchema>, @CurrentUser() user: UserActor) {
    const limit = await this.settings.number('agents.client_messages_per_hour', 30);
    const hit = await this.rateLimit.hit(`support:${user.userId}`, limit, 3_600);
    if (!hit.allowed) throw new AppError('RATE_LIMITED', 'Trop de messages envoyés à l\'assistance, réessayez plus tard', 429, { retryAfter: hit.resetIn });
    if (body.rideId) {
      const [ride] = await this.database.db
        .select({ id: schema.rides.id })
        .from(schema.rides)
        .innerJoin(schema.clients, eq(schema.clients.id, schema.rides.clientId))
        .where(and(eq(schema.rides.id, body.rideId), eq(schema.clients.userId, user.userId)))
        .limit(1);
      if (!ride) throw AppError.notFound('RIDE_NOT_FOUND', 'Course introuvable');
    }
    const externalId = `${body.channel}-${randomUUID()}`;
    this.events.emit('conversation.inbound', { channel: body.channel, externalId, userId: user.userId, phone: null, text: body.text, language: null, rideId: body.rideId ?? null, receivedAt: new Date() });
    return { accepted: true as const, externalId };
  }

  @Get('conversation')
  @NoAudit()
  @ApiOperation({ summary: 'Conversation en cours avec l\'assistance (messages, état : ouverte ou reprise par l\'équipe), ou null' })
  @ZodResponse(200, z.object({ conversation: conversationSchema.nullable() }))
  @ApiErrors(401, 429)
  async conversation(@CurrentUser() user: UserActor) {
    return { conversation: await this.conversations.currentFor(user.userId) };
  }
}
