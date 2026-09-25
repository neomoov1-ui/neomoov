/**
 * Activité du chauffeur (prompt 11) : accueil en une requête, revenus, relevés, packs (activation ; la consommation
 * viendra avec l'étape 8), clients fidèles (D38), tableau de conduite, fiche de course, fin de course (paiement direct
 * reçu, évaluation du client), incident, vérification faciale (V1.1, drapeau). Tous les montants sont calculés ici.
 */
import { randomUUID } from 'node:crypto';
import { schema } from '@neomoov/db';
import {
  activatePack, activationPriceCents, activePack, analyseDriving, daysBetween, isCredit, localDate, remainingRides, scoreSuggestions,
  type DriverAlert, type DriverDocumentsView, type DriverHomeView, type DriverJob, type DriverPacksView, type DriverRideView, type DriverScoreView, type DriverStatementView,
  type EarningsView, type LoyalClientView, type PackDefinition, type PackPurchase, type PaymentMethod, type ScheduledRideView, type ScoreTargets,
  type StatementLineKind, type StatementSummary,
} from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, isNull, lte, sql } from 'drizzle-orm';
import { AppError } from '../../common/app-error.js';
import { DomainEventsService } from '../../common/domain-events.js';
import { SettingsService } from '../../common/settings.service.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AuditService } from '../audit/audit.service.js';
import { PresenceService } from '../rides/presence.service.js';
import { parseGeoPoint, preferencesOf, selectRides, type RideRow } from '../rides/ride-view.js';
import { RidesService } from '../rides/rides.service.js';
import { DriverProfileService, type DriverRow } from './driver-profile.service.js';

type Period = 'day' | 'week' | 'month';
type PackRow = typeof schema.packs.$inferSelect;
type PurchaseRow = typeof schema.packPurchases.$inferSelect;

const DAY_MS = 86_400_000;

