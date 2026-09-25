/** Courses côté client (section 7.2, groupe Courses) et suivi public d'une course partagée. */
import {
  cancellationResultSchema, cancelRideSchema, createRideSchema, publicTrackingSchema, rateRideSchema, rideEventSchema, rideListQuerySchema, rideMessageInputSchema,
  rideMessageSchema, rideSchema, shareResponseSchema, sosInputSchema, sosResponseSchema, uuid,
} from '@neomoov/domain';
import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { ApiErrors, ZodBody, ZodQuery, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { Audit, Authenticated, CurrentUser, Owns, Public, type UserActor } from '../auth/actor.js';
import { RidesService } from './rides.service.js';

const rideListSchema = z.object({ items: z.array(rideSchema), nextCursor: uuid.nullable() });

@ApiTags('rides')
@ApiBearerAuth()
@Authenticated()
@Controller('rides')
export class RidesController {
  constructor(private readonly rides: RidesService) {}

  @Post()
  @ApiOperation({ summary: 'Demande une course à partir d\'un devis valide (en-tête Idempotency-Key obligatoire : la même clé renvoie la même course)' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Identifiant unique de la demande (8 à 80 caractères)' })
  @ZodBody(createRideSchema)
  @ZodResponse(201, rideSchema)
  @ZodResponse(200, rideSchema, 'Demande déjà enregistrée avec cette clé')
  @ApiErrors(400, 401, 403, 409, 429)
  async create(@Body(zodPipe(createRideSchema)) body: z.infer<typeof createRideSchema>, @CurrentUser() user: UserActor, @Headers('idempotency-key') key: string | undefined, @Res({ passthrough: true }) res: Response) {
    if (!key || !/^[A-Za-z0-9_-]{8,80}$/.test(key)) throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'En-tête Idempotency-Key requis (8 à 80 caractères sûrs)', 400);
    const { ride, created } = await this.rides.createFromQuote(body, user, key);
    res.status(created ? 201 : 200);
    return ride;
  }

  @Get()
  @ApiOperation({ summary: 'Historique des courses du client, par curseur' })
  @ZodQuery(rideListQuerySchema)
  @ZodResponse(200, rideListSchema)
  @ApiErrors(401, 429)
  list(@Query(zodPipe(rideListQuerySchema)) query: z.infer<typeof rideListQuerySchema>, @CurrentUser() user: UserActor) {
    return this.rides.listForUser(user.userId, query);
  }

  @Get(':id')
  @Owns('ride')
  @ApiOperation({ summary: 'Une course (client, chauffeur attribué ou personnel)' })
  @ZodResponse(200, rideSchema)
  @ApiErrors(401, 403, 404, 429)
  get(@Param('id', zodPipe(uuid)) id: string) {
    return this.rides.viewById(id);
  }

  @Get(':id/events')
  @Owns('ride')
  @ApiOperation({ summary: 'Journal des transitions et signaux de la course (`ride_events`)' })
  @ZodResponse(200, z.array(rideEventSchema))
  @ApiErrors(401, 403, 404, 429)
  events(@Param('id', zodPipe(uuid)) id: string) {
    return this.rides.eventsOf(id);
  }

  @Post(':id/cancel')
  @Owns('ride')
  @HttpCode(200)
  @ApiOperation({ summary: 'Annulation par le client : gratuite avant l\'attribution ou dans les 2 minutes, 5,00 $ ensuite (montants en base)' })
  @ZodBody(cancelRideSchema)
  @ZodResponse(200, cancellationResultSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  cancel(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(cancelRideSchema)) body: z.infer<typeof cancelRideSchema>, @CurrentUser() user: UserActor) {
    return this.rides.cancelByClient(id, user, body);
  }

  @Post(':id/rate')
  @Owns('ride')
  @HttpCode(200)
  @ApiOperation({ summary: 'Évaluation de la course terminée (note, étiquettes, commentaire, pourboire)' })
  @ZodBody(rateRideSchema)
  @ZodResponse(200, rideSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  rate(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(rateRideSchema)) body: z.infer<typeof rateRideSchema>, @CurrentUser() user: UserActor) {
    return this.rides.rate(id, user, body);
  }

  @Post(':id/share')
  @Owns('ride')
  @HttpCode(200)
  @ApiOperation({ summary: 'Lien public de suivi du trajet (page à l\'étape 12)' })
  @ZodResponse(200, shareResponseSchema)
  @ApiErrors(401, 403, 404, 429)
  share(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor) {
    return this.rides.share(id, user);
  }

  @Get(':id/messages')
  @Owns('ride')
  @ApiOperation({ summary: 'Messages échangés dans la course (messagerie masquée)' })
  @ZodResponse(200, z.array(rideMessageSchema))
  @ApiErrors(401, 403, 404, 429)
  messages(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor) {
    return this.rides.listMessages(id, user);
  }

  @Post(':id/messages')
  @Owns('ride')
  @HttpCode(201)
  @ApiOperation({ summary: 'Envoie un message à l\'autre partie (relayé en temps réel, jamais de numéro échangé)' })
  @ZodBody(rideMessageInputSchema)
  @ZodResponse(201, rideMessageSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  sendMessage(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(rideMessageInputSchema)) body: z.infer<typeof rideMessageInputSchema>, @CurrentUser() user: UserActor) {
    return this.rides.sendMessage(id, user, body.body);
  }

  @Post(':id/sos')
  @Owns('ride')
  @HttpCode(201)
  @Audit('ride.sos', 'incidents', 'incidentId')
  @ApiOperation({ summary: 'SOS : incident critique et alerte immédiate à l\'exploitation' })
  @ZodBody(sosInputSchema)
  @ZodResponse(201, sosResponseSchema)
  @ApiErrors(401, 403, 404, 429)
  sos(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(sosInputSchema)) body: z.infer<typeof sosInputSchema>, @CurrentUser() user: UserActor) {
    return this.rides.sos(id, user, body);
  }
}

@ApiTags('public')
@Controller('public')
export class PublicRidesController {
  constructor(private readonly rides: RidesService) {}

  @Get('track/:token')
  @Public()
  @ApiOperation({ summary: 'Suivi public d\'une course partagée : état, chauffeur, position pendant la course' })
  @ZodResponse(200, publicTrackingSchema)
  @ApiErrors(404, 410, 429)
  track(@Param('token', zodPipe(z.string().regex(/^[A-Za-z0-9_-]{16,24}$/))) token: string) {
    return this.rides.publicTracking(token);
  }
}
