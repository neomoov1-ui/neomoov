/**
 * Relevés hebdomadaires (section 5.8, prompt 09 tâches 1 et 4) : les lignes viennent des courses terminées (ou annulées
 * avec frais), des packs à facturer et des crédits de pack du parrainage ; le moteur du domaine
 * (`classifyRideForStatement`, `packBillingLines`, `buildStatement`) fait tous les calculs. Une course ou un pack ne figure
 * que sur un seul relevé : ce qui arrive en retard (événement traité après l'émission) passe au relevé suivant. Un
 * relevé émis est immuable : un ajustement ne s'ajoute qu'à un brouillon.
 */
import { schema } from '@neomoov/db';
import {
  buildStatement, classifyRideForStatement, isCredit, localDate, packBillingLines, periodForGeneration, splitTaxes,
  type AdminStatementDetail, type SettlementRide, type ShareRide, type Statement, type StatementComputed, type StatementGeneration, type StatementLine, type StatementLineKind,
  type StatementLineView, type StatementPeriod, type TaxRates,
} from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AppError } from '../../common/app-error.js';
import { DomainEventsService } from '../../common/domain-events.js';
import { organizationIdFor, withoutOrgScope } from '../../common/org-scope.context.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';
import { FleetShareService } from './fleet-share.service.js';

type Executor = Pick<Database['db'], 'insert' | 'update' | 'select' | 'execute' | 'delete'>;
type StatementRow = typeof schema.weeklyStatements.$inferSelect;

/**
 * Fenêtre de reprise ordinaire (8 semaines avant la période). Revue du 2 octobre 2026 (constat métier 14) : plus rien
 * n'est perdu au-delà. Une course terminée jamais portée par un relevé émis est reprise quel que soit son âge, une course
 * réglée qui peut encore porter un élément tardif (pourboire, garantie modèle) est relue quel que soit son âge ; un
 * rattrapage plus ancien que cette fenêtre est signalé à l'exploitation (`alert.settlement_late_rides`).
 */
const LOOKBACK_DAYS = 56;
const NO_STATEMENT = '00000000-0000-4000-8000-000000000000';
const ADJUSTMENTS = new Set(['adjustment_positive', 'adjustment_negative']);
/**
 * Éléments d'une course qui peuvent arriver après l'émission de son relevé : pourboire laissé plus tard, garantie modèle
 * validée plus tard (reprise du tarif, et remise de la redevance Neomoov de la course). Seule la différence avec ce que
 * portent déjà les relevés émis passe au relevé suivant (revue 17.B) ; les autres natures d'une course réglée ne sont
 * jamais recalculées.
 */
const LATE_KINDS = ['tip_platform', 'adjustment_negative', 'adjustment_positive'] as const;
const LATE_LABELS: Record<(typeof LATE_KINDS)[number], string> = {
  tip_platform: 'Pourboire reçu après le relevé',
  adjustment_negative: 'Garantie modèle validée après le relevé, course remboursée',
  adjustment_positive: 'Garantie modèle validée après le relevé, redevance Neomoov remise',
};

type RideRow = {
  id: string;
  public_number: string;
  state: string;
  payment_choice: string;
  fare_cents: number | null;
  service_fee_cents: number | null;
  regulatory_fee_cents: number | null;
  gst_cents: number | null;
  qst_cents: number | null;
  tip_cents: number;
  promotion_discount_cents: number;
  tolls_cents: number;
  cancellation_fee_cents: number;
  guarantee_outcome: string | null;
  driver_fare_protected: boolean;
  /** Redevance Neomoov enregistrée à la fin de la course (3 octobre 2026), sinon null. */
  platform_fee_cents: number | null;
  platform_fee_bps: number | null;
  at: string;
  /** La course figure déjà sur un relevé émis (seuls ses éléments arrivés en retard peuvent encore passer). */
  on_issued: boolean;
};

interface DriverInfo {
  id: string;
  userId: string;
  publicNumber: string;
  name: string | null;
  /** Organisation du chauffeur (étape 20) : le relevé lui appartient. */
  organizationId: string | null;
}

function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Vue d'une ligne : crédit positif, débit négatif. */
export function lineView(l: { kind: string; label: string; amountCents: number; rideId: string | null; packPurchaseId: string | null; occurredAt: Date }): StatementLineView {
  return {
    kind: l.kind, label: l.label, amountCents: isCredit(l.kind as StatementLineKind) ? l.amountCents : -l.amountCents, rideId: l.rideId, packPurchaseId: l.packPurchaseId,
    occurredAt: l.occurredAt.toISOString(),
  };
}

