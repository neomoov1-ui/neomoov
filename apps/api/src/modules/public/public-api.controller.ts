/**
 * API publique limitée (prompt 12, section 7.2 groupe Public) pour le site WordPress et les pages web : prospects
 * (préinscription des chauffeurs, demandes des entreprises et partenaires) devis et adresses sans compte. Clé d'API à portée
 * `public:write` (visible dans une page web : sa portée ne donne accès à rien d'autre), limitation par adresse IP,
 * protection anti-robots sur les formulaires. Le suivi partagé (`GET /public/track/{token}`) reste dans les courses.
 */
import { isIP } from 'node:net';
import { schema } from '@neomoov/db';
import { autocompleteQuerySchema, autocompleteSuggestionSchema, leadCreatedSchema, leadInputSchema, placeDetailsQuerySchema, placeDetailsSchema, quoteRequestSchema, quotesResponseSchema } from '@neomoov/domain';
import { Body, Controller, Get, Headers, HttpCode, Inject, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { MAPS_PROVIDER, type MapsProvider } from '../../adapters/types.js';
import { AntiBotService } from '../../common/anti-bot.service.js';
import { AppError } from '../../common/app-error.js';
import { DomainEventsService } from '../../common/domain-events.js';
import { ApiErrors, ZodBody, ZodQuery, ZodResponse } from '../../common/openapi.js';
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
    private readonly events: DomainEventsService,
    @Inject(MAPS_PROVIDER) private readonly maps: MapsProvider,
  ) {}

  /** Limite par adresse IP et par heure (réglage), en plus de la limite générale par minute. */
  private async limit(bucket: 'leads' | 'quotes' | 'places', ip: string | null): Promise<void> {
    if (!ip) return;
    const max = await this.settings.number(`public.${bucket}_per_ip_per_hour`, bucket === 'leads' ? 10 : bucket === 'places' ? 600 : 120);
    const result = await this.rateLimit.hit(`public:${bucket}:${ip}`, max, 3600);
    if (!result.allowed) throw new AppError('RATE_LIMITED', 'Trop de demandes, réessayez plus tard', 429, { retryAfter: result.resetIn });
  }

  @Post('leads')
  @HttpCode(201)
  @ApiOperation({ summary: 'Prospect : préinscription d\'un chauffeur ou demande d\'une entreprise ou d\'un partenaire (anti-robots, consentement exigé)' })
  @ZodBody(leadInputSchema)
  @ZodResponse(201, leadCreatedSchema)
  @ApiErrors(400, 401, 403, 429)
  async lead(@Body(zodPipe(leadInputSchema)) body: z.infer<typeof leadInputSchema>, @CurrentActor() actor: Actor | undefined, @ReqCtx() ctx: RequestContext, @Headers('x-neomoov-visitor-ip') visitorIp?: string) {
    // Relais d'un site partenaire (clé de service) : l'adresse du visiteur transmise par le relais compte, pas celle du serveur
    // du site (sinon tout le site partagerait une seule limite) ; sans adresse valide, ni limite par adresse ni `remoteip`.
    const ip = actor?.kind === 'service' ? relayedVisitorIp(visitorIp) : ctx.ip;
    await this.limit('leads', ip);
    if (!(await this.antiBot.verify(body.antiBotToken, ip))) throw AppError.forbidden('ANTI_BOT_FAILED', 'Vérification anti-robots échouée : réessayez');
    const source = actor?.kind === 'service' ? actor.name.slice(0, 30) : 'web';
    const [row] = await this.database.db
      .insert(schema.leads)
      .values({
        kind: body.kind, firstName: body.firstName, lastName: body.lastName ?? null, phone: body.phone, email: body.email?.toLowerCase() ?? null, city: body.city ?? null,
        // L'attestation Neomoov Chauffeur Pro est consignée en tête du message ; My Hub la vérifie auprès de l'Academy.
        message: [body.academyCode ? `Attestation Neomoov Chauffeur Pro : ${body.academyCode}` : null, body.message ?? null].filter(Boolean).join('\n') || null,
        language: body.language, source, consentAt: new Date(),
      })
      .returning({ id: schema.leads.id });
    this.audit.record({ action: 'public.lead_received', entity: 'leads', entityId: row!.id, after: { kind: body.kind, source } });
    // CRM (étape 25) : synchronisation asynchrone, avec le consentement donné par le formulaire.
    this.events.emit('lead.created', { leadId: row!.id, kind: body.kind, consent: true });
    return { id: row!.id, status: 'received' as const };
  }

  @Post('quotes')
  @HttpCode(201)
  @ApiOperation({ summary: 'Devis sans compte (réservation web, WordPress) : mêmes règles et même détail que les applications ; affichage seulement. Depuis un navigateur (relais du web), au-delà d\'un volume de devis par adresse, jeton Turnstile exigé (en-tête `x-turnstile-token`, 403 `TURNSTILE_REQUIRED`)' })
  @ZodBody(quoteRequestSchema)
  @ZodResponse(201, quotesResponseSchema)
  @ApiErrors(400, 401, 403, 429)
  async quote(@Body(zodPipe(quoteRequestSchema)) body: z.infer<typeof quoteRequestSchema>, @ReqCtx() ctx: RequestContext) {
    await this.limit('quotes', ctx.ip);
    // Revue du 2 octobre 2026 (sécurité 8) : chaque devis coûte un itinéraire ; au-delà du seuil par adresse, défi anti-robots.
    // Seulement pour un navigateur (relais du web, `x-neomoov-client: web`) : un site partenaire qui appelle depuis son
    // serveur ne peut pas afficher le défi et reste soumis à la seule limite par adresse.
    if (ctx.browser) {
      await this.antiBot.challenge('public_quotes', ctx.ip, ctx.antiBotToken);
      await this.antiBot.record('public_quotes', ctx.ip);
    }
    return this.quotes.createQuotes(body, { userId: null, language: ctx.language });
  }

  @Get('places/autocomplete')
  @ApiOperation({ summary: 'Suggestions d\x27adresses pour la réservation web sans compte (même fournisseur que les applications)' })
  @ZodQuery(autocompleteQuerySchema)
  @ZodResponse(200, z.array(autocompleteSuggestionSchema))
  @ApiErrors(400, 401, 403, 429, 503)
  async autocomplete(@Query(zodPipe(autocompleteQuerySchema)) query: z.infer<typeof autocompleteQuerySchema>, @ReqCtx() ctx: RequestContext) {
    await this.limit('places', ctx.ip);
    const near = query.lat !== undefined && query.lng !== undefined ? { lat: query.lat, lng: query.lng } : undefined;
    return this.maps.autocomplete(query.input, query.sessionToken, near);
  }

  @Get('places/details')
  @ApiOperation({ summary: 'Adresse et coordonnées d\x27un lieu choisi (réservation web sans compte)' })
  @ZodQuery(placeDetailsQuerySchema)
  @ZodResponse(200, placeDetailsSchema)
  @ApiErrors(400, 401, 403, 404, 429, 503)
  async details(@Query(zodPipe(placeDetailsQuerySchema)) query: z.infer<typeof placeDetailsQuerySchema>, @ReqCtx() ctx: RequestContext) {
    await this.limit('places', ctx.ip);
    const place = await this.maps.placeDetails(query.placeId, query.sessionToken);
    return { placeId: place.placeId ?? null, address: place.formattedAddress, coordinates: { lat: place.lat, lng: place.lng } };
  }
}

/** Adresse IPv4 ou IPv6 transmise par un relais authentifié (en-tête `x-neomoov-visitor-ip`), ou null si absente ou invalide. */
export function relayedVisitorIp(value: string | undefined): string | null {
  const ip = (value ?? '').trim();
  if (!ip || ip.length > 45) return null;
  return isIP(ip) ? ip : null;
}
