/** Ressource `/v1/me` (section 7.2) : profil, appareils, consentements, demandes de droits, suppression du compte. */
import { consentInputSchema, consentViewSchema, dataRequestInputSchema, dataRequestViewSchema, deleteMeSchema, deviceInputSchema, deviceSchema, meSchema, patchMeSchema, uuid } from '@neomoov/domain';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { ApiErrors, ZodBody, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { Authenticated, CurrentUser, Owns, type UserActor } from '../auth/actor.js';
import { UsersService } from '../users/users.service.js';
import { MeService } from './me.service.js';

const deletionScheduledSchema = z.object({ requestId: uuid, status: z.literal('scheduled') });

@ApiTags('me')
@ApiBearerAuth()
@Authenticated()
@Controller('me')
export class MeController {
  constructor(
    private readonly me: MeService,
    private readonly users: UsersService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Profil de l\'utilisateur connecté, avec ses rôles et l\'état de la politique de confidentialité' })
  @ZodResponse(200, meSchema)
  @ApiErrors(401, 429)
  get(@CurrentUser() user: UserActor) {
    return this.users.meView(user.userId, user.roles);
  }

  @Patch()
  @ApiOperation({ summary: 'Modifie la langue, le nom, le courriel ; accepte une nouvelle version de la politique de confidentialité' })
  @ZodBody(patchMeSchema)
  @ZodResponse(200, meSchema)
  @ApiErrors(400, 401, 409, 429)
  patch(@Body(zodPipe(patchMeSchema)) body: z.infer<typeof patchMeSchema>, @CurrentUser() user: UserActor) {
    return this.me.patch(user.userId, body, user.roles);
  }

  @Delete()
  @HttpCode(202)
  @ApiOperation({ summary: 'Supprime le compte (5.15) : accès coupé immédiatement, anonymisation des courses et effacement du reste en tâche de fond' })
  @ZodBody(deleteMeSchema)
  @ZodResponse(202, deletionScheduledSchema)
  @ApiErrors(401, 403, 429)
  remove(@Body(zodPipe(deleteMeSchema)) body: z.infer<typeof deleteMeSchema>, @CurrentUser() user: UserActor) {
    return this.me.deleteAccount(user, body.reason);
  }

  @Get('devices')
  @ApiOperation({ summary: 'Appareils enregistrés (jetons push)' })
  @ZodResponse(200, z.array(deviceSchema))
  @ApiErrors(401, 429)
  async devices(@CurrentUser() user: UserActor) {
    return (await this.users.listDevices(user.userId)).map(UsersService.deviceView);
  }

  @Post('devices')
  @HttpCode(201)
  @ApiOperation({ summary: 'Enregistre un appareil (plateforme, jeton push, version de l\'application)' })
  @ZodBody(deviceInputSchema)
  @ZodResponse(201, deviceSchema)
  @ApiErrors(400, 401, 429)
  async addDevice(@Body(zodPipe(deviceInputSchema)) body: z.infer<typeof deviceInputSchema>, @CurrentUser() user: UserActor) {
    return UsersService.deviceView(await this.users.upsertDevice(user.userId, body));
  }

  @Delete('devices/:id')
  @Owns('device')
  @HttpCode(204)
  @ApiOperation({ summary: 'Retire un appareil' })
  @ApiErrors(401, 403, 404, 429)
  async removeDevice(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor) {
    if (!(await this.users.deleteDevice(user.userId, id))) throw AppError.notFound('NOT_FOUND', 'Appareil introuvable');
  }

  @Get('consents')
  @ApiOperation({ summary: 'État des consentements par finalité (géolocalisation, marketing, enregistrement audio, biométrie, transfert)' })
  @ZodResponse(200, z.array(consentViewSchema))
  @ApiErrors(401, 429)
  consents(@CurrentUser() user: UserActor) {
    return this.me.listConsents(user.userId);
  }

  @Post('consents')
  @HttpCode(200)
  @ApiOperation({ summary: 'Accorde ou retire un consentement pour une finalité et une version (5.15)' })
  @ZodBody(consentInputSchema)
  @ZodResponse(200, consentViewSchema)
  @ApiErrors(400, 401, 429)
  setConsent(@Body(zodPipe(consentInputSchema)) body: z.infer<typeof consentInputSchema>, @CurrentUser() user: UserActor) {
    return this.me.setConsent(user.userId, body);
  }

  @Get('data-requests')
  @ApiOperation({ summary: 'Demandes de droits de l\'utilisateur (accès, rectification, portabilité, retrait, suppression)' })
  @ZodResponse(200, z.array(dataRequestViewSchema))
  @ApiErrors(401, 429)
  dataRequests(@CurrentUser() user: UserActor) {
    return this.me.listDataRequests(user.userId);
  }

  @Post('data-requests')
  @HttpCode(202)
  @ApiOperation({ summary: 'Dépose une demande de droits ; l\'export JSON et PDF (accès, portabilité) est produit en tâche de fond' })
  @ZodBody(dataRequestInputSchema)
  @ZodResponse(202, dataRequestViewSchema)
  @ApiErrors(400, 401, 429)
  createDataRequest(@Body(zodPipe(dataRequestInputSchema)) body: z.infer<typeof dataRequestInputSchema>, @CurrentUser() user: UserActor) {
    return this.me.createDataRequest(user.userId, body);
  }

  @Get('data-requests/:id')
  @Owns('dataRequest')
  @ApiOperation({ summary: 'Suivi d\'une demande ; liens signés vers l\'export quand il est prêt' })
  @ZodResponse(200, dataRequestViewSchema)
  @ApiErrors(401, 403, 404, 429)
  dataRequest(@Param('id', zodPipe(uuid)) id: string) {
    return this.me.getDataRequest(id);
  }
}