@Injectable()
export class StatementsService {
  constructor(
    @Inject(DB) private readonly database: Database,
    private readonly settings: SettingsService,
    private readonly events: DomainEventsService,
    private readonly outbox: NotificationsOutbox,
    private readonly audit: AuditService,
    private readonly fleetShare: FleetShareService,
  ) {}

  private get db() {
    return this.database.db;
  }

  async timeZone(): Promise<string> {
    return this.settings.string('service.time_zone', 'America/Toronto');
  }

  async rates(): Promise<TaxRates> {
    const [gstRatePpm, qstRatePpm] = await Promise.all([this.settings.number('pricing.gst_rate_ppm', 50_000), this.settings.number('pricing.qst_rate_ppm', 99_750)]);
    return { gstRatePpm, qstRatePpm };
  }

  /** Période d'un lundi donné, ou la dernière semaine entièrement écoulée. */
  async periodOf(periodStart: string | undefined, now = new Date()): Promise<StatementPeriod> {
    const timeZone = await this.timeZone();
    if (!periodStart) return periodForGeneration(now, timeZone);
    if (localDate(new Date(`${periodStart}T12:00:00Z`), 'UTC').weekday !== 1) throw new AppError('PERIOD_NOT_MONDAY', 'Une période de relevé commence un lundi', 400, { periodStart });
    return { startDate: periodStart, endDate: shift(periodStart, 6), timeZone };
  }

  /**
   * Génération (ou aperçu) des relevés d'une période : un brouillon par chauffeur qui a au moins une ligne ; un brouillon
   * existant est recalculé (ses ajustements manuels gardés), un relevé déjà émis n'est jamais modifié.
   */
  async generate(input: { periodStart?: string | undefined; driverId?: string | undefined; preview?: boolean | undefined; allowEmpty?: boolean | undefined; excludeDriverIds?: ReadonlySet<string> | undefined }, now = new Date()): Promise<StatementGeneration> {
    const period = await this.periodOf(input.periodStart, now);
    const rates = await this.rates();
    // Étape 20 : `excludeDriverIds` écarte d'un lot d'organisation les chauffeurs que la plateforme règle elle-même.
    const driverIds = input.driverId ? [input.driverId] : (await this.candidateDrivers(period)).filter((id) => !input.excludeDriverIds?.has(id));
    const result: StatementGeneration = { periodStart: period.startDate, periodEnd: period.endDate, preview: Boolean(input.preview), generated: 0, skipped: 0, statements: [] };
    for (const driverId of driverIds) {
      const driver = await this.driverInfo(driverId);
      if (!driver) {
        if (input.driverId) throw AppError.notFound('DRIVER_NOT_FOUND', 'Chauffeur introuvable');
        continue;
      }
      const computed = await this.db.transaction(async (tx) => {
        // Un verrou par chauffeur : deux générations simultanées ne prennent jamais la même course deux fois.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`statement:${driverId}`}))`);
        const [existing] = await tx.select().from(schema.weeklyStatements).where(and(eq(schema.weeklyStatements.driverId, driverId), eq(schema.weeklyStatements.periodStart, period.startDate))).limit(1);
        if (existing && existing.status !== 'draft') return { skipped: true, view: await this.computedOf(tx, existing, driver) };
        const lines = await this.collectLines(tx, driver, period, rates, existing?.id ?? null);
        // Brouillon vide seulement sur demande, pour un seul chauffeur (correction d'un relevé émis).
        if (!lines.length && !existing && !(input.allowEmpty && input.driverId)) return null;
        const statement = buildStatement(driverId, period, lines);
        if (input.preview) return { skipped: false, view: this.previewOf(driver, statement) };
        // Courses déjà sur ce brouillon : un rattrapage tardif n'est signalé qu'à sa première inscription (rejouable).
        const known = existing ? new Set((await tx.select({ rideId: schema.statementLines.rideId }).from(schema.statementLines).where(eq(schema.statementLines.statementId, existing.id))).map((l) => l.rideId)) : new Set<string | null>();
        const saved = await this.save(tx, driver, period, statement, existing ?? null);
        const lateBefore = new Date(`${shift(period.startDate, -LOOKBACK_DAYS)}T00:00:00Z`);
        const late = new Set(lines.filter((l) => l.rideId && !known.has(l.rideId) && l.occurredAt < lateBefore).map((l) => l.rideId!));
        return { skipped: false, view: await this.computedOf(tx, saved, driver), late: [...late] };
      });
      if (!computed) continue;
      if (computed.skipped) result.skipped += 1;
      else result.generated += 1;
      result.statements.push(computed.view);
      if ('late' in computed && computed.late.length && computed.view.id) await this.signalLateRides(computed.view.id, driver, computed.late);
    }
    return result;
  }

