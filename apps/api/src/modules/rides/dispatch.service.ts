/**
 * Répartition automatique et négociation encadrée (prompt 06, sections 5.4 et 5.5, amendements v1.1).
 *
 * - Course immédiate (drapeau `FEATURE_IMMEDIATE_RIDES`) : candidats en ligne par rayons successifs (`dispatch.search_radii_m`),
 *   temps d'arrivée par matrice pour les plus proches, score du domaine, offres séquentielles de `dispatch.offer_seconds`
 *   jusqu'à `dispatch.candidates_per_wave` par vague, puis `no_driver` quand la zone est épuisée.
 * - Réservation planifiée (D40) : dès la réservation, offres simultanées aux chauffeurs disponibles sur le créneau pendant
 *   `dispatch.scheduled_window_seconds`, le favori seul d'abord (`dispatch.favourite_exclusive_seconds`) ; sans confirmation,
 *   la fenêtre se ferme et le signal `scheduled.dispatch_due` (60 minutes avant) relance une fenêtre.
 * - Négociation (`FEATURE_NEGOTIATION`) : la proposition P' est diffusée aux `negotiation.candidates` meilleurs candidats avec
 *   le prix affiché P ; accepter P', contre-proposer une fois entre P' et P (au-dessus de P seulement avec
 *   `FEATURE_NEGOTIATION_ABOVE_MAX`, motif et acceptation écrite du client), ou décliner ; repli automatique au mode fixe à
 *   la fin de la fenêtre.
 * - Réattribution (annulation du chauffeur, absence de mouvement `dispatch.no_movement_seconds` après l'attribution, ou
 *   décision de l'opérateur) : nouvelle recherche avec exclusion du chauffeur et priorité.
 *
 * Tout l'état est en base (`ride_dispatches`, `ride_offers`, `ride_events`) ; `tick(now)` fait avancer les fenêtres avec une
 * horloge simulable. L'attribution reste celle de `RidesService.assign` (verrou de la course : la première acceptation
 * gagne). Un verrou Redis (ou en mémoire sans Redis) sérialise les pas d'une même course.
 */
import { schema } from '@neomoov/db';
import {
  agreedPrice, clampProposal, experimentGroupFor, negotiationIneligibility, nextRadius, parseDispatchWeights, parseSearchRadii, scoreCandidates, selectWave, subtotalForTotal,
  validateCounter, type ClientOfferView, type DispatchCandidate, type DispatchSummary, type DispatchTickReport, type DriverOfferView, type NegotiationMode, type OfferCounterInput,
  type RideView, type SearchRadius, type VehicleCategory,
} from '@neomoov/domain';
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { MAPS_PROVIDER, type GeoPoint, type MapsProvider } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { DomainEventsService } from '../../common/domain-events.js';
import { haversineMeters } from '../../common/geo.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { DB, type Database } from '../../infra/db.module.js';
import { REDIS } from '../../infra/redis.module.js';
import { AuditService } from '../audit/audit.service.js';
import type { UserActor } from '../auth/actor.js';
import { PricingRulesService } from '../pricing/pricing-rules.service.js';
import { ZonesService } from '../pricing/zones.service.js';
import { NotificationsOutbox } from './notifications-outbox.js';
import { PresenceService } from './presence.service.js';
import { dispatchSummaryOf, parseGeoPoint, type RideRow } from './ride-view.js';
import { RidesService, SYSTEM_ACTOR, type ActorRef } from './rides.service.js';

type DispatchRow = typeof schema.rideDispatches.$inferSelect;
/** Champs à poser sur `ride_dispatches` ; le compteur d'offres s'incrémente en SQL (pas de lecture puis écriture). */
type DispatchUpdate = Partial<Omit<typeof schema.rideDispatches.$inferInsert, 'offersSent'>> & { offersSent?: number | SQL };
type OfferRow = typeof schema.rideOffers.$inferSelect;
type StartReason = 'requested' | 'reassign' | 'scheduled_due' | 'release' | 'proposal' | 'operator';

interface DispatchConfig {
  radii: SearchRadius[];
  waveSeconds: number;
  offerSeconds: number;
  candidatesPerWave: number;
  chainMaxSeconds: number;
  noMovementSeconds: number;
  noMovementMeters: number;
  weights: ReturnType<typeof parseDispatchWeights>;
  etaCandidates: number;
  fallbackSpeedMps: number;
  emptySweepsMax: number;
  scheduledWindowSeconds: number;
  scheduledCandidatesMax: number;
  favouriteExclusiveSeconds: number;
  scheduledConflictMinutes: number;
  negotiationWindowSeconds: number;
  negotiationImmediateWindowSeconds: number;
  negotiationCandidates: number;
  floorPpm: number;
  ceilingPpm: number;
  requiredDocuments: string[];
  requireActivePack: boolean;
}

/** Candidat lu en base (une requête ensembliste), avant score. */
type CandidateRow = {
  driver_id: string;
  user_id: string;
  rating: string;
  ride_count: number;
  vehicle_id: string | null;
  category: VehicleCategory | null;
  distance_m: number | string | null;
  position: string | null;
  last_ride_at: string | null;
  shift_started_at: string | null;
  is_unlimited: boolean;
  is_client_favourite: boolean;
};

interface Candidate {
  driverId: string;
  userId: string;
  distanceMeters: number | null;
  etaSeconds: number | null;
  rating: number;
  idleMinutes: number;
  isUnlimited: boolean;
  isRequestedFavourite: boolean;
  isClientFavourite: boolean;
  position: GeoPoint | null;
}

/** Candidat mémorisé dans `ride_dispatches.candidate_ids` (vague en cours). */
interface CandidateRef {
  driverId: string;
  etaSeconds: number | null;
  distanceMeters: number | null;
  score: number;
}

interface OfferOptions {
  wave: number;
  type: 'fixed' | 'client_proposal';
  expiresAt: Date;
  now: Date;
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

@Injectable()
export class DispatchService implements OnModuleInit, OnModuleDestroy {
  private tickTimer: NodeJS.Timeout | null = null;
  private runner = false;
  private subscriptions: Array<() => void> = [];
  private readonly localLocks = new Map<string, Promise<void>>();
  /** Compteurs du processus (tests, santé). */
  readonly stats = { started: 0, offers: 0, ticks: 0, noDriver: 0 };

  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(REDIS) private readonly redis: Redis | null,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    @Inject(MAPS_PROVIDER) private readonly maps: MapsProvider,
    private readonly settings: SettingsService,
    private readonly events: DomainEventsService,
    private readonly rides: RidesService,
    private readonly presence: PresenceService,
    private readonly pricingRules: PricingRulesService,
    private readonly zones: ZonesService,
    private readonly outbox: NotificationsOutbox,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.database.db;
  }

  /** Sans Redis, le processus de l'API est seul : il porte la répartition. Avec Redis, c'est le worker (`enableRunner`). */
  onModuleInit() {
    if (this.env.DISPATCH_MODE === 'auto' && !this.redis) this.enableRunner();
  }

  onModuleDestroy() {
    this.disableRunner();
  }

  /** Vrai si ce processus porte la répartition (abonnements et battement). */
  get running(): boolean {
    return this.runner;
  }

  /** Abonne le processus aux événements de course et lance le battement périodique (une seule fois par processus). */
  enableRunner(): void {
    if (this.runner) return;
    this.runner = true;
    const guard = (rideId: string, what: string) => (error: unknown) => this.logger.error({ err: error, rideId }, what);
    this.subscriptions = [
      this.events.on('ride.requested', (p) => {
        void this.start(p.rideId, { reason: 'requested' }).catch(guard(p.rideId, 'Répartition impossible'));
      }),
      this.events.on('ride.reassign_requested', (p) => {
        const data = (p.data ?? {}) as { previousDriverId?: string; source?: string };
        // Les retraits par l'opérateur ou la surveillance relancent eux-mêmes la recherche.
        if (data.source && data.source !== 'driver') return;
        this.start(p.rideId, { reason: 'reassign', priority: true, excludeDriverIds: data.previousDriverId ? [data.previousDriverId] : [] }).catch(guard(p.rideId, 'Réattribution impossible'));
      }),
      this.events.on('scheduled.dispatch_due', (p) => {
        void this.start(p.rideId, { reason: 'scheduled_due' }).catch(guard(p.rideId, 'Attribution planifiée impossible'));
      }),
      this.events.on('ride.cancelled_by_client', (p) => this.cancel(p.rideId, 'cancelled').catch(guard(p.rideId, 'Arrêt de la répartition impossible'))),
      this.events.on('ride.assigned', (p) => {
        if (p.driverId) this.markAssigned(p.rideId, p.driverId).catch(guard(p.rideId, 'Clôture de la répartition impossible'));
      }),
    ];
    if (this.env.DISPATCH_TICK_MS > 0) {
      this.tickTimer = setInterval(() => void this.tick(new Date()).catch((error: unknown) => this.logger.error({ err: error }, 'Battement de la répartition en échec')), this.env.DISPATCH_TICK_MS);
      this.tickTimer.unref();
    }
    this.logger.info({ tickMs: this.env.DISPATCH_TICK_MS }, 'Répartition automatique active dans ce processus');
  }

  /** Retire ce processus de la répartition (worker sans Redis, arrêt). */
  disableRunner(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    for (const off of this.subscriptions) off();
    this.subscriptions = [];
    this.runner = false;
  }

