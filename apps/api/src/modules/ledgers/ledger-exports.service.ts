/**
 * Exports des registres (prompt 09, tâche 7) : CSV mensuels et trimestriels pour Revenu Québec et le comptable
 * (séparateur point-virgule, montants en cents, une ligne de total par mois et une pour le trimestre), et rapport de
 * synthèse PDF produit par le worker (file `exports`, jamais dans une requête HTTP). L'état d'un rapport est un petit
 * manifeste JSON rangé à côté du PDF dans le stockage objet : l'API et le worker le lisent sans table dédiée.
 */
import type { LedgerPeriod, LedgerSummaryView, LedgerType } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { STORAGE_PROVIDER, type StorageProvider } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { APP_LOGGER, currentCorrelationId } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { QueueService } from '../../infra/queue.module.js';
import { AuditService } from '../audit/audit.service.js';
import type { UserActor } from '../auth/actor.js';
import { csvDocument, csvLine, type CsvValue } from './csv.js';
import { renderLedgerSummaryPdf, type SummaryDriverRow } from './ledger-summary-pdf.js';
import { LedgersService } from './ledgers.service.js';
import { FieldCipher } from '../../common/field-cipher.js';

const SEPARATOR = ';';
const SUMMARY_PREFIX = 'ledgers/summaries';

interface SummaryManifest {
  type: LedgerType;
  period: string;
  status: 'pending' | 'ready' | 'failed';
  requestedAt: string;
  requestedBy: string | null;
  generatedAt: string | null;
  error: string | null;
}

export interface LedgerSummaryJob {
  kind: 'summary';
  type: LedgerType;
  period: string;
}

const num = (value: unknown): number => Number(value ?? 0);
const summaryKeys = (type: LedgerType, period: string) => ({ pdf: `${SUMMARY_PREFIX}/${type}/${period}.pdf`, manifest: `${SUMMARY_PREFIX}/${type}/${period}.json` });

