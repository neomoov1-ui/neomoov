/** Garantie modèle (section 5.2, prompt 08 tâche 6) : décision de l'exploitation sur un signalement de véhicule non conforme. */
import { guaranteeDecisionSchema, guaranteeResultSchema, uuid } from '@neomoov/domain';
import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiErrors, ZodBody, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { CurrentUser, Roles, STAFF_WRITE_ROLES, type UserActor } from '../auth/actor.js';
import { GuaranteeService } from './guarantee.service.js';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
export class GuaranteeController {
  constructor(private readonly guarantee: GuaranteeService) {}

  @Post('incidents/:id/guarantee')
  @Roles(...STAFF_WRITE_ROLES)
  @HttpCode(200)
  @ApiOperation({ summary: 'Garantie modèle : validée (remboursement intégral, tarif du chauffeur maintenu ou sanction proposée) ou refusée (clôture motivée) ; client prévenu' })
  @ZodBody(guaranteeDecisionSchema)
  @ZodResponse(200, guaranteeResultSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  decide(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(guaranteeDecisionSchema)) body: z.infer<typeof guaranteeDecisionSchema>, @CurrentUser() user: UserActor) {
    return this.guarantee.decide(id, body, user);
  }
}
