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
  type AdminStatementDetail, type SettlementRide, type Statement, type StatementComputed, type StatementGeneration, type StatementLine, type StatementLineKind,
  type StatementLineView, type StatementPeriod, type TaxRates,
} from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AppError } from '../../common/app-error.js';
import { DomainEventsService } from '../../common/domain-events.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';

type Executor = Pick<Database['db'], 'insert' | 'update' | 'select' | 'execute' | 'delete'>;
type StatementRow = typeof schema.weeklyStatements.$inferSelect;

/** Une course ou un pack non réglé depuis plus longtemps n'est plus repris automatiquement (reprise manuelle). */
const LOOKBACK_DAYS = 56;
const NO_STATEMENT = '00000000-0000-4000-8000-000000000000';
const ADJUSTMENTS = new Set(['adjustment_positive', 'adjustment_negative']);

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
  at: string;
};

interface DriverInfo {
  id: string;
  userId: string;
  publicNumber: string;
  name: string | null;
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
  async generate(input: { periodStart?: string | undefined; driverId?: string | undefined; preview?: boolean | undefined }, now = new Date()): Promise<StatementGeneration> {
    const period = await this.periodOf(input.periodStart, now);
    const rates = await this.rates();
    const driverIds = input.driverId ? [input.driverId] : await this.candidateDrivers(period);
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
        if (!lines.length && !existing) return null;
        const statement = buildStatement(driverId, period, lines);
        if (input.preview) return { skipped: false, view: this.previewOf(driver, statement) };
        const saved = await this.save(tx, driver, period, statement, existing ?? null);
        return { skipped: false, view: await this.computedOf(tx, saved, driver) };
      });
      if (!computed) continue;
      if (computed.skipped) result.skipped += 1;
      else result.generated += 1;
      result.statements.push(computed.view);
    }
    return result;
  }

  /** Chauffeurs qui ont une course ou un pack non réglé jusqu'à la fin de la période. */
  private async candidateDrivers(period: StatementPeriod): Promise<string[]> {
    const end = shift(period.endDate, 1);
    const from = shift(period.startDate, -LOOKBACK_DAYS);
    const rows = await this.db.execute<{ driver_id: string }>(sql`
      SELECT DISTINCT r.driver_id FROM rides r
      WHERE r.driver_id IS NOT NULL
        AND (r.state IN ('completed', 'rated', 'disputed') OR (r.state IN ('no_show', 'cancelled_by_client') AND r.cancellation_fee_cents > 0))
        AND COALESCE(r.state_timestamps->>'completed', r.state_timestamps->>'no_show', r.state_timestamps->>'cancelled_by_client')::timestamptz < (${end}::date::timestamp AT TIME ZONE ${period.timeZone})
        AND COALESCE(r.state_timestamps->>'completed', r.state_timestamps->>'no_show', r.state_timestamps->>'cancelled_by_client')::timestamptz >= (${from}::date::timestamp AT TIME ZONE ${period.timeZone})
        AND NOT EXISTS (SELECT 1 FROM statement_lines sl JOIN weekly_statements ws ON ws.id = sl.statement_id WHERE sl.ride_id = r.id AND ws.status <> 'draft')
      UNION
      SELECT DISTINCT p.driver_id FROM pack_purchases p
      WHERE p.billing = 'to_bill' AND p.statement_id IS NULL AND p.activated_at < (${end}::date::timestamp AT TIME ZONE ${period.timeZone})`);
    return rows.map((r) => r.driver_id);
  }

  private async driverInfo(driverId: string): Promise<DriverInfo | null> {
    const [row] = await this.db
      .select({ id: schema.drivers.id, userId: schema.drivers.userId, publicNumber: schema.drivers.publicNumber, first: schema.users.firstName, last: schema.users.lastName })
      .from(schema.drivers)
      .innerJoin(schema.users, eq(schema.users.id, schema.drivers.userId))
      .where(eq(schema.drivers.id, driverId))
      .limit(1);
    return row ? { id: row.id, userId: row.userId, publicNumber: row.publicNumber, name: [row.first, row.last].filter(Boolean).join(' ') || null } : null;
  }

  /**
   * Lignes d'un relevé : courses et packs non encore pris par un autre relevé (jusqu'à la fin de la période, 8 semaines
   * en arrière au plus), crédit de pack du parrainage appliqué aux packs facturés, ajustements manuels du brouillon.
   */
  private async collectLines(tx: Executor, driver: DriverInfo, period: StatementPeriod, rates: TaxRates, statementId: string | null): Promise<StatementLine[]> {
    const end = shift(period.endDate, 1);
    const from = shift(period.startDate, -LOOKBACK_DAYS);
    const self = statementId ?? NO_STATEMENT;
    const rides = await tx.execute<RideRow>(sql`
      SELECT r.id, r.public_number, r.state, r.payment_choice, r.fare_cents, r.service_fee_cents, r.regulatory_fee_cents, r.gst_cents, r.qst_cents, r.tip_cents,
        r.promotion_discount_cents, r.tolls_cents, r.cancellation_fee_cents, r.guarantee_outcome, r.driver_fare_protected,
        COALESCE(r.state_timestamps->>'completed', r.state_timestamps->>'no_show', r.state_timestamps->>'cancelled_by_client') AS at
      FROM rides r
      WHERE r.driver_id = ${driver.id}::uuid
        AND (r.state IN ('completed', 'rated', 'disputed') OR (r.state IN ('no_show', 'cancelled_by_client') AND r.cancellation_fee_cents > 0))
        AND COALESCE(r.state_timestamps->>'completed', r.state_timestamps->>'no_show', r.state_timestamps->>'cancelled_by_client')::timestamptz < (${end}::date::timestamp AT TIME ZONE ${period.timeZone})
        AND COALESCE(r.state_timestamps->>'completed', r.state_timestamps->>'no_show', r.state_timestamps->>'cancelled_by_client')::timestamptz >= (${from}::date::timestamp AT TIME ZONE ${period.timeZone})
        AND NOT EXISTS (SELECT 1 FROM statement_lines sl WHERE sl.ride_id = r.id AND sl.statement_id <> ${self}::uuid)`);
    const lines: StatementLine[] = [];
    for (const r of rides) {
      const ride = this.settlementRide(r);
      for (const line of classifyRideForStatement(ride, rates)) lines.push({ ...line, label: `${line.label ?? line.kind} · ${r.public_number}` });
      // Garantie modèle validée, chauffeur en faute : le tarif et ses taxes ne lui sont pas dus (course remboursée au client).
      if (ride.status === 'completed' && r.guarantee_outcome === 'validated' && !r.driver_fare_protected) {
        const amount = ride.fareCents + splitTaxes(ride, rates).fareTaxesCents;
        if (amount > 0) lines.push({ kind: 'adjustment_negative', amountCents: amount, rideId: r.id, occurredAt: ride.completedAt, label: `Garantie modèle, course remboursée · ${r.public_number}` });
      }
    }

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
      [row] = (await tx.insert(schema.weeklyStatements).values({ driverId: driver.id, periodStart: period.startDate, periodEnd: period.endDate, status: 'draft', ...totals }).returning()) as [StatementRow];
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
      await this.outbox.queue({ recipientUserId: driver.userId, channel: 'email', template: 'statement.issued', data: { statementId: id, periodStart: issued.periodStart, periodEnd: issued.periodEnd, netCents: issued.netCents } });
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
      chargeRef: row.stripeChargeId ?? null, pdfAvailable: Boolean(row.pdfKey), lines: lines.map(lineView),
    };
  }

  /** Brouillons d'une période (émission automatique du vendredi). */
  async draftsOf(periodStart: string): Promise<string[]> {
    const rows = await this.db.select({ id: schema.weeklyStatements.id }).from(schema.weeklyStatements).where(and(eq(schema.weeklyStatements.periodStart, periodStart), eq(schema.weeklyStatements.status, 'draft')));
    return rows.map((r) => r.id);
  }
}