  // --- Réglages ---

  private async config(): Promise<DispatchConfig> {
    const s = this.settings;
    const [radii, waveSeconds, offerSeconds, candidatesPerWave, chainMaxSeconds, noMovementSeconds, noMovementMeters, weights, etaCandidates, fallbackSpeedMps, emptySweepsMax] = await Promise.all([
      s.get<unknown>('dispatch.search_radii_m', null), s.number('dispatch.wave_seconds', 20), s.number('dispatch.offer_seconds', 15), s.number('dispatch.candidates_per_wave', 5),
      s.number('dispatch.chain_max_seconds', 300), s.number('dispatch.no_movement_seconds', 180), s.number('dispatch.no_movement_meters', 50), s.get<unknown>('dispatch.score_weights', null),
      s.number('dispatch.eta_candidates', 10), s.number('dispatch.fallback_speed_mps', 8), s.number('dispatch.empty_sweeps_max', 3),
    ]);
    const [scheduledWindowSeconds, scheduledCandidatesMax, favouriteExclusiveSeconds, scheduledConflictMinutes, negotiationWindowSeconds, negotiationImmediateWindowSeconds, negotiationCandidates, floorPpm, ceilingPpm, requiredDocuments, requireActivePack] = await Promise.all([
      s.number('dispatch.scheduled_window_seconds', 600), s.number('dispatch.scheduled_candidates_max', 20), s.number('dispatch.favourite_exclusive_seconds', 120), s.number('dispatch.scheduled_conflict_minutes', 90),
      s.number('negotiation.window_seconds', 600), s.number('negotiation.immediate_window_seconds', 60), s.number('negotiation.candidates', 5), s.number('pricing.negotiation_floor_ppm', 700_000),
      s.number('pricing.negotiation_ceiling_ppm', 1_300_000), s.get<unknown>('drivers.required_documents', ['licence', 'insurance', 'registration']), s.get<boolean>('drivers.require_active_pack', false),
    ]);
    return {
      radii: parseSearchRadii(radii), waveSeconds, offerSeconds, candidatesPerWave, chainMaxSeconds, noMovementSeconds, noMovementMeters, weights: parseDispatchWeights(weights), etaCandidates, fallbackSpeedMps, emptySweepsMax,
      scheduledWindowSeconds, scheduledCandidatesMax, favouriteExclusiveSeconds, scheduledConflictMinutes, negotiationWindowSeconds, negotiationImmediateWindowSeconds, negotiationCandidates, floorPpm, ceilingPpm,
      requiredDocuments: Array.isArray(requiredDocuments) ? requiredDocuments.filter((d): d is string => typeof d === 'string' && /^[a-z_]+$/.test(d)) : [], requireActivePack: requireActivePack === true,
    };
  }

  // --- Verrou par course ---

  private async withLock<T>(rideId: string, fn: () => Promise<T>): Promise<T> {
    if (this.redis) {
      const key = `dispatch:lock:${rideId}`;
      const token = `${process.pid}-${Date.now()}-${Math.random()}`;
      const deadline = Date.now() + 5000;
      while (!(await this.redis.set(key, token, 'PX', 10_000, 'NX'))) {
        if (Date.now() > deadline) throw AppError.conflict('DISPATCH_BUSY', 'La course est en cours de traitement, réessayez');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      try {
        return await fn();
      } finally {
        await this.redis.eval('if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) end return 0', 1, key, token).catch(() => undefined);
      }
    }
    const previous = this.localLocks.get(rideId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = previous.then(() => current);
    this.localLocks.set(rideId, chained);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.localLocks.get(rideId) === chained) this.localLocks.delete(rideId);
    }
  }

  // --- Lecture ---

  async dispatchOf(rideId: string): Promise<DispatchRow | null> {
    const [row] = await this.db.select().from(schema.rideDispatches).where(eq(schema.rideDispatches.rideId, rideId)).limit(1);
    return row ?? null;
  }

  private async pendingOffers(rideId: string): Promise<OfferRow[]> {
    return this.db.select().from(schema.rideOffers).where(and(eq(schema.rideOffers.rideId, rideId), eq(schema.rideOffers.state, 'sent'))).orderBy(asc(schema.rideOffers.sentAt));
  }

  // --- Démarrage, arrêt, clôture ---

  /** Ouvre (ou rouvre) la répartition d'une course demandée et fait immédiatement le premier pas. */
  async start(rideId: string, options: { reason: StartReason; priority?: boolean; excludeDriverIds?: string[]; mode?: NegotiationMode }): Promise<DispatchRow | null> {
    if (this.env.DISPATCH_MODE === 'manual' && options.reason === 'requested') return null;
    return this.withLock(rideId, async () => {
      const ride = await this.rides.getRide(rideId);
      if (ride.driverId || !['requested', 'offering'].includes(ride.state)) return null;
      const now = new Date();
      const existing = await this.dispatchOf(rideId);
      const excluded = [...new Set([...((existing?.excludedDriverIds as string[] | null) ?? []), ...(options.excludeDriverIds ?? [])])];
      const negotiationOn = this.env.FEATURE_NEGOTIATION && ride.negotiationMode === 'negotiation';
      const mode: NegotiationMode = options.mode ?? (negotiationOn ? 'negotiation' : 'fixed');
      const priority = options.priority ?? existing?.priority ?? false;
      const values: DispatchUpdate = {
        mode, status: 'searching', wave: 0, radiusIndex: priority ? 0 : -1, candidateIds: [], candidateCursor: 0, excludedDriverIds: excluded, offeredDriverIds: [], priority,
        nextActionAt: now, startedAt: now, endedAt: null, heldReason: null, heldByUserId: null, assignedAt: null, assignedPosition: null, movementCheckedAt: null, negotiationEndsAt: null, lastError: null, updatedAt: now,
      };
      await this.db.insert(schema.rideDispatches).values({ rideId, ...values }).onConflictDoUpdate({ target: schema.rideDispatches.rideId, set: values });
      for (const offer of await this.pendingOffers(rideId)) await this.closeOffer(offer, 'withdrawn', now);
      await this.rides.mark(rideId, 'dispatch_started', SYSTEM_ACTOR, { reason: options.reason, mode, priority, excluded });
      this.stats.started += 1;
      await this.step(rideId, now);
      return this.dispatchOf(rideId);
    });
  }

  /** Arrêt de la répartition (annulation du client, course close). */
  async cancel(rideId: string, status: 'cancelled' | 'assigned' = 'cancelled'): Promise<void> {
    const now = new Date();
    for (const offer of await this.pendingOffers(rideId)) await this.closeOffer(offer, status === 'assigned' ? 'assigned_elsewhere' : 'cancelled', now);
    await this.db.update(schema.rideDispatches).set({ status, endedAt: now, nextActionAt: null, updatedAt: now }).where(and(eq(schema.rideDispatches.rideId, rideId), inArray(schema.rideDispatches.status, ['searching', 'offering', 'held', 'window_closed'])));
    this.emitDispatch(rideId);
  }

  /** Après une attribution (offre acceptée, confirmation d'une planifiée, attribution forcée) : offres restantes closes, surveillance du départ armée. */
  async markAssigned(rideId: string, driverId: string): Promise<void> {
    const now = new Date();
    const cfg = await this.config();
    for (const offer of await this.pendingOffers(rideId)) if (offer.driverId !== driverId) await this.closeOffer(offer, 'assigned_elsewhere', now);
    const position = await this.presence.positionOf(driverId);
    const values: DispatchUpdate = { status: 'assigned', assignedAt: now, assignedPosition: position, movementCheckedAt: null, nextActionAt: new Date(now.getTime() + cfg.noMovementSeconds * 1000), endedAt: now, updatedAt: now };
    await this.db.insert(schema.rideDispatches).values({ rideId, ...values }).onConflictDoUpdate({ target: schema.rideDispatches.rideId, set: values });
    this.emitDispatch(rideId);
  }

  // --- Battement ---

  /** Fait avancer toutes les répartitions dues à l'instant `now` (offres échues, prochains pas, fenêtres closes, surveillance du départ). */
  async tick(now: Date = new Date(), maxIterations = 50): Promise<DispatchTickReport> {
    this.stats.ticks += 1;
    const report: DispatchTickReport = { expiredOffers: 0, steps: 0, fallbacks: 0, noMovement: 0, iterations: 0 };
    for (let i = 0; i < maxIterations; i += 1) {
      report.iterations += 1;
      let progressed = false;
      const expired = await this.db.select().from(schema.rideOffers).where(and(eq(schema.rideOffers.state, 'sent'), lte(schema.rideOffers.expiresAt, now))).limit(200);
      for (const offer of expired) {
        await this.closeOffer(offer, 'timeout', now);
        report.expiredOffers += 1;
        progressed = true;
      }
      const due = await this.db
        .select()
        .from(schema.rideDispatches)
        .where(and(inArray(schema.rideDispatches.status, ['searching', 'offering']), lte(schema.rideDispatches.nextActionAt, now)))
        .orderBy(desc(schema.rideDispatches.priority), asc(schema.rideDispatches.nextActionAt))
        .limit(100);
      for (const d of due) {
        await this.withLock(d.rideId, () => this.step(d.rideId, now)).catch((error: unknown) => this.failed(d.rideId, error));
        const after = await this.dispatchOf(d.rideId);
        if (d.mode === 'negotiation' && after?.mode === 'fixed') report.fallbacks += 1;
        report.steps += 1;
        progressed = true;
      }
      const stuck = await this.db
        .select()
        .from(schema.rideDispatches)
        .where(and(eq(schema.rideDispatches.status, 'assigned'), isNull(schema.rideDispatches.movementCheckedAt), lte(schema.rideDispatches.nextActionAt, now)))
        .limit(100);
      for (const d of stuck) {
        if (await this.checkMovement(d, now).catch((error: unknown) => (this.failed(d.rideId, error), false))) report.noMovement += 1;
        progressed = true;
      }
      if (!progressed) break;
    }
    return report;
  }

