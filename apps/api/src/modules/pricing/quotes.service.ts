/**
 * Service de devis (sections 5.1, 5.9, 7.2, prompt 04) : itinéraire par l'adaptateur cartographique (trafic à l'heure
 * prévue, péages), zones, règles chargées de la base, moteur pur du domaine, promotions et crédits, vérification
 * concurrentielle (D33), temps d'arrivée estimé, persistance avec empreinte et validité de 5 minutes. Mode dégradé
 * (`estimated: true`) quand l'API Routes est injoignable. Le client affiche le détail renvoyé, il ne recalcule rien.
 */
import { schema } from '@neomoov/db';
import {
  benchmarkCheck, benchmarkTimeWindow, computeQuote, PricingError, type CompetitorBenchmark, type Language, type Place, type Promotion, type Quote, type QuoteDetail,
  type PaymentMethod, type QuoteRequest, type QuoteView, type QuotesResponse, type SimulateQuote, type VehicleCategory,
} from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, getTableColumns, gt, gte, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { MAPS_PROVIDER, type GeoPoint, type MapsProvider, type RouteResult } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { sha256Hex } from '../../common/crypto.js';
import { haversineMeters } from '../../common/geo.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AuditService } from '../audit/audit.service.js';
import { lineLabel } from './labels.js';
import { DEFAULT_CITY, PricingRulesService } from './pricing-rules.service.js';
import { PromotionsService } from './promotions.service.js';
import { ZonesService } from './zones.service.js';

export interface QuoteActor {
  userId: string | null;
  language: Language;
}

interface Overrides {
  distanceMeters?: number | undefined;
  durationSeconds?: number | undefined;
  tollsCents?: number | undefined;
  clientCompletedRides?: number | undefined;
  creditsAvailableCents?: number | undefined;
  ignoreLeadTime?: boolean | undefined;
}

interface RouteInfo extends RouteResult {
  estimated: boolean;
}

export interface BenchmarkSummary {
  category: VehicleCategory;
  referenceCents: number | null;
  exceeded: boolean;
}

export type SimulateResponse = QuotesResponse & { pricingRulesVersion: string; benchmark: BenchmarkSummary[] };

type QuoteRow = typeof schema.quotes.$inferSelect;

const point = (p: Place): GeoPoint => ({ lat: p.coordinates.lat, lng: p.coordinates.lng });

/** « 2 heures », « 90 minutes » : le préavis vient d'un réglage, le message le suit. */
function describeLead(seconds: number): string {
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return `${hours} heure${hours > 1 ? 's' : ''}`;
  }
  return `${Math.round(seconds / 60)} minutes`;
}

