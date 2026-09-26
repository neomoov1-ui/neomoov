/**
 * API publique limitée (prompt 12, section 7.2 groupe Public) pour le site WordPress et les pages web : prospects
 * (préinscription des chauffeurs, demandes des entreprises et partenaires) et devis sans compte. Clé d'API à portée
 * `public:write` (visible dans une page web : sa portée ne donne accès à rien d'autre), limitation par adresse IP,
 * protection anti-robots sur les formulaires. Le suivi partagé (`GET /public/track/{token}`) reste dans les courses.
 */
import { schema } from '@neomoov/db';
import { leadCreatedSchema, leadInputSchema, quoteRequestSchema, quotesResponseSchema } from '@neomoov/domain';
import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AntiBotService } from '../../common/anti-bot.service.js';
import { AppError } from '../../common/app-error.js';
import { ApiErrors, ZodBody, ZodResponse } from '../../common/openapi.js';
import { RateLimitService } from '../../common/rate-limit.service.js';
import { SettingsService } from '../../common/settings.service.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AuditService } from '../audit/audit.service.js';
import { CurrentActor, ReqCtx, Scopes, type Actor, type RequestContext } from '../auth/actor.js';
import { QuotesService } from '../pricing/quotes.service.js';

@ApiTags('public')
@ApiBearerAuth()
@Scopes('public:write')
@Controller('public')
export class PublicApiController {
  constructor(
    @Inject(DB) private readonly database: Database,
    private readonly quotes: QuotesService,
    private readonly antiBot: AntiBotService,
    private readonly rateLimit: RateLimitService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /** Limite par adresse IP et par heure (réglage), en plus de la limite générale par minute. */
  private async limit(bucket: 'leads' | 'quotes', ip: string | null): Promise<void> {
    if (!ip) return;
    const max = await this.settings.number(`public.${bucket}_per_ip_per_hour`, bucket === 'leads' ? 10 : 120);
    const result = await this.rateLimit.hit(`public:${bucket}:${ip}`, max, 3600);
    if (!result.allowed) throw new AppError('RATE_LIMITED', 'Trop de demandes, réessayez plus tard', 429, { retryAfter: result.resetIn });
  }

  @Post('leads')
  @HttpCode(201)
  @ApiOperation({ summary: 'Prospect : préinscription d\'un chauffeur ou demande d\'une entreprise ou d\'un partenaire (anti-robots, consentement exigé)' })
  @ZodBody(leadInputSchema)
  @ZodResponse(201, leadCreatedSchema)
  @ApiErrors(400, 401, 403, 429)
  async lead(@Body(zodPipe(leadInputSchema)) body: z.infer<typeof leadInputSchema>, @CurrentActor() actor: Actor | undefined, @ReqCtx() ctx: RequestContext) {
    await this.limit('leads', ctx.ip);
    if (!(await this.antiBot.verify(body.antiBotToken, ctx.ip))) throw AppError.forbidden('ANTI_BOT_FAILED', 'Vérification anti-robots échouée : réessayez');
    const source = actor?.kind === 'service' ? actor.name.slice(0, 30) : 'web';
    const [row] = await this.database.db
      .insert(schema.leads)
      .values({
        kind: body.kind, firstName: body.firstName, lastName: body.lastName ?? null, phone: body.phone, email: body.email?.toLowerCase() ?? null, city: body.city ?? null,
        message: body.message ?? null, language: body.language, source, consentAt: new Date(),
      })
      .returning({ id: schema.leads.id });
    this.audit.record({ action: 'public.lead_received', entity: 'leads', entityId: row!.id, after: { kind: body.kind, source } });
    return { id: row!.id, status: 'received' as const };
  }

  @Post('quotes')
  @HttpCode(201)
  @ApiOperation({ summary: 'Devis sans compte (réservation web, WordPress) : mêmes règles et même détail que les applications ; affichage seulement' })
  @ZodBody(quoteRequestSchema)
  @ZodResponse(201, quotesResponseSchema)
  @ApiErrors(400, 401, 403, 429)
  async quote(@Body(zodPipe(quoteRequestSchema)) body: z.infer<typeof quoteRequestSchema>, @ReqCtx() ctx: RequestContext) {
    await this.limit('quotes', ctx.ip);
    return this.quotes.createQuotes(body, { userId: null, language: ctx.language });
  }
}
