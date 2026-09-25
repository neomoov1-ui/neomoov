/** Côté chauffeur (section 7.2, groupe Chauffeur) : statut, positions de secours, offres de la répartition, déroulé des courses, réservations planifiées. */
import {
  cancellationResultSchema, completeRideSchema, driverCancelSchema, driverOfferSchema, driverStatusSchema, driverStatusViewSchema, locationBatchSchema, locationUpdateSchema,
  offerCounterSchema, rideSchema, scheduledRideSchema, uuid,
} from '@neomoov/domain';
import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiErrors, ZodBody, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { CurrentUser, NoAudit, Roles, type UserActor } from '../auth/actor.js';
import { DispatchService } from './dispatch.service.js';
import { PresenceService } from './presence.service.js';
import { RidesService } from './rides.service.js';
import { ScheduledService } from './scheduled.service.js';

const driverRidesSchema = z.object({ active: rideSchema.nullable(), items: z.array(rideSchema) });
const locationAckSchema = z.object({ rideId: uuid.nullable(), accepted: z.boolean() });

@ApiTags('driver')
@ApiBearerAuth()
@Roles('driver')
@Controller('driver')
export class DriverController {
  constructor(
    private readonly rides: RidesService,
    private readonly presence: PresenceService,
    private readonly scheduled: ScheduledService,
    private readonly dispatch: DispatchService,
  ) {}

  @Get('offers')
  @NoAudit()
  @ApiOperation({ summary: 'Offres de course en attente de réponse (la plus ancienne d\'abord) ; aussi poussées par le socket `offer.new`' })
  @ZodResponse(200, z.array(driverOfferSchema))
  @ApiErrors(401, 403, 429)
  offers(@CurrentUser() user: UserActor) {
    return this.dispatch.listForDriver(user);
  }