  /**
   * Revue du 2 octobre 2026 (constat 14) : courses plus anciennes que la fenêtre ordinaire reprises sur un relevé
   * (jamais réglées, ou élément tardif). Rien n'est perdu ; l'exploitation est avertie pour vérifier ces montants
   * avant l'émission (journal d'audit et avis au personnel).
   */
  private async signalLateRides(statementId: string, driver: DriverInfo, rideIds: string[]): Promise<void> {
    this.audit.record({ action: 'statement.late_rides_caught_up', entity: 'weekly_statements', entityId: statementId, after: { driverId: driver.id, rideIds, count: rideIds.length } });
    await this.outbox.queueForStaff('alert.settlement_late_rides', { statementId, driverPublicNumber: driver.publicNumber, count: rideIds.length });
  }

  /**
   * Chauffeurs qui ont une course ou un pack non réglé jusqu'à la fin de la période, ou un loyer de flotte dû sur la
   * période (règle `rent` en vigueur, revue du 2 octobre 2026, constat 6 : le loyer est dû même sans course).
   */
  private async candidateDrivers(period: StatementPeriod): Promise<string[]> {
    const end = shift(period.endDate, 1);
    // Revue du 2 octobre 2026 (constat 14) : ni la course jamais réglée ni l'élément tardif n'ont de limite d'âge.
    const rows = await this.db.execute<{ driver_id: string }>(sql`
      SELECT DISTINCT r.driver_id FROM rides r
      WHERE r.driver_id IS NOT NULL
        AND (r.state IN ('completed', 'rated', 'disputed') OR (r.state IN ('no_show', 'cancelled_by_client') AND r.cancellation_fee_cents > 0))
        AND COALESCE(r.state_timestamps->>'completed', r.state_timestamps->>'no_show', r.state_timestamps->>'cancelled_by_client')::timestamptz < (${end}::date::timestamp AT TIME ZONE ${period.timeZone})
        AND NOT EXISTS (SELECT 1 FROM statement_lines sl JOIN weekly_statements ws ON ws.id = sl.statement_id WHERE sl.ride_id = r.id AND ws.status <> 'draft')
      UNION
      SELECT DISTINCT r.driver_id FROM rides r
      WHERE r.driver_id IS NOT NULL AND r.state IN ('completed', 'rated', 'disputed')
        AND (r.tip_cents > 0 OR r.guarantee_outcome = 'validated')
        AND (r.state_timestamps->>'completed')::timestamptz < (${end}::date::timestamp AT TIME ZONE ${period.timeZone})
        AND EXISTS (SELECT 1 FROM statement_lines sl JOIN weekly_statements ws ON ws.id = sl.statement_id WHERE sl.ride_id = r.id AND ws.status <> 'draft')
        AND (
          r.tip_cents > COALESCE((SELECT sum(sl.amount_cents) FROM statement_lines sl JOIN weekly_statements ws ON ws.id = sl.statement_id WHERE sl.ride_id = r.id AND sl.kind = 'tip_platform' AND ws.status <> 'draft'), 0)
          OR (r.guarantee_outcome = 'validated' AND NOT r.driver_fare_protected
            AND NOT EXISTS (SELECT 1 FROM statement_lines sl JOIN weekly_statements ws ON ws.id = sl.statement_id WHERE sl.ride_id = r.id AND sl.kind = 'adjustment_negative' AND ws.status <> 'draft'))
        )
      UNION
      SELECT DISTINCT p.driver_id FROM pack_purchases p
      WHERE p.billing = 'to_bill' AND p.statement_id IS NULL AND p.activated_at < (${end}::date::timestamp AT TIME ZONE ${period.timeZone})
      UNION
      SELECT DISTINCT d.id AS driver_id FROM revenue_share_rules rr
      JOIN drivers d ON d.organization_id = rr.organization_id AND (rr.driver_id IS NULL OR rr.driver_id = d.id)
      WHERE rr.mode = 'rent' AND rr.effective_from <= ${period.endDate}::date AND (rr.effective_to IS NULL OR rr.effective_to >= ${period.startDate}::date)
        AND d.status NOT IN ('pending', 'offboarded')
        AND NOT EXISTS (SELECT 1 FROM weekly_statements ws WHERE ws.driver_id = d.id AND ws.period_start = ${period.startDate}::date AND ws.status <> 'draft')`);
    return rows.map((r) => r.driver_id);
  }

