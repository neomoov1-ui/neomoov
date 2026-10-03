/**
 * Routes de l'espace « Réseaux sociaux » (3 octobre 2026) : administration des dix comptes dans My Hub
 * (`/admin/social`, lecture `marketing.read`, actions `marketing.manage`), retour des écrans d'autorisation OAuth
 * (`/social/oauth/callback/{espace}`, publique, `state` signé vérifié) et liens publics de la page Contact de
 * neomoov.net (`/public/social-links`, sans clé, cache 10 minutes). Aucune route ne rend une valeur secrète.
 */
import {
  socialAccountSchema, socialAccountUpdateSchema, socialConnectStartSchema, socialLinkInputSchema, socialLinksSchema, socialSelectSchema, socialSpaceSchema, socialTelegramConnectSchema,
  type SocialLinksView, type SocialSpace,
} from '@neomoov/domain';
import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { ApiErrors, ZodBody, ZodQuery, ZodResponse } from '../../common/openapi.js';
import { RateLimitService } from '../../common/rate-limit.service.js';
import { SettingsService } from '../../common/settings.service.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { Can, CurrentActor, CurrentUser, NoAudit, Public, ReqCtx, type Actor, type RequestContext, type UserActor } from '../auth/actor.js';
import { SocialAccountsService } from './social-accounts.service.js';

const callbackQuerySchema = z.object({
  code: z.string().max(2000).optional(),
  state: z.string().max(2000).optional(),
  error: z.string().max(200).optional(),
  error_description: z.string().max(1000).optional(),
}).passthrough();

@ApiTags('marketing')
@ApiBearerAuth()
@Controller('admin/social')
export class SocialAccountsController {
  constructor(private readonly social: SocialAccountsService) {}

  @Get()
  @Can('marketing.read')
  @NoAudit()
  @ApiOperation({ summary: 'Les dix comptes des réseaux sociaux : état, compte relié, dernière validation, mode, lien public, adresse de rappel (jamais une valeur secrète)' })
  @ZodResponse(200, z.array(socialAccountSchema))
  @ApiErrors(401, 403, 429)
  list() {
    return this.social.list();
  }

  @Get(':space/connect')
  @Can('marketing.manage')
  @NoAudit()
  @ApiOperation({ summary: 'Adresse de l\'écran d\'autorisation du réseau (OAuth 2.0, state signé de 15 minutes, PKCE pour X et Google) ; Instagram passe par le parcours Meta de Facebook' })
  @ZodResponse(200, socialConnectStartSchema)
  @ApiErrors(400, 401, 403, 409, 429)
  connect(@Param('space', zodPipe(socialSpaceSchema)) space: SocialSpace, @CurrentUser() user: UserActor) {
    return this.social.startConnect(space, user);
  }

