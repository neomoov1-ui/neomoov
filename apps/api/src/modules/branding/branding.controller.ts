/**
 * Marque par organisation (étape 22) : marque publique par code ou domaine (thème des applications et du web),
 * administration de la marque et des domaines d'une organisation, rattachement du profil client par code.
 */
import {
  attachOrganizationResultSchema, attachOrganizationSchema, brandUpdateSchema, brandViewSchema, domainSchema, joinCodeSchema, organizationDomainCreatedSchema,
  organizationDomainCreateSchema, organizationDomainSchema, publicBrandQuerySchema, publicBrandSchema, uuid, type PublicBrand,
} from '@neomoov/domain';
import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { ApiErrors, ZodBody, ZodQuery, ZodResponse } from '../../common/openapi.js';
import { RateLimitService } from '../../common/rate-limit.service.js';
import { SettingsService } from '../../common/settings.service.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { Authenticated, Can, CurrentActor, CurrentUser, Public, ReqCtx, type Actor, type RequestContext, type UserActor } from '../auth/actor.js';
import { BrandingService } from './branding.service.js';

/** Cache en mémoire des marques publiques (60 s, comme l'en-tête Cache-Control), borné. */
const PUBLIC_CACHE_TTL_MS = 60_000;
const PUBLIC_CACHE_MAX = 2_000;

@ApiTags('public')
@Controller('public/brand')
export class PublicBrandController {
  private readonly cache = new Map<string, { at: number; value: PublicBrand }>();

  constructor(
    private readonly branding: BrandingService,
    private readonly rateLimit: RateLimitService,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  @Public()
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({ summary: 'Marque d\'une organisation par code de rattachement ou par domaine vérifié : thème des applications et du web, sans donnée personnelle (limité par adresse sauf pour une clé de service, cache 60 s)' })
  @ZodQuery(z.object({ code: joinCodeSchema.optional(), domain: domainSchema.optional() }))
  @ZodResponse(200, publicBrandSchema)
  @ApiErrors(400, 404, 429)
  async get(@Query(zodPipe(publicBrandQuerySchema)) query: z.infer<typeof publicBrandQuerySchema>, @ReqCtx() ctx: RequestContext, @CurrentActor() actor: Actor | undefined): Promise<PublicBrand> {
    // Le serveur web (clé de service) relaie les marques de tous les domaines depuis une seule adresse : pas de limite par adresse.
    if (ctx.ip && actor?.kind !== 'service') {
      const max = await this.settings.number('public.brand_per_ip_per_hour', 300);
      const result = await this.rateLimit.hit(`public:brand:${ctx.ip}`, max, 3600);
      if (!result.allowed) throw new AppError('RATE_LIMITED', 'Trop de demandes, réessayez plus tard', 429, { retryAfter: result.resetIn });
    }
    const key = query.code ? `code:${query.code}` : `domain:${query.domain}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < PUBLIC_CACHE_TTL_MS) return hit.value;
    const value = query.code ? await this.branding.publicByCode(query.code) : await this.branding.publicByDomain(query.domain!);
    if (this.cache.size >= PUBLIC_CACHE_MAX) this.cache.clear();
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/organizations/:id')
export class AdminBrandController {
  constructor(private readonly branding: BrandingService) {}

  @Get('brand')
  @Can('organizations.read')
  @ApiOperation({ summary: 'Marque d\'une organisation : ce qui est enregistré, le résultat résolu (héritage du parent puis Neomoov) et son code de rattachement' })
  @ZodResponse(200, brandViewSchema)
  @ApiErrors(401, 403, 404, 429)
  get(@Param('id', zodPipe(uuid)) id: string) {
    return this.branding.getBrand(id);
  }

  @Put('brand')
  @Can('brand.edit')
  @ApiOperation({ summary: 'Modifie la marque (champs donnés seulement, null efface) ; refuse un contraste sous WCAG AA (BRAND_CONTRAST)' })
  @ZodBody(brandUpdateSchema)
  @ZodResponse(200, brandViewSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  update(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(brandUpdateSchema)) body: z.infer<typeof brandUpdateSchema>, @CurrentUser() user: UserActor) {
    return this.branding.updateBrand(id, body, user);
  }

  @Get('domains')
  @Can('organizations.read')
  @ApiOperation({ summary: 'Domaines web déclarés par l\'organisation (réservation, My Hub) et leur vérification' })
  @ZodResponse(200, z.array(organizationDomainSchema))
  @ApiErrors(401, 403, 404, 429)
  domains(@Param('id', zodPipe(uuid)) id: string) {
    return this.branding.listDomains(id);
  }

  @Post('domains')
  @Can('domains.manage')
  @HttpCode(201)
  @ApiOperation({ summary: 'Déclare un domaine ; le jeton et l\'enregistrement TXT à poser ne sont rendus qu\'une fois' })
  @ZodBody(organizationDomainCreateSchema)
  @ZodResponse(201, organizationDomainCreatedSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  addDomain(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(organizationDomainCreateSchema)) body: z.infer<typeof organizationDomainCreateSchema>, @CurrentUser() user: UserActor) {
    return this.branding.addDomain(id, body, user);
  }

  @Delete('domains/:domainId')
  @Can('domains.manage')
  @HttpCode(204)
  @ApiOperation({ summary: 'Retire un domaine' })
  @ApiErrors(401, 403, 404, 429)
  async removeDomain(@Param('id', zodPipe(uuid)) id: string, @Param('domainId', zodPipe(uuid)) domainId: string, @CurrentUser() user: UserActor) {
    await this.branding.removeDomain(id, domainId, user);
  }

  @Post('domains/:domainId/verify')
  @Can('domains.verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Marque un domaine vérifié après contrôle manuel de l\'enregistrement DNS (plateforme seulement, V1)' })
  @ZodResponse(200, organizationDomainSchema)
  @ApiErrors(401, 403, 404, 429)
  verifyDomain(@Param('id', zodPipe(uuid)) id: string, @Param('domainId', zodPipe(uuid)) domainId: string, @CurrentUser() user: UserActor) {
    return this.branding.verifyDomain(id, domainId, user);
  }
}

@ApiTags('me')
@ApiBearerAuth()
@Authenticated()
@Controller('me/organizations')
export class MeOrganizationsController {
  constructor(private readonly branding: BrandingService) {}

  @Post('attach')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rattache mon profil client à l\'organisation du code (lien neomoov.net/c/<code>, code QR ou saisie) ; renvoie sa marque' })
  @ZodBody(attachOrganizationSchema)
  @ZodResponse(200, attachOrganizationResultSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  attach(@Body(zodPipe(attachOrganizationSchema)) body: z.infer<typeof attachOrganizationSchema>, @CurrentUser() user: UserActor) {
    return this.branding.attach(user.userId, body.code);
  }
}
