/**
 * Neomoov Pilote (étape 24) : réglages et consentement, historique des décisions, coûts et rentabilité, agenda et
 * annulation de grâce pour le chauffeur (`driver.app`) ; rapport des exclusions de zones pour la plateforme
 * (`pilot.zones.read`). Chaque écriture est journalisée par le service.
 */
import {
  driverAgendaQuerySchema, driverAgendaSchema, driverCostsInputSchema, driverCostsSchema, driverProfitabilitySchema, monthSchema, pilotDecisionPageSchema,
  pilotDecisionsQuerySchema, pilotSettingsSchema, pilotSettingsUpdateSchema, pilotZoneExclusionsSchema, profitabilityQuerySchema, rideSchema, uuid,
} from '@neomoov/domain';
import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { ApiErrors, ZodBody, ZodQuery, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { Can, CurrentUser, type UserActor } from '../auth/actor.js';
import { PilotService, type PilotLanguage } from './pilot.service.js';

const languageOf = (acceptLanguage: string | undefined): PilotLanguage => (/^en\b/i.test((acceptLanguage ?? '').split(',')[0]?.trim() ?? '') ? 'en' : 'fr');

@ApiTags('driver')
@ApiBearerAuth()
@Can('driver.app')
@Controller('driver')
export class DriverPilotController {
  constructor(private readonly pilot: PilotService) {}

  @Get('pilot')
  @ApiOperation({ summary: 'Neomoov Pilote : réglages, critères, texte d\'information sur la décision automatisée (Loi 25, art. 12.1) à sa version courante, zones connues' })
  @ZodResponse(200, pilotSettingsSchema)
  @ApiErrors(401, 403, 429)
  settings(@CurrentUser() user: UserActor, @Headers('accept-language') acceptLanguage?: string) {
    return this.pilot.getSettings(user.userId, languageOf(acceptLanguage));
  }

  @Put('pilot')
  @ApiOperation({ summary: 'Neomoov Pilote : critères, consentement et activation (l\'activation exige le consentement à la version courante du texte d\'information)' })
  @ZodBody(pilotSettingsUpdateSchema)
  @ZodResponse(200, pilotSettingsSchema)
  @ApiErrors(400, 401, 403, 409, 429)
  update(@Body(zodPipe(pilotSettingsUpdateSchema)) body: z.infer<typeof pilotSettingsUpdateSchema>, @CurrentUser() user: UserActor, @Headers('accept-language') acceptLanguage?: string) {
    return this.pilot.updateSettings(user.userId, body, languageOf(acceptLanguage));
  }

  @Get('pilot/decisions')
  @ApiOperation({ summary: 'Neomoov Pilote : décisions sur mes offres (score, raisons, acceptation automatique, annulation de grâce), les plus récentes d\'abord' })
  @ZodQuery(pilotDecisionsQuerySchema)
  @ZodResponse(200, pilotDecisionPageSchema)
  @ApiErrors(400, 401, 403, 429)
  decisions(@Query(zodPipe(pilotDecisionsQuerySchema)) query: z.infer<typeof pilotDecisionsQuerySchema>, @CurrentUser() user: UserActor) {
    return this.pilot.decisions(user.userId, query);
  }

  @Post('rides/:id/pilot-cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Annulation sans frais d\'une course acceptée par Pilote, dans le délai de grâce (`pilot.grace_seconds`) : aucune pénalité, la course repart en répartition' })
  @ZodResponse(200, rideSchema)
  @ApiErrors(401, 403, 404, 409, 429)
  graceCancel(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor) {
    return this.pilot.graceCancel(user.userId, id);
  }

  @Get('agenda')
  @ApiOperation({ summary: 'Agenda : réservations attribuées chaînées, heure de départ conseillée depuis ma position (facultative) et alerte de départ' })
  @ZodQuery(driverAgendaQuerySchema)
  @ZodResponse(200, driverAgendaSchema)
  @ApiErrors(400, 401, 403, 429)
  agenda(@Query(zodPipe(driverAgendaQuerySchema)) query: z.infer<typeof driverAgendaQuerySchema>, @CurrentUser() user: UserActor) {
    if ((query.lat === undefined) !== (query.lng === undefined)) throw new AppError('VALIDATION_ERROR', 'La latitude et la longitude vont ensemble', 400, { fields: ['lat', 'lng'] });
    return this.pilot.agenda(user.userId, query.lat !== undefined && query.lng !== undefined ? { lat: query.lat, lng: query.lng } : null);
  }

  @Get('costs/:month')
  @ApiOperation({ summary: 'Coûts du mois par poste et revenus des autres plateformes saisis à la main (un total, sans logo)' })
  @ZodResponse(200, driverCostsSchema)
  @ApiErrors(400, 401, 403, 429)
  costs(@Param('month', zodPipe(monthSchema)) month: string, @CurrentUser() user: UserActor) {
    return this.pilot.getCosts(user.userId, month);
  }

  @Put('costs/:month')
  @ApiOperation({ summary: 'Enregistre les coûts du mois et le total des revenus des autres plateformes (montants en cents)' })
  @ZodBody(driverCostsInputSchema)
  @ZodResponse(200, driverCostsSchema)
  @ApiErrors(400, 401, 403, 429)
  saveCosts(@Param('month', zodPipe(monthSchema)) month: string, @Body(zodPipe(driverCostsInputSchema)) body: z.infer<typeof driverCostsInputSchema>, @CurrentUser() user: UserActor) {
    return this.pilot.saveCosts(user.userId, month, body);
  }

  @Get('profitability')
  @ApiOperation({ summary: 'Rentabilité nette du mois (mois courant par défaut) : revenus Neomoov et externes saisis, coûts et packs, net, marge' })
  @ZodQuery(profitabilityQuerySchema)
  @ZodResponse(200, driverProfitabilitySchema)
  @ApiErrors(400, 401, 403, 429)
  profitability(@Query(zodPipe(profitabilityQuerySchema)) query: z.infer<typeof profitabilityQuerySchema>, @CurrentUser() user: UserActor) {
    return this.pilot.profitability(user.userId, query.month);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
export class AdminPilotController {
  constructor(private readonly pilot: PilotService) {}

  @Get('pilot/zone-exclusions')
  @Can('pilot.zones.read')
  @ApiOperation({ summary: 'Neomoov Pilote : zones exclues par les critères des chauffeurs, zones surveillées et nombres (surveillance de la discrimination indirecte)' })
  @ZodResponse(200, pilotZoneExclusionsSchema)
  @ApiErrors(401, 403, 429)
  zoneExclusions() {
    return this.pilot.zoneExclusions();
  }
}