@Injectable()
export class QuotesService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(MAPS_PROVIDER) private readonly maps: MapsProvider,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly pricingRules: PricingRulesService,
    private readonly zones: ZonesService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly promotions: PromotionsService,
  ) {}

  private get db() {
    return this.database.db;
  }

  /** POST /v1/quotes : un devis par catégorie (toutes si aucune n'est demandée), persistés. Les références concurrentielles restent internes. */
  async createQuotes(input: QuoteRequest, actor: QuoteActor): Promise<QuotesResponse> {
    const { pricingRulesVersion: _version, benchmark: _benchmark, ...response } = await this.compute(input, actor, {}, true);
    return response;
  }

  /** POST /v1/admin/pricing/simulate : mêmes calculs, valeurs forcées possibles, rien n'est persisté ni journalisé. */
  async simulate(input: SimulateQuote, actor: QuoteActor): Promise<SimulateResponse> {
    const { distanceMeters, durationSeconds, tollsCents, clientCompletedRides, creditsAvailableCents, ignoreLeadTime, ...request } = input;
    return this.compute(request, actor, { distanceMeters, durationSeconds, tollsCents, clientCompletedRides, creditsAvailableCents, ignoreLeadTime }, false);
  }

  private async compute(input: QuoteRequest, actor: QuoteActor, overrides: Overrides, persist: boolean): Promise<SimulateResponse> {
    const loaded = await this.pricingRules.rulesFor(DEFAULT_CITY);
    const now = new Date();
    const pickupAt = await this.resolvePickup(input.requestedAt, now, overrides.ignoreLeadTime === true);
    const origin = point(input.origin);
    const destination = point(input.destination);
    const stops = input.stops.map(point);

    const [originZone, destinationZone, originAirport, destinationAirport] = await Promise.all([
      this.zones.zoneOf(origin), this.zones.zoneOf(destination), this.zones.isAirport(origin), this.zones.isAirport(destination),
    ]);
    if (!originZone && !destinationZone) throw new AppError('OUT_OF_SERVICE_AREA', 'Ce trajet est hors de notre zone de service', 400);

    const categories: VehicleCategory[] = input.category ? [input.category] : (loaded.rules.categories.map((c) => c.category) as VehicleCategory[]);
    const [route, client] = await Promise.all([this.routeFor(origin, destination, stops, pickupAt, overrides), this.clientOf(actor.userId)]);
    const promotionCandidates = await this.promotions.candidates(input.options.promoCode, client?.id ?? null);
    const clientCompletedRides = overrides.clientCompletedRides ?? client?.rideCount ?? 0;
    const creditsAvailableCents = overrides.creditsAvailableCents ?? (actor.userId ? await this.creditsOf(actor.userId) : 0);
    const [marginPpm, maxAgeDays, validitySeconds] = await Promise.all([
      this.settings.number('pricing.benchmark_margin_ppm', 50_000),
      this.settings.number('pricing.benchmark_max_age_days', 14),
      this.settings.number('pricing.quote_validity_seconds', 300),
    ]);
    const benchmarks = originZone && destinationZone ? await this.benchmarksFor(originZone.code, destinationZone.code, categories, benchmarkTimeWindow(pickupAt, loaded.timeZone), now, maxAgeDays) : [];
    const validUntil = new Date(now.getTime() + validitySeconds * 1000);
    // Chauffeur favori (5.10, D37) : vérifié pour un vrai devis ; la simulation My Hub garde le supplément tel quel.
    const favourite = persist && input.options.favouriteDriverId ? await this.favouriteFor(client?.id ?? null, input.options.favouriteDriverId, Boolean(input.requestedAt)) : null;

    // Calcul pur, catégorie par catégorie (moins de 100 ms hors cartographie).
    const promotionBase = { now, distanceMeters: route.distanceMeters, originZone: originZone?.code ?? null, destinationZone: destinationZone?.code ?? null, pickupAt, timeZone: loaded.timeZone, clientCompletedRides };
    const computed = categories.map((category) => {
      // Promotions (5.9) : le code saisi s'il est admissible pour cette catégorie, sinon une promotion automatique
      // (troisième, dixième course). Une promotion réservée à d'autres catégories n'est simplement pas appliquée ici.
      const applicablePromotion = this.promotions.choose(promotionCandidates, promotionBase, category);
      let quote: Quote;
      try {
        quote = computeQuote(
          {
            category,
            distanceMeters: route.distanceMeters,
            durationSeconds: route.durationSeconds,
            pickupAt,
            originZone: originZone?.code ?? null,
            destinationZone: destinationZone?.code ?? null,
            airport: originAirport || destinationAirport,
            options: {
              flex: input.options.flex,
              priority: input.options.priority,
              favouriteDriver: Boolean(input.options.favouriteDriverId) && favourite !== 'unavailable',
              childSeat: input.options.childSeat,
              bulkyLuggage: input.options.luggage,
              stops: stops.length,
            },
            promotion: applicablePromotion,
            clientCompletedRides,
            creditsAvailableCents,
            tollsCents: route.tollsCents,
          },
          loaded.rules,
        );
      } catch (error) {
        if (error instanceof PricingError) throw new AppError(error.code, error.message, 400, { category });
        throw error;
      }
      // Favori indisponible : aucun supplément, et l'option est signalée ignorée (message affiché par l'application).
      if (favourite === 'unavailable' && !quote.ignoredOptions.includes('favouriteDriver')) quote.ignoredOptions.push('favouriteDriver');
      const checked = benchmarkCheck(quote, benchmarks, loaded.rules, { originZone: originZone?.code, destinationZone: destinationZone?.code, pickupAt, now, timeZone: loaded.timeZone, marginPpm, maxAgeDays });
      return { category, before: quote, checked };
    });

    // Événement pour la direction (D33) : seulement pour un vrai devis, jamais pour une simulation My Hub.
    if (persist) {
      for (const { category, before, checked } of computed) {
        if (!checked.exceeded) continue;
        this.logger.warn({ category, referenceCents: checked.referenceCents, totalCents: checked.quote.totalCents, originZone: originZone?.code, destinationZone: destinationZone?.code }, 'benchmark_exceeded');
        this.audit.record({ action: 'pricing.benchmark_exceeded', entity: 'quotes', after: { category, referenceCents: checked.referenceCents, totalBeforeCents: before.totalCents, totalAfterCents: checked.quote.totalCents, alignmentDiscountCents: checked.quote.alignmentDiscountCents } });
      }
    }

    // Temps d'arrivée par catégorie, en parallèle (chaque recherche est indépendante).
    const etas = await Promise.all(computed.map(({ category }) => this.etaFor(origin, category)));
    const views = computed.map(({ category, checked }, index) => {
      const etaSeconds = etas[index] ?? null;
      const fingerprint = sha256Hex(JSON.stringify({ v: loaded.version, category, origin, destination, stops, pickupAt: pickupAt.toISOString(), route: { d: route.distanceMeters, t: route.durationSeconds, tolls: route.tollsCents, estimated: route.estimated }, lines: checked.quote.lines, total: checked.quote.totalCents }));
      return this.toView(checked.quote, { id: '00000000-0000-4000-8000-000000000000', route, pickupAt: input.requestedAt ? pickupAt : null, etaSeconds, validUntil, fingerprint, language: actor.language });
    });

    if (persist) {
      // Une seule instruction pour toutes les catégories.
      const rows = await this.db
        .insert(schema.quotes)
        .values(
          computed.map(({ category, checked }, index) => ({
            clientId: client?.id ?? null,
            createdByUserId: actor.userId,
            cityCode: loaded.cityCode,
            category,
            originAddress: input.origin.address,
            originPosition: origin,
            destinationAddress: input.destination.address,
            destinationPosition: destination,
            stops: input.stops,
            distanceMeters: route.distanceMeters,
            durationSeconds: route.durationSeconds,
            requestedAt: input.requestedAt ? pickupAt : null,
            lines: views[index]!.lines,
            fareCents: checked.quote.fareCents,
            serviceFeeCents: checked.quote.serviceFeeCents,
            regulatoryFeeCents: checked.quote.regulatoryFeeCents,
            gstCents: checked.quote.gstCents,
            qstCents: checked.quote.qstCents,
            creditsAppliedCents: checked.quote.creditsAppliedCents,
            totalCents: checked.quote.totalCents,
            maxConsentedCents: checked.quote.maxConsentedCents,
            options: input.options,
            promoCode: checked.quote.promotionCode,
            flatRateCode: checked.quote.flatRateCode,
            ignoredOptions: checked.quote.ignoredOptions,
            tollsCents: checked.quote.tollsCents,
            alignmentDiscountCents: checked.quote.alignmentDiscountCents,
            promotionDiscountCents: checked.quote.promotionDiscountCents,
            amountDueCents: checked.quote.amountDueCents,
            estimated: route.estimated,
            etaSeconds: etas[index] ?? null,
            originZoneCode: originZone?.code ?? null,
            destinationZoneCode: destinationZone?.code ?? null,
            validUntil,
            fingerprint: views[index]!.fingerprint,
            pricingRulesVersion: loaded.version,
          })),
        )
        .returning({ id: schema.quotes.id, category: schema.quotes.category });
      for (const row of rows) {
        const view = views.find((v) => v.category === row.category);
        if (view) view.id = row.id;
      }
    }

    return {
      origin: input.origin,
      destination: input.destination,
      stops: input.stops,
      requestedAt: input.requestedAt ? pickupAt.toISOString() : null,
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      estimated: route.estimated,
      polyline: route.polyline ?? null,
      quotes: views,
      paymentMethods: await this.availablePaymentMethods(Boolean(input.requestedAt)),
      pricingRulesVersion: loaded.version,
      benchmark: computed.map(({ category, checked }) => ({ category, referenceCents: checked.referenceCents, exceeded: checked.exceeded })),
    };
  }

  /**
   * Modes proposables au client (5.6) : la carte dans l'application toujours ; espèces, Interac ou terminal seulement si
   * au moins un chauffeur actif les accepte (en ligne pour une course immédiate, acceptant les planifiées pour une
   * réservation). Une seule ville en V1 : la zone est la ville.
   */
  private async availablePaymentMethods(scheduled: boolean): Promise<PaymentMethod[]> {
    const [row] = await this.db.execute<{ cash: boolean | null; interac: boolean | null; terminal: boolean | null }>(sql`
      SELECT bool_or(accepts_cash) AS cash, bool_or(accepts_interac) AS interac, bool_or(accepts_terminal) AS terminal
      FROM drivers WHERE status = 'active' AND ${scheduled ? sql`accepts_scheduled` : sql`is_online`}`);
    return ['card_app', 'apple_pay', 'google_pay', ...(row?.cash ? (['cash'] as const) : []), ...(row?.interac ? (['interac'] as const) : []), ...(row?.terminal ? (['terminal'] as const) : [])];
  }

  /** Préavis (D32) : au moins `rides.min_lead_seconds` avant la prise en charge, au plus `rides.max_lead_days` ; sans heure, course immédiate seulement si le drapeau l'autorise. */
  private async resolvePickup(requestedAt: string | undefined, now: Date, ignoreLeadTime: boolean): Promise<Date> {
    const [minLead, maxLeadDays] = await Promise.all([this.settings.number('rides.min_lead_seconds', 7200), this.settings.number('rides.max_lead_days', 30)]);
    const tooShort = () =>
      new AppError('LEAD_TIME_TOO_SHORT', `Réservez au moins ${describeLead(minLead)} à l'avance`, 400, { minLeadSeconds: minLead, earliestPickupAt: new Date(now.getTime() + minLead * 1000).toISOString() });
    if (!requestedAt) {
      if (ignoreLeadTime || this.env.FEATURE_IMMEDIATE_RIDES) return now;
      throw tooShort();
    }
    const pickupAt = new Date(requestedAt);
    if (ignoreLeadTime) return pickupAt;
    if (pickupAt.getTime() - now.getTime() < minLead * 1000) throw tooShort();
    if (pickupAt.getTime() - now.getTime() > maxLeadDays * 86_400_000) {
      throw new AppError('LEAD_TIME_TOO_LONG', `Réservez au plus ${maxLeadDays} jours à l'avance`, 400, { maxLeadDays });
    }
    return pickupAt;
  }

  /** Itinéraire réel (trafic à l'heure prévue, péages) ; sinon estimation interne, marquée `estimated`. */
  private async routeFor(origin: GeoPoint, destination: GeoPoint, stops: GeoPoint[], pickupAt: Date, overrides: Overrides): Promise<RouteInfo> {
    if (overrides.distanceMeters !== undefined && overrides.durationSeconds !== undefined) {
      return { distanceMeters: overrides.distanceMeters, durationSeconds: overrides.durationSeconds, tollsCents: overrides.tollsCents ?? 0, estimated: false };
    }
    if (overrides.distanceMeters !== undefined || overrides.durationSeconds !== undefined) {
      throw new AppError('VALIDATION_ERROR', 'Distance et durée forcées ensemble, ou aucune des deux', 400);
    }
    try {
      const route = await this.maps.route({ origin, destination, waypoints: stops, departureTime: pickupAt });
      return { ...route, tollsCents: overrides.tollsCents ?? route.tollsCents, estimated: false };
    } catch (error) {
      this.logger.warn({ err: error }, 'Itinéraire indisponible : devis en mode dégradé (estimation interne)');
      const [factorBps, speedKmh] = await Promise.all([this.settings.number('pricing.degraded_distance_factor_bps', 13_000), this.settings.number('pricing.degraded_speed_kmh', 30)]);
      const points = [origin, ...stops, destination];
      let meters = 0;
      for (let i = 1; i < points.length; i += 1) meters += haversineMeters(points[i - 1]!, points[i]!);
      const distanceMeters = Math.round((meters * factorBps) / 10_000);
      return { distanceMeters, durationSeconds: Math.round((distanceMeters / 1000 / speedKmh) * 3600), tollsCents: overrides.tollsCents ?? 0, estimated: true };
    }
  }

  private async clientOf(userId: string | null): Promise<{ id: string; rideCount: number } | null> {
    if (!userId) return null;
    const [row] = await this.db.select({ id: schema.clients.id, rideCount: schema.clients.rideCount }).from(schema.clients).where(eq(schema.clients.userId, userId)).limit(1);
    return row ?? null;
  }

  private async creditsOf(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`coalesce(sum(${schema.credits.remainingCents}), 0)::int` })
      .from(schema.credits)
      .where(and(eq(schema.credits.userId, userId), ne(schema.credits.origin, 'driver_pack'), gt(schema.credits.remainingCents, 0), or(isNull(schema.credits.expiresAt), gt(schema.credits.expiresAt, new Date()))));
    return row?.total ?? 0;
  }

  /**
   * Chauffeur favori demandé (5.10, D37) : il doit être un favori du client, lu dans les deux tables comme le fait la
   * répartition, sinon 400. Disponible : actif et acceptant les réservations (en ligne pour une course immédiate).
   */
  private async favouriteFor(clientId: string | null, driverId: string, scheduled: boolean): Promise<'available' | 'unavailable'> {
    const [row] = clientId
      ? await this.db.execute<{ status: string; accepts_scheduled: boolean; is_online: boolean }>(sql`
          SELECT d.status, d.accepts_scheduled, d.is_online FROM drivers d
          WHERE d.id = ${driverId}::uuid
            AND (EXISTS (SELECT 1 FROM favorite_drivers f WHERE f.client_id = ${clientId}::uuid AND f.driver_id = d.id)
              OR EXISTS (SELECT 1 FROM client_driver_links l WHERE l.client_id = ${clientId}::uuid AND l.driver_id = d.id AND l.favorite_since IS NOT NULL))`)
      : [];
    if (!row) throw new AppError('FAVOURITE_NOT_ALLOWED', 'Ce chauffeur ne fait pas partie de vos favoris', 400, { driverId });
    return row.status === 'active' && (scheduled ? row.accepts_scheduled : row.is_online) ? 'available' : 'unavailable';
  }

  /** Relevés concurrentiels récents pour ces zones (dans les deux sens), ces catégories et cette plage horaire (D33). */
  private async benchmarksFor(originZone: string, destinationZone: string, categories: VehicleCategory[], timeWindow: string, now: Date, maxAgeDays: number): Promise<CompetitorBenchmark[]> {
    const since = new Date(now.getTime() - maxAgeDays * 86_400_000);
    const rows = await this.db
      .select()
      .from(schema.competitorBenchmarks)
      .where(
        and(
          gte(schema.competitorBenchmarks.observedAt, since),
          inArray(schema.competitorBenchmarks.category, categories),
          eq(schema.competitorBenchmarks.timeWindow, timeWindow),
          or(
            and(eq(schema.competitorBenchmarks.originZoneCode, originZone), eq(schema.competitorBenchmarks.destinationZoneCode, destinationZone)),
            and(eq(schema.competitorBenchmarks.originZoneCode, destinationZone), eq(schema.competitorBenchmarks.destinationZoneCode, originZone)),
          ),
        ),
      )
      .orderBy(desc(schema.competitorBenchmarks.observedAt))
      .limit(200);
    return rows.map((r) => ({ category: r.category, originZone: r.originZoneCode, destinationZone: r.destinationZoneCode, timeWindow: r.timeWindow as CompetitorBenchmark['timeWindow'], uberPriceCents: r.uberPriceCents, lyftPriceCents: r.lyftPriceCents, observedAt: r.observedAt, source: r.source }));
  }

  /** Temps d'arrivée du chauffeur en ligne le plus proche de cette catégorie (temps provisoire), ou null. */
  private async etaFor(origin: GeoPoint, category: VehicleCategory): Promise<number | null> {
    try {
      const radius = await this.settings.number('pricing.eta_search_radius_m', 10_000);
      const rows = await this.db.execute<{ driver_id: string; position: string }>(
        sql`SELECT dp.driver_id, ST_AsGeoJSON(dp.position) AS position FROM driver_presence dp
            JOIN drivers d ON d.id = dp.driver_id
            WHERE dp.is_available AND dp.category = ${category} AND d.status = 'active'
              AND ST_DWithin(dp.position, ST_SetSRID(ST_MakePoint(${origin.lng}, ${origin.lat}), 4326)::geography, ${radius})
            ORDER BY dp.position <-> ST_SetSRID(ST_MakePoint(${origin.lng}, ${origin.lat}), 4326)::geography
            LIMIT 5`,
      );
      if (!rows.length) return null;
      const origins = rows.map((r) => {
        const parsed = JSON.parse(r.position) as { coordinates: [number, number] };
        return { lng: parsed.coordinates[0], lat: parsed.coordinates[1] };
      });
      const reachable = (await this.maps.etaMatrix(origins, origin)).filter((e) => Number.isFinite(e) && e >= 0);
      return reachable.length ? Math.round(Math.min(...reachable)) : null;
    } catch (error) {
      this.logger.warn({ err: error }, 'Temps d\'arrivée estimé indisponible pour ce devis');
      return null;
    }
  }

  /** Détail affiché : lignes du moteur, promotion, frais (avant remise d'alignement), redevance, taxes, crédits ; leur somme vaut le reste à payer. */
  private toView(quote: Quote, extra: { id: string; route: RouteInfo; pickupAt: Date | null; etaSeconds: number | null; validUntil: Date; fingerprint: string; language: Language }): QuoteView {
    const label = (code: string) => lineLabel(code, extra.language);
    const lines: QuoteView['lines'] = quote.lines.map((l) => ({ code: l.code, label: label(l.code), amountCents: l.amountCents }));
    if (quote.promotionDiscountCents > 0) lines.push({ code: 'promotion', label: label('promotion'), amountCents: -quote.promotionDiscountCents });
    // La ligne « benchmark_alignment » (négative) est déjà dans les lignes du moteur : les frais s'affichent avant remise.
    lines.push({ code: 'service_fee', label: label('service_fee'), amountCents: quote.serviceFeeCents + quote.alignmentDiscountCents });
    lines.push({ code: 'regulatory_fee', label: label('regulatory_fee'), amountCents: quote.regulatoryFeeCents });
    lines.push({ code: 'gst', label: label('gst'), amountCents: quote.gstCents });
    lines.push({ code: 'qst', label: label('qst'), amountCents: quote.qstCents });
    if (quote.creditsAppliedCents > 0) lines.push({ code: 'credits', label: label('credits'), amountCents: -quote.creditsAppliedCents });
    return {
      id: extra.id,
      category: quote.category as VehicleCategory,
      distanceMeters: extra.route.distanceMeters,
      durationSeconds: extra.route.durationSeconds,
      lines,
      fareCents: quote.fareCents,
      serviceFeeCents: quote.serviceFeeCents,
      regulatoryFeeCents: quote.regulatoryFeeCents,
      tollsCents: quote.tollsCents,
      promotionCode: quote.promotionCode,
      promotionDiscountCents: quote.promotionDiscountCents,
      alignmentDiscountCents: quote.alignmentDiscountCents,
      subtotalCents: quote.subtotalCents,
      gstCents: quote.gstCents,
      qstCents: quote.qstCents,
      totalCents: quote.totalCents,
      creditsAppliedCents: quote.creditsAppliedCents,
      amountDueCents: quote.amountDueCents,
      maxConsentedCents: quote.maxConsentedCents,
      flatRateCode: quote.flatRateCode,
      ignoredOptions: quote.ignoredOptions,
      estimated: extra.route.estimated,
      eta: { seconds: extra.etaSeconds, status: extra.etaSeconds === null ? 'on_availability' : 'estimated' },
      requestedAt: extra.pickupAt?.toISOString() ?? null,
      validUntil: extra.validUntil.toISOString(),
      fingerprint: extra.fingerprint,
    };
  }

  /** GET /v1/quotes/{id} : le devis persisté, avec son itinéraire. */
  async getQuote(id: string): Promise<QuoteDetail> {
    // Les colonnes géographiques sont lues en GeoJSON (le type personnalisé ne décode pas le WKB brut).
    const { originPosition: _o, destinationPosition: _d, ...columns } = getTableColumns(schema.quotes);
    const [row] = await this.db
      .select({ ...columns, originGeo: sql<string>`ST_AsGeoJSON(${schema.quotes.originPosition})`, destinationGeo: sql<string>`ST_AsGeoJSON(${schema.quotes.destinationPosition})` })
      .from(schema.quotes)
      .where(eq(schema.quotes.id, id))
      .limit(1);
    if (!row) throw AppError.notFound('QUOTE_NOT_FOUND', 'Devis introuvable');
    const { originGeo, destinationGeo, ...quote } = row;
    return QuotesService.rowToDetail(quote, originGeo, destinationGeo);
  }

  static rowToDetail(q: Omit<QuoteRow, 'originPosition' | 'destinationPosition'>, originGeoJson: string, destinationGeoJson: string): QuoteDetail {
    const parse = (geo: string) => {
      const parsed = JSON.parse(geo) as { coordinates: [number, number] };
      return { lat: parsed.coordinates[1], lng: parsed.coordinates[0] };
    };
    return {
      id: q.id,
      category: q.category,
      distanceMeters: q.distanceMeters,
      durationSeconds: q.durationSeconds,
      lines: q.lines as QuoteView['lines'],
      fareCents: q.fareCents,
      serviceFeeCents: q.serviceFeeCents,
      regulatoryFeeCents: q.regulatoryFeeCents,
      tollsCents: q.tollsCents,
      promotionCode: q.promoCode,
      promotionDiscountCents: q.promotionDiscountCents,
      alignmentDiscountCents: q.alignmentDiscountCents,
      subtotalCents: q.fareCents - q.promotionDiscountCents + q.serviceFeeCents + q.regulatoryFeeCents + q.tollsCents,
      gstCents: q.gstCents,
      qstCents: q.qstCents,
      totalCents: q.totalCents,
      creditsAppliedCents: q.creditsAppliedCents,
      amountDueCents: q.amountDueCents,
      maxConsentedCents: q.maxConsentedCents,
      flatRateCode: q.flatRateCode,
      ignoredOptions: q.ignoredOptions as string[],
      estimated: q.estimated,
      eta: { seconds: q.etaSeconds, status: q.etaSeconds === null ? 'on_availability' : 'estimated' },
      requestedAt: q.requestedAt?.toISOString() ?? null,
      validUntil: q.validUntil.toISOString(),
      fingerprint: q.fingerprint,
      origin: { address: q.originAddress, coordinates: parse(originGeoJson) },
      destination: { address: q.destinationAddress, coordinates: parse(destinationGeoJson) },
      stops: q.stops as Place[],
    };
  }
}