  private async driverInfo(driverId: string): Promise<DriverInfo | null> {
    const [row] = await this.db
      .select({ id: schema.drivers.id, userId: schema.drivers.userId, publicNumber: schema.drivers.publicNumber, organizationId: schema.drivers.organizationId, first: schema.users.firstName, last: schema.users.lastName })
      .from(schema.drivers)
      .innerJoin(schema.users, eq(schema.users.id, schema.drivers.userId))
      .where(eq(schema.drivers.id, driverId))
      .limit(1);
    return row ? { id: row.id, userId: row.userId, publicNumber: row.publicNumber, organizationId: row.organizationId, name: [row.first, row.last].filter(Boolean).join(' ') || null } : null;
  }

  /**
   * Lignes d'un relevé : courses et packs non encore pris par un autre relevé (jusqu'à la fin de la période), crédit de
   * pack du parrainage appliqué aux packs facturés, ajustements manuels du brouillon. Les courses de la fenêtre ordinaire
   * (8 semaines) sont toutes relues ; au-delà, seulement celles jamais réglées ou qui peuvent porter un élément tardif
   * (revue du 2 octobre 2026, constat 14). Rejouable : ce que portent les relevés émis n'est jamais repris deux fois.
   */
  private async collectLines(tx: Executor, driver: DriverInfo, period: StatementPeriod, rates: TaxRates, statementId: string | null): Promise<StatementLine[]> {
    const end = shift(period.endDate, 1);
    const from = shift(period.startDate, -LOOKBACK_DAYS);
    const self = statementId ?? NO_STATEMENT;
    const issuedLine = sql`EXISTS (SELECT 1 FROM statement_lines sl JOIN weekly_statements ws ON ws.id = sl.statement_id WHERE sl.ride_id = r.id AND sl.statement_id <> ${self}::uuid AND ws.status <> 'draft')`;
    const rides = await tx.execute<RideRow>(sql`
      SELECT r.id, r.public_number, r.state, r.payment_choice, r.fare_cents, r.service_fee_cents, r.regulatory_fee_cents, r.gst_cents, r.qst_cents, r.tip_cents,
        r.promotion_discount_cents, r.tolls_cents, r.cancellation_fee_cents, r.guarantee_outcome, r.driver_fare_protected,
        pf.amount_cents AS platform_fee_cents, pf.rate_bps AS platform_fee_bps,
        COALESCE(r.state_timestamps->>'completed', r.state_timestamps->>'no_show', r.state_timestamps->>'cancelled_by_client') AS at,
        ${issuedLine} AS on_issued
      FROM rides r
      LEFT JOIN platform_fees pf ON pf.ride_id = r.id
      WHERE r.driver_id = ${driver.id}::uuid
        AND (r.state IN ('completed', 'rated', 'disputed') OR (r.state IN ('no_show', 'cancelled_by_client') AND r.cancellation_fee_cents > 0))
        AND COALESCE(r.state_timestamps->>'completed', r.state_timestamps->>'no_show', r.state_timestamps->>'cancelled_by_client')::timestamptz < (${end}::date::timestamp AT TIME ZONE ${period.timeZone})
        AND (
          COALESCE(r.state_timestamps->>'completed', r.state_timestamps->>'no_show', r.state_timestamps->>'cancelled_by_client')::timestamptz >= (${from}::date::timestamp AT TIME ZONE ${period.timeZone})
          OR NOT ${issuedLine} OR r.tip_cents > 0 OR r.guarantee_outcome = 'validated'
        )
        AND NOT EXISTS (SELECT 1 FROM statement_lines sl JOIN weekly_statements ws ON ws.id = sl.statement_id WHERE sl.ride_id = r.id AND sl.statement_id <> ${self}::uuid AND ws.status = 'draft')`);
    // Ce que les relevés émis portent déjà pour les éléments tardifs des courses réglées.
    const settled = [...rides].filter((r) => r.on_issued).map((r) => r.id);
    const recorded = new Map<string, number>();
    if (settled.length) {
      const rows = await tx.execute<{ ride_id: string; kind: string; total: number }>(sql`
        SELECT sl.ride_id, sl.kind, sum(sl.amount_cents)::int AS total FROM statement_lines sl JOIN weekly_statements ws ON ws.id = sl.statement_id
        WHERE sl.ride_id IN (${sql.join(settled.map((id) => sql`${id}::uuid`), sql`, `)}) AND sl.statement_id <> ${self}::uuid AND ws.status <> 'draft'
          AND sl.kind IN ('tip_platform', 'adjustment_negative', 'adjustment_positive')
        GROUP BY sl.ride_id, sl.kind`);
      for (const row of rows) recorded.set(`${row.ride_id}:${row.kind}`, Number(row.total));
    }
    const lines: StatementLine[] = [];
    // Étape 23 : courses terminées de ce relevé dont le tarif revient au chauffeur (base du partage des revenus).
    const shareRides: ShareRide[] = [];
    for (const r of rides) {
      const ride = this.settlementRide(r);
      const rideLines: StatementLine[] = classifyRideForStatement(ride, rates).map((line) => ({ ...line, label: `${line.label ?? line.kind} · ${r.public_number}` }));
      // Garantie modèle validée, chauffeur en faute : le tarif et ses taxes ne lui sont pas dus (course remboursée au client).
      if (ride.status === 'completed' && r.guarantee_outcome === 'validated' && !r.driver_fare_protected) {
        const amount = ride.fareCents + splitTaxes(ride, rates).fareTaxesCents;
        if (amount > 0) rideLines.push({ kind: 'adjustment_negative', amountCents: amount, rideId: r.id, occurredAt: ride.completedAt, label: `Garantie modèle, course remboursée · ${r.public_number}` });
        // Le tarif n'étant pas dû, la redevance Neomoov de la course est remise (ligne visible, même montant).
        const fee = ride.platformFee?.amountCents ?? 0;
        if (fee > 0) rideLines.push({ kind: 'adjustment_positive', amountCents: fee, rideId: r.id, occurredAt: ride.completedAt, label: `Garantie modèle, redevance Neomoov remise · ${r.public_number}` });
      }
      if (!r.on_issued) {
        lines.push(...rideLines);
        if (ride.status === 'completed' && !(r.guarantee_outcome === 'validated' && !r.driver_fare_protected)) {
          shareRides.push({ rideId: r.id, date: localDate(ride.completedAt, period.timeZone).date, fareCents: ride.fareCents });
        }
        continue;
      }
      for (const kind of LATE_KINDS) {
        const due = rideLines.filter((l) => l.kind === kind).reduce((sum, l) => sum + l.amountCents, 0) - (recorded.get(`${r.id}:${kind}`) ?? 0);
        if (due > 0) lines.push({ kind, amountCents: due, rideId: r.id, occurredAt: ride.completedAt, label: `${LATE_LABELS[kind]} · ${r.public_number}` });
      }
    }

    // Étape 23 : part de l'organisation du chauffeur (loyer ou pourcentage), selon ses règles de partage.
    lines.push(...(await this.fleetShare.lines(tx, driver, period, shareRides)));

    const packs = await tx.execute<{ id: string; price_paid_cents: number; activated_at: string; name: string | null }>(sql`
      SELECT p.id, p.price_paid_cents, p.activated_at, k.name FROM pack_purchases p LEFT JOIN packs k ON k.code = p.pack_code
      WHERE p.driver_id = ${driver.id}::uuid AND p.billing = 'to_bill' AND p.statement_id IS NULL
        AND p.activated_at < (${end}::date::timestamp AT TIME ZONE ${period.timeZone})
        AND NOT EXISTS (SELECT 1 FROM statement_lines sl WHERE sl.pack_purchase_id = p.id AND sl.statement_id <> ${self}::uuid)`);
    let packsTotal = 0;
    for (const p of packs) {
      for (const line of packBillingLines(p.id, p.price_paid_cents, new Date(p.activated_at), rates, `Pack ${p.name ?? ''}`.trim())) {
        lines.push(line);
        packsTotal += line.amountCents;
      }
    }

    // Crédit de pack du parrainage chauffeur (origine `driver_pack`) : appliqué aux packs de ce relevé, le reste attend.
    if (packsTotal > 0) {
      const [available] = await tx.execute<{ total: number }>(sql`
        SELECT COALESCE(sum(remaining_cents), 0)::int AS total FROM credits
        WHERE user_id = ${driver.userId}::uuid AND origin = 'driver_pack' AND remaining_cents > 0 AND (expires_at IS NULL OR expires_at > now())`);
      const amount = Math.min(Number(available?.total ?? 0), packsTotal);
      if (amount > 0) lines.push({ kind: 'referral_credit', amountCents: amount, occurredAt: new Date(`${period.endDate}T12:00:00Z`), label: 'Crédit de parrainage appliqué aux packs' });
    }

    if (statementId) {
      const manual = await tx
        .select()
        .from(schema.statementLines)
        .where(and(eq(schema.statementLines.statementId, statementId), inArray(schema.statementLines.kind, [...ADJUSTMENTS]), isNull(schema.statementLines.rideId)));
      for (const m of manual) lines.push({ kind: m.kind as StatementLineKind, amountCents: m.amountCents, occurredAt: m.occurredAt, label: m.label });
    }
    return lines;
  }

