/**
 * My Hub, incidents ouverts à la main et registre des incidents de confidentialité (Loi 25). Création et fiche du
 * registre : administrateur et opérateur ; export du registre : administrateur. Chaque écriture est journalisée.
 */
import { adminIncidentCreateSchema, adminIncidentSchema, privacyBreachInputSchema, privacyBreachSchema, uuid } from '@neomoov/domain';
import { Body, Controller, Get, HttpCode, Param, Post, Put, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { ApiErrors, ZodBody, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { CurrentUser, Roles, STAFF_WRITE_ROLES, type UserActor } from '../auth/actor.js';
import { AdminIncidentsService } from './admin-incidents.service.js';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/incidents')
export class AdminIncidentsController {
  constructor(private readonly incidents: AdminIncidentsService) {}

  @Post()
  @Roles(...STAFF_WRITE_ROLES)
  @HttpCode(201)
  @ApiOperation({ summary: 'Ouvre un incident à la main (plainte par téléphone, objet perdu, incident de confidentialité inscrit aussitôt au registre)' })
  @ZodBody(adminIncidentCreateSchema)
  @ZodResponse(201, adminIncidentSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  create(@Body(zodPipe(adminIncidentCreateSchema)) body: z.infer<typeof adminIncidentCreateSchema>, @CurrentUser() user: UserActor) {
    return this.incidents.create(body, user);
  }

  @Get('privacy-register.csv')
  @Roles('admin')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Registre des incidents de confidentialité en CSV (copie remise à la CAI sur demande) ; téléchargement journalisé' })
  @ApiErrors(401, 403, 429)
  async register(@CurrentUser() user: UserActor, @Res({ passthrough: true }) res: Response) {
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="registre-incidents-confidentialite.csv"');
    res.setHeader('cache-control', 'private, no-store');
    return this.incidents.registerCsv(user);
  }

  @Get(':id/privacy-breach')
  @Roles(...STAFF_WRITE_ROLES)
  @ApiOperation({ summary: 'Fiche du registre des incidents de confidentialité : rubriques, évaluation, avis, mesures, suites à donner' })
  @ZodResponse(200, privacyBreachSchema)
  @ApiErrors(401, 403, 404, 429)
  privacyBreach(@Param('id', zodPipe(uuid)) id: string) {
    return this.incidents.privacyBreach(id);
  }

  @Put(':id/privacy-breach')
  @Roles(...STAFF_WRITE_ROLES)
  @ApiOperation({ summary: 'Inscrit l\'incident au registre (numéro IC-AAAA-NNN) ou remplace sa fiche ; une inscription ne se retire pas' })
  @ZodBody(privacyBreachInputSchema)
  @ZodResponse(200, privacyBreachSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  savePrivacyBreach(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(privacyBreachInputSchema)) body: z.infer<typeof privacyBreachInputSchema>, @CurrentUser() user: UserActor) {
    return this.incidents.savePrivacyBreach(id, body, user);
  }
}
