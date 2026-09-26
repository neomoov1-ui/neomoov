/** « Mes chauffeurs » (section 5.10, D38, prompt 08 tâche 5) : favoris du client. */
import { favoriteSchema, uuid } from '@neomoov/domain';
import { Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiErrors, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { Audit, Authenticated, CurrentUser, type UserActor } from '../auth/actor.js';
import { FavoritesService } from './favorites.service.js';

@ApiTags('me')
@ApiBearerAuth()
@Authenticated()
@Controller('me/favorites')
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Get()
  @ApiOperation({ summary: '« Mes chauffeurs » : favoris du client (prénom, note, courses ensemble, véhicule actuel, disponibilité)' })
  @ZodResponse(200, z.array(favoriteSchema))
  @ApiErrors(401, 403, 429)
  list(@CurrentUser() user: UserActor) {
    return this.favorites.list(user.userId);
  }

  @Post(':driverId')
  @HttpCode(201)
  @Audit('client.favorite_added', 'favorite_drivers', 'driverId')
  @ApiOperation({ summary: 'Ajoute un chauffeur aux favoris, après une course terminée notée 4 ou plus avec lui ; idempotent' })
  @ZodResponse(201, favoriteSchema)
  @ApiErrors(401, 403, 404, 409, 429)
  add(@Param('driverId', zodPipe(uuid)) driverId: string, @CurrentUser() user: UserActor) {
    return this.favorites.add(user.userId, driverId);
  }

  @Delete(':driverId')
  @HttpCode(204)
  @Audit('client.favorite_removed', 'favorite_drivers', 'driverId')
  @ApiOperation({ summary: 'Retire un chauffeur des favoris ; idempotent' })
  @ApiErrors(401, 403, 429)
  async remove(@Param('driverId', zodPipe(uuid)) driverId: string, @CurrentUser() user: UserActor) {
    await this.favorites.remove(user.userId, driverId);
  }
}