  private settlementRide(r: RideRow): SettlementRide {
    const completed = ['completed', 'rated', 'disputed'].includes(r.state);
    return {
      id: r.id,
      status: completed ? 'completed' : r.state === 'no_show' ? 'no_show' : 'cancelled',
      completedAt: new Date(r.at),
      paymentChannel: r.payment_choice === 'pay_driver_after' ? 'direct' : 'platform',
      fareCents: r.fare_cents ?? 0,
      serviceFeeCents: r.service_fee_cents ?? 0,
      regulatoryFeeCents: r.regulatory_fee_cents ?? 0,
      gstCents: r.gst_cents ?? 0,
      qstCents: r.qst_cents ?? 0,
      // Le pourboire passe toujours par la plateforme (carte de la course) ; un pourboire en espèces n'est pas connu.
      tipCents: r.tip_cents,
      tipChannel: 'platform',
      promotionCompensationCents: r.promotion_discount_cents,
      tollCents: r.tolls_cents,
      cancellationFeeCents: r.cancellation_fee_cents,
      platformFee: r.platform_fee_cents === null || r.platform_fee_bps === null ? null : { amountCents: Number(r.platform_fee_cents), rateBps: Number(r.platform_fee_bps) },
    };
  }

  private totalsOf(statement: Statement) {
    const t = statement.totalsByKind;
    const sum = (...kinds: string[]) => kinds.reduce((s, k) => s + (t[k] ?? 0), 0);
    return {
      platformFaresCents: sum('ride_fare_platform'),
      platformFareTaxesCents: sum('fare_taxes_platform'),
      tipsCents: sum('tip_platform'),
      packsBilledCents: sum('pack_billed', 'pack_taxes'),
      directFeesCollectedCents: sum('service_fee_direct', 'regulatory_fee_direct', 'fee_taxes_direct'),
      creditsAndBonusesCents: sum('promotion_compensation', 'bonus', 'referral_credit', 'cancellation_fee_platform', 'toll_reimbursement'),
      adjustmentsCents: sum('adjustment_positive') - sum('adjustment_negative'),
      creditsCents: statement.creditsCents,
      debitsCents: statement.debitsCents,
      netCents: statement.netCents,
    };
  }