  @Post('offers/:id/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Accepte une offre : la première acceptation gagne la course, les autres offres expirent' })
  @ZodResponse(200, rideSchema)
  @ApiErrors(401, 403, 404, 409, 429)
  acceptOffer(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor) {
    return this.dispatch.accept(id, user);
  }

  @Post('offers/:id/decline')
  @HttpCode(200)
  @ApiOperation({ summary: 'Décline une offre : le candidat suivant est sollicité tout de suite' })
  @ZodResponse(200, z.object({ state: z.literal('declined') }))
  @ApiErrors(401, 403, 404, 429)
  declineOffer(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor) {
    return this.dispatch.decline(id, user);
  }

  @Post('offers/:id/counter')
  @HttpCode(201)
  @ApiOperation({ summary: 'Contre-proposition (négociation encadrée, drapeau FEATURE_NEGOTIATION) : une seule par course, entre la proposition du client et le prix affiché' })
  @ZodBody(offerCounterSchema)
  @ZodResponse(201, driverOfferSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  counterOffer(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(offerCounterSchema)) body: z.infer<typeof offerCounterSchema>, @CurrentUser() user: UserActor) {
    return this.dispatch.counter(id, user, body);
  }

  @Get('status')
  @ApiOperation({ summary: 'Statut de présence du chauffeur' })
  @ZodResponse(200, driverStatusViewSchema)
  @ApiErrors(401, 403, 429)
  status(@CurrentUser() user: UserActor) {
    return this.presence.statusOf(user.userId);
  }

  @Post('status')
  @HttpCode(200)
  @ApiOperation({ summary: 'En ligne (prérequis vérifiés : documents, véhicule, pack, solde), en pause ou hors ligne' })
  @ZodBody(driverStatusSchema)
  @ZodResponse(200, driverStatusViewSchema)
  @ApiErrors(400, 401, 403, 409, 429)
  setStatus(@Body(zodPipe(driverStatusSchema)) body: z.infer<typeof driverStatusSchema>, @CurrentUser() user: UserActor) {
    return this.presence.setStatus(user.userId, body);
  }

  @Post('location')
  @HttpCode(200)
  @NoAudit()
  @ApiOperation({ summary: 'Position (secours au socket) : toutes les 5 secondes ou 50 mètres' })
  @ZodBody(locationUpdateSchema)
  @ZodResponse(200, locationAckSchema)
  @ApiErrors(400, 401, 403, 409, 429)
  location(@Body(zodPipe(locationUpdateSchema)) body: z.infer<typeof locationUpdateSchema>, @CurrentUser() user: UserActor) {
    return this.presence.recordLocation(user.userId, body);
  }

  @Post('locations')
  @HttpCode(200)
  @NoAudit()
  @ApiOperation({ summary: 'Lot de positions accumulées hors ligne (une présence expirée pendant une course est recréée)' })
  @ZodBody(locationBatchSchema)
  @ZodResponse(200, z.object({ rideId: uuid.nullable(), accepted: z.number().int(), ignored: z.number().int() }))
  @ApiErrors(400, 401, 403, 409, 429)
  async locations(@Body(zodPipe(locationBatchSchema)) body: z.infer<typeof locationBatchSchema>, @CurrentUser() user: UserActor) {
    const driver = await this.presence.driverOfUser(user.userId);
    return this.presence.recordBatchForDriver(driver.id, body.positions);
  }

  @Get('rides')
  @ApiOperation({ summary: 'Course en cours et courses récentes du chauffeur' })
  @ZodResponse(200, driverRidesSchema)
  @ApiErrors(401, 403, 429)
  async list(@CurrentUser() user: UserActor) {
    const driver = await this.rides.driverOfUser(user.userId);
    if (!driver) return { active: null, items: [] };
    return this.rides.listForDriver(driver.id);
  }

  @Post('rides/:id/depart')
  @HttpCode(200)
  @ApiOperation({ summary: 'En route vers le client' })
  @ZodResponse(200, rideSchema)
  @ApiErrors(401, 403, 404, 409, 429)
  depart(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor) {
    return this.rides.depart(id, user);
  }

  @Post('rides/:id/arrive')
  @HttpCode(200)
  @ApiOperation({ summary: 'Arrivé sur place (le compteur d\'attente démarre)' })
  @ZodResponse(200, rideSchema)
  @ApiErrors(401, 403, 404, 409, 429)
  arrive(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor) {
    return this.rides.arrive(id, user);
  }

  @Post('rides/:id/contact')
  @HttpCode(200)
  @ApiOperation({ summary: 'Tentative de contact du client sur place (compte pour la non-présentation)' })
  @ZodResponse(200, z.object({ contactAttempts: z.number().int() }))
  @ApiErrors(401, 403, 404, 409, 429)
  contact(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor) {
    return this.rides.recordContactAttempt(id, user);
  }

  @Post('rides/:id/start')
  @HttpCode(200)
  @ApiOperation({ summary: 'Client à bord' })
  @ZodResponse(200, rideSchema)
  @ApiErrors(401, 403, 404, 409, 429)
  start(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor) {
    return this.rides.start(id, user);
  }

  @Post('rides/:id/complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Fin de course : prix final (attente dans la limite du prix maximal consenti), trace' })
  @ZodBody(completeRideSchema)
  @ZodResponse(200, rideSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  complete(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(completeRideSchema)) body: z.infer<typeof completeRideSchema>, @CurrentUser() user: UserActor) {
    return this.rides.complete(id, user, body);
  }

  @Post('rides/:id/no-show')
  @HttpCode(200)
  @ApiOperation({ summary: 'Non-présentation après cinq minutes sur place et deux tentatives de contact' })
  @ZodResponse(200, cancellationResultSchema)
  @ApiErrors(401, 403, 404, 409, 429)
  noShow(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor) {
    return this.rides.declareNoShow(id, user);
  }

  @Post('rides/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Annulation par le chauffeur (motif) : réattribution immédiate avec priorité' })
  @ZodBody(driverCancelSchema)
  @ZodResponse(200, rideSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  cancel(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(driverCancelSchema)) body: z.infer<typeof driverCancelSchema>, @CurrentUser() user: UserActor) {
    return this.rides.cancelByDriver(id, user, body.reason);
  }

  @Get('scheduled')
  @ApiOperation({ summary: 'Courses planifiées ouvertes de sa catégorie et celles qui lui sont attribuées' })
  @ZodResponse(200, z.array(scheduledRideSchema))
  @ApiErrors(401, 403, 429)
  scheduledList(@CurrentUser() user: UserActor) {
    return this.scheduled.listForDriver(user);
  }

  @Post('scheduled/:id/claim')
  @HttpCode(200)
  @ApiOperation({ summary: 'Se proposer sur une course planifiée' })
  @ZodResponse(200, z.object({ assignmentId: uuid, status: z.literal('proposed') }))
  @ApiErrors(401, 403, 404, 409, 429)
  claim(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor) {
    return this.scheduled.claim(id, user);
  }

  @Post('scheduled/:id/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirmer une course planifiée : elle est attribuée au chauffeur' })
  @ZodResponse(200, rideSchema)
  @ApiErrors(401, 403, 404, 409, 429)
  confirm(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor) {
    return this.scheduled.confirm(id, user);
  }

  @Post('scheduled/:id/decline')
  @HttpCode(204)
  @ApiOperation({ summary: 'Retirer sa proposition' })
  @ApiErrors(401, 403, 429)
  async decline(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor) {
    await this.scheduled.decline(id, user);
  }
}
