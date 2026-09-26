/** Crédits et parrainage de l'utilisateur connecté (section 7.2, groupe `/v1/me` ; prompt 08 tâche 4). */
import { creditsSchema, referralApplySchema, referralSchema } from '@neomoov/domain';
import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiErrors, ZodBody, ZodQuery, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { Authenticated, CurrentUser, NoAudit, type UserActor } from '../auth/actor.js';
import { CreditsService } from './credits.service.js';
import { ReferralsService } from './referrals.service.js';

/** Type de parrainage affiché : chauffeur par défaut pour un chauffeur, client sinon. */
const referralQuerySchema = z.object({ kind: z.enum(['client', 'driver']).optional() });

@ApiTags('me')
@ApiBearerAuth()
@Authenticated()
@Controller('me')
export class MeCreditsController {
  constructor(
    private readonly credits: CreditsService,
    private readonly referrals: ReferralsService,
  ) {}

  @Get('credits')
  @NoAudit()
  @ApiOperation({ summary: 'Crédits du compte : total disponible et liste (utilisables d\'abord, les plus récents en tête), déduits automatiquement du devis' })
  @ZodResponse(200, creditsSchema)
  @ApiErrors(401, 429)
  list(@CurrentUser() user: UserActor) {
    return this.credits.list(user.userId);
  }

  @Get('referral')
  @NoAudit()
  @ApiOperation({ summary: 'Parrainage : code personnel (créé au premier appel), lien de partage, montants, statistiques et parrain du compte' })
  @ZodQuery(referralQuerySchema)
  @ZodResponse(200, referralSchema)
  @ApiErrors(400, 401, 403, 429)
  referral(@Query(zodPipe(referralQuerySchema)) query: z.infer<typeof referralQuerySchema>, @CurrentUser() user: UserActor) {
    return this.referrals.view(user.userId, query.kind);
  }

  @Post('referral/apply')
  @HttpCode(201)
  @ApiOperation({ summary: 'Saisie du code d\'un parrain (à l\'inscription, avant la première course) : crédits pour les deux après la première course terminée' })
  @ZodBody(referralApplySchema)
  @ZodResponse(201, referralSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  apply(@Body(zodPipe(referralApplySchema)) body: z.infer<typeof referralApplySchema>, @CurrentUser() user: UserActor) {
    return this.referrals.apply(user.userId, body.code);
  }
}