  private async save(tx: Executor, driver: DriverInfo, period: StatementPeriod, statement: Statement, existing: StatementRow | null): Promise<StatementRow> {
    const totals = this.totalsOf(statement);
    let row: StatementRow;
    if (existing) {
      await tx.delete(schema.statementLines).where(eq(schema.statementLines.statementId, existing.id));
      [row] = (await tx.update(schema.weeklyStatements).set(totals).where(eq(schema.weeklyStatements.id, existing.id)).returning()) as [StatementRow];
    } else {
      [row] = (await tx.insert(schema.weeklyStatements).values({ driverId: driver.id, organizationId: organizationIdFor(driver.organizationId), periodStart: period.startDate, periodEnd: period.endDate, status: 'draft', ...totals }).returning()) as [StatementRow];
    }
    if (statement.lines.length) {
      await tx.insert(schema.statementLines).values(
        statement.lines.map((l) => ({ statementId: row.id, kind: l.kind, amountCents: l.amountCents, rideId: l.rideId ?? null, packPurchaseId: l.packPurchaseId ?? null, label: (l.label ?? l.kind).slice(0, 120), occurredAt: l.occurredAt })),
      );
    }
    return row;
  }

  private previewOf(driver: DriverInfo, statement: Statement): StatementComputed {
    return {
      id: null, driverId: driver.id, driverPublicNumber: driver.publicNumber, driverName: driver.name, status: null,
      creditsCents: statement.creditsCents, debitsCents: statement.debitsCents, netCents: statement.netCents,
      lines: statement.lines.map((l) => lineView({ kind: l.kind, label: l.label ?? l.kind, amountCents: l.amountCents, rideId: l.rideId ?? null, packPurchaseId: l.packPurchaseId ?? null, occurredAt: l.occurredAt })),
    };
  }

  private async computedOf(executor: Executor, row: StatementRow, driver: DriverInfo): Promise<StatementComputed> {
    const lines = await executor.select().from(schema.statementLines).where(eq(schema.statementLines.statementId, row.id)).orderBy(asc(schema.statementLines.occurredAt));
    return {
      id: row.id, driverId: driver.id, driverPublicNumber: driver.publicNumber, driverName: driver.name, status: row.status,
      creditsCents: row.creditsCents, debitsCents: row.debitsCents, netCents: row.netCents, lines: lines.map(lineView),
    };
  }