  private async failed(rideId: string, error: unknown): Promise<void> {
    this.logger.error({ err: error, rideId }, 'Pas de répartition en échec');
    const message = error instanceof Error ? error.message.slice(0, 500) : String(error);
    // La répartition sera retentée au battement suivant ; l'erreur est visible dans My Hub.
    await this.db.update(schema.rideDispatches).set({ lastError: message, nextActionAt: new Date(Date.now() + 5000), updatedAt: new Date() }).where(eq(schema.rideDispatches.rideId, rideId)).catch(() => undefined);
  }

  // --- Un pas ---

  private async step(rideId: string, now: Date): Promise<void> {
    const d = await this.dispatchOf(rideId);
    if (!d || !['searching', 'offering'].includes(d.status)) return;
    const ride = await this.rides.getRide(rideId);
    if (ride.driverId || !['requested', 'offering'].includes(ride.state)) {
      await this.cancel(rideId, ride.driverId ? 'assigned' : 'cancelled');
      return;
    }
    const cfg = await this.config();
    if (d.mode === 'negotiation') await this.stepNegotiation(d, ride, now, cfg);
    else if (ride.type === 'scheduled') await this.stepScheduled(d, ride, now, cfg);
    else await this.stepImmediate(d, ride, now, cfg);
    this.emitDispatch(rideId);
  }

  /** Mode fixe, course immédiate : offres séquentielles, vagues par rayon, épuisement de la zone. */
  private async stepImmediate(d: DispatchRow, ride: RideRow, now: Date, cfg: DispatchConfig): Promise<void> {
    const pending = await this.pendingOffers(ride.id);
    const live = pending.filter((o) => o.expiresAt.getTime() > now.getTime());
    if (live.length) {
      await this.save(d.rideId, { nextActionAt: live[0]!.expiresAt, status: 'offering' });
      return;
    }
    for (const offer of pending) await this.closeOffer(offer, 'timeout', now);
    let current = ride;
    let candidates = d.candidateIds as CandidateRef[];
    let cursor = d.candidateCursor;
    let radiusIndex = d.radiusIndex;
    let wave = d.wave;
    const offered = new Set(d.offeredDriverIds as string[]);
    const excluded = d.excludedDriverIds as string[];
    for (let guard = 0; guard < cfg.radii.length + 2; guard += 1) {
      while (cursor < candidates.length) {
        const ref = candidates[cursor]!;
        cursor += 1;
        const candidate = await this.candidateById(current, ref, cfg);
        if (!candidate) continue;
        const expiresAt = new Date(now.getTime() + cfg.offerSeconds * 1000);
        await this.sendOffer(current, candidate, { wave, type: 'fixed', expiresAt, now });
        offered.add(ref.driverId);
        await this.save(d.rideId, { status: 'offering', wave, radiusIndex, candidateIds: candidates, candidateCursor: cursor, offeredDriverIds: [...offered], offersSent: sql`${schema.rideDispatches.offersSent} + 1`, nextActionAt: expiresAt });
        return;
      }
      const next = nextRadius(radiusIndex, cfg.radii);
      if (!next) {
        // Zone épuisée. Sans aucune offre envoyée, quelques balayages de plus (chauffeurs qui passent en ligne) avant d'abandonner.
        const sweeps = Math.floor(wave / Math.max(1, cfg.radii.length));
        if (offered.size === 0 && sweeps < cfg.emptySweepsMax) {
          await this.save(d.rideId, { status: 'searching', wave, radiusIndex: -1, candidateIds: [], candidateCursor: 0, nextActionAt: new Date(now.getTime() + cfg.waveSeconds * 1000) });
          return;
        }
        await this.exhaust(d.rideId, current, now, { wave, offered: offered.size });
        return;
      }
      radiusIndex = next.index;
      wave += 1;
      const found = await this.searchImmediateCandidates(current, next.radius, [...excluded, ...offered], cfg);
      candidates = found;
      cursor = 0;
      await this.rides.mark(current.id, 'dispatch_wave', SYSTEM_ACTOR, { wave, radiusMeters: next.radius, candidates: found.map((c) => ({ driverId: c.driverId, score: c.score, etaSeconds: c.etaSeconds })) });
      if (candidates.length && current.state === 'offering' && wave > 1) {
        await this.rides.systemTransition(current.id, 'new_wave', { wave });
        current = await this.rides.getRide(current.id);
      }
    }
    await this.save(d.rideId, { wave, radiusIndex, candidateIds: candidates, candidateCursor: cursor, nextActionAt: new Date(now.getTime() + cfg.waveSeconds * 1000) });
  }

  /** Réservation planifiée (D40) : fenêtre d'offres simultanées, favori seul d'abord, fermeture sans confirmation. */
  private async stepScheduled(d: DispatchRow, ride: RideRow, now: Date, cfg: DispatchConfig): Promise<void> {
    const windowEnd = d.negotiationEndsAt;
    if (windowEnd && now.getTime() >= windowEnd.getTime()) {
      for (const offer of await this.pendingOffers(ride.id)) await this.closeOffer(offer, 'timeout', now);
      await this.save(d.rideId, { status: 'window_closed', candidateIds: [], candidateCursor: 0, nextActionAt: null, endedAt: now });
      await this.rides.mark(ride.id, 'offer_window_closed', SYSTEM_ACTOR, { offered: (d.offeredDriverIds as string[]).length });
      if (ride.state === 'offering') await this.rides.systemTransition(ride.id, 'new_wave', { reason: 'window_closed' });
      return;
    }
    const offered = new Set(d.offeredDriverIds as string[]);
    if (!windowEnd) {
      const found = await this.searchScheduledCandidates(ride, d.excludedDriverIds as string[], cfg);
      if (!found.length) {
        await this.save(d.rideId, { status: 'window_closed', nextActionAt: null, endedAt: now });
        await this.rides.mark(ride.id, 'no_candidates', SYSTEM_ACTOR, { type: 'scheduled' });
        return;
      }
      const end = new Date(now.getTime() + cfg.scheduledWindowSeconds * 1000);
      const favourite = found.find((c) => c.isRequestedFavourite || c.isClientFavourite);
      if (favourite && cfg.favouriteExclusiveSeconds > 0) {
        const exclusiveEnd = new Date(Math.min(end.getTime(), now.getTime() + cfg.favouriteExclusiveSeconds * 1000));
        await this.sendOffer(ride, favourite, { wave: 1, type: 'fixed', expiresAt: exclusiveEnd, now });
        offered.add(favourite.driverId);
        const rest = found.filter((c) => c.driverId !== favourite.driverId);
        await this.save(d.rideId, { status: 'offering', wave: 1, negotiationEndsAt: end, candidateIds: rest, candidateCursor: 0, offeredDriverIds: [...offered], offersSent: sql`${schema.rideDispatches.offersSent} + 1`, nextActionAt: exclusiveEnd });
        return;
      }
      const sent = await this.broadcast(ride, found, { wave: 1, type: 'fixed', expiresAt: end, now });
      for (const id of sent) offered.add(id);
      await this.save(d.rideId, { status: 'offering', wave: 1, negotiationEndsAt: end, candidateIds: [], candidateCursor: 0, offeredDriverIds: [...offered], offersSent: sql`${schema.rideDispatches.offersSent} + ${sent.length}`, nextActionAt: end });
      return;
    }
    const remaining = (d.candidateIds as CandidateRef[]).filter((c) => !offered.has(c.driverId));
    const pending = await this.pendingOffers(ride.id);
    const livePending = pending.filter((o) => o.expiresAt.getTime() > now.getTime());
    if (remaining.length && !livePending.length) {
      // Le favori n'a pas répondu dans son délai : les autres reçoivent l'offre jusqu'à la fin de la fenêtre.
      for (const offer of pending) await this.closeOffer(offer, 'timeout', now);
      const found = (await this.searchScheduledCandidates(ride, [...(d.excludedDriverIds as string[]), ...offered], cfg)).filter((c) => remaining.some((r) => r.driverId === c.driverId));
      const sent = await this.broadcast(ride, found, { wave: 2, type: 'fixed', expiresAt: windowEnd, now });
      for (const id of sent) offered.add(id);
      await this.save(d.rideId, { wave: 2, candidateIds: [], candidateCursor: 0, offeredDriverIds: [...offered], offersSent: sql`${schema.rideDispatches.offersSent} + ${sent.length}`, nextActionAt: windowEnd });
      return;
    }
    await this.save(d.rideId, { nextActionAt: livePending.length ? new Date(Math.min(windowEnd.getTime(), ...livePending.map((o) => o.expiresAt.getTime()))) : windowEnd });
  }

