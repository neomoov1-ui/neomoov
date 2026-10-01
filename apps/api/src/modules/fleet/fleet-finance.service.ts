/**
 * Étape 23 (module Flotte) : partage des revenus, versements et rapports d'une organisation, dans la transaction
 * restreinte de la route.
 *
 * - Règles de partage (`revenue_share_rules`) : loyer par semaine ou pourcentage du tarif chauffeur, par défaut pour
 *   l'organisation ou pour un chauffeur, avec dates d'effet ; appliquées à la génération des relevés (`FleetShareService`).
 * - Compte de versement : Stripe Connect de l'organisation (parcours d'ouverture repris de celui des chauffeurs, simulé en
 *   test). Tant que Connect n'est pas en service (compte Stripe de Neomoov non validé, encaissement par Square sans
 *   équivalent de Connect), les relevés d'organisation se règlent hors plateforme (`settle-offline`, export des virements).
 * - Rapports : les courses Neomoov des chauffeurs de l'organisation (y compris celles du réseau de la plateforme, qu'une
 *   transaction restreinte ne voit pas) sont agrégées par une lecture de la plateforme limitée aux chauffeurs du
 *   sous-arbre : totaux seulement, jamais de donnée d'un client d'une autre organisation.
 */
import { schema } from '@neomoov/db';
import {
  localDate, revenueShare, type OwnerDashboard, type RevenueShareMode, type RevenueShareRuleCreate, type RevenueShareRuleView, type WeeklyReport,
} from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { withoutOrgScope } from '../../common/org-scope.context.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AuditService } from '../audit/audit.service.js';
import type { OrgScope, UserActor } from '../auth/actor.js';
import { SettlementJobsService } from '../settlement/settlement-jobs.service.js';
import { StatementsService } from '../settlement/statements.service.js';
import { FleetVehiclesService } from './fleet-vehicles.service.js';

type RuleRow = typeof schema.revenueShareRules.$inferSelect;

