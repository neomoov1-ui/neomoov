/** Courses côté client (section 7.2, groupe Courses), négociation encadrée, et suivi public d'une course partagée. */
import {
  acceptOfferSchema, availableVehicleSchema, cancellationResultSchema, cancelRideSchema, clientOfferSchema, clientProposalSchema, createRideSchema, incidentCreatedSchema, publicTrackingSchema, rateRideSchema,
  rideEventSchema, rideListQuerySchema, rideMessageInputSchema, rideMessageSchema, rideSchema, shareResponseSchema, sosInputSchema, sosResponseSchema, uuid, vehicleMismatchSchema,
} from '@neomoov/domain';
import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { ApiErrors, ZodBody, ZodQuery, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { Audit, Authenticated, CurrentUser, Owns, Public, type UserActor } from '../auth/actor.js';
import { DispatchService } from './dispatch.service.js';
import { RidesService } from './rides.service.js';

const rideListSchema = z.object({ items: z.array(rideSchema), nextCursor: uuid.nullable() });

@ApiTags('rides')
@ApiBearerAuth()
@Authenticated()
@Controller('rides')
export class RidesController {
  constructor(
    private readonly rides: RidesService,
    private readonly dispatch: DispatchService,
  ) {}

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

  @Post(':id/report-vehicle-mismatch')
  @Owns('ride')
  @HttpCode(201)
  @Audit('ride.vehicle_mismatch_reported', 'incidents', 'incidentId')
  @ApiOperation({ summary: 'Garantie modèle : signale un véhicule non conforme à la catégorie réservée (incident traité par l\'exploitation)' })
  @ZodBody(vehicleMismatchSchema)
  @ZodResponse(201, incidentCreatedSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  reportVehicleMismatch(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(vehicleMismatchSchema)) body: z.infer<typeof vehicleMismatchSchema>, @CurrentUser() user: UserActor) {
    return this.rides.reportVehicleMismatch(id, user, body);
  }

  // --- Négociation encadrée (5.5, drapeau FEATURE_NEGOTIATION : 404 sinon) ---

  @Post(':id/proposals')
  @Owns('ride')
  @HttpCode(200)
  @ApiOperation({ summary: 'Propose un prix sous le prix affiché (borné au plancher, arrondi au dollar) : diffusé aux meilleurs chauffeurs pendant la fenêtre, puis repli au prix affiché' })
  @ZodBody(clientProposalSchema)
  @ZodResponse(200, rideSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  propose(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(clientProposalSchema)) body: z.infer<typeof clientProposalSchema>, @CurrentUser() user: UserActor) {
    return this.dispatch.propose(id, user, body.proposedTotalCents);
  }

  @Get(':id/offers')
  @Owns('ride')
  @ApiOperation({ summary: 'Contre-propositions des chauffeurs (vide sans le drapeau)' })
  @ZodResponse(200, z.array(clientOfferSchema))
  @ApiErrors(401, 403, 404, 429)
  offers(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor) {
    return this.dispatch.listForClient(id, user);
  }

  @Post(':id/offers/:offerId/accept')
  @Owns('ride')
  @HttpCode(200)
  @ApiOperation({ summary: 'Retient une contre-proposition : la course est attribuée à ce chauffeur au prix convenu (acceptation écrite exigée au-dessus du prix affiché)' })
  @ZodBody(acceptOfferSchema)
  @ZodResponse(200, rideSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  acceptOffer(@Param('id', zodPipe(uuid)) id: string, @Param('offerId', zodPipe(uuid)) offerId: string, @Body(zodPipe(acceptOfferSchema)) body: z.infer<typeof acceptOfferSchema>, @CurrentUser() user: UserActor) {
    return this.dispatch.acceptForClient(id, offerId, user, body.consentText);
  }
}

/** Sélection précise du véhicule (D37) : servie par la répartition, qui connaît les chauffeurs libres sur un créneau. */
@ApiTags('quotes')
@ApiBearerAuth()
@Authenticated()
@Controller('quotes')
export class QuoteVehiclesController {
  constructor(private readonly dispatch: DispatchService) {}

  @Get(':id/vehicles')
  @Owns('quote')
  @ApiOperation({ summary: 'Véhicules réellement libres sur le créneau d\'un devis planifié, à choisir précisément (D37) ; liste vide pour une course immédiate' })
  @ZodResponse(200, z.array(availableVehicleSchema))
  @ApiErrors(401, 403, 404, 429)
  vehicles(@Param('id', zodPipe(uuid)) id: string) {
    return this.dispatch.availableVehicles(id);
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