  /** Négociation : diffusion simultanée de P' et P aux meilleurs candidats, puis repli au mode fixe à la fin de la fenêtre. */
  private async stepNegotiation(d: DispatchRow, ride: RideRow, now: Date, cfg: DispatchConfig): Promise<void> {
    const windowEnd = d.negotiationEndsAt;
    if (windowEnd && now.getTime() >= windowEnd.getTime()) {
      for (const offer of await this.pendingOffers(ride.id)) await this.closeOffer(offer, 'timeout', now);
      await this.db.update(schema.rides).set({ negotiationMode: 'fixed' }).where(eq(schema.rides.id, ride.id));
      await this.rides.mark(ride.id, 'negotiation_fallback', SYSTEM_ACTOR, { proposedTotalCents: ride.proposedTotalCents, displayedTotalCents: ride.quotedTotalCents });
      const recipient = await this.rides.recipientOf(ride);
      await this.outbox.queue({ ...recipient, template: 'ride.negotiation_fallback', data: { rideId: ride.id, totalCents: ride.quotedTotalCents } });
      await this.save(d.rideId, { mode: 'fixed', status: 'searching', wave: 0, radiusIndex: -1, candidateIds: [], candidateCursor: 0, offeredDriverIds: [], negotiationEndsAt: null, nextActionAt: now });
      const fresh = (await this.dispatchOf(ride.id))!;
      const reloaded = await this.rides.getRide(ride.id);
      if (reloaded.type === 'scheduled') await this.stepScheduled(fresh, reloaded, now, cfg);
      else await this.stepImmediate(fresh, reloaded, now, cfg);
      return;
    }
    if (!windowEnd) {
      const excluded = d.excludedDriverIds as string[];
      const found = ride.type === 'scheduled' ? await this.searchScheduledCandidates(ride, excluded, cfg) : await this.searchAnyRadius(ride, excluded, cfg);
      const chosen = selectWave(found, cfg.negotiationCandidates);
      const seconds = ride.type === 'scheduled' ? cfg.negotiationWindowSeconds : cfg.negotiationImmediateWindowSeconds;
      const end = new Date(now.getTime() + seconds * 1000);
      if (!chosen.length) {
        await this.rides.mark(ride.id, 'no_candidates', SYSTEM_ACTOR, { type: 'negotiation' });
        await this.save(d.rideId, { negotiationEndsAt: end, nextActionAt: end });
        return;
      }
      const sent = await this.broadcast(ride, chosen, { wave: 1, type: 'client_proposal', expiresAt: end, now });
      await this.rides.mark(ride.id, 'negotiation_opened', SYSTEM_ACTOR, { proposedTotalCents: ride.proposedTotalCents, displayedTotalCents: ride.quotedTotalCents, candidates: sent.length, endsAt: end.toISOString() });
      await this.save(d.rideId, { status: 'offering', wave: 1, negotiationEndsAt: end, offeredDriverIds: sent, offersSent: sql`${schema.rideDispatches.offersSent} + ${sent.length}`, nextActionAt: end });
      return;
    }
    await this.save(d.rideId, { nextActionAt: windowEnd });
  }

  private async exhaust(rideId: string, ride: RideRow, now: Date, data: Record<string, unknown>): Promise<void> {
    await this.save(rideId, { status: 'exhausted', candidateIds: [], candidateCursor: 0, nextActionAt: null, endedAt: now });
    await this.rides.systemTransition(rideId, 'no_driver_found', data);
    this.stats.noDriver += 1;
    this.logger.warn({ rideId, publicNumber: ride.publicNumber, ...data }, 'Aucun chauffeur disponible');
  }

  private async save(rideId: string, set: DispatchUpdate): Promise<void> {
    await this.db.update(schema.rideDispatches).set({ ...set, updatedAt: new Date() }).where(eq(schema.rideDispatches.rideId, rideId));
  }

  private emitDispatch(rideId: string): void {
    void this.dispatchOf(rideId)
      .then((d) => {
        if (d) this.events.emit('dispatch.updated', { rideId, status: d.status, wave: d.wave, offersSent: d.offersSent, nextActionAt: d.nextActionAt });
      })
      .catch(() => undefined);
  }

  // --- Candidats ---

  private premiumContext(ride: RideRow, airport: boolean): boolean {
    return ride.reservedCategory !== 'neo_premium' || Boolean(ride.organizationId) || airport;
  }

  /** Filtres communs de la section 5.4, en SQL : statut, documents exigés, pack (si exigé), solde, suspension, pas d'offre en attente ailleurs. */
  private eligibilityFilters(cfg: DispatchConfig, rideId: string) {
    const documents = cfg.requiredDocuments.length
      ? sql`AND NOT EXISTS (SELECT 1 FROM unnest(${sql.raw(`ARRAY[${cfg.requiredDocuments.map((t) => `'${t}'`).join(',')}]::text[]`)}) AS req(type)
             WHERE NOT EXISTS (SELECT 1 FROM driver_documents dd WHERE dd.driver_id = d.id AND dd.type::text = req.type AND dd.status = 'approved' AND (dd.expires_on IS NULL OR dd.expires_on >= current_date)))`
      : sql``;
    const pack = cfg.requireActivePack ? sql`AND EXISTS (SELECT 1 FROM pack_purchases pp WHERE pp.driver_id = d.id AND pp.status = 'active' AND (pp.rides_remaining IS NULL OR pp.rides_remaining > 0 OR pp.auto_renew))` : sql``;
    return sql`d.status = 'active' ${documents} ${pack}
      AND NOT EXISTS (SELECT 1 FROM driver_balances b WHERE b.driver_id = d.id AND b.suspended_for_balance_at IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM sanctions s WHERE s.driver_id = d.id AND s.type = 'suspension' AND (s.ends_at IS NULL OR s.ends_at > now()))
      AND NOT EXISTS (SELECT 1 FROM ride_offers o WHERE o.driver_id = d.id AND o.state = 'sent' AND o.expires_at > now() AND o.ride_id <> ${rideId}::uuid)`;
  }

  /** Un chauffeur ne reçoit que des demandes compatibles avec les modes de paiement qu'il accepte (amendement v1.1). */
  private paymentFilter(ride: RideRow) {
    if (ride.paymentChoice !== 'pay_driver_after') return sql``;
    if (ride.paymentMethod === 'cash') return sql`AND d.accepts_cash`;
    if (ride.paymentMethod === 'interac') return sql`AND d.accepts_interac`;
    if (ride.paymentMethod === 'terminal') return sql`AND d.accepts_terminal`;
    return sql``;
  }

  private favouriteOf(ride: RideRow): { requested: string | null; clientFavourite: ReturnType<typeof sql> } {
    const requested = (ride.options as { favouriteDriverId?: string } | null)?.favouriteDriverId ?? null;
    const clientFavourite = ride.clientId
      ? sql`(EXISTS (SELECT 1 FROM client_driver_links l WHERE l.client_id = ${ride.clientId}::uuid AND l.driver_id = d.id AND l.favorite_since IS NOT NULL) OR EXISTS (SELECT 1 FROM favorite_drivers f WHERE f.client_id = ${ride.clientId}::uuid AND f.driver_id = d.id))`
      : sql`false`;
    return { requested, clientFavourite };
  }

  private toCandidates(rows: CandidateRow[], favouriteRequested: string | null, now: Date): Candidate[] {
    return rows.map((r) => {
      const since = r.last_ride_at ?? r.shift_started_at;
      const idleMinutes = since ? Math.max(0, (now.getTime() - new Date(since).getTime()) / 60_000) : 60;
      return {
        driverId: r.driver_id, userId: r.user_id, position: r.position ? parseGeoPoint(r.position) : null, distanceMeters: r.distance_m === null ? null : Math.round(Number(r.distance_m)), etaSeconds: null,
        rating: Number(r.rating), idleMinutes, isUnlimited: r.is_unlimited, isRequestedFavourite: favouriteRequested === r.driver_id, isClientFavourite: r.is_client_favourite,
      };
    });
  }