/** Jour civil décalé de `days` (AAAA-MM-JJ). */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Bornes locales d'une période : le jour, la semaine du lundi au dimanche (5.8), le mois civil. */
export function periodRange(period: Period, date: string): { from: string; to: string } {
  if (period === 'day') return { from: date, to: date };
  if (period === 'week') {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const from = addDays(date, -((weekday + 6) % 7));
    return { from, to: addDays(from, 6) };
  }
  const [y, m] = date.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${date.slice(0, 7)}-01`, to: `${date.slice(0, 7)}-${String(last).padStart(2, '0')}` };
}

const INCIDENT_MAPPING: Record<string, { type: 'accident' | 'complaint' | 'lost_item' | 'other'; severity: 'medium' | 'high' }> = {
  accident: { type: 'accident', severity: 'high' },
  aggression: { type: 'complaint', severity: 'high' },
  damage: { type: 'other', severity: 'medium' },
  lost_item: { type: 'lost_item', severity: 'medium' },
  client_behaviour: { type: 'complaint', severity: 'medium' },
  vehicle_problem: { type: 'other', severity: 'medium' },
  other: { type: 'other', severity: 'medium' },
};

@Injectable()
export class DriverActivityService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly settings: SettingsService,
    private readonly profiles: DriverProfileService,
    private readonly presence: PresenceService,
    private readonly rides: RidesService,
    private readonly events: DomainEventsService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.database.db;
  }

  // Accueil --------------------------------------------------------------------------------------------------------

  async home(userId: string): Promise<DriverHomeView> {
    const driver = await this.profiles.requireDriver(userId);
    const today = await this.profiles.today();
    const [user, presence, eligibility, docs, packs, dayEarnings, weekEarnings, nextScheduled] = await Promise.all([
      this.db.select({ firstName: schema.users.firstName }).from(schema.users).where(eq(schema.users.id, userId)).limit(1),
      this.presence.statusOf(userId),
      this.presence.eligibility(driver, driver.currentVehicleId),
      this.profiles.documentsOf(driver),
      this.packsOf(driver),
      this.earningsOf(driver, 'day', today),
      this.earningsOf(driver, 'week', today),
      this.nextScheduled(driver),
    ]);
    // Documents et packs lus une fois, partagés par l'assistant d'inscription et les alertes.
    const [onboarding, alerts] = await Promise.all([this.profiles.onboarding(driver, docs, packs.active !== null), this.alertsOf(driver, docs, packs)]);
    return {
      profile: { firstName: user[0]?.firstName ?? null, publicNumber: driver.publicNumber, status: driver.status },
      presence,
      blockers: eligibility.reasons,
      onboarding,
      pack: packs.active,
      earnings: { today: dayEarnings.totals, week: weekEarnings.totals },
      nextScheduled,
      alerts,
      features: { faceCheck: this.env.FEATURE_FACE_CHECK, negotiation: this.env.FEATURE_NEGOTIATION },
    };
  }

  private scheduledView(r: RideRow, assignment: { id: string; proposedAt: Date; confirmedAt: Date | null } | null): ScheduledRideView {
    return {
      id: r.id, publicNumber: r.publicNumber, state: r.state, category: r.reservedCategory, requestedAt: r.requestedAt!.toISOString(),
      origin: { address: r.originAddress, coordinates: parseGeoPoint(r.originGeo) }, destination: { address: r.destinationAddress, coordinates: parseGeoPoint(r.destinationGeo) },
      driverFareCents: r.fareCents ?? 0, paymentMethod: r.paymentMethod,
      assignment: assignment ? { id: assignment.id, proposedAt: assignment.proposedAt.toISOString(), confirmedAt: assignment.confirmedAt?.toISOString() ?? null } : null,
    };
  }

  /** Prochaine course planifiée attribuée au chauffeur (confirmée ou à confirmer). */
  private async nextScheduled(driver: DriverRow): Promise<ScheduledRideView | null> {
    const upcoming = await selectRides(this.db, and(eq(schema.rides.driverId, driver.id), eq(schema.rides.type, 'scheduled'), eq(schema.rides.state, 'assigned'), gt(schema.rides.requestedAt, new Date())), { limit: 50 });
    const next = upcoming.sort((a, b) => a.requestedAt!.getTime() - b.requestedAt!.getTime())[0];
    if (!next) return null;
    const [assignment] = await this.db
      .select({ id: schema.scheduledAssignments.id, proposedAt: schema.scheduledAssignments.proposedAt, confirmedAt: schema.scheduledAssignments.confirmedAt })
      .from(schema.scheduledAssignments)
      .where(and(eq(schema.scheduledAssignments.rideId, next.id), eq(schema.scheduledAssignments.driverId, driver.id), isNull(schema.scheduledAssignments.declinedAt)))
      .orderBy(desc(schema.scheduledAssignments.proposedAt))
      .limit(1);
    return this.scheduledView(next, assignment ?? null);
  }

  /** Alertes de l'accueil, les plus graves d'abord : documents, solde, pack, formation, versements, note, planifiées. */
  private async alertsOf(driver: DriverRow, docs: DriverDocumentsView, packs: DriverPacksView): Promise<DriverAlert[]> {
    const alerts: DriverAlert[] = [];
    const [balance, payoutRequired, trainingRequired, targets, unconfirmed] = await Promise.all([
      this.db.select().from(schema.driverBalances).where(eq(schema.driverBalances.driverId, driver.id)).limit(1),
      this.settings.get<boolean>('drivers.require_payout_account', false),
      this.settings.get<boolean>('drivers.require_training', true),
      this.scoreTargets(),
      this.db
        .select({ id: schema.scheduledAssignments.id })
        .from(schema.scheduledAssignments)
        .where(and(
          eq(schema.scheduledAssignments.driverId, driver.id), isNull(schema.scheduledAssignments.confirmedAt), isNull(schema.scheduledAssignments.declinedAt),
          // Seules les courses à venir encore ouvertes : une proposition restée sans réponse sur une course passée ne compte plus.
          sql`${schema.scheduledAssignments.rideId} IN (SELECT r.id FROM rides r WHERE r.requested_at > now() AND r.state IN ('requested', 'offering', 'assigned'))`,
        )),
    ]);
    if (driver.status === 'suspended') alerts.push({ code: 'suspended', severity: 'critical', params: {} });
    for (const item of docs.items) {
      if (item.state === 'expired') alerts.push({ code: 'document_expired', severity: 'critical', params: { type: item.type } });
      else if (item.state === 'rejected') alerts.push({ code: 'document_rejected', severity: 'warning', params: { type: item.type } });
      else if (item.state === 'expiring') alerts.push({ code: 'document_expiring', severity: 'warning', params: { type: item.type, days: item.daysToExpiry ?? 0 } });
    }
    const account = balance[0];
    if (account?.suspendedForBalanceAt) alerts.push({ code: 'balance_suspended', severity: 'critical', params: { amountCents: -account.balanceCents } });
    else if (account && account.balanceCents < 0) alerts.push({ code: 'balance_negative', severity: 'warning', params: { amountCents: -account.balanceCents } });
    const lowThreshold = await this.settings.number('packs.low_threshold', 3);
    if (packs.active && packs.active.ridesRemaining !== null && packs.active.ridesRemaining <= lowThreshold) alerts.push({ code: 'pack_low', severity: 'warning', params: { remaining: packs.active.ridesRemaining } });
    if (!packs.active && packs.required) alerts.push({ code: 'pack_missing', severity: 'critical', params: {} });
    if (!driver.trainingCertifiedAt && trainingRequired) alerts.push({ code: 'training_required', severity: 'warning', params: {} });
    if (!driver.stripeConnectOnboarded && payoutRequired) alerts.push({ code: 'payout_required', severity: 'warning', params: {} });
    const rating = Number(driver.ratingAverage);
    if (driver.ratingCount >= 10 && rating < targets.minRating) alerts.push({ code: 'rating_warning', severity: 'warning', params: { rating } });
    if (unconfirmed.length) alerts.push({ code: 'scheduled_to_confirm', severity: 'info', params: { count: unconfirmed.length } });
    const order = { critical: 0, warning: 1, info: 2 } as const;
    return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
  }

  // Revenus ----------------------------------------------------------------------------------------------------------

  async earnings(userId: string, period: Period, date?: string): Promise<EarningsView> {
    const driver = await this.profiles.requireDriver(userId);
    return this.earningsOf(driver, period, date ?? (await this.profiles.today()));
  }

  /**
   * Revenus d'une période (heure de Montréal) : tarif du chauffeur et pourboires des courses terminées, frais
   * d'annulation et de non-présentation qui lui reviennent. `collectedDirectCents` : ce que les clients lui ont payé
   * directement (il reverse les frais de service au relevé).
   */
  private async earningsOf(driver: DriverRow, period: Period, date: string): Promise<EarningsView> {
    const tz = await this.profiles.timeZone();
    const { from, to } = periodRange(period, date);
    const at = sql`COALESCE(${schema.rides.stateTimestamps}->>'completed', ${schema.rides.stateTimestamps}->>'no_show', ${schema.rides.stateTimestamps}->>'cancelled_by_client')::timestamptz`;
    const rows = await this.db
      .select({
        id: schema.rides.id, publicNumber: schema.rides.publicNumber, state: schema.rides.state, fareCents: schema.rides.fareCents, tipCents: schema.rides.tipCents,
        cancellationFeeCents: schema.rides.cancellationFeeCents, finalPriceCents: schema.rides.finalPriceCents, paymentMethod: schema.rides.paymentMethod, paymentChoice: schema.rides.paymentChoice,
        at: sql<string>`${at}`,
      })
      .from(schema.rides)
      .where(and(
        eq(schema.rides.driverId, driver.id),
        sql`(${schema.rides.state} IN ('completed', 'rated', 'disputed') OR (${schema.rides.state} IN ('no_show', 'cancelled_by_client') AND ${schema.rides.cancellationFeeCents} > 0))`,
        sql`${at} >= (${from}::date::timestamp AT TIME ZONE ${tz})`,
        sql`${at} < ((${to}::date + 1)::timestamp AT TIME ZONE ${tz})`,
      ))
      .orderBy(desc(at));
    let fareCents = 0;
    let tipsCents = 0;
    let rides = 0;
    let collectedDirectCents = 0;
    const items = rows.map((r) => {
      const completed = ['completed', 'rated', 'disputed'].includes(r.state);
      const direct = r.paymentChoice === 'pay_driver_after';
      const fare = completed ? (r.fareCents ?? 0) : r.cancellationFeeCents;
      fareCents += fare;
      tipsCents += r.tipCents;
      if (completed) rides += 1;
      if (completed && direct) collectedDirectCents += r.finalPriceCents ?? 0;
      return {
        rideId: r.id, publicNumber: r.publicNumber, kind: completed ? ('ride' as const) : ('cancellation_fee' as const), at: new Date(r.at).toISOString(),
        fareCents: fare, tipCents: r.tipCents, paymentMethod: r.paymentMethod as PaymentMethod, collectedBy: completed && direct ? ('driver' as const) : ('platform' as const),
      };
    });
    return { period, from, to, totals: { fareCents, tipsCents, totalCents: fareCents + tipsCents, rides }, collectedDirectCents, items };
  }

  // Relevés ----------------------------------------------------------------------------------------------------------

  private statementSummary(row: typeof schema.weeklyStatements.$inferSelect): StatementSummary {
    return {
      id: row.id, periodStart: row.periodStart, periodEnd: row.periodEnd, status: row.status, creditsCents: row.creditsCents, debitsCents: row.debitsCents, netCents: row.netCents,
      issuedAt: row.issuedAt?.toISOString() ?? null, settledAt: row.settledAt?.toISOString() ?? null, pdfAvailable: Boolean(row.pdfKey),
    };
  }

  /** Relevés émis (les brouillons restent dans My Hub) ; la génération hebdomadaire arrive à l'étape 9. */
  async statements(userId: string): Promise<StatementSummary[]> {
    const driver = await this.profiles.requireDriver(userId);
    const rows = await this.db
      .select()
      .from(schema.weeklyStatements)
      .where(and(eq(schema.weeklyStatements.driverId, driver.id), sql`${schema.weeklyStatements.status} <> 'draft'`))
      .orderBy(desc(schema.weeklyStatements.periodStart))
      .limit(52);
    return rows.map((r) => this.statementSummary(r));
  }

  /** Détail d'un relevé : chaque ligne renvoie à sa course ou à son pack ; crédits positifs, débits négatifs. */
  async statement(userId: string, id: string): Promise<DriverStatementView> {
    const driver = await this.profiles.requireDriver(userId);
    const [row] = await this.db.select().from(schema.weeklyStatements).where(and(eq(schema.weeklyStatements.id, id), eq(schema.weeklyStatements.driverId, driver.id))).limit(1);
    if (!row || row.status === 'draft') throw AppError.notFound('STATEMENT_NOT_FOUND', 'Relevé introuvable');
    const lines = await this.db.select().from(schema.statementLines).where(eq(schema.statementLines.statementId, id)).orderBy(asc(schema.statementLines.occurredAt));
    return {
      ...this.statementSummary(row),
      lines: lines.map((l) => ({
        kind: l.kind, label: l.label, amountCents: isCredit(l.kind as StatementLineKind) ? l.amountCents : -l.amountCents, rideId: l.rideId, packPurchaseId: l.packPurchaseId, occurredAt: l.occurredAt.toISOString(),
      })),
    };
  }

  // Packs ------------------------------------------------------------------------------------------------------------

  private packDefinition(row: PackRow): PackDefinition {
    return { code: row.code, ridesIncluded: row.ridesIncluded, priceCents: row.priceCents, validityDays: row.validityDays, discovery: row.code === 'discovery', priorityBonus: row.code === 'unlimited' };
  }

  private purchaseOf(row: PurchaseRow): PackPurchase {
    return {
      id: row.id, driverId: row.driverId, packCode: row.packCode, ridesIncluded: row.ridesIncluded, ridesRemaining: row.ridesRemaining ?? 0, carriedOverRemaining: row.carriedOverRemaining,
      activatedAt: row.activatedAt, expiresAt: row.expiresAt, status: row.status, autoRenew: row.autoRenew, nextPackCode: row.nextPackCode, rolloverDone: row.rolloverDone, billing: row.billing,
    };
  }

  private async packSettings() {
    const [lowThreshold, rolloverWindowDays, discoveryFirstDrivers] = await Promise.all([
      this.settings.number('packs.low_threshold', 3), this.settings.number('packs.rollover_window_days', 7), this.settings.number('packs.discovery_free_first_drivers', 100),
    ]);
    return { lowThreshold, rolloverWindowDays, discoveryFirstDrivers };
  }

  async packs(userId: string): Promise<DriverPacksView> {
    return this.packsOf(await this.profiles.requireDriver(userId));
  }

  private async packsOf(driver: DriverRow): Promise<DriverPacksView> {
    const [catalog, purchases, settings, required, rank] = await Promise.all([
      this.db.select().from(schema.packs).where(eq(schema.packs.active, true)).orderBy(asc(schema.packs.sortOrder)),
      this.db.select().from(schema.packPurchases).where(eq(schema.packPurchases.driverId, driver.id)).orderBy(desc(schema.packPurchases.activatedAt)),
      this.packSettings(),
      this.settings.get<boolean>('drivers.require_active_pack', false),
      this.db.select({ n: sql<number>`count(*)::int` }).from(schema.drivers).where(lte(schema.drivers.createdAt, driver.createdAt)),
    ]);
    const now = new Date();
    const domainPurchases = purchases.map((p) => this.purchaseOf(p));
    const profile = { driverId: driver.id, isRLuxeEvTenant: false, discoveryUsed: purchases.some((p) => p.packCode === 'discovery'), signupRank: rank[0]?.n ?? Number.MAX_SAFE_INTEGER };
    const active = activePack(domainPurchases, now);
    const names = new Map(catalog.map((c) => [c.code, c.name]));
    return {
      catalog: catalog.map((c) => {
        const price = activationPriceCents(this.packDefinition(c), profile, settings);
        return { code: c.code, name: c.name, ridesIncluded: c.ridesIncluded, priceCents: c.priceCents, validityDays: c.validityDays, priceForMeCents: price.priceCents, available: price.allowed };
      }),
      active: active ? { id: active.id, code: active.packCode as PackRow['code'], name: names.get(active.packCode as PackRow['code']) ?? active.packCode, ridesRemaining: remainingRides(active), expiresAt: active.expiresAt.toISOString(), autoRenew: active.autoRenew } : null,
      history: purchases.map((p) => ({
        id: p.id, code: p.packCode, pricePaidCents: p.pricePaidCents, ridesIncluded: p.ridesIncluded, ridesRemaining: p.ridesRemaining, carriedOverRemaining: p.carriedOverRemaining,
        activatedAt: p.activatedAt.toISOString(), expiresAt: p.expiresAt.toISOString(), status: p.status, autoRenew: p.autoRenew, nextPackCode: p.nextPackCode, billing: p.billing,
      })),
      required: required === true,
    };
  }

  /**
   * Activation (5.7) : actif immédiatement, facturé au relevé suivant (jamais d'avance). Avec un pack en cours, le
   * nouveau choix prend effet à son épuisement (`nextPackCode`) ; le même pack ne fait que changer le renouvellement.
   */
  async activatePack(userId: string, input: { packCode: PackRow['code']; autoRenew: boolean }): Promise<DriverPacksView> {
    const driver = await this.profiles.requireDriver(userId);
    const [pack] = await this.db.select().from(schema.packs).where(and(eq(schema.packs.code, input.packCode), eq(schema.packs.active, true))).limit(1);
    if (!pack) throw AppError.notFound('PACK_NOT_FOUND', 'Pack introuvable');
    const settings = await this.packSettings();
    // Un verrou par chauffeur : deux activations simultanées ne créent jamais deux packs actifs ni deux Découverte.
    const created = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${driver.id}))`);
      const purchases = await tx.select().from(schema.packPurchases).where(eq(schema.packPurchases.driverId, driver.id));
      const now = new Date();
      const current = activePack(purchases.map((p) => this.purchaseOf(p)), now);
      if (current) {
        const set = current.packCode === input.packCode ? { autoRenew: input.autoRenew, nextPackCode: null } : { nextPackCode: input.packCode, autoRenew: true };
        await tx.update(schema.packPurchases).set(set).where(eq(schema.packPurchases.id, current.id));
        return null;
      }
      const [rank] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.drivers).where(lte(schema.drivers.createdAt, driver.createdAt));
      const profile = { driverId: driver.id, isRLuxeEvTenant: false, discoveryUsed: purchases.some((p) => p.packCode === 'discovery'), signupRank: rank?.n ?? Number.MAX_SAFE_INTEGER };
      const price = activationPriceCents(this.packDefinition(pack), profile, settings);
      if (!price.allowed) throw AppError.conflict('DISCOVERY_ALREADY_USED', 'Le pack Découverte ne s\'active qu\'une seule fois');
      const purchase = activatePack(randomUUID(), driver.id, this.packDefinition(pack), price.priceCents, now, input.autoRenew);
      await tx.insert(schema.packPurchases).values({
        id: purchase.id, driverId: driver.id, packCode: pack.code, pricePaidCents: price.priceCents, ridesIncluded: purchase.ridesIncluded, ridesRemaining: purchase.ridesIncluded === null ? null : purchase.ridesRemaining,
        carriedOverRemaining: 0, activatedAt: purchase.activatedAt, expiresAt: purchase.expiresAt, status: 'active', autoRenew: purchase.autoRenew, billing: purchase.billing,
      });
      return { id: purchase.id, priceCents: price.priceCents };
    });
    if (created) this.audit.record({ action: 'driver.pack_activated', entity: 'pack_purchases', entityId: created.id, after: { packCode: pack.code, priceCents: created.priceCents } });
    return this.packsOf(driver);
  }

  async updatePack(userId: string, id: string, input: { autoRenew?: boolean | undefined; nextPackCode?: PackRow['code'] | null | undefined }): Promise<DriverPacksView> {
    const driver = await this.profiles.requireDriver(userId);
    const set = { ...(input.autoRenew !== undefined ? { autoRenew: input.autoRenew } : {}), ...(input.nextPackCode !== undefined ? { nextPackCode: input.nextPackCode } : {}) };
    const [row] = await this.db.update(schema.packPurchases).set(set).where(and(eq(schema.packPurchases.id, id), eq(schema.packPurchases.driverId, driver.id))).returning({ id: schema.packPurchases.id });
    if (!row) throw AppError.notFound('PACK_PURCHASE_NOT_FOUND', 'Pack introuvable');
    return this.packsOf(driver);
  }

  // Clients fidèles (D38) --------------------------------------------------------------------------------------------

  async loyalClients(userId: string): Promise<LoyalClientView[]> {
    const driver = await this.profiles.requireDriver(userId);
    const rows = await this.db
      .select({
        clientId: schema.clientDriverLinks.clientId, ridesCount: schema.clientDriverLinks.ridesCount, lastRideAt: schema.clientDriverLinks.lastRideAt,
        favouriteSince: sql<Date | null>`COALESCE(${schema.clientDriverLinks.favoriteSince}, (SELECT f.created_at FROM favorite_drivers f WHERE f.client_id = ${schema.clientDriverLinks.clientId} AND f.driver_id = ${driver.id}))`,
        firstName: schema.users.firstName,
      })
      .from(schema.clientDriverLinks)
      .innerJoin(schema.clients, eq(schema.clients.id, schema.clientDriverLinks.clientId))
      .innerJoin(schema.users, eq(schema.users.id, schema.clients.userId))
      .where(and(eq(schema.clientDriverLinks.driverId, driver.id), isNull(schema.users.deletedAt)))
      .orderBy(desc(schema.clientDriverLinks.ridesCount))
      .limit(200);
    const minRides = await this.settings.number('drivers.loyal_client_min_rides', 2);
    return rows
      .map((r) => {
        const since = r.favouriteSince ? new Date(r.favouriteSince) : null;
        return { clientId: r.clientId, firstName: r.firstName, favourite: since !== null, favouriteSince: since?.toISOString() ?? null, ridesCount: r.ridesCount, lastRideAt: r.lastRideAt?.toISOString() ?? null };
      })
      .filter((c) => c.favourite || c.ridesCount >= minRides)
      .sort((a, b) => Number(b.favourite) - Number(a.favourite) || b.ridesCount - a.ridesCount);
  }

  // Tableau de conduite ------------------------------------------------------------------------------------------------

  private async scoreTargets(): Promise<ScoreTargets> {
    const raw = await this.settings.get<Partial<ScoreTargets>>('driving.score_targets', {});
    return { minRating: 4.6, restrictionRating: 4.4, minPunctualityPct: 90, maxCancellations: 2, maxHarshPer100Km: 2, ...(raw && typeof raw === 'object' ? raw : {}) };
  }

  /**
   * Compteurs d'un jour (heure de Montréal) : conduite à partir des positions, courses terminées, ponctualité des
   * réservations (arrivée au plus tard à l'heure prévue plus la tolérance), annulations du chauffeur.
   */
  private async dayCounters(driver: DriverRow, day: string, tz: string) {
    const start = sql`(${day}::date::timestamp AT TIME ZONE ${tz})`;
    const end = sql`((${day}::date + 1)::timestamp AT TIME ZONE ${tz})`;
    const [thresholds, tolerance] = await Promise.all([
      this.settings.get<Record<string, number>>('driving.thresholds', {}),
      this.settings.number('driving.punctuality_tolerance_seconds', 120),
    ]);
    const [points, completed, cancellations] = await Promise.all([
      this.db.execute<{ lat: number; lng: number; speed: number | null; at: string }>(sql`
        SELECT ST_Y(position::geometry) AS lat, ST_X(position::geometry) AS lng, speed_mps AS speed, recorded_at AS at
        FROM driver_locations WHERE driver_id = ${driver.id} AND recorded_at >= ${start} AND recorded_at < ${end} ORDER BY recorded_at LIMIT 50000`),
      this.db.execute<{ requested_at: string | null; arrived: string | null; type: string }>(sql`
        SELECT requested_at, state_timestamps->>'arrived' AS arrived, type FROM rides
        WHERE driver_id = ${driver.id} AND state IN ('completed', 'rated', 'disputed')
          AND (state_timestamps->>'completed')::timestamptz >= ${start} AND (state_timestamps->>'completed')::timestamptz < ${end}`),
      this.db.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM ride_events WHERE actor_user_id = ${driver.userId} AND type = 'driver_cancels' AND occurred_at >= ${start} AND occurred_at < ${end}`),
    ]);
    const analysis = analyseDriving(
      [...points].map((p) => ({ at: new Date(p.at).getTime(), lat: Number(p.lat), lng: Number(p.lng), speedMps: p.speed === null ? null : Number(p.speed) })),
      { harshAccelerationMps2: 2.5, harshBrakingMps2: 3, minGapSeconds: 1, maxGapSeconds: 10, ...thresholds },
    );
    const timed = [...completed].filter((r) => r.type === 'scheduled' && r.requested_at && r.arrived);
    const punctual = timed.filter((r) => new Date(r.arrived!).getTime() <= new Date(r.requested_at!).getTime() + tolerance * 1000).length;
    return {
      harshAccelerations: analysis.harshAccelerations, harshBrakings: analysis.harshBrakings, distanceMeters: analysis.distanceMeters,
      completedRides: [...completed].length, timedRides: timed.length, punctualRides: punctual, cancellationCount: [...cancellations][0]?.n ?? 0,
    };
  }

  /**
   * Tableau de conduite sur la période glissante (30 jours) : un compteur par jour dans `driver_scores`, calculé une fois
   * pour les jours passés (mis à jour quotidiennement) et recalculé pour aujourd'hui à chaque lecture.
   */
  async score(userId: string): Promise<DriverScoreView> {
    const driver = await this.profiles.requireDriver(userId);
    const [tz, days, targets] = await Promise.all([this.profiles.timeZone(), this.settings.number('driving.score_period_days', 30), this.scoreTargets()]);
    const today = localDate(new Date(), tz).date;
    const periodStart = addDays(today, -(days - 1));
    const stored = await this.db.select().from(schema.driverScores).where(and(eq(schema.driverScores.driverId, driver.id), sql`${schema.driverScores.periodStart} >= ${periodStart}`));
    const firstDay = localDate(driver.createdAt, tz).date;
    const wanted: string[] = [];
    for (let d = daysBetween(firstDay, periodStart) > 0 ? periodStart : firstDay; daysBetween(d, today) >= 0; d = addDays(d, 1)) wanted.push(d);
    const missing = wanted.filter((d) => d === today || !stored.some((s) => s.periodStart === d));
    const computed = await Promise.all(missing.map(async (day) => ({ day, counters: await this.dayCounters(driver, day, tz) })));
    for (const { day, counters } of computed) {
      const punctualityPct = counters.timedRides ? Math.round((counters.punctualRides * 100) / counters.timedRides) : 100;
      await this.db
        .insert(schema.driverScores)
        .values({ driverId: driver.id, periodStart: day, periodEnd: day, punctualityPct, ...counters })
        .onConflictDoUpdate({ target: [schema.driverScores.driverId, schema.driverScores.periodStart], set: { punctualityPct, ...counters, computedAt: new Date() } });
    }
    const rows = [...stored.filter((s) => !missing.includes(s.periodStart)), ...computed.map((c) => ({ periodStart: c.day, ...c.counters }))];
    const sum = (key: 'harshAccelerations' | 'harshBrakings' | 'distanceMeters' | 'completedRides' | 'timedRides' | 'punctualRides' | 'cancellationCount') => rows.reduce((s, r) => s + r[key], 0);
    const timedRides = sum('timedRides');
    const input = {
      punctualityPct: timedRides ? Math.round((sum('punctualRides') * 100) / timedRides) : 100,
      cancellationCount: sum('cancellationCount'),
      harshAccelerations: sum('harshAccelerations'),
      harshBrakings: sum('harshBrakings'),
      distanceMeters: sum('distanceMeters'),
      rating: driver.ratingCount > 0 ? Number(driver.ratingAverage) : null,
      ratingCount: driver.ratingCount,
    };
    return {
      periodStart, periodEnd: today, punctualityPct: input.punctualityPct, cancellationCount: input.cancellationCount, harshAccelerations: input.harshAccelerations, harshBrakings: input.harshBrakings,
      distanceKm: Math.round(input.distanceMeters / 100) / 10, rating: input.rating, ratingCount: input.ratingCount, completedRides: sum('completedRides'),
      suggestions: scoreSuggestions(input, targets), computedAt: new Date().toISOString(),
    };
  }

  // Fiche de course et fin de course ---------------------------------------------------------------------------------

  private async rideOfDriver(userId: string, rideId: string): Promise<{ driver: DriverRow; ride: RideRow }> {
    const driver = await this.profiles.requireDriver(userId);
    const ride = await this.rides.getRide(rideId);
    if (ride.driverId !== driver.id) throw AppError.forbidden('NOT_YOUR_RIDE', 'Cette course n\'est pas la vôtre');
    return { driver, ride };
  }

  private async jobOf(ride: RideRow): Promise<DriverJob> {
    const [client, payment, rating, minWait, minContacts, callNumber] = await Promise.all([
      ride.clientId
        ? this.db.select({ firstName: schema.users.firstName, language: schema.users.language }).from(schema.clients).innerJoin(schema.users, eq(schema.users.id, schema.clients.userId)).where(eq(schema.clients.id, ride.clientId)).limit(1)
        : Promise.resolve([]),
      this.db.select({ confirmed: schema.payments.driverConfirmedCents }).from(schema.payments).where(and(eq(schema.payments.rideId, ride.id), eq(schema.payments.collectedBy, 'driver'))).limit(1),
      this.db.select({ id: schema.rideRatings.id }).from(schema.rideRatings).where(and(eq(schema.rideRatings.rideId, ride.id), eq(schema.rideRatings.authorKind, 'driver'))).limit(1),
      this.settings.number('rides.no_show_min_wait_seconds', 300),
      this.settings.number('rides.no_show_min_contacts', 2),
      this.settings.get<string | null>('telephony.proxy_number', null),
    ]);
    const arrived = (ride.stateTimestamps as Record<string, string> | null)?.['arrived'];
    const direct = ride.paymentChoice === 'pay_driver_after';
    const language = client[0]?.language ?? (ride.guestLanguage === 'en' || ride.guestLanguage === 'fr' ? ride.guestLanguage : null);
    return {
      clientFirstName: client[0]?.firstName ?? ride.guestName?.split(' ')[0] ?? null,
      passengerName: ride.passengerName,
      language: language === 'en' || language === 'fr' ? language : null,
      preferences: preferencesOf(ride.preferences),
      specialRequests: ride.specialRequests,
      paymentChoice: ride.paymentChoice as DriverJob['paymentChoice'],
      driverFareCents: ride.fareCents ?? 0,
      distanceMeters: ride.distanceMeters,
      durationSeconds: ride.durationSeconds,
      waitedSeconds: ride.waitedSeconds,
      contactAttempts: ride.contactAttempts,
      noShow: { availableAt: arrived ? new Date(new Date(arrived).getTime() + minWait * 1000).toISOString() : null, minContacts },
      payment: { direct, amountDueCents: direct ? ride.finalPriceCents : null, confirmedCents: payment[0]?.confirmed ?? null },
      clientRated: rating.length > 0,
      callNumber: typeof callNumber === 'string' && callNumber ? callNumber : null,
    };
  }

  async driverRide(userId: string, rideId: string): Promise<DriverRideView> {
    const { ride } = await this.rideOfDriver(userId, rideId);
    const [view, job] = await Promise.all([this.rides.view(ride), this.jobOf(ride)]);
    return { ...view, job };
  }

  /** Paiement direct (5.6) : le chauffeur confirme le montant reçu ; un écart avec le prix final est signalé à l'opérateur. */
  async paymentReceived(userId: string, rideId: string, amountCents: number): Promise<DriverRideView> {
    const { ride } = await this.rideOfDriver(userId, rideId);
    if (ride.paymentChoice !== 'pay_driver_after') throw AppError.conflict('NOT_DIRECT_PAYMENT', 'Cette course est payée dans l\'application');
    if (!['completed', 'rated', 'disputed'].includes(ride.state)) throw AppError.conflict('RIDE_NOT_COMPLETED', 'La course n\'est pas terminée', { state: ride.state });
    const [existing] = await this.db.select({ id: schema.payments.id }).from(schema.payments).where(and(eq(schema.payments.rideId, ride.id), eq(schema.payments.collectedBy, 'driver'))).limit(1);
    if (existing) await this.db.update(schema.payments).set({ driverConfirmedCents: amountCents, status: 'paid_direct' }).where(eq(schema.payments.id, existing.id));
    else await this.db.insert(schema.payments).values({ rideId: ride.id, clientId: ride.clientId, method: ride.paymentMethod, status: 'paid_direct', collectedBy: 'driver', driverConfirmedCents: amountCents });
    const actor = { kind: 'driver' as const, userId };
    await this.rides.mark(ride.id, 'payment_received_direct', actor, { amountCents, expectedCents: ride.finalPriceCents });
    if (ride.finalPriceCents !== null && amountCents !== ride.finalPriceCents) {
      const [incident] = await this.db
        .insert(schema.incidents)
        .values({ rideId: ride.id, type: 'other', severity: 'medium', reportedByUserId: userId, reportedByKind: 'driver', description: `Écart de paiement direct : ${amountCents} ¢ reçus pour ${ride.finalPriceCents} ¢ dus` })
        .returning({ id: schema.incidents.id });
      await this.rides.mark(ride.id, 'payment_discrepancy', actor, { amountCents, expectedCents: ride.finalPriceCents, incidentId: incident!.id });
      this.events.emit('ride.incident', { rideId: ride.id, incidentId: incident!.id, type: 'other', severity: 'medium', reportedByUserId: userId });
    }
    return this.driverRide(userId, rideId);
  }

  /** Évaluation du client par le chauffeur (5.11, des deux côtés) : une seule par course. */
  async rateClient(userId: string, rideId: string, input: { score: number; tags: string[]; comment?: string | undefined }): Promise<DriverRideView> {
    const { ride } = await this.rideOfDriver(userId, rideId);
    if (!['completed', 'rated', 'disputed', 'no_show'].includes(ride.state)) throw AppError.conflict('RIDE_NOT_COMPLETED', 'La course n\'est pas terminée', { state: ride.state });
    await this.db.insert(schema.rideRatings).values({ rideId, authorKind: 'driver', authorUserId: userId, score: input.score, tags: input.tags, comment: input.comment ?? null }).onConflictDoNothing();
    return this.driverRide(userId, rideId);
  }

  /** Signalement d'incident depuis la course : enregistré et poussé à My Hub ; les incidents graves sont prioritaires. */
  async reportIncident(userId: string, rideId: string, input: { kind: string; description: string }): Promise<{ incidentId: string; status: 'open' }> {
    const { ride } = await this.rideOfDriver(userId, rideId);
    const mapping = INCIDENT_MAPPING[input.kind] ?? INCIDENT_MAPPING['other']!;
    const [incident] = await this.db
      .insert(schema.incidents)
      .values({ rideId: ride.id, type: mapping.type, severity: mapping.severity, reportedByUserId: userId, reportedByKind: 'driver', description: `[${input.kind}] ${input.description}` })
      .returning({ id: schema.incidents.id });
    await this.rides.mark(ride.id, 'incident_reported', { kind: 'driver', userId }, { incidentId: incident!.id, kind: input.kind });
    this.events.emit('ride.incident', { rideId: ride.id, incidentId: incident!.id, type: mapping.type, severity: mapping.severity, reportedByUserId: userId });
    return { incidentId: incident!.id, status: 'open' };
  }

  /**
   * Début de quart avec vérification faciale (V1.1, `FEATURE_FACE_CHECK`) : module isolé, photo transmise au
   * fournisseur de comparaison (simulé tant que la déclaration biométrique n'est pas faite), aucun traitement local.
   */
  async startShift(userId: string, photoBase64: string): Promise<{ shiftId: string | null; faceCheck: 'passed' | 'failed' | 'disabled'; startedAt: string | null }> {
    const driver = await this.profiles.requireDriver(userId);
    if (!this.env.FEATURE_FACE_CHECK) return { shiftId: null, faceCheck: 'disabled', startedAt: null };
    const photo = Buffer.from(photoBase64, 'base64');
    const passed = photo.length > 1000 && photo[0] === 0xff && photo[1] === 0xd8;
    const now = new Date();
    if (!passed) return { shiftId: null, faceCheck: 'failed', startedAt: null };
    const [open] = await this.db.select({ id: schema.driverShifts.id }).from(schema.driverShifts).where(and(eq(schema.driverShifts.driverId, driver.id), isNull(schema.driverShifts.endedAt))).limit(1);
    const shiftId = open
      ? (await this.db.update(schema.driverShifts).set({ faceCheckPassedAt: now }).where(eq(schema.driverShifts.id, open.id)).returning({ id: schema.driverShifts.id }))[0]!.id
      : (await this.db.insert(schema.driverShifts).values({ driverId: driver.id, startedAt: now, faceCheckPassedAt: now }).returning({ id: schema.driverShifts.id }))[0]!.id;
    return { shiftId, faceCheck: 'passed', startedAt: now.toISOString() };
  }
}
