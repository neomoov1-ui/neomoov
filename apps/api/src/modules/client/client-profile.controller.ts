/** Configuration publique des applications et profil client (préférences, lieux enregistrés), prompt 10. */
import { appConfigSchema, ridePreferencesSchema, savedPlaceInputSchema, savedPlaceSchema, uuid } from '@neomoov/domain';
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiErrors, ZodBody, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { Authenticated, CurrentUser, NoAudit, Public, type UserActor } from '../auth/actor.js';
import { ClientProfileService } from './client-profile.service.js';

@ApiTags('config')
@Controller('config')
export class ConfigController {
  constructor(private readonly profile: ClientProfileService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Configuration publique des applications : drapeaux distants (négociation…), préavis, annulation, catégories, assistance' })
  @ZodResponse(200, appConfigSchema)
  @ApiErrors(429)
  get() {
    return this.profile.config();
  }
}

@ApiTags('me')
@ApiBearerAuth()
@Authenticated()
@Controller('me')
export class ClientProfileController {
  constructor(private readonly profile: ClientProfileService) {}

  @Get('preferences')
  @NoAudit()
  @ApiOperation({ summary: 'Préférences de confort du client (D36, D37), pré-remplies à chaque réservation' })
  @ZodResponse(200, ridePreferencesSchema)
  @ApiErrors(401, 403, 429)
  preferences(@CurrentUser() user: UserActor) {
    return this.profile.preferences(user.userId);
  }

  @Put('preferences')
  @ApiOperation({ summary: 'Remplace les préférences de confort du client' })
  @ZodBody(ridePreferencesSchema)
  @ZodResponse(200, ridePreferencesSchema)
  @ApiErrors(400, 401, 403, 429)
  setPreferences(@Body(zodPipe(ridePreferencesSchema)) body: z.infer<typeof ridePreferencesSchema>, @CurrentUser() user: UserActor) {
    return this.profile.setPreferences(user.userId, body);
  }

  @Get('places')
  @NoAudit()
  @ApiOperation({ summary: 'Lieux enregistrés du client' })
  @ZodResponse(200, z.array(savedPlaceSchema))
  @ApiErrors(401, 403, 429)
  places(@CurrentUser() user: UserActor) {
    return this.profile.places(user.userId);
  }

  @Post('places')
  @HttpCode(201)
  @ApiOperation({ summary: 'Enregistre un lieu (domicile, travail…), 20 au plus' })
  @ZodBody(savedPlaceInputSchema)
  @ZodResponse(201, savedPlaceSchema)
  @ApiErrors(400, 401, 403, 409, 429)
  addPlace(@Body(zodPipe(savedPlaceInputSchema)) body: z.infer<typeof savedPlaceInputSchema>, @CurrentUser() user: UserActor) {
    return this.profile.addPlace(user.userId, body);
  }

  @Delete('places/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Retire un lieu enregistré' })
  @ApiErrors(401, 403, 404, 429)
  async removePlace(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor) {
    await this.profile.removePlace(user.userId, id);
  }
}
