/**
 * Registres de la redevance et des taxes (prompt 09, tâche 7, section 5.13). À la fin d'une course, une ligne par
 * registre : redevance due (période de remise AAAA-MM, heure de Montréal) et taxes par nature (`splitTaxDetail` : TPS et
 * TVQ du tarif pour le chauffeur, décision D26, celles des frais pour Neomoov). Les index uniques par course rendent
 * l'écriture idempotente : plusieurs processus peuvent recevoir le même événement, la reprise peut repasser. La remise
 * de la redevance d'un mois est marquée par le personnel des finances et journalisée.
 */
import { schema } from '@neomoov/db';
import {
  driverTaxReport, ledgerEntriesForRide, localDate, monthOf, parseLedgerPeriod, quarterOfMonth,
  type DriverTaxReport, type LedgerMonthView, type LedgerPeriod, type RedevanceRemitResult,
} from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { AppError } from '../../common/app-error.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AuditService } from '../audit/audit.service.js';
import { PricingRulesService } from '../pricing/pricing-rules.service.js';

/** États d'une course terminée : ceux-là seulement entrent aux registres. */
const FINISHED_STATES = new Set<string>(['completed', 'rated', 'disputed']);
/** Courses traitées au plus par passe de reprise. */
const SWEEP_LIMIT = 500;

export interface LedgerRecordResult {
  redevance: boolean;
  taxes: boolean;
}

export interface LedgerSweepReport {
  scanned: number;
  redevance: number;
  taxes: number;
  failed: number;
}

/** Totaux d'un mois des registres (vue My Hub et rapport de synthèse). */
const num = (value: unknown): number => Number(value ?? 0);