@Injectable()
export class FleetFinanceService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly statements: StatementsService,
    private readonly settlementJobs: SettlementJobsService,
    private readonly vehicles: FleetVehiclesService,
  ) {}

  private get db() {
    return this.database.db;
  }

  // --- Règles de partage ---

  private async ruleViews(rows: RuleRow[]): Promise<RevenueShareRuleView[]> {
    const driverIds = [...new Set(rows.map((r) => r.driverId).filter((id): id is string => Boolean(id)))];
    const names = driverIds.length
      ? await this.db.select({ id: schema.drivers.id, first: schema.users.firstName, last: schema.users.lastName }).from(schema.drivers).leftJoin(schema.users, eq(schema.users.id, schema.drivers.userId)).where(inArray(schema.drivers.id, driverIds))
      : [];
    const nameOf = new Map(names.map((n) => [n.id, [n.first, n.last].filter(Boolean).join(' ') || null]));
    return rows.map((r) => ({
      id: r.id, organizationId: r.organizationId, driverId: r.driverId, driverName: r.driverId ? (nameOf.get(r.driverId) ?? null) : null, mode: r.mode as RevenueShareMode,
      weeklyRentCents: r.weeklyRentCents, percentagePpm: r.percentagePpm, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo, createdAt: r.createdAt.toISOString(),
    }));
  }

  async rules(): Promise<RevenueShareRuleView[]> {
    return this.ruleViews(await this.db.select().from(schema.revenueShareRules).orderBy(desc(schema.revenueShareRules.effectiveFrom), desc(schema.revenueShareRules.createdAt)));
  }

  /** Nouvelle règle de l'organisation (pour un de ses chauffeurs, sinon par défaut). Les relevés déjà émis ne changent pas. */
  async createRule(scope: OrgScope, input: RevenueShareRuleCreate, actor: UserActor): Promise<RevenueShareRuleView> {
    if (input.driverId) {
      const [driver] = await this.db.select({ id: schema.drivers.id }).from(schema.drivers).where(eq(schema.drivers.id, input.driverId)).limit(1);
      if (!driver) throw AppError.notFound('DRIVER_NOT_FOUND', 'Chauffeur introuvable');
    }
    const [row] = await this.db
      .insert(schema.revenueShareRules)
      .values({
        organizationId: scope.organizationId, driverId: input.driverId ?? null, mode: input.mode, weeklyRentCents: input.mode === 'rent' ? (input.weeklyRentCents ?? null) : null,
        percentagePpm: input.mode === 'percentage' ? (input.percentagePpm ?? null) : null, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo ?? null, createdByUserId: actor.userId,
      })
      .returning();
    this.audit.record({ action: 'fleet.revenue_share_rule_created', entity: 'revenue_share_rules', entityId: row!.id, after: { driverId: row!.driverId, mode: row!.mode, weeklyRentCents: row!.weeklyRentCents, percentagePpm: row!.percentagePpm, effectiveFrom: row!.effectiveFrom, effectiveTo: row!.effectiveTo } });
    return (await this.ruleViews([row!]))[0]!;
  }

  /** Fin d'une règle (dernier jour inclus) ; jamais avant son début. */
  async endRule(id: string, effectiveTo: string): Promise<RevenueShareRuleView> {
    const [rule] = await this.db.select().from(schema.revenueShareRules).where(eq(schema.revenueShareRules.id, id)).limit(1);
    if (!rule) throw AppError.notFound('REVENUE_SHARE_RULE_NOT_FOUND', 'Règle introuvable');
    if (effectiveTo < rule.effectiveFrom) throw new AppError('END_BEFORE_START', 'La fin d\'une règle suit son début', 400, { effectiveFrom: rule.effectiveFrom });
    const [row] = await this.db.update(schema.revenueShareRules).set({ effectiveTo }).where(eq(schema.revenueShareRules.id, id)).returning();
    this.audit.record({ action: 'fleet.revenue_share_rule_ended', entity: 'revenue_share_rules', entityId: id, before: { effectiveTo: rule.effectiveTo }, after: { effectiveTo } });
    return (await this.ruleViews([row!]))[0]!;
  }

  // --- Compte de versement (Stripe Connect de l'organisation) ---

  async payoutAccount(organizationId: string) {
    const [org] = await this.db.select({ accountRef: schema.organizations.stripeAccountId, onboarded: schema.organizations.stripeAccountOnboarded }).from(schema.organizations).where(eq(schema.organizations.id, organizationId)).limit(1);
    if (!org) throw AppError.notFound('ORGANIZATION_NOT_FOUND', 'Organisation introuvable');
    let { onboarded } = org;
    let payoutsEnabled = onboarded;
    if (org.accountRef) {
      const remote = await this.provider.connectAccountStatus(org.accountRef);
      payoutsEnabled = remote.payoutsEnabled;
      if (remote.onboarded !== onboarded) {
        await this.db.update(schema.organizations).set({ stripeAccountOnboarded: remote.onboarded }).where(eq(schema.organizations.id, organizationId));
        onboarded = remote.onboarded;
      }
    }
    return { mode: onboarded && payoutsEnabled ? ('connect' as const) : ('offline' as const), linked: Boolean(org.accountRef), onboarded, payoutsEnabled, provider: this.provider.name };
  }

  /** Lien d'ouverture du compte Connect (le compte est créé au premier appel), comme pour un chauffeur. */
  async payoutOnboarding(organizationId: string, actor: UserActor) {
    const [org] = await this.db.select({ id: schema.organizations.id, accountRef: schema.organizations.stripeAccountId }).from(schema.organizations).where(eq(schema.organizations.id, organizationId)).limit(1);
    if (!org) throw AppError.notFound('ORGANIZATION_NOT_FOUND', 'Organisation introuvable');
    let accountRef = org.accountRef;
    if (!accountRef) {
      accountRef = (await this.provider.createConnectAccount({ externalId: org.id })).accountRef;
      await this.db.update(schema.organizations).set({ stripeAccountId: accountRef }).where(eq(schema.organizations.id, org.id));
      this.audit.record({ action: 'fleet.payout_account_created', entity: 'organizations', entityId: org.id, after: { provider: this.provider.name } });
    }
    const [returnUrl, refreshUrl] = await Promise.all([
      this.settings.string('payout.organization_return_url', 'https://neomoov.net/hub/flotte/versements'),
      this.settings.string('payout.organization_refresh_url', 'https://neomoov.net/hub/flotte/versements'),
    ]);
    const link = await this.provider.createConnectOnboardingLink({ accountRef, returnUrl, refreshUrl });
    return { url: link.url, expiresAt: link.expiresAt.toISOString(), simulated: this.provider.name === 'mock' };
  }

  // --- Relevés des chauffeurs vus par l'organisation ---

  async statement(id: string) {
    const detail = await this.statements.detail(id);
    const shareCents = detail.lines.filter((l) => l.kind === 'fleet_share').reduce((sum, l) => sum - l.amountCents, 0);
    return {
      id: detail.id, driverId: detail.driverId, driverName: detail.driverName, periodStart: detail.periodStart, periodEnd: detail.periodEnd, status: detail.status, creditsCents: detail.creditsCents,
      debitsCents: detail.debitsCents, netCents: detail.netCents, shareCents, issuedAt: detail.issuedAt, pdfAvailable: detail.pdfAvailable,
      lines: detail.lines.map((l) => ({ kind: l.kind, label: l.label, amountCents: l.amountCents, rideId: l.rideId ?? null, occurredAt: l.occurredAt })),
    };
  }

  async statementPdf(id: string): Promise<Buffer | null> {
    const [row] = await this.db.select({ pdfKey: schema.weeklyStatements.pdfKey }).from(schema.weeklyStatements).where(eq(schema.weeklyStatements.id, id)).limit(1);
    if (!row) throw AppError.notFound('STATEMENT_NOT_FOUND', 'Relevé introuvable');
    return this.settlementJobs.pdfOf(row.pdfKey);
  }

  // --- Rapports ---

  /** Courses terminées des chauffeurs du sous-arbre sur une période, par chauffeur et par véhicule (lecture de la plateforme, filtrée). */
  private async completedRides(scope: Pick<OrgScope, 'path'>, start: string, end: string, timeZone: string, filter: { vehicleIds?: string[] } = {}) {
    const vehicleFilter = filter.vehicleIds ? sql`AND r.vehicle_id IN (${sql.join(filter.vehicleIds.map((id) => sql`${id}::uuid`), sql`, `)})` : sql`AND o.path LIKE ${scope.path} || '%'`;
    return withoutOrgScope(() => this.database.db.execute<{ ride_id: string; driver_id: string; vehicle_id: string | null; fare_cents: number | null; completed_at: string }>(sql`
      SELECT r.id AS ride_id, r.driver_id, r.vehicle_id, r.fare_cents, (r.state_timestamps->>'completed') AS completed_at
      FROM rides r
      JOIN drivers d ON d.id = r.driver_id
      LEFT JOIN organizations o ON o.id = d.organization_id
      WHERE r.state IN ('completed', 'rated', 'disputed')
        AND (r.state_timestamps->>'completed')::timestamptz >= (${start}::date::timestamp AT TIME ZONE ${timeZone})
        AND (r.state_timestamps->>'completed')::timestamptz < ((${end}::date + 1)::timestamp AT TIME ZONE ${timeZone})
        ${vehicleFilter}`));
  }

  async weeklyReport(scope: OrgScope, periodStart: string | undefined, now = new Date()): Promise<WeeklyReport> {
    const period = await this.statements.periodOf(periodStart, now);
    const rides = [...(await this.completedRides(scope, period.startDate, period.endDate, period.timeZone))];
    const driverIds = [...new Set(rides.map((r) => r.driver_id))];
    const drivers = driverIds.length
      ? await this.db.select({ id: schema.drivers.id, publicNumber: schema.drivers.publicNumber, first: schema.users.firstName, last: schema.users.lastName }).from(schema.drivers).leftJoin(schema.users, eq(schema.users.id, schema.drivers.userId)).where(inArray(schema.drivers.id, driverIds))
      : [];
    const rules = (await this.db.select().from(schema.revenueShareRules).where(eq(schema.revenueShareRules.organizationId, scope.organizationId))).map((r) => ({ ...r, mode: r.mode as RevenueShareMode }));
    const byDriver = drivers.map((d) => {
      const mine = rides.filter((r) => r.driver_id === d.id);
      const fareCents = mine.reduce((sum, r) => sum + (r.fare_cents ?? 0), 0);
      const share = revenueShare(rules, d.id, period, mine.map((r) => ({ rideId: r.ride_id, date: localDate(new Date(r.completed_at), period.timeZone).date, fareCents: r.fare_cents ?? 0 })));
      return { driverId: d.id, driverName: [d.first, d.last].filter(Boolean).join(' ') || null, publicNumber: d.publicNumber, rides: mine.length, fareCents, shareCents: share.totalCents };
    });
    const vehicleIds = [...new Set(rides.map((r) => r.vehicle_id).filter((id): id is string => Boolean(id)))];
    const vehicles = vehicleIds.length ? await this.db.select({ id: schema.vehicles.id, plate: schema.vehicles.plate, make: schema.vehicles.make, model: schema.vehicles.model }).from(schema.vehicles).where(inArray(schema.vehicles.id, vehicleIds)) : [];
    const byVehicle = vehicles.map((v) => {
      const mine = rides.filter((r) => r.vehicle_id === v.id);
      return { vehicleId: v.id, plate: v.plate, make: v.make, model: v.model, rides: mine.length, fareCents: mine.reduce((sum, r) => sum + (r.fare_cents ?? 0), 0) };
    });
    return {
      periodStart: period.startDate, periodEnd: period.endDate,
      totals: { rides: byDriver.reduce((s, d) => s + d.rides, 0), fareCents: byDriver.reduce((s, d) => s + d.fareCents, 0), shareCents: byDriver.reduce((s, d) => s + d.shareCents, 0) },
      byDriver: byDriver.sort((a, b) => b.fareCents - a.fareCents), byVehicle: byVehicle.sort((a, b) => b.fareCents - a.fareCents),
    };
  }

  /** Tableau de bord du propriétaire de véhicule : ses véhicules de l'organisation, leurs courses et leurs revenus, leurs échéances. */
  async ownerDashboard(scope: OrgScope, actor: UserActor, periodStart: string | undefined, now = new Date()): Promise<OwnerDashboard> {
    const period = await this.statements.periodOf(periodStart, now);
    const owned = await this.db
      .select({ id: schema.vehicles.id, plate: schema.vehicles.plate, make: schema.vehicles.make, model: schema.vehicles.model, status: schema.vehicles.status, odometerKm: schema.vehicles.odometerKm, nextInspectionDueOn: schema.vehicles.nextInspectionDueOn, first: schema.users.firstName, last: schema.users.lastName })
      .from(schema.vehicles)
      .leftJoin(schema.drivers, eq(schema.drivers.id, schema.vehicles.driverId))
      .leftJoin(schema.users, eq(schema.users.id, schema.drivers.userId))
      .where(eq(schema.vehicles.ownerUserId, actor.userId));
    const rides = owned.length ? [...(await this.completedRides(scope, period.startDate, period.endDate, period.timeZone, { vehicleIds: owned.map((v) => v.id) }))] : [];
    const today = localDate(now, period.timeZone).date;
    const due = await this.vehicles.dueOf(owned.map((v) => v.id), today, new Map(owned.map((v) => [v.id, v.odometerKm])));
    return {
      periodStart: period.startDate, periodEnd: period.endDate,
      vehicles: owned.map((v) => {
        const mine = rides.filter((r) => r.vehicle_id === v.id);
        return {
          vehicleId: v.id, plate: v.plate, make: v.make, model: v.model, status: v.status, driverName: [v.first, v.last].filter(Boolean).join(' ') || null,
          rides: mine.length, fareCents: mine.reduce((sum, r) => sum + (r.fare_cents ?? 0), 0), nextInspectionDueOn: v.nextInspectionDueOn, maintenanceDue: due.get(v.id) ?? [],
        };
      }),
    };
  }
}

