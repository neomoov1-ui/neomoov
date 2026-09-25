/** Lieux et devis (section 7.2) ; simulation et relevés concurrentiels pour My Hub (D33). */
import { schema } from '@neomoov/db';
import {
  autocompleteQuerySchema, autocompleteSuggestionSchema, benchmarkInputSchema, benchmarkViewSchema, placeDetailsQuerySchema, placeDetailsSchema, quoteDetailSchema,
  quoteRequestSchema, quotesResponseSchema, simulateQuoteSchema, simulateResponseSchema, uuid, VEHICLE_CATEGORIES,
} from '@neomoov/domain';
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { MAPS_PROVIDER, type MapsProvider } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { ApiErrors, ZodBody, ZodQuery, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { DB, type Database } from '../../infra/db.module.js';
import { Audit, Authenticated, CurrentActor, CurrentUser, Owns, ReqCtx, Roles, STAFF_READ_ROLES, STAFF_WRITE_ROLES, type Actor, type RequestContext, type UserActor } from '../auth/actor.js';
import { PricingRulesService } from './pricing-rules.service.js';
import { QuotesService } from './quotes.service.js';
import { ZonesService } from './zones.service.js';

@ApiTags('places')
@ApiBearerAuth()
@Authenticated()
@Controller('places')
export class PlacesController {
  constructor(@Inject(MAPS_PROVIDER) private readonly maps: MapsProvider) {}

  @Get('autocomplete')
  @ApiOperation({ summary: 'Suggestions d\'adresses (Places), autour de la position fournie' })
  @ZodQuery(autocompleteQuerySchema)
  @ZodResponse(200, z.array(autocompleteSuggestionSchema))
  @ApiErrors(400, 401, 429, 503)
  autocomplete(@Query(zodPipe(autocompleteQuerySchema)) query: z.infer<typeof autocompleteQuerySchema>) {
    const near = query.lat !== undefined && query.lng !== undefined ? { lat: query.lat, lng: query.lng } : undefined;
    return this.maps.autocomplete(query.input, query.sessionToken, near);
  }

  @Get('details')
  @ApiOperation({ summary: 'Adresse et coordonnées d\'un lieu choisi dans les suggestions' })
  @ZodQuery(placeDetailsQuerySchema)
  @ZodResponse(200, placeDetailsSchema)
  @ApiErrors(400, 401, 404, 429, 503)
  async details(@Query(zodPipe(placeDetailsQuerySchema)) query: z.infer<typeof placeDetailsQuerySchema>) {
    const place = await this.maps.placeDetails(query.placeId, query.sessionToken);
    return { placeId: place.placeId ?? null, address: place.formattedAddress, coordinates: { lat: place.lat, lng: place.lng } };
  }
}

@ApiTags('quotes')
@ApiBearerAuth()
@Authenticated()
@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Devis : un par catégorie (toutes si aucune n\'est demandée), détail complet, validité de 5 minutes ; `estimated` en mode dégradé' })
  @ZodBody(quoteRequestSchema)
  @ZodResponse(201, quotesResponseSchema)
  @ApiErrors(400, 401, 429)
  create(@Body(zodPipe(quoteRequestSchema)) body: z.infer<typeof quoteRequestSchema>, @CurrentUser() user: UserActor, @ReqCtx() ctx: RequestContext) {
    return this.quotes.createQuotes(body, { userId: user.userId, language: ctx.language });
  }

  @Get(':id')
  @Owns('quote')
  @ApiOperation({ summary: 'Un devis persisté, avec son itinéraire' })
  @ZodResponse(200, quoteDetailSchema)
  @ApiErrors(401, 403, 404, 429)
  get(@Param('id', zodPipe(uuid)) id: string) {
    return this.quotes.getQuote(id);
  }
}

const zoneViewSchema = z.object({ id: uuid, code: z.string(), name: z.string(), type: z.string(), cityCode: z.string() });

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/pricing')
export class AdminPricingController {
  constructor(
    private readonly quotes: QuotesService,
    private readonly rules: PricingRulesService,
    private readonly zones: ZonesService,
    @Inject(DB) private readonly database: Database,
  ) {}

  @Post('simulate')
  @Roles(...STAFF_READ_ROLES)
  @HttpCode(200)
  @ApiOperation({ summary: 'Simulation de devis pour My Hub : mêmes règles, valeurs forcées possibles, rien n\'est persisté' })
  @ZodBody(simulateQuoteSchema)
  @ZodResponse(200, simulateResponseSchema)
  @ApiErrors(400, 401, 403, 429)
  simulate(@Body(zodPipe(simulateQuoteSchema)) body: z.infer<typeof simulateQuoteSchema>, @CurrentActor() actor: Actor | undefined, @ReqCtx() ctx: RequestContext) {
    return this.quotes.simulate(body, { userId: actor?.kind === 'user' ? actor.userId : null, language: ctx.language });
  }