@Injectable()
export class LedgersService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly settings: SettingsService,
    private readonly pricingRules: PricingRulesService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.database.db;
  }

  async timeZone(): Promise<string> {
    return this.settings.string('service.time_zone', 'America/Toronto');
  }

  /** Période valide ou erreur 400 lisible. */
  period(code: string): LedgerPeriod {
    const period = parseLedgerPeriod(code);
    if (!period) throw new AppError('LEDGER_PERIOD_INVALID', 'Période AAAA-MM (mois) ou AAAA-Tn (trimestre) attendue', 400, { period: code });
    return period;
  }

  /**
   * Lignes des deux registres d'une course terminée, aux taux et à la redevance en vigueur pour sa ville ; sans effet
   * pour une course non terminée ou déjà inscrite. Renvoie ce qui a été écrit.
   */
  async record(rideId: string): Promise<LedgerRecordResult> {
    const none = { redevance: false, taxes: false };
    const r = schema.rides;
    const [ride] = await this.db
      .select({
        id: r.id, driverId: r.driverId, state: r.state, cityCode: r.cityCode, stateTimestamps: r.stateTimestamps, fareCents: r.fareCents,
        promotionDiscountCents: r.promotionDiscountCents, regulatoryFeeCents: r.regulatoryFeeCents, gstCents: r.gstCents, qstCents: r.qstCents,
      })
      .from(r)
      .where(eq(r.id, rideId))
      .limit(1);
    if (!ride?.driverId || !FINISHED_STATES.has(ride.state)) return none;
    const completedAt = (ride.stateTimestamps as Record<string, string> | null)?.['completed'];
    if (!completedAt) {
      this.logger.warn({ rideId }, 'Course terminée sans horodatage de fin : registres non tenus');
      return none;
    }
    const [loaded, timeZone] = await Promise.all([this.pricingRules.rulesFor(ride.cityCode), this.timeZone()]);
    const entries = ledgerEntriesForRide(
      {
        id: ride.id, driverId: ride.driverId, completedAt: new Date(completedAt), fareCents: ride.fareCents ?? 0, promotionCompensationCents: ride.promotionDiscountCents,
        regulatoryFeeCents: ride.regulatoryFeeCents, gstCents: ride.gstCents ?? 0, qstCents: ride.qstCents ?? 0,
      },
      { rates: { gstRatePpm: loaded.rules.gstRatePpm, qstRatePpm: loaded.rules.qstRatePpm }, regulatoryFeeCents: loaded.rules.regulatoryFeeCents, timeZone },
    );
    const [redevance] = await this.db.insert(schema.redevanceLedger).values(entries.redevance).onConflictDoNothing({ target: schema.redevanceLedger.rideId }).returning({ id: schema.redevanceLedger.id });
    const [taxes] = await this.db.insert(schema.taxLedger).values(entries.taxes).onConflictDoNothing({ target: schema.taxLedger.rideId }).returning({ id: schema.taxLedger.id });
    return { redevance: Boolean(redevance), taxes: Boolean(taxes) };
  }

  /**
   * Reprise : courses terminées sans ligne dans l'un des registres (panne, événement perdu, redémarrage), 500 au plus par
   * passe, les plus anciennes d'abord. `rideIds` limite la passe à ces courses (tests, reprise ciblée).
   */
  async sweep(options: { rideIds?: string[] } = {}): Promise<LedgerSweepReport> {
    const report: LedgerSweepReport = { scanned: 0, redevance: 0, taxes: 0, failed: 0 };
    if (options.rideIds && !options.rideIds.length) return report;
    const rows = await this.db.execute<{ id: string }>(sql`
      SELECT r.id FROM rides r
      WHERE r.state IN ('completed', 'rated', 'disputed') AND r.driver_id IS NOT NULL AND (r.state_timestamps->>'completed') IS NOT NULL
        AND (NOT EXISTS (SELECT 1 FROM redevance_ledger l WHERE l.ride_id = r.id) OR NOT EXISTS (SELECT 1 FROM tax_ledger t WHERE t.ride_id = r.id))
        ${options.rideIds ? sql`AND r.id IN ${options.rideIds}` : sql``}
      ORDER BY (r.state_timestamps->>'completed')::timestamptz, r.id
      LIMIT ${SWEEP_LIMIT}`);
    for (const { id } of rows) {
      report.scanned += 1;
      try {
        const written = await this.record(id);
        if (written.redevance) report.redevance += 1;
        if (written.taxes) report.taxes += 1;
      } catch (error) {
        report.failed += 1;
        this.logger.error({ err: error, rideId: id }, 'Registres : reprise en échec pour cette course');
      }
    }
    if (report.redevance || report.taxes || report.failed) this.logger.info(report, 'Registres : reprise des courses terminées sans ligne');
    return report;
  }

  /**
   * Mois des registres : redevance due, facturée et remise, taxes par nature. Sans période : les 24 derniers mois qui ont
   * des lignes ; avec une période (mois ou trimestre) : ses mois qui ont des lignes.
   */
  async months(periodCode?: string): Promise<LedgerMonthView[]> {
    const months = periodCode ? this.period(periodCode).months : null;
    const redevance = await this.db.execute<{ period: string; n: number; amount: string; billed: string; remitted: string; unremitted: number; remitted_at: string | null }>(sql`
      SELECT l.remittance_period AS period, count(*)::int AS n, sum(l.amount_cents)::bigint AS amount, COALESCE(sum(r.regulatory_fee_cents), 0)::bigint AS billed,
        COALESCE(sum(l.amount_cents) FILTER (WHERE l.remitted_at IS NOT NULL), 0)::bigint AS remitted, (count(*) FILTER (WHERE l.remitted_at IS NULL))::int AS unremitted,
        to_char(max(l.remitted_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS remitted_at
      FROM redevance_ledger l JOIN rides r ON r.id = l.ride_id
      ${months ? sql`WHERE l.remittance_period IN ${months}` : sql``}
      GROUP BY l.remittance_period ORDER BY l.remittance_period DESC LIMIT 24`);
    const periods = [...redevance].map((row) => row.period);
    if (!periods.length) return [];
    const taxes = await this.db.execute<{ period: string; fare_gst: string; fare_qst: string; fee_gst: string; fee_qst: string }>(sql`
      SELECT period, sum(fare_gst_cents)::bigint AS fare_gst, sum(fare_qst_cents)::bigint AS fare_qst, sum(fee_gst_cents)::bigint AS fee_gst, sum(fee_qst_cents)::bigint AS fee_qst
      FROM tax_ledger WHERE period IN ${periods} GROUP BY period`);
    const byPeriod = new Map([...taxes].map((t) => [t.period, t]));
    return [...redevance].map((row) => {
      const tax = byPeriod.get(row.period);
      return {
        period: row.period, rideCount: num(row.n), redevanceCents: num(row.amount), redevanceBilledCents: num(row.billed), remittedCents: num(row.remitted),
        unremittedCount: num(row.unremitted), remittedAt: row.remitted_at,
        fareGstCents: num(tax?.fare_gst), fareQstCents: num(tax?.fare_qst), feeGstCents: num(tax?.fee_gst), feeQstCents: num(tax?.fee_qst),
      };
    });
  }

  /**
   * Remise de la redevance d'un mois terminé : les lignes non encore remises reçoivent la date de remise (midi, heure de
   * Montréal, du jour indiqué, ou maintenant). Une ligne inscrite après coup (reprise) reste à remettre : une nouvelle
   * remise la marque à son tour. Journalisée avec la référence de la remise.
   */
  async remit(input: { period: string; remittedOn?: string | undefined; reference?: string | undefined }): Promise<RedevanceRemitResult> {
    const tz = await this.timeZone();
    const period = this.period(input.period);
    if (period.kind !== 'month') throw new AppError('LEDGER_PERIOD_INVALID', 'La redevance se remet par mois (AAAA-MM)', 400, { period: input.period });
    const today = localDate(new Date(), tz).date;
    if (period.endDate >= today) throw AppError.conflict('LEDGER_PERIOD_OPEN', 'La redevance d\'un mois se remet une fois le mois terminé', { period: input.period });
    if (input.remittedOn && (input.remittedOn <= period.endDate || input.remittedOn > today)) {
      throw new AppError('REMITTANCE_DATE_INVALID', 'La date de remise suit la fin du mois et n\'est pas dans le futur', 400, { remittedOn: input.remittedOn, periodEnd: period.endDate });
    }
    const l = schema.redevanceLedger;
    const [existing] = await this.db.select({ n: count() }).from(l).where(eq(l.remittancePeriod, input.period));
    if (!existing?.n) throw AppError.notFound('LEDGER_PERIOD_EMPTY', 'Aucune course au registre de la redevance pour ce mois', { period: input.period });
    const remittedAt = input.remittedOn ? sql`((${input.remittedOn}::date + time '12:00') AT TIME ZONE ${tz})` : sql`now()`;
    const iso = (column: typeof l.remittedAt) => sql<string | null>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
    const updated = await this.db
      .update(l)
      .set({ remittedAt })
      .where(and(eq(l.remittancePeriod, input.period), isNull(l.remittedAt)))
      .returning({ amountCents: l.amountCents, remittedAt: iso(l.remittedAt) });
    const [totals] = await this.db
      .select({ n: count(), amount: sql<string>`COALESCE(sum(${l.amountCents}), 0)::bigint`, last: sql<string | null>`to_char(max(${l.remittedAt}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')` })
      .from(l)
      .where(eq(l.remittancePeriod, input.period));
    const result: RedevanceRemitResult = {
      period: input.period,
      rideCount: num(totals?.n),
      amountCents: num(totals?.amount),
      newlyRemitted: updated.length,
      newlyRemittedCents: updated.reduce((sum, row) => sum + row.amountCents, 0),
      // Remise qui vient d'être marquée, ou la dernière du mois si tout était déjà remis (à la seconde).
      remittedAt: updated[0]?.remittedAt ?? totals?.last ?? new Date().toISOString(),
    };
    this.audit.record({ action: 'ledger.redevance_remitted', entity: 'redevance_ledger', entityId: null, after: { ...result, reference: input.reference ?? null } });
    return result;
  }

  /** Chauffeur d'un compte (rapport de ses propres taxes) ; 403 sans profil chauffeur. */
  async driverIdOfUser(userId: string): Promise<string> {
    const [driver] = await this.db.select({ id: schema.drivers.id }).from(schema.drivers).where(eq(schema.drivers.userId, userId)).limit(1);
    if (!driver) throw AppError.forbidden('DRIVER_PROFILE_REQUIRED', 'Profil chauffeur requis : commencez par la candidature');
    return driver.id;
  }

  /**
   * Rapport trimestriel d'un chauffeur pour ses déclarations (5.8) : par mois, courses terminées, tarifs et TPS et TVQ
   * sur ses tarifs, qu'il remet lui-même (décision D26). Sans trimestre : le trimestre en cours.
   */
  async driverTaxReport(driverId: string, quarter?: string): Promise<DriverTaxReport> {
    const tz = await this.timeZone();
    const code = quarter ?? quarterOfMonth(monthOf(new Date(), tz));
    const period = this.period(code);
    const [driver] = await this.db
      .select({ id: schema.drivers.id, publicNumber: schema.drivers.publicNumber, gstNumber: schema.drivers.gstNumber, qstNumber: schema.drivers.qstNumber, firstName: schema.users.firstName, lastName: schema.users.lastName })
      .from(schema.drivers)
      .innerJoin(schema.users, eq(schema.users.id, schema.drivers.userId))
      .where(eq(schema.drivers.id, driverId))
      .limit(1);
    if (!driver) throw AppError.notFound('DRIVER_NOT_FOUND', 'Chauffeur introuvable');
    const rows = await this.db.execute<{ month: string; n: number; fare: string; gst: string; qst: string }>(sql`
      SELECT t.period AS month, count(*)::int AS n, COALESCE(sum(r.fare_cents), 0)::bigint AS fare, sum(t.fare_gst_cents)::bigint AS gst, sum(t.fare_qst_cents)::bigint AS qst
      FROM tax_ledger t JOIN rides r ON r.id = t.ride_id
      WHERE t.driver_id = ${driverId} AND t.period IN ${period.months}
      GROUP BY t.period`);
    const report = driverTaxReport(period, [...rows].map((row) => ({ month: row.month, rideCount: num(row.n), fareCents: num(row.fare), gstCents: num(row.gst), qstCents: num(row.qst) })));
    const name = [driver.firstName, driver.lastName].filter(Boolean).join(' ') || null;
    return {
      quarter: code, startDate: period.startDate, endDate: period.endDate,
      driver: { id: driver.id, publicNumber: driver.publicNumber, name, gstNumber: driver.gstNumber, qstNumber: driver.qstNumber },
      months: report.months, totals: report.totals, generatedAt: new Date().toISOString(),
    };
  }
}
