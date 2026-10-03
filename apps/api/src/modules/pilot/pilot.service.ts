/**
 * Neomoov Pilote (étape 24, amendement v1.2 section 7) : acceptation automatique des courses Neomoov selon les critères
 * du chauffeur. Décision D1 du fondateur : Pilote n'agit que sur les courses Neomoov ; il ne lit rien et ne fait rien sur
 * une autre plateforme (les revenus d'ailleurs sont un total saisi à la main par le chauffeur).
 *
 * - Réglages et consentement : l'activation exige l'acceptation du texte d'information à sa version courante (Loi 25,
 *   article 12.1) ; une nouvelle version du texte suspend l'acceptation automatique jusqu'au nouveau consentement.
 * - Répartition : inscrit au crochet `PilotHook`, Pilote évalue chaque offre créée pour un chauffeur qui l'a activé,
 *   enregistre sa décision et, si elle dit `accept`, accepte l'offre pour lui par `DispatchService.accept` (même chemin,
 *   mêmes verrous et mêmes vérifications qu'à la main), une fois le verrou de la course libéré ; le chauffeur reçoit
 *   l'avis « acceptée par Pilote, annulable sans frais pendant N secondes ».
 * - Annulation de grâce : dans `pilot.grace_seconds`, sans frais, sans sanction ni effet sur la Charte d'équité (l'agent
 *   qualité et le tableau de conduite ignorent l'annulation marquée `pilotGrace`) ; la course repart en répartition.
 * - Mode multi-applications : réservations planifiées seulement, seuils relevés, fenêtre de réponse allongée.
 * - Surveillance des exclusions de zones : rapport pour la plateforme et alerte au personnel, une fois par chauffeur et
 *   par zone surveillée (marqueur au journal d'audit).
 * - Critères de la flotte (finalisation du 3 octobre 2026, « critères du chauffeur ou de la flotte ») : l'organisation
 *   cliente du chauffeur peut fixer des critères (`organizations.settings.pilot`, modes `default` ou `minimum`), jugés avec
 *   les siens par `evaluateOfferWithFleet` ; ils ne changent que la décision de Pilote, jamais l'ordre des offres.
 */
import { schema } from '@neomoov/db';
import {
  chainAgenda, DEFAULT_PILOT_CRITERIA, evaluateOfferWithFleet, netProfitability, parseFleetPilotSettings, parsePilotCriteria, parseWatchedZones, PILOT_INFORMATION_VERSION, pilotInformation,
  pilotZoneExclusions, watchedZonesExcluded, type DriverAgendaView, type DriverCostsInput, type DriverCostsView, type DriverOfferView, type DriverProfitabilityView,
  type FleetPilotSettings, type PilotContext, type PilotCriteria, type PilotDecisionPage, type PilotDecisionsQuery, type PilotEvaluation, type PilotOffer, type PilotScoreView, type PilotSettingsUpdate,
  type PilotSettingsView, type PilotZoneExclusionsView, type RidePreferences, type RideView, type VehicleCategory,
} from '@neomoov/domain';
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { MAPS_PROVIDER, type GeoPoint, type MapsProvider } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AuditService } from '../audit/audit.service.js';
import type { UserActor } from '../auth/actor.js';
import { ZonesService } from '../pricing/zones.service.js';
import { DispatchService } from '../rides/dispatch.service.js';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';
import { PilotHook, type OfferPilot, type OfferRow, type PilotOfferOutcome } from '../rides/pilot-hook.js';
import { PresenceService } from '../rides/presence.service.js';
import { parseGeoPoint, preferencesOf, selectRides, type RideRow } from '../rides/ride-view.js';
import { RidesService, SYSTEM_ACTOR } from '../rides/rides.service.js';

type SettingsRow = typeof schema.driverPilotSettings.$inferSelect;
type CostRow = typeof schema.driverCostEntries.$inferSelect;
export type PilotLanguage = 'fr' | 'en';

/** Durée d'une réservation dont le devis n'a pas de durée (estimation de l'agenda et des chevauchements). */
const DEFAULT_RIDE_SECONDS = 1800;
const ZONE_ALERT = 'alert.pilot_zone_exclusion';

interface PilotConfig {
  available: boolean;
  graceSeconds: number;
  multiAppFactor: number;
  multiAppResponseSeconds: number;
  watchedZones: string[];
  nearMissPercent: number;
  timeZone: string;
  bufferSeconds: number;
  alertSeconds: number;
}

/** Ce que Pilote sait d'une offre, qu'elle vienne de la répartition (offre et course) ou de la vue du chauffeur. */
interface OfferFacts {
  driverId: string;
  rideId: string;
  clientId: string | null;
  rideType: 'immediate' | 'scheduled';
  negotiation: boolean;
  category: VehicleCategory;
  driverFareCents: number;
  pickupMeters: number | null;
  pickupSeconds: number | null;
  tripMeters: number | null;
  tripSeconds: number | null;
  pickupAt: Date;
  origin: GeoPoint;
  destination: GeoPoint;
  preferences: RidePreferences | null;
}