  /**
   * Émission : le brouillon devient le relevé du chauffeur (immuable). Les packs portés sont marqués facturés, le crédit
   * de pack appliqué est prélevé sur les crédits `driver_pack` (le plus proche de son expiration d'abord). Le PDF est
   * produit ensuite par la file `settlements`, le courriel part par l'outbox.
   */
  async issue(id: string, now = new Date()): Promise<AdminStatementDetail> {
    const issued = await this.db.transaction(async (tx) => {
      const [row] = await tx.execute<{ id: string; driver_id: string; status: string }>(sql`SELECT id, driver_id, status FROM weekly_statements WHERE id = ${id}::uuid FOR UPDATE`);
      if (!row) throw AppError.notFound('STATEMENT_NOT_FOUND', 'Relevé introuvable');
      if (row.status !== 'draft') throw AppError.conflict('STATEMENT_NOT_DRAFT', 'Ce relevé est déjà émis');
      const lines = await tx.select().from(schema.statementLines).where(eq(schema.statementLines.statementId, id));
      const packIds = [...new Set(lines.map((l) => l.packPurchaseId).filter((p): p is string => Boolean(p)))];
      if (packIds.length) await tx.update(schema.packPurchases).set({ billing: 'billed', statementId: id }).where(and(inArray(schema.packPurchases.id, packIds), eq(schema.packPurchases.billing, 'to_bill')));
      const referral = lines.filter((l) => l.kind === 'referral_credit').reduce((s, l) => s + l.amountCents, 0);
      if (referral > 0) await this.consumePackCredits(tx, row.driver_id, referral);
      const [updated] = await tx.update(schema.weeklyStatements).set({ status: 'issued', issuedAt: now }).where(eq(schema.weeklyStatements.id, id)).returning();
      await tx
        .insert(schema.driverBalances)
        .values({ driverId: row.driver_id, lastStatementId: id })
        .onConflictDoUpdate({ target: schema.driverBalances.driverId, set: { lastStatementId: id } });
      return updated!;
    });
    const driver = await this.driverInfo(issued.driverId);
    this.audit.record({ action: 'statement.issued', entity: 'weekly_statements', entityId: id, after: { netCents: issued.netCents, periodStart: issued.periodStart } });
    this.events.emit('statement.issued', { statementId: id, driverId: issued.driverId, periodStart: issued.periodStart, netCents: issued.netCents });
    if (driver) {
      await this.outbox.queue({ recipientUserId: driver.userId, template: 'statement.issued', data: { statementId: id, periodStart: issued.periodStart, periodEnd: issued.periodEnd, netCents: issued.netCents } });
    }
    return this.detail(id);
  }

  private async consumePackCredits(tx: Executor, driverId: string, amountCents: number): Promise<void> {
    const [driver] = await tx.select({ userId: schema.drivers.userId }).from(schema.drivers).where(eq(schema.drivers.id, driverId)).limit(1);
    if (!driver) return;
    const credits = await tx.execute<{ id: string; remaining_cents: number }>(sql`
      SELECT id, remaining_cents FROM credits WHERE user_id = ${driver.userId}::uuid AND origin = 'driver_pack' AND remaining_cents > 0 AND (expires_at IS NULL OR expires_at > now())
      ORDER BY expires_at ASC NULLS LAST, created_at ASC FOR UPDATE`);
    let left = amountCents;
    for (const c of credits) {
      if (left <= 0) break;
      const take = Math.min(Number(c.remaining_cents), left);
      await tx.update(schema.credits).set({ remainingCents: sql`${schema.credits.remainingCents} - ${take}` }).where(eq(schema.credits.id, c.id));
      left -= take;
    }
  }