  /** Lignes des chauffeurs en ligne (ou en fin de course à moins de `chain_max_seconds` de l'origine), catégorie égale ou supérieure, dans le rayon. */
  private async immediateRows(ride: RideRow, cfg: DispatchConfig, filter: { radius: SearchRadius; excluded: string[]; onlyDriverId?: string }): Promise<CandidateRow[]> {
    const origin = parseGeoPoint(ride.originGeo);
    const { clientFavourite } = this.favouriteOf(ride);
    const chainMeters = Math.round(cfg.chainMaxSeconds * cfg.fallbackSpeedMps);
    const point = sql`ST_SetSRID(ST_MakePoint(${origin.lng}::float, ${origin.lat}::float), 4326)::geography`;
    const radiusFilter = filter.radius === null ? sql`` : sql`AND ST_DWithin(p.position::geography, ${point}, ${filter.radius}::float)`;
    const excludedFilter = filter.excluded.length ? sql`AND d.id NOT IN (${sql.join(filter.excluded.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``;
    const onlyFilter = filter.onlyDriverId ? sql`AND d.id = ${filter.onlyDriverId}::uuid` : sql``;
    const query = sql`
      SELECT d.id AS driver_id, d.user_id, d.rating_average AS rating, d.ride_count, p.vehicle_id, p.category, ST_AsGeoJSON(p.position) AS position,
             ST_Distance(p.position::geography, ${point}) AS distance_m,
             (SELECT max(r.updated_at) FROM rides r WHERE r.driver_id = d.id AND r.state IN ('completed', 'rated')) AS last_ride_at,
             (SELECT s.started_at FROM driver_shifts s WHERE s.driver_id = d.id AND s.ended_at IS NULL ORDER BY s.started_at DESC LIMIT 1) AS shift_started_at,
             EXISTS (SELECT 1 FROM pack_purchases pp WHERE pp.driver_id = d.id AND pp.status = 'active' AND pp.pack_code = 'unlimited') AS is_unlimited,
             ${clientFavourite} AS is_client_favourite
      FROM driver_presence p
      JOIN drivers d ON d.id = p.driver_id
      JOIN vehicle_categories vc ON vc.code = p.category
      WHERE ${this.eligibilityFilters(cfg, ride.id)}
        AND vc.rank >= (SELECT rank FROM vehicle_categories WHERE code = ${ride.reservedCategory})
        AND (p.is_available OR (p.current_ride_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM rides cr WHERE cr.id = p.current_ride_id AND cr.state = 'in_progress'
                AND ST_DWithin(cr.destination_position::geography, ${point}, ${chainMeters}::float))))
        ${radiusFilter} ${excludedFilter} ${onlyFilter} ${this.paymentFilter(ride)}
      ORDER BY distance_m ASC
      LIMIT 60`;
    return this.db.execute<CandidateRow>(query);
  }

  /** Candidats d'une vague : les plus proches reçoivent un temps d'arrivée par matrice, puis score et sélection. */
  private async searchImmediateCandidates(ride: RideRow, radius: SearchRadius, excluded: string[], cfg: DispatchConfig): Promise<CandidateRef[]> {
    const rows = await this.immediateRows(ride, cfg, { radius, excluded });
    if (!rows.length) return [];
    const origin = parseGeoPoint(ride.originGeo);
    const now = new Date();
    const candidates = this.toCandidates(rows, this.favouriteOf(ride).requested, now);
    const closest = candidates.slice(0, cfg.etaCandidates).filter((c) => c.position);
    if (closest.length) {
      try {
        const etas = await this.maps.etaMatrix(closest.map((c) => c.position!), origin);
        closest.forEach((c, i) => {
          c.etaSeconds = etas[i] ?? null;
        });
      } catch (error) {
        this.logger.warn({ err: error, rideId: ride.id }, 'Matrice des temps d\'arrivée indisponible : estimation par la distance');
      }
    }
    const airport = (await this.zones.isAirport(origin)) || (await this.zones.isAirport(parseGeoPoint(ride.destinationGeo)));
    const scored = scoreCandidates(candidates.map((c): DispatchCandidate => ({ ...c, zoneImbalance: 0 })), { premiumContext: this.premiumContext(ride, airport), fallbackSpeedMps: cfg.fallbackSpeedMps }, cfg.weights);
    return selectWave(scored, cfg.candidatesPerWave).map((s) => ({ driverId: s.driverId, etaSeconds: s.etaSeconds, distanceMeters: s.distanceMeters, score: s.score }));
  }

  /** Négociation d'une course immédiate : premiers candidats trouvés en élargissant le rayon. */
  private async searchAnyRadius(ride: RideRow, excluded: string[], cfg: DispatchConfig): Promise<Candidate[]> {
    for (const radius of cfg.radii) {
      const refs = await this.searchImmediateCandidates(ride, radius, excluded, cfg);
      if (refs.length) {
        const candidates: Candidate[] = [];
        for (const ref of refs) {
          const c = await this.candidateById(ride, ref, cfg);
          if (c) candidates.push(c);
        }
        if (candidates.length) return candidates;
      }
    }
    return [];
  }

  /** Revérifie un candidat au moment de l'offre (encore en ligne, disponible, sans offre en attente ailleurs). */
  private async candidateById(ride: RideRow, ref: CandidateRef, cfg: DispatchConfig): Promise<Candidate | null> {
    const rows = await this.immediateRows(ride, cfg, { radius: null, excluded: [], onlyDriverId: ref.driverId });
    const candidate = this.toCandidates(rows, this.favouriteOf(ride).requested, new Date())[0];
    return candidate ? { ...candidate, etaSeconds: ref.etaSeconds, distanceMeters: ref.distanceMeters ?? candidate.distanceMeters } : null;
  }

  /** Réservation planifiée : chauffeurs actifs qui acceptent les planifiées, catégorie conforme, sans conflit d'horaire ; favoris d'abord. */
  private async searchScheduledCandidates(ride: RideRow, excluded: string[], cfg: DispatchConfig): Promise<Candidate[]> {
    const { requested, clientFavourite } = this.favouriteOf(ride);
    const excludedFilter = excluded.length ? sql`AND d.id NOT IN (${sql.join(excluded.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``;
    const requestedAt = (ride.requestedAt ?? new Date()).toISOString();
    const query = sql`
      SELECT d.id AS driver_id, d.user_id, d.rating_average AS rating, d.ride_count, v.id AS vehicle_id, v.category, ST_AsGeoJSON(p.position) AS position, NULL::float AS distance_m,
             (SELECT max(r.updated_at) FROM rides r WHERE r.driver_id = d.id AND r.state IN ('completed', 'rated')) AS last_ride_at,
             NULL::timestamptz AS shift_started_at,
             EXISTS (SELECT 1 FROM pack_purchases pp WHERE pp.driver_id = d.id AND pp.status = 'active' AND pp.pack_code = 'unlimited') AS is_unlimited,
             ${clientFavourite} AS is_client_favourite
      FROM drivers d
      JOIN vehicles v ON v.id = d.current_vehicle_id AND v.status = 'active'
      JOIN vehicle_categories vc ON vc.code = v.category
      LEFT JOIN driver_presence p ON p.driver_id = d.id
      WHERE ${this.eligibilityFilters(cfg, ride.id)}
        AND d.accepts_scheduled
        AND vc.rank >= (SELECT rank FROM vehicle_categories WHERE code = ${ride.reservedCategory})
        AND NOT EXISTS (SELECT 1 FROM rides r2 WHERE r2.driver_id = d.id AND r2.id <> ${ride.id}::uuid AND r2.type = 'scheduled' AND r2.state IN ('assigned', 'en_route', 'arrived', 'in_progress')
                        AND r2.requested_at BETWEEN ${requestedAt}::timestamptz - make_interval(mins => ${cfg.scheduledConflictMinutes}::int) AND ${requestedAt}::timestamptz + make_interval(mins => ${cfg.scheduledConflictMinutes}::int))
        ${excludedFilter} ${this.paymentFilter(ride)}
      ORDER BY (d.id = ${requested ?? NIL_UUID}::uuid) DESC, is_client_favourite DESC, d.rating_average DESC, d.ride_count ASC
      LIMIT ${cfg.scheduledCandidatesMax}::int`;
    const rows = await this.db.execute<CandidateRow>(query);
    const candidates = this.toCandidates(rows, requested, new Date());
    const scored = scoreCandidates(candidates.map((c): DispatchCandidate => ({ ...c, etaSeconds: null, distanceMeters: null, zoneImbalance: 0 })), { premiumContext: this.premiumContext(ride, false), fallbackSpeedMps: cfg.fallbackSpeedMps }, cfg.weights);
    const byId = new Map(candidates.map((c) => [c.driverId, c]));
    return scored.map((s) => byId.get(s.driverId)!);
  }

  // --- Offres ---

  /** Passe la course en `offering` avant une première offre, et renvoie la ligne à jour. */
  private async ensureOffering(ride: RideRow, data: Record<string, unknown>): Promise<RideRow> {
    if (ride.state !== 'requested') return ride;
    await this.rides.systemTransition(ride.id, 'offers_sent', data);
    return this.rides.getRide(ride.id);
  }

  private async broadcast(ride: RideRow, candidates: Candidate[], options: OfferOptions): Promise<string[]> {
    const sent: string[] = [];
    if (!candidates.length) return sent;
    const current = await this.ensureOffering(ride, { wave: options.wave, type: options.type, candidates: candidates.length });
    for (const candidate of candidates) {
      try {
        await this.sendOffer(current, candidate, options);
        sent.push(candidate.driverId);
      } catch (error) {
        this.logger.warn({ err: error, rideId: ride.id, driverId: candidate.driverId }, 'Offre non envoyée');
      }
    }
    return sent;
  }

  /** Tarif du chauffeur pour un total donné : le sous-total retrouvé depuis le total, moins les frais fixes du devis. */
  private async fareForTotal(ride: RideRow, totalCents: number): Promise<number> {
    const { rules } = await this.pricingRules.rulesFor(ride.cityCode);
    const subtotal = subtotalForTotal(totalCents, rules) ?? totalCents;
    return Math.max(0, subtotal - (ride.serviceFeeCents ?? 0) - (ride.regulatoryFeeCents ?? 0) - ride.tollsCents);
  }

  private async sendOffer(ride: RideRow, candidate: Candidate, options: OfferOptions): Promise<OfferRow> {
    const current = await this.ensureOffering(ride, { wave: options.wave, type: options.type });
    const negotiation = options.type === 'client_proposal';
    const proposed = negotiation ? current.proposedTotalCents : null;
    const driverFareCents = proposed !== null ? await this.fareForTotal(current, proposed) : (current.fareCents ?? 0);
    const [offer] = await this.db
      .insert(schema.rideOffers)
      .values({
        rideId: current.id, driverId: candidate.driverId, wave: options.wave, type: options.type, state: 'sent', driverFareCents, proposedTotalCents: proposed, displayedTotalCents: negotiation ? current.quotedTotalCents : null,
        pickupDistanceMeters: candidate.distanceMeters, pickupSeconds: candidate.etaSeconds, sentAt: options.now, expiresAt: options.expiresAt,
      })
      .returning();
    await this.rides.mark(current.id, 'offer_sent', SYSTEM_ACTOR, { offerId: offer!.id, driverId: candidate.driverId, wave: options.wave, type: options.type, expiresAt: options.expiresAt.toISOString(), pickupSeconds: candidate.etaSeconds, proposedTotalCents: proposed });
    this.stats.offers += 1;
    this.events.emit('offer.sent', { offerId: offer!.id, rideId: current.id, driverId: candidate.driverId, driverUserId: candidate.userId, wave: options.wave, type: options.type, expiresAt: options.expiresAt, proposedTotalCents: proposed });
    await this.outbox.queue({ recipientUserId: candidate.userId, template: 'offer.new', data: { offerId: offer!.id, rideId: current.id, expiresAt: options.expiresAt.toISOString() } });
    return offer!;
  }

  private async closeOffer(offer: OfferRow, reason: 'timeout' | 'assigned_elsewhere' | 'withdrawn' | 'cancelled', now: Date): Promise<void> {
    const state = reason === 'timeout' || reason === 'assigned_elsewhere' ? 'expired' : 'withdrawn';
    const [closed] = await this.db.update(schema.rideOffers).set({ state, respondedAt: now }).where(and(eq(schema.rideOffers.id, offer.id), eq(schema.rideOffers.state, 'sent'))).returning({ id: schema.rideOffers.id });
    if (!closed) return;
    const [driver] = await this.db.select({ userId: schema.drivers.userId }).from(schema.drivers).where(eq(schema.drivers.id, offer.driverId)).limit(1);
    await this.rides.mark(offer.rideId, 'offer_expired', SYSTEM_ACTOR, { offerId: offer.id, driverId: offer.driverId, reason });
    this.events.emit('offer.expired', { offerId: offer.id, rideId: offer.rideId, driverId: offer.driverId, driverUserId: driver?.userId ?? '', reason });
  }

  private async offerOfDriver(offerId: string, actor: UserActor): Promise<{ offer: OfferRow; driverId: string }> {
    const driver = await this.presence.driverOfUser(actor.userId);
    const [offer] = await this.db.select().from(schema.rideOffers).where(eq(schema.rideOffers.id, offerId)).limit(1);
    if (!offer || offer.driverId !== driver.id) throw AppError.notFound('OFFER_NOT_FOUND', 'Offre introuvable');
    return { offer, driverId: driver.id };
  }

  private driverOfferView(offer: OfferRow, ride: RideRow): DriverOfferView {
    const negotiation = this.env.FEATURE_NEGOTIATION && offer.type !== 'fixed';
    return {
      id: offer.id, rideId: offer.rideId, wave: offer.wave, type: offer.type, state: offer.state, driverFareCents: offer.driverFareCents,
      proposedTotalCents: negotiation ? offer.proposedTotalCents : null, displayedTotalCents: negotiation ? offer.displayedTotalCents : null,
      pickupDistanceMeters: offer.pickupDistanceMeters, pickupSeconds: offer.pickupSeconds, isFavourite: this.favouriteOf(ride).requested === offer.driverId, sentAt: offer.sentAt.toISOString(), expiresAt: offer.expiresAt.toISOString(),
      ride: {
        id: ride.id, publicNumber: ride.publicNumber, type: ride.type, category: ride.reservedCategory, origin: { address: ride.originAddress, coordinates: parseGeoPoint(ride.originGeo) }, destination: { address: ride.destinationAddress, coordinates: parseGeoPoint(ride.destinationGeo) },
        requestedAt: ride.requestedAt?.toISOString() ?? null, paymentMethod: ride.paymentMethod, paymentChoice: ride.paymentChoice as 'prepaid' | 'pay_driver_after', specialRequests: ride.specialRequests,
      },
    };
  }

  /** Vue d'une offre pour le chauffeur (diffusion `offer.new`). */
  async offerView(offerId: string): Promise<DriverOfferView | null> {
    const [offer] = await this.db.select().from(schema.rideOffers).where(eq(schema.rideOffers.id, offerId)).limit(1);
    if (!offer) return null;
    return this.driverOfferView(offer, await this.rides.getRide(offer.rideId));
  }

  /** `GET /driver/offers` : offres en attente du chauffeur, la plus ancienne d'abord. */
  async listForDriver(actor: UserActor): Promise<DriverOfferView[]> {
    const driver = await this.presence.driverOfUser(actor.userId);
    const now = new Date();
    const offers = await this.db
      .select()
      .from(schema.rideOffers)
      .where(and(eq(schema.rideOffers.driverId, driver.id), eq(schema.rideOffers.state, 'sent'), gt(schema.rideOffers.expiresAt, now), inArray(schema.rideOffers.type, ['fixed', 'client_proposal'])))
      .orderBy(asc(schema.rideOffers.sentAt));
    const views: DriverOfferView[] = [];
    for (const offer of offers) views.push(this.driverOfferView(offer, await this.rides.getRide(offer.rideId)));
    return views;
  }

  /** Acceptation par le chauffeur : la première acceptation gagne (verrou de la course dans `assign`), les autres offres expirent. */
  async accept(offerId: string, actor: UserActor): Promise<RideView> {
    const { offer, driverId } = await this.offerOfDriver(offerId, actor);
    if (offer.type === 'driver_counter') throw AppError.conflict('OFFER_NOT_ACCEPTABLE', 'Une contre-proposition est acceptée par le client');
    const now = new Date();
    const [claimed] = await this.db.update(schema.rideOffers).set({ state: 'accepted', respondedAt: now }).where(and(eq(schema.rideOffers.id, offerId), eq(schema.rideOffers.state, 'sent'), gt(schema.rideOffers.expiresAt, now))).returning();
    if (!claimed) throw AppError.conflict('OFFER_EXPIRED', 'Cette offre n\'est plus disponible', { state: offer.state });
    return this.withLock(offer.rideId, async () => {
      const ride = await this.rides.getRide(offer.rideId);
      const actorRef: ActorRef = { kind: 'driver', userId: actor.userId };
      try {
        if (claimed.type === 'client_proposal' && claimed.proposedTotalCents !== null) {
          const agreed = agreedPrice({ displayedCents: ride.quotedTotalCents, proposedCents: ride.proposedTotalCents, offer: { type: 'client_proposal', proposedTotalCents: claimed.proposedTotalCents } });
          await this.db.update(schema.rides).set({ agreedTotalCents: agreed.totalCents }).where(and(eq(schema.rides.id, ride.id), isNull(schema.rides.driverId)));
          await this.rides.mark(ride.id, 'negotiation_agreed', actorRef, { offerId, totalCents: agreed.totalCents, by: 'driver' });
        }
        await this.rides.assign(ride.id, { driverId }, actorRef);
      } catch (error) {
        if (error instanceof AppError && ['RIDE_ALREADY_ASSIGNED', 'RIDE_INVALID_TRANSITION'].includes(error.code)) {
          await this.db.update(schema.rideOffers).set({ state: 'expired' }).where(eq(schema.rideOffers.id, offerId));
          await this.rides.mark(ride.id, 'offer_expired', SYSTEM_ACTOR, { offerId, driverId, reason: 'assigned_elsewhere' });
          this.events.emit('offer.expired', { offerId, rideId: ride.id, driverId, driverUserId: actor.userId, reason: 'assigned_elsewhere' });
          throw AppError.conflict('OFFER_EXPIRED', 'La course vient d\'être attribuée à un autre chauffeur');
        }
        throw error;
      }
      await this.rides.mark(ride.id, 'offer_accepted', actorRef, { offerId, driverId, type: claimed.type });
      this.events.emit('offer.responded', { offerId, rideId: ride.id, driverId, response: 'accepted', proposedTotalCents: claimed.proposedTotalCents });
      await this.markAssigned(ride.id, driverId);
      return this.rides.viewById(ride.id);
    });
  }

  /** Refus par le chauffeur : en mode fixe immédiat, le candidat suivant est sollicité tout de suite. */
  async decline(offerId: string, actor: UserActor): Promise<{ state: 'declined' }> {
    const { offer, driverId } = await this.offerOfDriver(offerId, actor);
    const now = new Date();
    const [declined] = await this.db.update(schema.rideOffers).set({ state: 'declined', respondedAt: now }).where(and(eq(schema.rideOffers.id, offerId), eq(schema.rideOffers.state, 'sent'))).returning({ id: schema.rideOffers.id });
    if (declined) {
      await this.rides.mark(offer.rideId, 'offer_declined', { kind: 'driver', userId: actor.userId }, { offerId, driverId });
      this.events.emit('offer.responded', { offerId, rideId: offer.rideId, driverId, response: 'declined', proposedTotalCents: offer.proposedTotalCents });
      await this.withLock(offer.rideId, () => this.step(offer.rideId, now)).catch((error: unknown) => this.failed(offer.rideId, error));
    }
    return { state: 'declined' };
  }

  /** Contre-proposition du chauffeur (une seule par course), entre P' et P ; au-dessus de P avec le second drapeau et un motif. */
  async counter(offerId: string, actor: UserActor, input: OfferCounterInput): Promise<DriverOfferView> {
    this.assertNegotiation();
    const { offer, driverId } = await this.offerOfDriver(offerId, actor);
    const now = new Date();
    if (offer.type !== 'client_proposal' || offer.state !== 'sent' || offer.expiresAt.getTime() <= now.getTime()) throw AppError.conflict('OFFER_NOT_NEGOTIABLE', 'Cette offre ne peut plus recevoir de contre-proposition', { type: offer.type, state: offer.state });
    const ride = await this.rides.getRide(offer.rideId);
    if (ride.driverId || ride.negotiationMode !== 'negotiation') throw AppError.conflict('NEGOTIATION_CLOSED', 'La négociation est terminée');
    const [previous] = await this.db.select({ id: schema.rideOffers.id }).from(schema.rideOffers).where(and(eq(schema.rideOffers.rideId, ride.id), eq(schema.rideOffers.driverId, driverId), eq(schema.rideOffers.type, 'driver_counter'))).limit(1);
    if (previous) throw AppError.conflict('COUNTER_ALREADY_MADE', 'Une seule contre-proposition par course');
    const cfg = await this.config();
    const check = validateCounter(
      { displayedCents: ride.quotedTotalCents, proposedCents: ride.proposedTotalCents ?? ride.quotedTotalCents, counterCents: input.proposedTotalCents, reason: input.reason, reasonText: input.reasonText },
      { floorPpm: cfg.floorPpm, ceilingPpm: cfg.ceilingPpm, aboveMaxEnabled: this.env.FEATURE_NEGOTIATION_ABOVE_MAX },
    );
    if (!check.ok) throw new AppError(check.code, 'Contre-proposition refusée', check.code === 'ABOVE_MAX_DISABLED' ? 409 : 400, { ceilingCents: check.ceilingCents, displayedCents: ride.quotedTotalCents, proposedCents: ride.proposedTotalCents });
    const [row] = await this.db
      .insert(schema.rideOffers)
      .values({
        rideId: ride.id, driverId, wave: offer.wave, type: 'driver_counter', state: 'sent', driverFareCents: await this.fareForTotal(ride, input.proposedTotalCents), proposedTotalCents: input.proposedTotalCents, displayedTotalCents: ride.quotedTotalCents,
        reason: check.aboveDisplayed ? (input.reason ?? null) : null, reasonText: check.aboveDisplayed ? (input.reasonText ?? null) : null, pickupDistanceMeters: offer.pickupDistanceMeters, pickupSeconds: offer.pickupSeconds, sentAt: now, expiresAt: offer.expiresAt,
      })
      .returning();
    await this.rides.mark(ride.id, 'offer_countered', { kind: 'driver', userId: actor.userId }, { offerId: row!.id, inReplyTo: offerId, driverId, proposedTotalCents: input.proposedTotalCents, aboveDisplayed: check.aboveDisplayed, reason: input.reason ?? null });
    this.events.emit('offer.responded', { offerId: row!.id, rideId: ride.id, driverId, response: 'countered', proposedTotalCents: input.proposedTotalCents });
    const recipient = await this.rides.recipientOf(ride);
    await this.outbox.queue({ ...recipient, template: 'ride.counter_offer', data: { rideId: ride.id, offerId: row!.id, totalCents: input.proposedTotalCents } });
    return this.driverOfferView(row!, ride);
  }

  // --- Côté client (négociation) ---

  private assertNegotiation(): void {
    if (!this.env.FEATURE_NEGOTIATION) throw new AppError('FEATURE_DISABLED', 'Fonction non disponible', 404);
  }

  /** `POST /rides/{id}/proposals` : P' borné et arrondi, groupe de test tiré au sort, diffusion aux meilleurs candidats. */
  async propose(rideId: string, actor: UserActor, proposedTotalCents: number): Promise<RideView> {
    this.assertNegotiation();
    const ride = await this.rides.getRide(rideId);
    if ((await this.rides.participantKind(ride, actor)) !== 'client') throw AppError.forbidden('NOT_RIDE_CLIENT', 'Seul le client peut proposer un prix');
    if (ride.driverId || !['requested', 'offering'].includes(ride.state)) throw AppError.conflict('NEGOTIATION_CLOSED', 'La course a déjà un chauffeur ou est close', { state: ride.state });
    const [client] = ride.clientId ? await this.db.select().from(schema.clients).where(eq(schema.clients.id, ride.clientId)).limit(1) : [];
    if (!client) throw AppError.conflict('NEGOTIATION_NOT_ELIGIBLE', 'Réservation sans compte client', { reason: 'guest' });
    const [quote] = ride.quoteId ? await this.db.select({ flatRateCode: schema.quotes.flatRateCode }).from(schema.quotes).where(eq(schema.quotes.id, ride.quoteId)).limit(1) : [];
    const ineligible = negotiationIneligibility({ flatRateCode: quote?.flatRateCode ?? null, category: ride.reservedCategory, organizationId: ride.organizationId, businessAccountId: client.businessAccountId });
    if (ineligible) throw AppError.conflict('NEGOTIATION_NOT_ELIGIBLE', 'La négociation n\'est pas offerte pour cette course', { reason: ineligible });
    let group = client.experimentGroup as NegotiationMode | null;
    if (!group) {
      group = experimentGroupFor(Math.random());
      await this.db.update(schema.clients).set({ experimentGroup: group, experimentAssignedAt: new Date() }).where(eq(schema.clients.id, client.id));
      this.audit.record({ action: 'client.experiment_group_assigned', entity: 'clients', entityId: client.id, after: { group } });
      await this.rides.mark(rideId, 'experiment_group_assigned', SYSTEM_ACTOR, { clientId: client.id, group });
    }
    if (group === 'fixed') throw AppError.conflict('NEGOTIATION_NOT_AVAILABLE', 'La négociation n\'est pas offerte à ce compte pour le moment', { reason: 'experiment_group' });
    const cfg = await this.config();
    const proposal = clampProposal(ride.quotedTotalCents, proposedTotalCents, cfg.floorPpm);
    await this.db.update(schema.rides).set({ proposedTotalCents: proposal.totalCents, negotiationMode: 'negotiation', agreedTotalCents: null }).where(eq(schema.rides.id, rideId));
    await this.rides.mark(rideId, 'proposal_set', { kind: 'client', userId: actor.userId }, { requestedCents: proposedTotalCents, proposedTotalCents: proposal.totalCents, floorCents: proposal.floorCents, displayedTotalCents: ride.quotedTotalCents, adjusted: proposal.adjusted });
    await this.start(rideId, { reason: 'proposal', mode: 'negotiation' });
    return this.rides.viewById(rideId);
  }

  /** `GET /rides/{id}/offers` : contre-propositions des chauffeurs (ouvertes ou acceptées) ; vide quand le drapeau est désactivé. */
  async listForClient(rideId: string, actor: UserActor): Promise<ClientOfferView[]> {
    if (!this.env.FEATURE_NEGOTIATION) return [];
    const ride = await this.rides.getRide(rideId);
    await this.rides.participantKind(ride, actor);
    const offers = await this.db.select().from(schema.rideOffers).where(and(eq(schema.rideOffers.rideId, rideId), eq(schema.rideOffers.type, 'driver_counter'), inArray(schema.rideOffers.state, ['sent', 'accepted']))).orderBy(asc(schema.rideOffers.sentAt));
    if (!offers.length) return [];
    const drivers = await this.db
      .select({ id: schema.drivers.id, firstName: schema.users.firstName, rating: schema.drivers.ratingAverage, rideCount: schema.drivers.rideCount, currentVehicleId: schema.drivers.currentVehicleId })
      .from(schema.drivers)
      .innerJoin(schema.users, eq(schema.users.id, schema.drivers.userId))
      .where(inArray(schema.drivers.id, offers.map((o) => o.driverId)));
    const vehicleIds = drivers.map((d) => d.currentVehicleId).filter((v): v is string => Boolean(v));
    const vehicles = vehicleIds.length ? await this.db.select({ id: schema.vehicles.id, make: schema.vehicles.make, model: schema.vehicles.model, colour: schema.vehicles.colour, category: schema.vehicles.category }).from(schema.vehicles).where(inArray(schema.vehicles.id, vehicleIds)) : [];
    return offers.map((o) => {
      const driver = drivers.find((d) => d.id === o.driverId);
      const vehicle = vehicles.find((v) => v.id === driver?.currentVehicleId);
      return {
        id: o.id, type: o.type, state: o.state, totalCents: o.proposedTotalCents ?? ride.quotedTotalCents, aboveDisplayed: (o.proposedTotalCents ?? 0) > ride.quotedTotalCents, reason: (o.reason as ClientOfferView['reason']) ?? null, reasonText: o.reasonText,
        sentAt: o.sentAt.toISOString(), expiresAt: o.expiresAt.toISOString(),
        driver: { id: o.driverId, firstName: driver?.firstName ?? 'Chauffeur', rating: Number(driver?.rating ?? 5), rideCount: driver?.rideCount ?? 0, vehicle: { make: vehicle?.make ?? '', model: vehicle?.model ?? '', colour: vehicle?.colour ?? '', category: vehicle?.category ?? ride.reservedCategory } },
      };
    });
  }

  /** `POST /rides/{id}/offers/{offerId}/accept` : le client retient une contre-proposition ; au-dessus de P, acceptation écrite conservée et prix maximal consenti mis à jour. */
  async acceptForClient(rideId: string, offerId: string, actor: UserActor, consentText: string | undefined): Promise<RideView> {
    this.assertNegotiation();
    return this.withLock(rideId, async () => {
      const ride = await this.rides.getRide(rideId);
      if ((await this.rides.participantKind(ride, actor)) !== 'client') throw AppError.forbidden('NOT_RIDE_CLIENT', 'Seul le client peut accepter une offre');
      if (ride.driverId || !['requested', 'offering'].includes(ride.state)) throw AppError.conflict('NEGOTIATION_CLOSED', 'La course a déjà un chauffeur ou est close', { state: ride.state });
      const now = new Date();
      const [offer] = await this.db.select().from(schema.rideOffers).where(and(eq(schema.rideOffers.id, offerId), eq(schema.rideOffers.rideId, rideId))).limit(1);
      if (!offer || offer.type !== 'driver_counter') throw AppError.notFound('OFFER_NOT_FOUND', 'Offre introuvable');
      if (offer.state !== 'sent' || offer.expiresAt.getTime() <= now.getTime()) throw AppError.conflict('OFFER_EXPIRED', 'Cette offre n\'est plus disponible', { state: offer.state });
      const agreed = agreedPrice({ displayedCents: ride.quotedTotalCents, proposedCents: ride.proposedTotalCents, offer: { type: 'driver_counter', proposedTotalCents: offer.proposedTotalCents } });
      const actorRef: ActorRef = { kind: 'client', userId: actor.userId };
      if (agreed.explicitConsentRequired) {
        if (!this.env.FEATURE_NEGOTIATION_ABOVE_MAX) throw AppError.conflict('ABOVE_MAX_DISABLED', 'Une offre au-dessus du prix affiché ne peut pas être acceptée');
        if (!consentText) throw new AppError('CONSENT_TEXT_REQUIRED', 'L\'acceptation écrite du nouveau prix maximal est requise', 400, { totalCents: agreed.totalCents });
        await this.rides.mark(rideId, 'negotiation_above_max_accepted', actorRef, { offerId, totalCents: agreed.totalCents, previousMaxConsentedCents: ride.maxConsentedCents, consentText, acceptedAt: now.toISOString(), reason: offer.reason, reasonText: offer.reasonText });
        await this.db.update(schema.rides).set({ maxConsentedCents: agreed.totalCents }).where(eq(schema.rides.id, rideId));
        this.audit.record({ action: 'ride.max_consented_raised', entity: 'rides', entityId: rideId, before: { maxConsentedCents: ride.maxConsentedCents }, after: { maxConsentedCents: agreed.totalCents, offerId } });
      }
      await this.db.update(schema.rides).set({ agreedTotalCents: agreed.totalCents }).where(eq(schema.rides.id, rideId));
      await this.db.update(schema.rideOffers).set({ state: 'accepted', respondedAt: now }).where(eq(schema.rideOffers.id, offerId));
      await this.rides.mark(rideId, 'negotiation_agreed', actorRef, { offerId, totalCents: agreed.totalCents, by: 'client', aboveDisplayed: agreed.explicitConsentRequired });
      await this.rides.assign(rideId, { driverId: offer.driverId }, actorRef);
      this.events.emit('offer.responded', { offerId, rideId, driverId: offer.driverId, response: 'accepted', proposedTotalCents: offer.proposedTotalCents });
      await this.markAssigned(rideId, offer.driverId);
      return this.rides.viewById(rideId);
    });
  }

  // --- Panneau opérateur ---

  /** Mise en attente : offres retirées, aucune nouvelle recherche jusqu'à `release`. */
  async hold(rideId: string, actor: UserActor, reason: string): Promise<RideView> {
    return this.withLock(rideId, async () => {
      const ride = await this.rides.getRide(rideId);
      if (ride.driverId || !['requested', 'offering'].includes(ride.state)) throw AppError.conflict('RIDE_NOT_HOLDABLE', 'Seule une course sans chauffeur peut être mise en attente', { state: ride.state });
      const now = new Date();
      for (const offer of await this.pendingOffers(rideId)) await this.closeOffer(offer, 'withdrawn', now);
      const values: DispatchUpdate = { status: 'held', heldReason: reason, heldByUserId: actor.userId, nextActionAt: null, candidateIds: [], candidateCursor: 0, negotiationEndsAt: null, updatedAt: now };
      await this.db.insert(schema.rideDispatches).values({ rideId, ...values }).onConflictDoUpdate({ target: schema.rideDispatches.rideId, set: values });
      await this.rides.mark(rideId, 'dispatch_held', { kind: 'operator', userId: actor.userId }, { reason });
      if (ride.state === 'offering') await this.rides.systemTransition(rideId, 'new_wave', { reason: 'held' });
      this.emitDispatch(rideId);
      return this.rides.viewById(rideId);
    });
  }

  /** Reprise après une mise en attente. */
  async release(rideId: string, actor: UserActor): Promise<RideView> {
    const d = await this.dispatchOf(rideId);
    if (!d || d.status !== 'held') throw AppError.conflict('RIDE_NOT_HELD', 'La course n\'est pas en attente', { status: d?.status ?? null });
    await this.rides.mark(rideId, 'dispatch_released', { kind: 'operator', userId: actor.userId }, {});
    await this.start(rideId, { reason: 'release' });
    return this.rides.viewById(rideId);
  }

  /** Réattribution par l'opérateur : le chauffeur en place est retiré (sans sanction) et une nouvelle recherche prioritaire démarre. */
  async reassign(rideId: string, actor: UserActor, input: { reason: string; excludeDriver: boolean }): Promise<RideView> {
    const ride = await this.rides.getRide(rideId);
    const operator: ActorRef = { kind: 'operator', userId: actor.userId };
    let exclude: string[] = [];
    if (ride.driverId) {
      if (!['assigned', 'en_route', 'arrived'].includes(ride.state)) throw AppError.conflict('RIDE_NOT_REASSIGNABLE', 'La course ne peut plus être réattribuée', { state: ride.state });
      const released = await this.rides.releaseDriver(rideId, operator, input.reason, { sanction: false, source: 'operator' });
      if (input.excludeDriver) exclude = [released.previousDriverId];
    } else if (!['requested', 'offering'].includes(ride.state)) {
      throw AppError.conflict('RIDE_NOT_REASSIGNABLE', 'La course ne peut plus être réattribuée', { state: ride.state });
    }
    await this.start(rideId, { reason: 'operator', priority: true, excludeDriverIds: exclude });
    return this.rides.viewById(rideId);
  }

  /** Vue My Hub : répartition et offres d'une course. */
  async adminView(rideId: string): Promise<{ dispatch: DispatchSummary | null; offers: Array<{ id: string; driverId: string; wave: number; type: string; state: string; driverFareCents: number; proposedTotalCents: number | null; pickupSeconds: number | null; sentAt: string; expiresAt: string; respondedAt: string | null }> }> {
    await this.rides.getRide(rideId);
    const d = await this.dispatchOf(rideId);
    const offers = await this.db.select().from(schema.rideOffers).where(eq(schema.rideOffers.rideId, rideId)).orderBy(asc(schema.rideOffers.sentAt));
    const radii = parseSearchRadii(await this.settings.get<unknown>('dispatch.search_radii_m', null));
    return {
      dispatch: d ? dispatchSummaryOf(d, radii) : null,
      offers: offers.map((o) => ({ id: o.id, driverId: o.driverId, wave: o.wave, type: o.type, state: o.state, driverFareCents: o.driverFareCents, proposedTotalCents: o.proposedTotalCents, pickupSeconds: o.pickupSeconds, sentAt: o.sentAt.toISOString(), expiresAt: o.expiresAt.toISOString(), respondedAt: o.respondedAt?.toISOString() ?? null })),
    };
  }

  // --- Surveillance du départ (5.4) ---

  /** Chauffeur immobile `dispatch.no_movement_seconds` après l'attribution : retrait sans sanction et réattribution prioritaire. */
  private async checkMovement(d: DispatchRow, now: Date): Promise<boolean> {
    const ride = await this.rides.getRide(d.rideId);
    if (ride.state !== 'assigned' || !ride.driverId) {
      await this.save(d.rideId, { movementCheckedAt: now });
      return false;
    }
    const cfg = await this.config();
    const position = await this.presence.positionOf(ride.driverId);
    const start = d.assignedPosition ? { lat: d.assignedPosition.lat, lng: d.assignedPosition.lng } : null;
    const moved = position !== null && (start === null || haversineMeters(start, position) >= cfg.noMovementMeters);
    await this.save(d.rideId, { movementCheckedAt: now });
    if (moved) return false;
    const previousDriverId = ride.driverId;
    await this.rides.releaseDriver(d.rideId, SYSTEM_ACTOR, 'no_movement', { sanction: false, source: 'system' });
    await this.rides.mark(d.rideId, 'no_movement_reassign', SYSTEM_ACTOR, { driverId: previousDriverId, seconds: cfg.noMovementSeconds, meters: cfg.noMovementMeters });
    const [driver] = await this.db.select({ userId: schema.drivers.userId }).from(schema.drivers).where(eq(schema.drivers.id, previousDriverId)).limit(1);
    if (driver) await this.outbox.queue({ recipientUserId: driver.userId, template: 'ride.removed_no_movement', data: { rideId: d.rideId } });
    await this.start(d.rideId, { reason: 'reassign', priority: true, excludeDriverIds: [previousDriverId] });
    return true;
  }
}