@Injectable()
export class LedgerExportsService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly ledgers: LedgersService,
    private readonly settings: SettingsService,
    private readonly queues: QueueService,
    private readonly audit: AuditService,
    private readonly fields: FieldCipher,
  ) {}

  private get db() {
    return this.database.db;
  }

  /** Nom du fichier CSV téléchargé. */
  csvFileName(type: LedgerType, period: string): string {
    return `neomoov-registre-${type}-${period}.csv`;
  }

  /** Export CSV d'un registre sur un mois ou un trimestre ; le téléchargement est journalisé. */
  async csv(type: LedgerType, periodCode: string, actor: UserActor): Promise<string> {
    const period = this.ledgers.period(periodCode);
    const tz = await this.ledgers.timeZone();
    const body = type === 'redevance' ? await this.redevanceCsv(period, tz) : await this.taxesCsv(period, tz);
    await this.audit.write([{ action: 'ledger.export_downloaded', entity: 'ledgers', entityId: null, after: { type, period: periodCode, format: 'csv' } }], { actor, ip: null, correlationId: currentCorrelationId() ?? null });
    return body;
  }

  /**
   * Registre de la redevance : une ligne par course (redevance due, redevance facturée au client, date de remise), puis
   * une ligne `TOTAL AAAA-MM` par mois (nombre de courses dans la colonne `course`) et, pour un trimestre, `TOTAL AAAA-Tn`.
   */
  private async redevanceCsv(period: LedgerPeriod, tz: string): Promise<string> {
    const rows = await this.db.execute<{ period: string; ride: string; completed: string | null; driver: string | null; amount: number; billed: number; remitted: string | null }>(sql`
      SELECT l.remittance_period AS period, r.public_number AS ride,
        to_char((r.state_timestamps->>'completed')::timestamptz AT TIME ZONE ${tz}, 'YYYY-MM-DD HH24:MI') AS completed,
        d.public_number AS driver, l.amount_cents AS amount, COALESCE(r.regulatory_fee_cents, 0) AS billed,
        to_char(l.remitted_at AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS remitted
      FROM redevance_ledger l JOIN rides r ON r.id = l.ride_id LEFT JOIN drivers d ON d.id = r.driver_id
      WHERE l.remittance_period IN ${period.months}
      ORDER BY l.remittance_period, (r.state_timestamps->>'completed')::timestamptz, r.public_number`);
    const header = ['periode', 'course', 'terminee_le', 'chauffeur', 'redevance_cents', 'facturee_client_cents', 'remise_le'];
    return this.withTotals(period, header, [...rows], (row) => [row.period, row.ride, row.completed, row.driver, num(row.amount), num(row.billed), row.remitted], [4, 5]);
  }

  /**
   * Registre des taxes : une ligne par course (numéros de taxes du chauffeur, tarif, TPS et TVQ du tarif pour le chauffeur,
   * TPS et TVQ des frais pour Neomoov), avec les mêmes lignes de total que la redevance.
   */
  private async taxesCsv(period: LedgerPeriod, tz: string): Promise<string> {
    const rows = await this.db.execute<{ period: string; ride: string; completed: string | null; driver: string; gst_number: string | null; qst_number: string | null; fare: number; fare_gst: number; fare_qst: number; fee_gst: number; fee_qst: number }>(sql`
      SELECT t.period, r.public_number AS ride,
        to_char((r.state_timestamps->>'completed')::timestamptz AT TIME ZONE ${tz}, 'YYYY-MM-DD HH24:MI') AS completed,
        d.public_number AS driver, d.gst_number, d.qst_number, COALESCE(r.fare_cents, 0) AS fare,
        t.fare_gst_cents AS fare_gst, t.fare_qst_cents AS fare_qst, t.fee_gst_cents AS fee_gst, t.fee_qst_cents AS fee_qst
      FROM tax_ledger t JOIN rides r ON r.id = t.ride_id JOIN drivers d ON d.id = t.driver_id
      WHERE t.period IN ${period.months}
      ORDER BY t.period, (r.state_timestamps->>'completed')::timestamptz, r.public_number`);
    const header = ['periode', 'course', 'terminee_le', 'chauffeur', 'tps_chauffeur', 'tvq_chauffeur', 'tarif_cents', 'tps_tarif_cents', 'tvq_tarif_cents', 'tps_frais_cents', 'tvq_frais_cents'];
    return this.withTotals(period, header, [...rows], (row) => [row.period, row.ride, row.completed, row.driver, this.fields.decrypt(row.gst_number), this.fields.decrypt(row.qst_number), num(row.fare), num(row.fare_gst), num(row.fare_qst), num(row.fee_gst), num(row.fee_qst)], [6, 7, 8, 9, 10]);
  }

  /** Lignes par mois, total de chaque mois (même vide) et total du trimestre ; `sums` : colonnes additionnées. */
  private withTotals<T extends { period: string }>(period: LedgerPeriod, header: string[], rows: T[], cells: (row: T) => CsvValue[], sums: number[]): string {
    const lines = [csvLine(header, SEPARATOR)];
    const grand = new Map<number, number>(sums.map((i) => [i, 0]));
    let grandCount = 0;
    const totalLine = (label: string, rideCount: number, totals: Map<number, number>): string => {
      const out: CsvValue[] = header.map(() => null);
      out[0] = label;
      out[1] = rideCount;
      for (const [i, value] of totals) out[i] = value;
      return csvLine(out, SEPARATOR);
    };
    for (const month of period.months) {
      const monthRows = rows.filter((r) => r.period === month);
      const totals = new Map<number, number>(sums.map((i) => [i, 0]));
      for (const row of monthRows) {
        const values = cells(row);
        lines.push(csvLine(values, SEPARATOR));
        for (const i of sums) totals.set(i, totals.get(i)! + Number(values[i] ?? 0));
      }
      lines.push(totalLine(`TOTAL ${month}`, monthRows.length, totals));
      grandCount += monthRows.length;
      for (const i of sums) grand.set(i, grand.get(i)! + totals.get(i)!);
    }
    if (period.kind === 'quarter') lines.push(totalLine(`TOTAL ${period.code}`, grandCount, grand));
    return csvDocument(lines);
  }

  // Rapport de synthèse PDF ------------------------------------------------------------------------------------------

  private async readManifest(type: LedgerType, period: string): Promise<SummaryManifest | null> {
    const object = await this.storage.getObject(summaryKeys(type, period).manifest);
    if (!object) return null;
    try {
      return JSON.parse(object.body.toString('utf8')) as SummaryManifest;
    } catch {
      return null;
    }
  }

  private async writeManifest(manifest: SummaryManifest): Promise<void> {
    await this.storage.putObject({ key: summaryKeys(manifest.type, manifest.period).manifest, body: Buffer.from(JSON.stringify(manifest)), contentType: 'application/json' });
  }

  private view(manifest: SummaryManifest): LedgerSummaryView {
    return {
      type: manifest.type, period: manifest.period, status: manifest.status, requestedAt: manifest.requestedAt, generatedAt: manifest.generatedAt, error: manifest.error,
      downloadPath: manifest.status === 'ready' ? `/admin/ledgers/summaries/${manifest.type}/${manifest.period}/pdf` : null,
    };
  }

  /** Demande d'un rapport : manifeste « en attente », puis tâche pour le worker (traitée sur place sans Redis). */
  async requestSummary(type: LedgerType, periodCode: string, actor: UserActor): Promise<LedgerSummaryView> {
    this.ledgers.period(periodCode);
    const previous = await this.readManifest(type, periodCode);
    await this.writeManifest({ type, period: periodCode, status: 'pending', requestedAt: new Date().toISOString(), requestedBy: actor.userId, generatedAt: previous?.generatedAt ?? null, error: null });
    const job: LedgerSummaryJob = { kind: 'summary', type, period: periodCode };
    await this.queues.add('exports', 'summary', job, { jobId: `summary-${type}-${periodCode}-${Date.now()}` });
    this.audit.record({ action: 'ledger.summary_requested', entity: 'ledgers', entityId: null, after: { type, period: periodCode } });
    return (await this.summaryStatus(type, periodCode))!;
  }

  async summaryStatus(type: LedgerType, periodCode: string): Promise<LedgerSummaryView | null> {
    const manifest = await this.readManifest(type, periodCode);
    return manifest ? this.view(manifest) : null;
  }

  /** Fichier PDF d'un rapport prêt ; le téléchargement est journalisé. */
  async summaryFile(type: LedgerType, periodCode: string, actor: UserActor): Promise<Buffer> {
    const manifest = await this.readManifest(type, periodCode);
    if (!manifest) throw AppError.notFound('LEDGER_SUMMARY_NOT_FOUND', 'Aucun rapport demandé pour ce registre et cette période');
    if (manifest.status !== 'ready') throw AppError.conflict('LEDGER_SUMMARY_NOT_READY', 'Le rapport n\'est pas encore prêt', { status: manifest.status });
    const object = await this.storage.getObject(summaryKeys(type, periodCode).pdf);
    if (!object) throw AppError.notFound('LEDGER_SUMMARY_FILE_MISSING', 'Fichier du rapport introuvable dans le stockage : demandez-le de nouveau');
    await this.audit.write([{ action: 'ledger.export_downloaded', entity: 'ledgers', entityId: null, after: { type, period: periodCode, format: 'pdf' } }], { actor, ip: null, correlationId: currentCorrelationId() ?? null });
    return object.body;
  }

  /** Production du rapport par le worker : données agrégées, PDF, manifeste « prêt » (ou « en échec » avec le motif). */
  async produceSummary(type: LedgerType, periodCode: string): Promise<void> {
    const manifest: SummaryManifest = (await this.readManifest(type, periodCode)) ?? { type, period: periodCode, status: 'pending', requestedAt: new Date().toISOString(), requestedBy: null, generatedAt: null, error: null };
    try {
      const period = this.ledgers.period(periodCode);
      const [tz, companyName, months] = await Promise.all([this.ledgers.timeZone(), this.settings.string('company.legal_name', 'Neomoov'), this.ledgers.months(periodCode)]);
      const drivers = type === 'taxes' ? await this.driverTotals(period) : [];
      const generatedAt = new Date();
      const pdf = await renderLedgerSummaryPdf({ type, period, companyName, generatedAt, timeZone: tz, months, drivers });
      await this.storage.putObject({ key: summaryKeys(type, periodCode).pdf, body: pdf, contentType: 'application/pdf' });
      await this.writeManifest({ ...manifest, status: 'ready', generatedAt: generatedAt.toISOString(), error: null });
      await this.audit.recordSystem({ action: 'ledger.summary_produced', entity: 'ledgers', entityId: null, after: { type, period: periodCode, bytes: pdf.length } }, 'ledger_exports');
    } catch (error) {
      await this.writeManifest({ ...manifest, status: 'failed', error: error instanceof Error ? error.message.slice(0, 300) : 'Erreur inconnue' }).catch(() => undefined);
      this.logger.error({ err: error, type, period: periodCode }, 'Rapport de synthèse des registres en échec');
      throw error;
    }
  }

  /** Taxes par chauffeur sur la période (détail du rapport de synthèse des taxes). */
  private async driverTotals(period: LedgerPeriod): Promise<SummaryDriverRow[]> {
    const rows = await this.db.execute<{ driver: string; gst_number: string | null; qst_number: string | null; n: number; fare: string; gst: string; qst: string }>(sql`
      SELECT d.public_number AS driver, d.gst_number, d.qst_number, count(*)::int AS n, COALESCE(sum(r.fare_cents), 0)::bigint AS fare,
        sum(t.fare_gst_cents)::bigint AS gst, sum(t.fare_qst_cents)::bigint AS qst
      FROM tax_ledger t JOIN rides r ON r.id = t.ride_id JOIN drivers d ON d.id = t.driver_id
      WHERE t.period IN ${period.months}
      GROUP BY d.id, d.public_number, d.gst_number, d.qst_number ORDER BY d.public_number`);
    return [...rows].map((row) => ({ publicNumber: row.driver, gstNumber: this.fields.decrypt(row.gst_number), qstNumber: this.fields.decrypt(row.qst_number), rideCount: num(row.n), fareCents: num(row.fare), gstCents: num(row.gst), qstCents: num(row.qst) }));
  }
}