  @Get('rules')
  @Roles(...STAFF_READ_ROLES)
  @ApiOperation({ summary: 'Règles de tarification en vigueur (assemblées depuis la base) et leur version' })
  @ApiErrors(401, 403, 429)
  async currentRules() {
    const loaded = await this.rules.rulesFor();
    return { cityCode: loaded.cityCode, timeZone: loaded.timeZone, version: loaded.version, rules: loaded.rules };
  }

  @Post('rules/refresh')
  @Roles(...STAFF_WRITE_ROLES)
  @HttpCode(204)
  @Audit('admin.pricing_rules_refreshed', 'settings')
  @ApiOperation({ summary: 'Vide les caches (règles, réglages, zones) après une modification en base' })
  @ApiErrors(401, 403, 429)
  refresh() {
    this.rules.invalidate();
    this.zones.invalidate();
  }

  @Get('zones')
  @Roles(...STAFF_READ_ROLES)
  @ApiOperation({ summary: 'Zones actives (codes à utiliser pour les relevés concurrentiels)' })
  @ZodResponse(200, z.array(zoneViewSchema))
  @ApiErrors(401, 403, 429)
  async listZones() {
    return (await this.zones.all()).map((z) => ({ id: z.id, code: z.code, name: z.name, type: z.type, cityCode: z.cityCode }));
  }

  @Get('benchmarks')
  @Roles(...STAFF_READ_ROLES)
  @ApiOperation({ summary: 'Relevés concurrentiels (D33), du plus récent au plus ancien' })
  @ZodResponse(200, z.array(benchmarkViewSchema))
  @ApiErrors(401, 403, 429)
  async listBenchmarks() {
    const rows = await this.database.db.select().from(schema.competitorBenchmarks).orderBy(desc(schema.competitorBenchmarks.observedAt)).limit(500);
    return rows.map(AdminPricingController.benchmarkView);
  }

  @Post('benchmarks')
  @Roles(...STAFF_WRITE_ROLES)
  @HttpCode(201)
  @Audit('admin.benchmark_recorded', 'competitor_benchmarks')
  @ApiOperation({ summary: 'Saisit un relevé concurrentiel (trajet témoin, plage horaire, prix Uber et Lyft observés)' })
  @ZodBody(benchmarkInputSchema)
  @ZodResponse(201, benchmarkViewSchema)
  @ApiErrors(400, 401, 403, 429)
  async recordBenchmark(@Body(zodPipe(benchmarkInputSchema)) body: z.infer<typeof benchmarkInputSchema>, @CurrentUser() user: UserActor) {
    const zones = await this.zones.all();
    for (const code of [body.originZoneCode, body.destinationZoneCode]) {
      if (!zones.some((z) => z.code === code)) throw new AppError('ZONE_UNKNOWN', `Zone inconnue : ${code}`, 400, { code });
    }
    const [row] = await this.database.db
      .insert(schema.competitorBenchmarks)
      .values({
        cityCode: zones.find((z) => z.code === body.originZoneCode)!.cityCode,
        category: body.category,
        originZoneCode: body.originZoneCode,
        destinationZoneCode: body.destinationZoneCode,
        timeWindow: body.timeWindow,
        uberPriceCents: body.uberPriceCents ?? null,
        lyftPriceCents: body.lyftPriceCents ?? null,
        observedAt: body.observedAt ? new Date(body.observedAt) : new Date(),
        source: body.source ?? 'manual',
        recordedByUserId: user.userId,
      })
      .returning();
    return AdminPricingController.benchmarkView(row!);
  }

  @Delete('benchmarks/:id')
  @Roles(...STAFF_WRITE_ROLES)
  @HttpCode(204)
  @Audit('admin.benchmark_deleted', 'competitor_benchmarks')
  @ApiOperation({ summary: 'Retire un relevé erroné' })
  @ApiErrors(401, 403, 404, 429)
  async deleteBenchmark(@Param('id', zodPipe(uuid)) id: string) {
    const rows = await this.database.db.delete(schema.competitorBenchmarks).where(eq(schema.competitorBenchmarks.id, id)).returning({ id: schema.competitorBenchmarks.id });
    if (!rows.length) throw AppError.notFound('NOT_FOUND', 'Relevé introuvable');
  }

  static benchmarkView(row: typeof schema.competitorBenchmarks.$inferSelect) {
    return {
      id: row.id,
      category: row.category as (typeof VEHICLE_CATEGORIES)[number],
      originZoneCode: row.originZoneCode,
      destinationZoneCode: row.destinationZoneCode,
      timeWindow: row.timeWindow as z.infer<typeof benchmarkViewSchema>['timeWindow'],
      uberPriceCents: row.uberPriceCents,
      lyftPriceCents: row.lyftPriceCents,
      observedAt: row.observedAt.toISOString(),
      source: row.source,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