@Injectable()
export class PilotService implements OfferPilot, OnModuleInit, OnModuleDestroy {
  /** Acceptations automatiques en cours (attendues à l'arrêt du processus). */
  private readonly pending = new Set<Promise<void>>();

  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    @Inject(MAPS_PROVIDER) private readonly maps: MapsProvider,
    private readonly settings: SettingsService,
    private readonly zones: ZonesService,
    private readonly dispatch: DispatchService,
    private readonly rides: RidesService,
    private readonly presence: PresenceService,
    private readonly outbox: NotificationsOutbox,
    private readonly audit: AuditService,
    private readonly hook: PilotHook,
  ) {}

  private get db() {
    return this.database.db;
  }

  onModuleInit(): void {
    this.hook.register(this);
  }

  async onModuleDestroy(): Promise<void> {
    this.hook.register(null);
    await Promise.allSettled([...this.pending]);
  }

  // --- Réglages de la plateforme ---

  private async config(): Promise<PilotConfig> {
    const s = this.settings;
    const [available, grace, factor, response, watched, nearMiss, timeZone, buffer, alert] = await Promise.all([
      s.get<unknown>('pilot.enabled', true), s.number('pilot.grace_seconds', 60), s.number('pilot.multi_app_factor', 1.25), s.number('pilot.multi_app_response_seconds', 30),
      s.get<unknown>('pilot.watched_zones', []), s.number('pilot.near_miss_percent', 10), s.string('service.time_zone', 'America/Toronto'),
      s.number('pilot.departure_buffer_minutes', 5), s.number('pilot.departure_alert_minutes', 15),
    ]);
    return {
      available: available !== false, graceSeconds: Math.max(0, grace), multiAppFactor: Math.max(1, factor), multiAppResponseSeconds: Math.max(0, response),
      watchedZones: parseWatchedZones(watched), nearMissPercent: Math.max(0, nearMiss), timeZone, bufferSeconds: Math.max(0, buffer) * 60, alertSeconds: Math.max(0, alert) * 60,
    };
  }

  // --- Chauffeur et réglages ---

  private async driverOfUser(userId: string): Promise<{ id: string; publicNumber: string } | null> {
    const [driver] = await this.db.select({ id: schema.drivers.id, publicNumber: schema.drivers.publicNumber }).from(schema.drivers).where(eq(schema.drivers.userId, userId)).limit(1);
    return driver ?? null;
  }

  private async requireDriver(userId: string): Promise<{ id: string; publicNumber: string }> {
    const driver = await this.driverOfUser(userId);
    if (!driver) throw AppError.forbidden('DRIVER_PROFILE_REQUIRED', 'Profil chauffeur requis');
    return driver;
  }

  private async settingsRow(driverId: string): Promise<SettingsRow | undefined> {
    const [row] = await this.db.select().from(schema.driverPilotSettings).where(eq(schema.driverPilotSettings.driverId, driverId)).limit(1);
    return row;
  }

  /** Critères enregistrés (le mode multi-applications vient de sa colonne) ; sans ligne, aucun filtre ; null si illisibles. */
  private criteriaOf(row: SettingsRow | undefined): PilotCriteria | null {
    if (!row) return { ...DEFAULT_PILOT_CRITERIA };
    const criteria = parsePilotCriteria(row.criteria);
    return criteria ? { ...criteria, multiAppMode: row.multiAppMode } : null;
  }

  /** Critères Pilote de l'organisation cliente du chauffeur (`null` : aucune, ou mode `off`). */
  private async fleetOf(driverId: string): Promise<FleetPilotSettings | null> {
    const [row] = await this.db.execute<{ pilot: unknown }>(sql`
      SELECT o.settings -> 'pilot' AS pilot FROM drivers d JOIN organizations o ON o.id = d.organization_id
      WHERE d.id = ${driverId}::uuid AND o.parent_id IS NOT NULL`);
    if (!row) return null;
    const fleet = parseFleetPilotSettings(row.pilot);
    return fleet.mode === 'off' ? null : fleet;
  }

  /** Acceptation automatique permise : Pilote offert, activé par le chauffeur, consentement à la version courante. */
  private canAutoAccept(row: SettingsRow | undefined, cfg: PilotConfig): boolean {
    return Boolean(cfg.available && row?.enabled && row.consentVersion === PILOT_INFORMATION_VERSION);
  }

  private async settingsView(driverId: string, language: PilotLanguage, cfg?: PilotConfig): Promise<PilotSettingsView> {
    const [row, config, zones] = await Promise.all([this.settingsRow(driverId), cfg ? Promise.resolve(cfg) : this.config(), this.zones.all()]);
    const criteria = this.criteriaOf(row) ?? { ...DEFAULT_PILOT_CRITERIA, multiAppMode: row?.multiAppMode ?? false };
    return {
      available: config.available,
      enabled: row?.enabled ?? false,
      multiAppMode: criteria.multiAppMode,
      criteria,
      consentAt: row?.consentAt?.toISOString() ?? null,
      consentVersion: row?.consentVersion ?? null,
      consentCurrent: row?.consentVersion === PILOT_INFORMATION_VERSION,
      information: pilotInformation(language, config.graceSeconds),
      graceSeconds: config.graceSeconds,
      multiAppFactor: config.multiAppFactor,
      multiAppResponseSeconds: config.multiAppResponseSeconds,
      zones: zones.map((z) => ({ code: z.code, name: z.name, type: z.type })).sort((a, b) => a.code.localeCompare(b.code)),
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }

  /** `GET /driver/pilot`. */
  async getSettings(userId: string, language: PilotLanguage): Promise<PilotSettingsView> {
    const driver = await this.requireDriver(userId);
    return this.settingsView(driver.id, language);
  }

  /**
   * `PUT /driver/pilot` : critères (zones connues seulement), consentement (version courante seulement) et activation
   * (exige un consentement à la version courante et Pilote offert). Une zone surveillée nouvellement exclue alerte le personnel.
   */
  async updateSettings(userId: string, input: PilotSettingsUpdate, language: PilotLanguage, now = new Date()): Promise<PilotSettingsView> {
    const driver = await this.requireDriver(userId);
    const [row, cfg, zones] = await Promise.all([this.settingsRow(driver.id), this.config(), this.zones.all()]);
    const criteria: PilotCriteria = input.criteria ?? this.criteriaOf(row) ?? { ...DEFAULT_PILOT_CRITERIA };
    const known = new Set(zones.map((z) => z.code));
    const unknown = [...new Set([...criteria.originZones, ...criteria.destinationZones])].filter((z) => !known.has(z));
    if (unknown.length) throw new AppError('PILOT_UNKNOWN_ZONE', 'Zone inconnue dans les critères', 400, { zones: unknown });
    let consentAt = row?.consentAt ?? null;
    let consentVersion = row?.consentVersion ?? null;
    if (input.consentVersion !== undefined) {
      if (input.consentVersion !== PILOT_INFORMATION_VERSION) {
        throw AppError.conflict('PILOT_CONSENT_OUTDATED', 'Le texte d\'information a changé : relisez-le avant de l\'accepter', { currentVersion: PILOT_INFORMATION_VERSION });
      }
      if (consentVersion !== input.consentVersion) {
        consentAt = now;
        consentVersion = input.consentVersion;
      }
    }
    const enabled = input.enabled ?? row?.enabled ?? false;
    if (enabled && !cfg.available) throw AppError.conflict('PILOT_UNAVAILABLE', 'Neomoov Pilote n\'est pas offert pour le moment');
    if (enabled && consentVersion !== PILOT_INFORMATION_VERSION) {
      throw AppError.conflict('PILOT_CONSENT_REQUIRED', 'Lisez et acceptez l\'information sur la décision automatisée pour activer Pilote', { currentVersion: PILOT_INFORMATION_VERSION });
    }
    const values = { enabled, criteria, multiAppMode: criteria.multiAppMode, consentAt, consentVersion, updatedAt: now };
    await this.db.insert(schema.driverPilotSettings).values({ driverId: driver.id, ...values }).onConflictDoUpdate({ target: schema.driverPilotSettings.driverId, set: values });
    this.audit.record({
      action: 'pilot.settings_updated', entity: 'drivers', entityId: driver.id,
      before: row ? { enabled: row.enabled, multiAppMode: row.multiAppMode, consentVersion: row.consentVersion } : null,
      after: { enabled, multiAppMode: criteria.multiAppMode, consentVersion, criteria },
    });
    if (consentAt && consentAt === now) this.audit.record({ action: 'pilot.consent_given', entity: 'drivers', entityId: driver.id, after: { version: consentVersion } });
    await this.alertWatchedZones(driver, criteria, cfg, zones);
    return this.settingsView(driver.id, language, cfg);
  }

  // --- Évaluation des offres ---

  private async plannedRides(driverId: string, exceptRideId: string, around: Date): Promise<Array<{ startsAt: Date; endsAt: Date }>> {
    const day = 86_400_000;
    const rows = await this.db
      .select({ requestedAt: schema.rides.requestedAt, durationSeconds: schema.rides.durationSeconds })
      .from(schema.rides)
      .where(and(
        eq(schema.rides.driverId, driverId), eq(schema.rides.type, 'scheduled'), inArray(schema.rides.state, ['assigned', 'en_route', 'arrived', 'in_progress']), ne(schema.rides.id, exceptRideId),
        isNotNull(schema.rides.requestedAt), gte(schema.rides.requestedAt, new Date(around.getTime() - day)), lt(schema.rides.requestedAt, new Date(around.getTime() + day)),
      ))
      .limit(50);
    return rows.map((r) => ({ startsAt: r.requestedAt!, endsAt: new Date(r.requestedAt!.getTime() + (r.durationSeconds ?? DEFAULT_RIDE_SECONDS) * 1000) }));
  }

  /** Note moyenne donnée au client par les chauffeurs (notes retirées exceptées) ; null sans note. */
  private async clientRating(clientId: string): Promise<number | null> {
    const [row] = await this.db.execute<{ average: number | string | null }>(sql`
      SELECT avg(rr.score)::float AS average FROM ride_ratings rr JOIN rides r ON r.id = rr.ride_id
      WHERE r.client_id = ${clientId}::uuid AND rr.author_kind = 'driver' AND rr.excluded_at IS NULL`);
    return row?.average === null || row?.average === undefined ? null : Math.round(Number(row.average) * 100) / 100;
  }

  private async evaluate(facts: OfferFacts, criteria: PilotCriteria | null, cfg: PilotConfig, fleet: FleetPilotSettings | null): Promise<PilotEvaluation> {
    const input = await this.evaluationInput(facts, criteria, cfg, fleet);
    return evaluateOfferWithFleet(input.offer, criteria, fleet, input.context);
  }

  /** Ce que le domaine évalue : l'offre (zones, note du client) et le contexte (réservations du chauffeur, réglages). */
  private async evaluationInput(facts: OfferFacts, criteria: PilotCriteria | null, cfg: PilotConfig, fleet: FleetPilotSettings | null = null): Promise<{ offer: PilotOffer; context: PilotContext }> {
    const ratingNeeded = criteria?.minClientRating != null || fleet?.criteria.minClientRating != null;
    const [originZones, destinationZones, planned, clientRating] = await Promise.all([
      this.zones.zonesOf(facts.origin).then((zones) => zones.map((z) => z.code)),
      this.zones.zonesOf(facts.destination).then((zones) => zones.map((z) => z.code)),
      this.plannedRides(facts.driverId, facts.rideId, facts.pickupAt),
      ratingNeeded && facts.clientId ? this.clientRating(facts.clientId) : Promise.resolve(null),
    ]);
    const offer: PilotOffer = {
      rideType: facts.rideType, negotiation: facts.negotiation, category: facts.category, driverFareCents: facts.driverFareCents,
      pickupMeters: facts.pickupMeters, pickupSeconds: facts.pickupSeconds, tripMeters: facts.tripMeters, tripSeconds: facts.tripSeconds, pickupAt: facts.pickupAt,
      originZones, destinationZones, clientRating,
      assistanceAnimal: facts.preferences?.assistanceAnimal === true, accessibility: facts.preferences?.accessibility === true,
    };
    return { offer, context: { timeZone: cfg.timeZone, multiAppFactor: cfg.multiAppFactor, nearMissPercent: cfg.nearMissPercent, planned } };
  }

  private factsOfOffer(offer: OfferRow, ride: RideRow): OfferFacts {
    return {
      driverId: offer.driverId, rideId: ride.id, clientId: ride.clientId, rideType: ride.type, negotiation: offer.type !== 'fixed', category: ride.reservedCategory,
      driverFareCents: offer.driverFareCents, pickupMeters: offer.pickupDistanceMeters, pickupSeconds: offer.pickupSeconds, tripMeters: ride.distanceMeters, tripSeconds: ride.durationSeconds,
      pickupAt: ride.requestedAt ?? offer.sentAt, origin: parseGeoPoint(ride.originGeo), destination: parseGeoPoint(ride.destinationGeo), preferences: preferencesOf(ride.preferences),
    };
  }

  private factsOfView(driverId: string, view: DriverOfferView, clientId: string | null): OfferFacts {
    return {
      driverId, rideId: view.rideId, clientId, rideType: view.ride.type, negotiation: view.type !== 'fixed', category: view.ride.category,
      driverFareCents: view.driverFareCents, pickupMeters: view.pickupDistanceMeters, pickupSeconds: view.pickupSeconds, tripMeters: view.ride.distanceMeters, tripSeconds: view.ride.durationSeconds,
      pickupAt: new Date(view.ride.requestedAt ?? view.sentAt), origin: view.ride.origin.coordinates, destination: view.ride.destination.coordinates, preferences: view.ride.preferences,
    };
  }

  private scoreOf(evaluation: PilotEvaluation, row: SettingsRow | undefined, cfg: PilotConfig, offerType: string): PilotScoreView {
    return { ...evaluation, enabled: row?.enabled ?? false, autoAccept: this.canAutoAccept(row, cfg) && evaluation.decision === 'accept' && offerType === 'fixed' };
  }

  /** Crochet : score Pilote des offres de la vue du chauffeur, Pilote activé ou non. */
  async scoreOffers(driverUserId: string, views: DriverOfferView[]): Promise<DriverOfferView[]> {
    const driver = await this.driverOfUser(driverUserId);
    if (!driver) return views;
    const [row, cfg, fleet] = await Promise.all([this.settingsRow(driver.id), this.config(), this.fleetOf(driver.id)]);
    const criteria = this.criteriaOf(row);
    const clients = new Map<string, string | null>();
    if (criteria?.minClientRating != null || fleet?.criteria.minClientRating != null) {
      const rows = await this.db.select({ id: schema.rides.id, clientId: schema.rides.clientId }).from(schema.rides).where(inArray(schema.rides.id, views.map((v) => v.rideId)));
      for (const r of rows) clients.set(r.id, r.clientId);
    }
    return Promise.all(views.map(async (view) => {
      const evaluation = await this.evaluate(this.factsOfView(driver.id, view, clients.get(view.rideId) ?? null), criteria, cfg, fleet);
      return { ...view, pilotScore: this.scoreOf(evaluation, row, cfg, view.type) };
    }));
  }

  /**
   * Crochet : offre créée par la répartition. Sans réglage, ou Pilote désactivé hors mode multi-applications, rien ne
   * change. Mode multi-applications : l'offre qui n'est pas acceptée automatiquement reçoit la fenêtre de réponse
   * allongée. Pilote activé : la décision est enregistrée ; si elle dit `accept`, l'offre est acceptée pour le chauffeur.
   */
  async onOfferCreated(offer: OfferRow, ride: RideRow, driverUserId: string): Promise<PilotOfferOutcome> {
    const row = await this.settingsRow(offer.driverId);
    if (!row || (!row.enabled && !row.multiAppMode)) return { expiresAt: offer.expiresAt, notify: true };
    const [cfg, fleet] = await Promise.all([this.config(), this.fleetOf(offer.driverId)]);
    const criteria = this.criteriaOf(row);
    const input = await this.evaluationInput(this.factsOfOffer(offer, ride), criteria, cfg, fleet);
    const recorded = row.enabled ? await this.recordDecision(offer, ride, row, cfg, criteria, input, fleet) : null;
    const decisionId = recorded?.id ?? null;
    const autoAccept = decisionId !== null && this.scoreOf(recorded!.evaluation, row, cfg, offer.type).autoAccept;
    let expiresAt = offer.expiresAt;
    if (row.multiAppMode && !autoAccept) {
      const extended = new Date(offer.sentAt.getTime() + cfg.multiAppResponseSeconds * 1000);
      if (extended.getTime() > expiresAt.getTime()) {
        const [updated] = await this.db.update(schema.rideOffers).set({ expiresAt: extended }).where(and(eq(schema.rideOffers.id, offer.id), eq(schema.rideOffers.state, 'sent'))).returning({ id: schema.rideOffers.id });
        if (updated) expiresAt = extended;
      }
    }
    if (!autoAccept || decisionId === null) return { expiresAt, notify: true };
    const task = this.autoAccept(offer, ride, driverUserId, decisionId, cfg);
    this.pending.add(task);
    void task.finally(() => this.pending.delete(task));
    return { expiresAt, notify: false };
  }

  /**
   * Décision enregistrée sous le verrou du chauffeur (une évaluation à la fois, entre processus). Une offre que Pilote
   * accepterait est réévaluée avec les acceptations encore en cours du chauffeur comptées comme réservations prévues :
   * offre réclamée dont la course n'est pas encore attribuée (l'acceptation attend le verrou de sa course), ou décision
   * « accept » dont l'offre attend d'être réclamée. Deux répartitions simultanées ne font donc pas accepter pour lui deux
   * courses qui se chevauchent. La décision est validée avant que l'acceptation ne commence.
   */
  private async recordDecision(
    offer: OfferRow, ride: RideRow, row: SettingsRow, cfg: PilotConfig, criteria: PilotCriteria | null, input: { offer: PilotOffer; context: PilotContext }, fleet: FleetPilotSettings | null = null,
  ): Promise<{ id: string | null; evaluation: PilotEvaluation }> {
    let evaluation = evaluateOfferWithFleet(input.offer, criteria, fleet, input.context);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`pilot-accept:${offer.driverId}`}))`);
      if (this.scoreOf(evaluation, row, cfg, offer.type).autoAccept) {
        const pending = await tx.execute<{ starts_at: Date | string; duration_seconds: number | null }>(sql`
          SELECT coalesce(r.requested_at, o.created_at) AS starts_at, r.duration_seconds
          FROM ride_offers o JOIN rides r ON r.id = o.ride_id
          WHERE o.driver_id = ${offer.driverId}::uuid AND o.ride_id <> ${ride.id}::uuid
            AND r.driver_id IS NULL AND r.state IN ('requested', 'offering')
            AND ((o.state = 'accepted' AND o.responded_at > now() - interval '5 minutes')
              OR (o.state = 'sent' AND o.expires_at > now() AND EXISTS (
                SELECT 1 FROM driver_pilot_decisions pd WHERE pd.offer_id = o.id AND pd.decision = 'accept' AND pd.auto_accepted_at IS NULL)))
          LIMIT 20`);
        if (pending.length) {
          const inFlight = [...pending].map((p) => {
            const startsAt = new Date(p.starts_at);
            return { startsAt, endsAt: new Date(startsAt.getTime() + (p.duration_seconds ?? DEFAULT_RIDE_SECONDS) * 1000) };
          });
          evaluation = evaluateOfferWithFleet(input.offer, criteria, fleet, { ...input.context, planned: [...input.context.planned, ...inFlight] });
        }
      }
      const [inserted] = await tx
        .insert(schema.driverPilotDecisions)
        .values({ driverId: offer.driverId, rideId: ride.id, offerId: offer.id, decision: evaluation.decision, score: evaluation.score, reasons: evaluation.reasons })
        .onConflictDoNothing()
        .returning({ id: schema.driverPilotDecisions.id });
      return { id: inserted?.id ?? null, evaluation };
    });
  }

  /**
   * Acceptation pour le chauffeur, par le chemin de l'acceptation manuelle : le verrou de la course est attendu (la
   * répartition qui a créé l'offre le tient encore), la première acceptation gagne. Perdue (un autre chauffeur, offre
   * échue) : rien de plus. Verrou occupé trop longtemps : l'offre est rendue au chauffeur, qui décide lui-même.
   */
  private async autoAccept(offer: OfferRow, ride: RideRow, driverUserId: string, decisionId: string, cfg: PilotConfig): Promise<void> {
    const actor: UserActor = { kind: 'user', userId: driverUserId, sessionId: 'neomoov-pilot', primaryRole: 'driver', roles: ['driver'], amr: [] };
    try {
      await this.dispatch.accept(offer.id, actor);
    } catch (error) {
      const code = error instanceof AppError ? error.code : null;
      if (code === 'DISPATCH_BUSY') await this.returnOffer(offer, driverUserId).catch(() => undefined);
      else if (code !== 'OFFER_EXPIRED') this.logger.error({ err: error, offerId: offer.id, rideId: ride.id }, 'Neomoov Pilote : acceptation automatique impossible');
      await this.rides.mark(ride.id, 'pilot_auto_accept_failed', SYSTEM_ACTOR, { offerId: offer.id, decisionId, code }).catch(() => undefined);
      return;
    }
    await this.db.update(schema.driverPilotDecisions).set({ autoAcceptedAt: new Date() }).where(eq(schema.driverPilotDecisions.id, decisionId));
    await this.rides.mark(ride.id, 'pilot_auto_accepted', { kind: 'driver', userId: driverUserId }, { offerId: offer.id, decisionId, graceSeconds: cfg.graceSeconds });
    await this.outbox.queue({ recipientUserId: driverUserId, template: 'pilot.auto_accepted', data: { rideId: ride.id, publicNumber: ride.publicNumber, requestedAt: ride.requestedAt?.toISOString() ?? null, graceSeconds: cfg.graceSeconds } });
    this.audit.record({ action: 'pilot.auto_accepted', entity: 'rides', entityId: ride.id, after: { driverId: offer.driverId, offerId: offer.id, decisionId } });
  }

  private async returnOffer(offer: OfferRow, driverUserId: string): Promise<void> {
    const [back] = await this.db
      .update(schema.rideOffers)
      .set({ state: 'sent', respondedAt: null })
      .where(and(eq(schema.rideOffers.id, offer.id), eq(schema.rideOffers.state, 'accepted'), sql`${schema.rideOffers.expiresAt} > now()`, sql`NOT EXISTS (SELECT 1 FROM rides r WHERE r.id = ${offer.rideId}::uuid AND r.driver_id IS NOT NULL)`))
      .returning({ id: schema.rideOffers.id });
    if (back) await this.outbox.queue({ recipientUserId: driverUserId, template: 'offer.new', data: { offerId: offer.id, rideId: offer.rideId, expiresAt: offer.expiresAt.toISOString() } });
  }

  // --- Annulation de grâce ---

  /**
   * `POST /driver/rides/{id}/pilot-cancel` : course acceptée par Pilote, annulée par le chauffeur dans le délai de grâce,
   * avant de partir : aucuns frais, aucune sanction, aucun effet sur la Charte d'équité ; la course repart en répartition
   * (priorité, chauffeur exclu). Hors délai : `PILOT_GRACE_EXPIRED`, l'annulation ordinaire s'applique.
   */
  async graceCancel(userId: string, rideId: string, now = new Date()): Promise<RideView> {
    const driver = await this.requireDriver(userId);
    const ride = await this.rides.getRide(rideId);
    if (ride.driverId !== driver.id) throw AppError.forbidden('NOT_RIDE_DRIVER', 'Cette course n\'est pas attribuée à ce chauffeur');
    const [decision] = await this.db
      .select()
      .from(schema.driverPilotDecisions)
      .where(and(eq(schema.driverPilotDecisions.driverId, driver.id), eq(schema.driverPilotDecisions.rideId, rideId), isNotNull(schema.driverPilotDecisions.autoAcceptedAt), isNull(schema.driverPilotDecisions.cancelledInGraceAt)))
      .orderBy(desc(schema.driverPilotDecisions.autoAcceptedAt))
      .limit(1);
    if (!decision) throw AppError.conflict('PILOT_GRACE_NOT_APPLICABLE', 'Cette course n\'a pas été acceptée par Pilote');
    const cfg = await this.config();
    const elapsedSeconds = Math.max(0, Math.round((now.getTime() - decision.autoAcceptedAt!.getTime()) / 1000));
    if (elapsedSeconds > cfg.graceSeconds) {
      throw AppError.conflict('PILOT_GRACE_EXPIRED', 'Le délai d\'annulation sans frais est passé : l\'annulation suit les règles ordinaires', { graceSeconds: cfg.graceSeconds, elapsedSeconds });
    }
    if (ride.state !== 'assigned') throw AppError.conflict('PILOT_GRACE_NOT_APPLICABLE', 'Course déjà commencée : l\'annulation suit les règles ordinaires', { state: ride.state });
    const released = await this.rides.releaseDriver(rideId, { kind: 'driver', userId }, 'pilot_grace', { sanction: false, source: 'driver', pilotGrace: true });
    await this.db.update(schema.driverPilotDecisions).set({ cancelledInGraceAt: now }).where(and(eq(schema.driverPilotDecisions.id, decision.id), isNull(schema.driverPilotDecisions.cancelledInGraceAt)));
    await this.rides.mark(rideId, 'pilot_grace_cancelled', { kind: 'driver', userId }, { decisionId: decision.id, graceSeconds: cfg.graceSeconds, elapsedSeconds });
    this.audit.record({ action: 'pilot.grace_cancelled', entity: 'rides', entityId: rideId, after: { driverId: driver.id, decisionId: decision.id, elapsedSeconds } });
    return this.rides.view(released.ride);
  }

  // --- Historique ---

  /** `GET /driver/pilot/decisions` : décisions de Pilote, les plus récentes d'abord, par page. */
  async decisions(userId: string, query: PilotDecisionsQuery): Promise<PilotDecisionPage> {
    const driver = await this.requireDriver(userId);
    const cfg = await this.config();
    const where = eq(schema.driverPilotDecisions.driverId, driver.id);
    const [rows, totals] = await Promise.all([
      this.db
        .select({ decision: schema.driverPilotDecisions, ride: { publicNumber: schema.rides.publicNumber, type: schema.rides.type, requestedAt: schema.rides.requestedAt, originAddress: schema.rides.originAddress, destinationAddress: schema.rides.destinationAddress, fareCents: schema.rides.fareCents }, offerFareCents: schema.rideOffers.driverFareCents })
        .from(schema.driverPilotDecisions)
        .innerJoin(schema.rides, eq(schema.rides.id, schema.driverPilotDecisions.rideId))
        .leftJoin(schema.rideOffers, eq(schema.rideOffers.id, schema.driverPilotDecisions.offerId))
        .where(where)
        .orderBy(desc(schema.driverPilotDecisions.createdAt))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ n: count() }).from(schema.driverPilotDecisions).where(where),
    ]);
    return {
      page: query.page, pageSize: query.pageSize, total: totals[0]?.n ?? 0,
      items: rows.map(({ decision: d, ride, offerFareCents }) => ({
        id: d.id, rideId: d.rideId, offerId: d.offerId, decision: d.decision as PilotEvaluation['decision'], score: d.score as PilotEvaluation['score'], reasons: d.reasons as PilotEvaluation['reasons'],
        autoAcceptedAt: d.autoAcceptedAt?.toISOString() ?? null, cancelledInGraceAt: d.cancelledInGraceAt?.toISOString() ?? null,
        graceEndsAt: d.autoAcceptedAt ? new Date(d.autoAcceptedAt.getTime() + cfg.graceSeconds * 1000).toISOString() : null,
        createdAt: d.createdAt.toISOString(),
        ride: { publicNumber: ride.publicNumber, type: ride.type, requestedAt: ride.requestedAt?.toISOString() ?? null, originAddress: ride.originAddress, destinationAddress: ride.destinationAddress, driverFareCents: offerFareCents ?? ride.fareCents ?? 0 },
      })),
    };
  }

  // --- Coûts et rentabilité ---

  private costsView(month: string, row: CostRow | undefined): DriverCostsView {
    return {
      month, vehicleCents: row?.vehicleCents ?? 0, insuranceCents: row?.insuranceCents ?? 0, energyCents: row?.energyCents ?? 0, maintenanceCents: row?.maintenanceCents ?? 0,
      phoneCents: row?.phoneCents ?? 0, otherCents: row?.otherCents ?? 0, externalRevenueCents: row?.externalRevenueCents ?? 0, updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }

  private async costRow(driverId: string, month: string): Promise<CostRow | undefined> {
    const [row] = await this.db.select().from(schema.driverCostEntries).where(and(eq(schema.driverCostEntries.driverId, driverId), eq(schema.driverCostEntries.month, month))).limit(1);
    return row;
  }

  async getCosts(userId: string, month: string): Promise<DriverCostsView> {
    const driver = await this.requireDriver(userId);
    return this.costsView(month, await this.costRow(driver.id, month));
  }

  /** `PUT /driver/costs/{mois}` : remplace les postes du mois (le détail des montants n'entre pas au journal d'audit). */
  async saveCosts(userId: string, month: string, input: Required<DriverCostsInput>, now = new Date()): Promise<DriverCostsView> {
    const driver = await this.requireDriver(userId);
    const values = { ...input, updatedAt: now };
    const [row] = await this.db
      .insert(schema.driverCostEntries)
      .values({ driverId: driver.id, month, ...values })
      .onConflictDoUpdate({ target: [schema.driverCostEntries.driverId, schema.driverCostEntries.month], set: values })
      .returning();
    this.audit.record({ action: 'pilot.costs_updated', entity: 'drivers', entityId: driver.id, after: { month } });
    return this.costsView(month, row);
  }

  private currentMonth(timeZone: string, now = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(now);
    return `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}`;
  }

  /**
   * `GET /driver/profitability` : revenus Neomoov du mois (mêmes règles que l'écran Revenus : tarif et pourboires des
   * courses terminées, frais d'annulation et de non-présentation), packs achetés, redevance Neomoov des courses terminées
   * (3 octobre 2026), coûts et revenus externes saisis.
   */
  async profitability(userId: string, month?: string): Promise<DriverProfitabilityView> {
    const driver = await this.requireDriver(userId);
    const cfg = await this.config();
    const period = month ?? this.currentMonth(cfg.timeZone);
    const tz = cfg.timeZone;
    const start = sql`(${`${period}-01`}::date::timestamp AT TIME ZONE ${tz})`;
    const end = sql`((${`${period}-01`}::date + interval '1 month')::timestamp AT TIME ZONE ${tz})`;
    const at = sql`COALESCE(${schema.rides.stateTimestamps}->>'completed', ${schema.rides.stateTimestamps}->>'no_show', ${schema.rides.stateTimestamps}->>'cancelled_by_client')::timestamptz`;
    const [rides, packs, costs, fees] = await Promise.all([
      this.db
        .select({ state: schema.rides.state, fareCents: schema.rides.fareCents, tipCents: schema.rides.tipCents, cancellationFeeCents: schema.rides.cancellationFeeCents })
        .from(schema.rides)
        .where(and(
          eq(schema.rides.driverId, driver.id),
          sql`(${schema.rides.state} IN ('completed', 'rated', 'disputed') OR (${schema.rides.state} IN ('no_show', 'cancelled_by_client') AND ${schema.rides.cancellationFeeCents} > 0))`,
          sql`${at} >= ${start}`, sql`${at} < ${end}`,
        )),
      this.db.execute<{ total: number | string | null }>(sql`
        SELECT coalesce(sum(price_paid_cents), 0)::int AS total FROM pack_purchases
        WHERE driver_id = ${driver.id}::uuid AND status <> 'cancelled' AND activated_at >= ${start} AND activated_at < ${end}`),
      this.costRow(driver.id, period),
      this.db.execute<{ total: number | string | null }>(sql`
        SELECT coalesce(sum(pf.amount_cents), 0)::int AS total FROM platform_fees pf JOIN rides r ON r.id = pf.ride_id
        WHERE pf.driver_id = ${driver.id}::uuid AND (r.state_timestamps->>'completed')::timestamptz >= ${start} AND (r.state_timestamps->>'completed')::timestamptz < ${end}`),
    ]);
    const lines = rides.map((r) => (['completed', 'rated', 'disputed'].includes(r.state) ? { fareCents: r.fareCents ?? 0, tipCents: r.tipCents } : { fareCents: r.cancellationFeeCents, tipCents: r.tipCents, fee: true }));
    const result = netProfitability(lines, {
      vehicle: costs?.vehicleCents ?? 0, insurance: costs?.insuranceCents ?? 0, energy: costs?.energyCents ?? 0, maintenance: costs?.maintenanceCents ?? 0, phone: costs?.phoneCents ?? 0, other: costs?.otherCents ?? 0,
      packsCents: Number(packs[0]?.total ?? 0),
      platformFeesCents: Number(fees[0]?.total ?? 0),
    }, costs?.externalRevenueCents ?? 0);
    return { month: period, ...result, costsEntered: Boolean(costs) };
  }

  // --- Agenda ---

  private async travelSeconds(from: GeoPoint, to: GeoPoint): Promise<number | null> {
    try {
      const [seconds] = await this.maps.etaMatrix([from], to);
      return typeof seconds === 'number' && Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : null;
    } catch {
      return null;
    }
  }

  /**
   * `GET /driver/agenda` : réservations attribuées des 7 prochains jours, chaînées ; départ conseillé depuis la position
   * envoyée par l'application (consentement à la localisation déjà donné), sinon la dernière position en ligne.
   */
  async agenda(userId: string, position: GeoPoint | null, now = new Date()): Promise<DriverAgendaView> {
    const driver = await this.requireDriver(userId);
    const cfg = await this.config();
    // Les 10 réservations les plus proches (et non les 10 dernières créées), puis leurs lignes complètes.
    const upcoming = await this.db
      .select({ id: schema.rides.id })
      .from(schema.rides)
      .where(and(
        eq(schema.rides.driverId, driver.id), eq(schema.rides.type, 'scheduled'), eq(schema.rides.state, 'assigned'), isNotNull(schema.rides.requestedAt),
        gte(schema.rides.requestedAt, new Date(now.getTime() - 2 * 3_600_000)), lt(schema.rides.requestedAt, new Date(now.getTime() + 7 * 86_400_000)),
      ))
      .orderBy(asc(schema.rides.requestedAt), asc(schema.rides.id))
      .limit(10);
    const rows = upcoming.length
      ? (await selectRides(this.db, inArray(schema.rides.id, upcoming.map((r) => r.id)))).sort((a, b) => a.requestedAt!.getTime() - b.requestedAt!.getTime())
      : [];
    let from: DriverAgendaView['from'] = position ? 'position' : 'none';
    let previous: GeoPoint | null = position;
    if (!previous) {
      previous = await this.presence.positionOf(driver.id);
      if (previous) from = 'presence';
    }
    const travels: Array<number | null> = [];
    for (const ride of rows) {
      travels.push(previous ? await this.travelSeconds(previous, parseGeoPoint(ride.originGeo)) : null);
      previous = parseGeoPoint(ride.destinationGeo);
    }
    const entries = chainAgenda(rows.map((r, i) => ({ id: r.id, startsAt: r.requestedAt!, durationSeconds: r.durationSeconds, travelSeconds: travels[i] ?? null })), {
      now, bufferSeconds: cfg.bufferSeconds, alertSeconds: cfg.alertSeconds, defaultDurationSeconds: DEFAULT_RIDE_SECONDS,
    });
    const byId = new Map(rows.map((r, i) => [r.id, { ride: r, travel: travels[i] ?? null }]));
    return {
      from, alertMinutes: Math.round(cfg.alertSeconds / 60),
      items: entries.map((e) => {
        const { ride, travel } = byId.get(e.id)!;
        return {
          rideId: ride.id, publicNumber: ride.publicNumber, requestedAt: e.startsAt.toISOString(), endsAt: e.endsAt.toISOString(),
          origin: { address: ride.originAddress, coordinates: parseGeoPoint(ride.originGeo) }, destination: { address: ride.destinationAddress, coordinates: parseGeoPoint(ride.destinationGeo) },
          driverFareCents: ride.fareCents ?? 0, travelSeconds: travel, leaveAt: e.leaveAt?.toISOString() ?? null, gapSeconds: e.gapSeconds, conflict: e.conflict, status: e.status,
        };
      }),
    };
  }

  // --- Surveillance des exclusions de zones ---

  /**
   * Zones surveillées (`pilot.watched_zones`) exclues par les critères du chauffeur : courriel au personnel, une seule
   * fois par chauffeur et par zone (marqueur `alert.pilot_zone_exclusion` au journal d'audit, posé sous verrou).
   */
  private async alertWatchedZones(driver: { id: string; publicNumber: string }, criteria: PilotCriteria, cfg: PilotConfig, zones: Array<{ code: string; type: string }>): Promise<string[]> {
    if (!cfg.watchedZones.length) return [];
    const exclusions = pilotZoneExclusions(criteria, zones);
    const watched = watchedZonesExcluded(exclusions, cfg.watchedZones);
    if (!watched.length) return [];
    const fresh = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`pilot-zones:${driver.id}`}))`);
      const done = await tx.select({ after: schema.auditLog.after }).from(schema.auditLog).where(and(eq(schema.auditLog.action, ZONE_ALERT), eq(schema.auditLog.entity, 'drivers'), eq(schema.auditLog.entityId, driver.id)));
      const already = new Set(done.map((r) => (r.after as { zone?: unknown } | null)?.zone).filter((z): z is string => typeof z === 'string'));
      const added = watched.filter((z) => !already.has(z));
      if (added.length) await tx.insert(schema.auditLog).values(added.map((zone) => ({ action: ZONE_ALERT, entity: 'drivers', entityId: driver.id, after: { zone, origin: exclusions.origin.includes(zone), destination: exclusions.destination.includes(zone) } })));
      return added;
    });
    for (const zone of fresh) {
      await this.outbox.queueForStaff(ZONE_ALERT, { driverPublicNumber: driver.publicNumber, zone, origin: exclusions.origin.includes(zone), destination: exclusions.destination.includes(zone) });
    }
    if (fresh.length) this.logger.warn({ driverId: driver.id, zones: fresh }, 'Neomoov Pilote : zone surveillée exclue, personnel alerté');
    return fresh;
  }

  /** `GET /admin/pilot/zone-exclusions` : chauffeurs dont les critères excluent des zones, zones et nombres. */
  async zoneExclusions(): Promise<PilotZoneExclusionsView> {
    const [cfg, zones, rows] = await Promise.all([
      this.config(),
      this.zones.all(),
      this.db
        .select({ driverId: schema.driverPilotSettings.driverId, enabled: schema.driverPilotSettings.enabled, criteria: schema.driverPilotSettings.criteria, publicNumber: schema.drivers.publicNumber })
        .from(schema.driverPilotSettings)
        .innerJoin(schema.drivers, eq(schema.drivers.id, schema.driverPilotSettings.driverId)),
    ]);
    const drivers: PilotZoneExclusionsView['drivers'] = [];
    for (const row of rows) {
      const criteria = parsePilotCriteria(row.criteria);
      if (!criteria) continue;
      const exclusions = pilotZoneExclusions(criteria, zones);
      if (!exclusions.origin.length && !exclusions.destination.length) continue;
      drivers.push({ driverId: row.driverId, publicNumber: row.publicNumber, enabled: row.enabled, ...exclusions, watched: watchedZonesExcluded(exclusions, cfg.watchedZones) });
    }
    const stats = zones
      .filter((z) => z.type !== 'service_area')
      .map((z) => {
        const origin = drivers.filter((d) => d.origin.includes(z.code));
        const destination = drivers.filter((d) => d.destination.includes(z.code));
        const any = drivers.filter((d) => d.origin.includes(z.code) || d.destination.includes(z.code));
        return { code: z.code, name: z.name, type: z.type, watched: cfg.watchedZones.includes(z.code), drivers: any.length, enabledDrivers: any.filter((d) => d.enabled).length, origin: origin.length, destination: destination.length };
      })
      .sort((a, b) => b.drivers - a.drivers || a.code.localeCompare(b.code));
    drivers.sort((a, b) => b.watched.length - a.watched.length || a.publicNumber.localeCompare(b.publicNumber));
    return { watchedZones: cfg.watchedZones, zones: stats, drivers };
  }
}