  /** Ajustement motivé (crédit ou débit), sur un brouillon seulement ; un relevé émis se corrige sur le suivant. */
  async adjust(id: string, input: { direction: 'credit' | 'debit'; amountCents: number; reason: string }, now = new Date()): Promise<AdminStatementDetail> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx.execute<{ id: string; driver_id: string; status: string; period_start: string; period_end: string }>(sql`
        SELECT id, driver_id, status, period_start::text, period_end::text FROM weekly_statements WHERE id = ${id}::uuid FOR UPDATE`);
      if (!row) throw AppError.notFound('STATEMENT_NOT_FOUND', 'Relevé introuvable');
      if (row.status !== 'draft') throw AppError.conflict('STATEMENT_ALREADY_ISSUED', 'Relevé déjà émis : l\'ajustement se fait sur le brouillon de la semaine suivante');
      await tx.insert(schema.statementLines).values({
        statementId: id, kind: input.direction === 'credit' ? 'adjustment_positive' : 'adjustment_negative', amountCents: input.amountCents, label: input.reason.slice(0, 120), occurredAt: now,
      });
      const lines = await tx.select().from(schema.statementLines).where(eq(schema.statementLines.statementId, id));
      const statement = buildStatement(row.driver_id, { startDate: row.period_start, endDate: row.period_end, timeZone: await this.timeZone() }, lines.map((l) => ({ kind: l.kind as StatementLineKind, amountCents: l.amountCents, occurredAt: l.occurredAt })));
      await tx.update(schema.weeklyStatements).set(this.totalsOf(statement)).where(eq(schema.weeklyStatements.id, id));
    });
    this.audit.record({ action: 'statement.adjusted', entity: 'weekly_statements', entityId: id, after: { direction: input.direction, amountCents: input.amountCents, reason: input.reason } });
    return this.detail(id);
  }

  async detail(id: string): Promise<AdminStatementDetail> {
    const [row] = await this.db.select().from(schema.weeklyStatements).where(eq(schema.weeklyStatements.id, id)).limit(1);
    if (!row) throw AppError.notFound('STATEMENT_NOT_FOUND', 'Relevé introuvable');
    const driver = await this.driverInfo(row.driverId);
    const lines = await this.db.select().from(schema.statementLines).where(eq(schema.statementLines.statementId, id)).orderBy(asc(schema.statementLines.occurredAt));
    return {
      id: row.id, driverId: row.driverId, driverPublicNumber: driver?.publicNumber ?? '', driverName: driver?.name ?? null, periodStart: row.periodStart, periodEnd: row.periodEnd,
      status: row.status, creditsCents: row.creditsCents, debitsCents: row.debitsCents, netCents: row.netCents, issuedAt: row.issuedAt?.toISOString() ?? null,
      settledAt: row.settledAt?.toISOString() ?? null, attempts: row.attempts, failureCode: row.failureCode ?? null, transferRef: row.stripeTransferId ?? null,
      chargeRef: row.stripeChargeId ?? null, offlineSettlement: row.offlineSettlement ?? null, pdfAvailable: Boolean(row.pdfKey), lines: lines.map(lineView),
    };
  }

  /** Brouillons d'une période (émission automatique du vendredi), sans ceux des chauffeurs écartés du lot. */
  async draftsOf(periodStart: string, excludeDriverIds?: ReadonlySet<string>): Promise<string[]> {
    const rows = await this.db.select({ id: schema.weeklyStatements.id, driverId: schema.weeklyStatements.driverId }).from(schema.weeklyStatements).where(and(eq(schema.weeklyStatements.periodStart, periodStart), eq(schema.weeklyStatements.status, 'draft')));
    return rows.filter((r) => !excludeDriverIds?.has(r.driverId)).map((r) => r.id);
  }

  /**
   * Étape 20 : chauffeurs d'une organisation cliente qui ont, depuis le début de la fenêtre de reprise d'une période (ou
   * jamais réglée, quel que soit son âge : revue du 2 octobre 2026, constat 14), une course réglable d'une autre
   * organisation (la plateforme, une organisation sœur). Le contexte de leur organisation ne voit
   * pas ces courses : leur relevé reste fait par la plateforme, complet, comme avant. Lu par la plateforme, hors contexte.
   */
  async driversWithForeignRides(period: StatementPeriod): Promise<Set<string>> {
    const from = shift(period.startDate, -LOOKBACK_DAYS);
    const rows = await withoutOrgScope(() => this.db.execute<{ driver_id: string }>(sql`
      SELECT DISTINCT r.driver_id FROM rides r
      JOIN drivers d ON d.id = r.driver_id
      JOIN organizations od ON od.id = d.organization_id
      LEFT JOIN organizations ro ON ro.id = r.organization_id
      WHERE od.parent_id IS NOT NULL
        AND (r.state IN ('completed', 'rated', 'disputed') OR (r.state IN ('no_show', 'cancelled_by_client') AND r.cancellation_fee_cents > 0))
        AND (
          COALESCE(r.state_timestamps->>'completed', r.state_timestamps->>'no_show', r.state_timestamps->>'cancelled_by_client')::timestamptz >= (${from}::date::timestamp AT TIME ZONE ${period.timeZone})
          OR NOT EXISTS (SELECT 1 FROM statement_lines sl JOIN weekly_statements ws ON ws.id = sl.statement_id WHERE sl.ride_id = r.id AND ws.status <> 'draft')
        )
        AND (ro.path IS NULL OR ro.path NOT LIKE od.path || '%')`));
    return new Set([...rows].map((r) => r.driver_id));
  }
}
