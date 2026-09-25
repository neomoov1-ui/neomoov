/** Courses côté My Hub (étape 5) : création par l'opérateur et attribution forcée ; les autres écrans arrivent à l'étape 12. */
import { adminAssignSchema, adminCreateRideSchema, rideEventSchema, rideSchema, uuid } from '@neomoov/domain';
import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiErrors, ZodBody, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { Audit, CurrentUser, Roles, STAFF_READ_ROLES, STAFF_WRITE_ROLES, type UserActor } from '../auth/actor.js';
import { ScheduledService } from './scheduled.service.js';
import { RidesService } from './rides.service.js';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/rides')
export class AdminRidesController {
  constructor(
    private readonly rides: RidesService,
    private readonly scheduled: ScheduledService,
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
}
