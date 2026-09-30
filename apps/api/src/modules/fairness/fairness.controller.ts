/**
 * Charte d'équité (D7) : sanctions vues par le chauffeur, réponse et appel ; décision et exclusion d'une note dans My Hub
 * (administrateur et opérateur). Chaque écriture est journalisée.
 */
import {
  adminSanctionAppealSchema, driverSanctionSchema, ratingExclusionSchema, sanctionAppealDecisionSchema, sanctionAppealInputSchema, sanctionAppealListQuerySchema, uuid,
} from '@neomoov/domain';
import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiErrors, ZodBody, ZodQuery, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { Can, Authenticated, CurrentUser, type UserActor } from '../auth/actor.js';
import { FairnessService } from './fairness.service.js';

@ApiTags('driver')
@ApiBearerAuth()
@Authenticated()
@Can('driver.app')
@Controller('driver')
export class DriverFairnessController {
  constructor(private readonly fairness: FairnessService) {}

  @Get('sanctions')
  @ApiOperation({ summary: 'Mes sanctions : motif écrit, période, décision humaine ou non, mes réponses et appels (Charte d\'équité)' })
  @ZodResponse(200, z.array(driverSanctionSchema))
  @ApiErrors(401, 403, 429)
  sanctions(@CurrentUser() user: UserActor) {
    return this.fairness.driverSanctions(user.userId);
  }

  @Post('sanctions/:id/appeals')
  @HttpCode(201)
  @ApiOperation({ summary: 'Réponse (ma version) ou appel sur une sanction : réponse d\'une personne sous 4 heures ouvrables' })
  @ZodBody(sanctionAppealInputSchema)
  @ZodResponse(201, driverSanctionSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  appeal(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(sanctionAppealInputSchema)) body: z.infer<typeof sanctionAppealInputSchema>, @CurrentUser() user: UserActor) {
    return this.fairness.appeal(user.userId, id, body);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
export class AdminFairnessController {
  constructor(private readonly fairness: FairnessService) {}

  @Get('fairness/appeals')
  @Can('fairness.appeals.decide')
  @ApiOperation({ summary: 'Réponses et appels des chauffeurs, les plus anciens d\'abord, avec le retard sur le délai de 4 heures ouvrables' })
  @ZodQuery(sanctionAppealListQuerySchema)
  @ZodResponse(200, z.array(adminSanctionAppealSchema))
  @ApiErrors(400, 401, 403, 429)
  appeals(@Query(zodPipe(sanctionAppealListQuerySchema)) query: z.infer<typeof sanctionAppealListQuerySchema>) {
    return this.fairness.list(query);
  }

  @Post('fairness/appeals/:id/decide')
  @HttpCode(200)
  @Can('fairness.appeals.decide')
  @ApiOperation({ summary: 'Décision motivée sur une réponse ou un appel ; un appel est tranché par une autre personne ; « overturned » lève la sanction' })
  @ZodBody(sanctionAppealDecisionSchema)
  @ZodResponse(200, adminSanctionAppealSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  decide(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(sanctionAppealDecisionSchema)) body: z.infer<typeof sanctionAppealDecisionSchema>, @CurrentUser() user: UserActor) {
    return this.fairness.decide(id, body, user);
  }

  @Post('ratings/:id/exclude')
  @HttpCode(200)
  @Can('fairness.appeals.decide')
  @ApiOperation({ summary: 'Retire une note du client du calcul de la note du chauffeur, avec le motif ; note du chauffeur recalculée' })
  @ZodBody(ratingExclusionSchema)
  @ZodResponse(200, z.object({ id: uuid, excludedAt: z.string(), driverRating: z.object({ average: z.number(), count: z.number().int() }).nullable() }))
  @ApiErrors(400, 401, 403, 404, 429)
  excludeRating(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(ratingExclusionSchema)) body: z.infer<typeof ratingExclusionSchema>, @CurrentUser() user: UserActor) {
    return this.fairness.excludeRating(id, body.reason, user);
  }
}