  @Post('telegram/connect')
  @Can('marketing.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Telegram : jeton du bot et canal, validés (bot administrateur du canal avec le droit de publier) puis enregistrés chiffrés' })
  @ZodBody(socialTelegramConnectSchema)
  @ZodResponse(200, socialAccountSchema)
  @ApiErrors(400, 401, 403, 422, 429, 502)
  telegram(@Body(zodPipe(socialTelegramConnectSchema)) body: z.infer<typeof socialTelegramConnectSchema>, @CurrentUser() user: UserActor) {
    return this.social.connectTelegram(body, user);
  }

  @Post(':space/link')
  @Can('marketing.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Lien public du compte (relais manuel : Snapchat, chaîne WhatsApp ; ou adresse corrigée) : https sur un domaine du réseau' })
  @ZodBody(socialLinkInputSchema)
  @ZodResponse(200, socialAccountSchema)
  @ApiErrors(400, 401, 403, 429)
  link(@Param('space', zodPipe(socialSpaceSchema)) space: SocialSpace, @Body(zodPipe(socialLinkInputSchema)) body: z.infer<typeof socialLinkInputSchema>, @CurrentUser() user: UserActor) {
    return this.social.setLink(space, body.profileUrl, user);
  }

  @Post(':space/select')
  @Can('marketing.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Choix de la page (Facebook, avec son compte Instagram) ou de l\'organisation (LinkedIn) quand l\'autorisation en donne plusieurs' })
  @ZodBody(socialSelectSchema)
  @ZodResponse(200, socialAccountSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  select(@Param('space', zodPipe(socialSpaceSchema)) space: SocialSpace, @Body(zodPipe(socialSelectSchema)) body: z.infer<typeof socialSelectSchema>, @CurrentUser() user: UserActor) {
    return this.social.select(space, body.accountId, user);
  }

  @Post(':space/validate')
  @Can('marketing.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revalide le compte tout de suite (jeton rafraîchi si besoin, lecture du compte chez le réseau)' })
  @ZodResponse(200, socialAccountSchema)
  @ApiErrors(400, 401, 403, 429)
  validate(@Param('space', zodPipe(socialSpaceSchema)) space: SocialSpace, @CurrentUser() user: UserActor) {
    return this.social.revalidate(space, user);
  }

  @Patch(':space')
  @Can('marketing.manage')
  @ApiOperation({ summary: 'Réglages du compte : mode (direct ou relais manuel), « afficher sur le site », lien public, approbation de l\'application par le réseau' })
  @ZodBody(socialAccountUpdateSchema)
  @ZodResponse(200, socialAccountSchema)
  @ApiErrors(400, 401, 403, 429)
  update(@Param('space', zodPipe(socialSpaceSchema)) space: SocialSpace, @Body(zodPipe(socialAccountUpdateSchema)) body: z.infer<typeof socialAccountUpdateSchema>, @CurrentUser() user: UserActor) {
    return this.social.update(space, body, user);
  }

  @Delete(':space')
  @Can('marketing.manage')
  @ApiOperation({ summary: 'Déconnecte le compte : jetons effacés, compte et lien retirés (le blogue reste en lecture seule)' })
  @ZodResponse(200, socialAccountSchema)
  @ApiErrors(400, 401, 403, 429)
  disconnect(@Param('space', zodPipe(socialSpaceSchema)) space: SocialSpace, @CurrentUser() user: UserActor) {
    return this.social.disconnect(space, user);
  }
}

@ApiTags('marketing')
@Controller('social/oauth')
export class SocialOAuthController {
  constructor(
    private readonly social: SocialAccountsService,
    private readonly rateLimit: RateLimitService,
    private readonly settings: SettingsService,
  ) {}

  @Get('callback/:space')
  @Public()
  @ApiOperation({ summary: 'Retour de l\'écran d\'autorisation du réseau (adresse de rappel à déclarer chez lui) : state vérifié (400 sinon), code échangé, compte enregistré chiffré, redirection vers My Hub' })
  @ZodQuery(callbackQuerySchema)
  @ApiErrors(400, 429)
  async callback(@Param('space', zodPipe(socialSpaceSchema)) space: SocialSpace, @Query(zodPipe(callbackQuerySchema)) query: z.infer<typeof callbackQuerySchema>, @ReqCtx() ctx: RequestContext, @Res() res: Response) {
    if (ctx.ip) {
      const max = await this.settings.number('social.oauth_callback_per_ip_per_hour', 60);
      const result = await this.rateLimit.hit(`social:oauth:${ctx.ip}`, max, 3600);
      if (!result.allowed) throw new AppError('RATE_LIMITED', 'Trop de demandes, réessayez plus tard', 429, { retryAfter: result.resetIn });
    }
    const target = await this.social.callback(space, query);
    res.setHeader('cache-control', 'no-store');
    res.redirect(302, target);
  }
}

@ApiTags('public')
@Controller('public/social-links')
export class PublicSocialLinksController {
  constructor(
    private readonly social: SocialAccountsService,
    private readonly rateLimit: RateLimitService,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  @Public()
  @Header('Cache-Control', 'public, max-age=600')
  @ApiOperation({ summary: 'Liens des réseaux de Neomoov pour la page Contact : comptes reliés, validés et marqués « afficher sur le site », dans l\'ordre des espaces (sans clé, cache 10 minutes)' })
  @ZodResponse(200, socialLinksSchema)
  @ApiErrors(429)
  async links(@ReqCtx() ctx: RequestContext, @CurrentActor() actor: Actor | undefined): Promise<SocialLinksView> {
    if (ctx.ip && actor?.kind !== 'service') {
      const max = await this.settings.number('public.social_links_per_ip_per_hour', 300);
      const result = await this.rateLimit.hit(`public:social-links:${ctx.ip}`, max, 3600);
      if (!result.allowed) throw new AppError('RATE_LIMITED', 'Trop de demandes, réessayez plus tard', 429, { retryAfter: result.resetIn });
    }
    return this.social.publicLinks();
  }
}
