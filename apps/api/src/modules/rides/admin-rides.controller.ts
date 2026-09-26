/** Courses côté My Hub (étapes 5 et 6) : création par l'opérateur, attribution forcée, panneau de répartition (réattribution, mise en attente, reprise). */
import { adminAssignSchema, adminCreateRideSchema, adminDispatchViewSchema, adminHoldSchema, adminReassignSchema, dispatchTickReportSchema, dispatchTickSchema, rideEventSchema, rideSchema, uuid } from '@neomoov/domain';
import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiErrors, ZodBody, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { Audit, CurrentUser, Roles, STAFF_READ_ROLES, STAFF_WRITE_ROLES, type UserActor } from '../auth/actor.js';
import { DispatchService } from './dispatch.service.js';
import { ScheduledService } from './scheduled.service.js';
import { RidesService } from './rides.service.js';
import { StuckRidesService } from './stuck-rides.service.js';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/rides')
export class AdminRidesController {
  constructor(
    private readonly rides: RidesService,
    private readonly scheduled: ScheduledService,
    private readonly dispatch: DispatchService,
    private readonly stuck: StuckRidesService,
  ) {}

  @Post()
  @Roles(...STAFF_WRITE_ROLES)
  @HttpCode(201)
  @ApiOperation({ summary: 'Création par l\'opérateur à partir d\'un devis (compte client ou fiche minimale)' })
  @ZodBody(adminCreateRideSchema)
  @ZodResponse(201, rideSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  create(@Body(zodPipe(adminCreateRideSchema)) body: z.infer<typeof adminCreateRideSchema>, @CurrentUser() user: UserActor) {
    return this.rides.createByOperator(body, user);
  }

  @Post(':id/assign')
  @Roles(...STAFF_WRITE_ROLES)
  @HttpCode(200)
  @ApiOperation({ summary: 'Attribution forcée à un chauffeur (garantie modèle vérifiée)' })
  @ZodBody(adminAssignSchema)
  @ZodResponse(200, rideSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  assign(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(adminAssignSchema)) body: z.infer<typeof adminAssignSchema>, @CurrentUser() user: UserActor) {
    return this.rides.assign(id, body, { kind: 'operator', userId: user.userId });
  }

  @Get('stuck')
  @Roles(...STAFF_READ_ROLES)
  @ApiOperation({ summary: 'Courses figées : arrivé sans suite, en route ou en course trop longtemps, réservation dont l\'heure est passée, recherche qui dure' })
  @ZodResponse(200, z.array(z.object({ rideId: uuid, publicNumber: z.string(), state: z.string(), since: z.string(), minutes: z.number().int().min(0) })))
  @ApiErrors(401, 403, 429)
  stuckRides() {
    return this.stuck.find();
  }

  @Get(':id')
  @Roles(...STAFF_READ_ROLES)
  @ApiOperation({ summary: 'Une course, vue My Hub' })
  @ZodResponse(200, rideSchema)
  @ApiErrors(401, 403, 404, 429)
  get(@Param('id', zodPipe(uuid)) id: string) {
    return this.rides.viewById(id);
  }

  @Get(':id/events')
  @Roles(...STAFF_READ_ROLES)
  @ApiOperation({ summary: 'Journal `ride_events` d\'une course' })
  @ZodResponse(200, z.array(rideEventSchema))
  @ApiErrors(401, 403, 404, 429)
  events(@Param('id', zodPipe(uuid)) id: string) {
    return this.rides.eventsOf(id);
  }

  @Post('scheduled/tick')
  @Roles('admin')
  @HttpCode(200)
  @Audit('admin.scheduled_tick', 'rides')
  @ApiOperation({ summary: 'Exécute une passe des tâches planifiées (rappels, attribution à 60 minutes, alertes) ; normalement faite par le worker chaque minute' })
  @ZodBody(z.object({ now: z.string().datetime({ offset: true }).optional() }))
  @ZodResponse(200, z.object({ reminders: z.array(uuid), dispatchDue: z.array(uuid), operatorAlerts: z.array(uuid) }))
  @ApiErrors(401, 403, 429)
  tick(@Body(zodPipe(z.object({ now: z.string().datetime({ offset: true }).optional() }))) body: { now?: string }) {
    return this.scheduled.tick(body.now ? new Date(body.now) : new Date());
  }

  // --- Panneau de répartition (5.4, tâche 7) ---

  @Get(':id/dispatch')
  @Roles(...STAFF_READ_ROLES)
  @ApiOperation({ summary: 'Répartition d\'une course : état de la recherche et toutes les offres faites aux chauffeurs' })
  @ZodResponse(200, adminDispatchViewSchema)
  @ApiErrors(401, 403, 404, 429)
  dispatchOf(@Param('id', zodPipe(uuid)) id: string) {
    return this.dispatch.adminView(id);
  }

  @Post(':id/reassign')
  @Roles(...STAFF_WRITE_ROLES)
  @HttpCode(200)
  @Audit('admin.ride_reassigned', 'rides')
  @ApiOperation({ summary: 'Réattribution : le chauffeur en place est retiré (sans sanction) et une nouvelle recherche prioritaire démarre' })
  @ZodBody(adminReassignSchema)
  @ZodResponse(200, rideSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  reassign(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(adminReassignSchema)) body: z.infer<typeof adminReassignSchema>, @CurrentUser() user: UserActor) {
    return this.dispatch.reassign(id, user, body);
  }

  @Post(':id/hold')
  @Roles(...STAFF_WRITE_ROLES)
  @HttpCode(200)
  @Audit('admin.ride_held', 'rides')
  @ApiOperation({ summary: 'Mise en attente : les offres en cours sont retirées, aucune nouvelle recherche jusqu\'à la reprise' })
  @ZodBody(adminHoldSchema)
  @ZodResponse(200, rideSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  hold(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(adminHoldSchema)) body: z.infer<typeof adminHoldSchema>, @CurrentUser() user: UserActor) {
    return this.dispatch.hold(id, user, body.reason);
  }

  @Post(':id/release')
  @Roles(...STAFF_WRITE_ROLES)
  @HttpCode(200)
  @Audit('admin.ride_released', 'rides')
  @ApiOperation({ summary: 'Reprise de la recherche après une mise en attente' })
  @ZodResponse(200, rideSchema)
  @ApiErrors(401, 403, 404, 409, 429)
  release(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor) {
    return this.dispatch.release(id, user);
  }

  @Post('dispatch/tick')
  @Roles('admin')
  @HttpCode(200)
  @Audit('admin.dispatch_tick', 'rides')
  @ApiOperation({ summary: 'Exécute un battement de la répartition (offres échues, vagues, fenêtres closes, surveillance du départ) ; normalement fait chaque seconde par le processus qui la porte' })
  @ZodBody(dispatchTickSchema)
  @ZodResponse(200, dispatchTickReportSchema)
  @ApiErrors(400, 401, 403, 429)
  dispatchTick(@Body(zodPipe(dispatchTickSchema)) body: z.infer<typeof dispatchTickSchema>) {
    return this.dispatch.tick(body.now ? new Date(body.now) : new Date());
  }
}
