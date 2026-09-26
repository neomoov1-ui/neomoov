/**
 * Export mensuel de géolocalisation (prompt 09, tâche 8, section 5.13) : le 1er du mois, heure de Montréal, un fichier
 * CSV daté des courses terminées du mois précédent (identifiants pseudonymisés, origine, destination, horodatages,
 * distance), archivé par l'adaptateur de stockage, et une ligne `geolocation_exports` par mois et par format. La passe
 * est rejouable : un verrou consultatif empêche deux productions simultanées du même mois, la ligne existante est
 * réutilisée (un lancement manuel remplace son fichier, l'ancien reste archivé), jamais dupliquée.
 */
import { schema } from '@neomoov/db';
import { monthOf, parseLedgerPeriod, previousMonth, type GeolocationExportRunResult, type GeolocationExportView } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { STORAGE_PROVIDER, type StorageProvider } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { APP_LOGGER, currentCorrelationId } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { DB, type Database } from '../../infra/db.module.js';
import { QueueService } from '../../infra/queue.module.js';
import { AuditService } from '../audit/audit.service.js';
import type { UserActor } from '../auth/actor.js';
import { buildGeolocationCsv, geolocationFormat, geolocationKey, type GeolocationRide } from './geolocation-format.js';

type ExportRow = typeof schema.geolocationExports.$inferSelect;

export interface GeolocationProduceResult {
  status: 'produced' | 'skipped' | 'busy';
  exportId: string | null;
  rideCount: number;
}

/** Horodatage compact du nom de fichier : 20261001T040512Z. */
const stamp = (at: Date) => at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

@Injectable()
export class GeolocationExportService {
  private key: Buffer | null = null;

  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly queues: QueueService,
  ) {}

  private get db() {
    return this.database.db;
  }

  /** Clé des pseudonymes, dérivée une fois par processus (jamais la clé brute). */
  private pseudonymKey(): Buffer {
    this.key ??= geolocationKey(this.env.ENCRYPTION_KEY!);
    return this.key;
  }

  async timeZone(): Promise<string> {
    return this.settings.string('service.time_zone', 'America/Toronto');
  }

  async formatCode(): Promise<string> {
    return this.settings.string('geolocation_export.format', 'csv-v0');
  }

  /** Mois terminé, sinon 409 (un export porte sur un mois complet). */
  async assertClosedMonth(month: string): Promise<void> {
    const current = monthOf(new Date(), await this.timeZone());
    if (month >= current) throw AppError.conflict('GEOLOCATION_PERIOD_OPEN', 'L\'export porte sur un mois terminé', { month, current });
  }

  /**
   * Produit l'export d'un mois au format en vigueur. `force: false` (tâche planifiée) : rien si un fichier existe déjà ;
   * `force: true` (lancement manuel) : nouveau fichier, même ligne. Un export déjà transmis n'est jamais remplacé.
   */
  async produce(month: string, options: { force: boolean; requestedBy?: string | null }): Promise<GeolocationProduceResult> {
    const period = parseLedgerPeriod(month);
    if (period?.kind !== 'month') throw new AppError('LEDGER_PERIOD_INVALID', 'Mois AAAA-MM attendu', 400, { month });
    const [tz, code] = await Promise.all([this.timeZone(), this.formatCode()]);
    const format = geolocationFormat(code);
    const g = schema.geolocationExports;
    const result = await this.db.transaction(async (tx): Promise<GeolocationProduceResult> => {
      const [lock] = await tx.execute<{ ok: boolean }>(sql`SELECT pg_try_advisory_xact_lock(hashtext(${`geolocation-export-${month}-${code}`})) AS ok`);
      if (!lock?.ok) return { status: 'busy', exportId: null, rideCount: 0 };
      const [existing] = await tx.select().from(g).where(and(eq(g.periodStart, period.startDate), eq(g.periodEnd, period.endDate), eq(g.format, code))).limit(1);
      if (existing?.fileKey && !options.force) return { status: 'skipped', exportId: existing.id, rideCount: existing.rideCount };
      if (existing?.transmittedAt) throw AppError.conflict('GEOLOCATION_EXPORT_TRANSMITTED', 'Cet export a déjà été transmis : il n\'est pas remplacé', { month });
      const rows = await tx.execute<{ id: string; driver_id: string | null; vehicle_id: string | null; category: string; o_lat: number; o_lng: number; d_lat: number; d_lng: number; picked_up_at: string | null; completed_at: string; distance_meters: number | null; duration_seconds: number | null }>(sql`
        SELECT r.id, r.driver_id, r.vehicle_id, COALESCE(r.served_category, r.reserved_category)::text AS category,
          ST_Y(r.origin_position::geometry) AS o_lat, ST_X(r.origin_position::geometry) AS o_lng,
          ST_Y(r.destination_position::geometry) AS d_lat, ST_X(r.destination_position::geometry) AS d_lng,
          r.state_timestamps->>'in_progress' AS picked_up_at, r.state_timestamps->>'completed' AS completed_at, r.distance_meters, r.duration_seconds
        FROM rides r
        WHERE r.state IN ('completed', 'rated', 'disputed')
          AND (r.state_timestamps->>'completed')::timestamptz >= (${period.startDate}::date::timestamp AT TIME ZONE ${tz})
          AND (r.state_timestamps->>'completed')::timestamptz < ((${period.endDate}::date + 1)::timestamp AT TIME ZONE ${tz})
        ORDER BY (r.state_timestamps->>'completed')::timestamptz, r.id`);
      const rides: GeolocationRide[] = [...rows].map((r) => ({
        id: r.id, driverId: r.driver_id, vehicleId: r.vehicle_id, category: r.category, originLat: Number(r.o_lat), originLng: Number(r.o_lng),
        destinationLat: Number(r.d_lat), destinationLng: Number(r.d_lng), pickedUpAt: r.picked_up_at, completedAt: r.completed_at,
        distanceMeters: r.distance_meters === null ? null : Number(r.distance_meters), durationSeconds: r.duration_seconds === null ? null : Number(r.duration_seconds),
      }));
      const producedAt = new Date();
      const fileKey = `geolocation/${code}/neomoov-geolocalisation-${month}-${stamp(producedAt)}.csv`;
      await this.storage.putObject({ key: fileKey, body: Buffer.from(buildGeolocationCsv(format, rides, this.pseudonymKey()), 'utf8'), contentType: 'text/csv; charset=utf-8' });
      const [row] = await tx
        .insert(g)
        .values({ periodStart: period.startDate, periodEnd: period.endDate, format: code, fileKey, rideCount: rides.length, createdAt: producedAt })
        .onConflictDoUpdate({ target: [g.periodStart, g.periodEnd, g.format], set: { fileKey, rideCount: rides.length, createdAt: producedAt } })
        .returning({ id: g.id });
      return { status: 'produced', exportId: row!.id, rideCount: rides.length };
    });
    if (result.status === 'produced') {
      await this.audit.recordSystem({ action: 'geolocation.export_produced', entity: 'geolocation_exports', entityId: result.exportId, after: { month, format: code, rideCount: result.rideCount, force: options.force, requestedBy: options.requestedBy ?? null } }, 'geolocation_export');
      this.logger.info({ month, format: code, rideCount: result.rideCount }, 'Export de géolocalisation produit');
    }
    return result;
  }

  /**
   * Lancement manuel pour un mois terminé (My Hub) : tâche du worker ; sans Redis, produite avant la réponse. Remplace le
   * fichier d'un export existant (nouvelle date dans le nom, l'ancien fichier reste archivé).
   */
  async requestRun(month: string, actor: UserActor): Promise<GeolocationExportRunResult> {
    await this.assertClosedMonth(month);
    const code = await this.formatCode();
    try {
      geolocationFormat(code);
    } catch {
      throw AppError.conflict('GEOLOCATION_FORMAT_UNKNOWN', 'Format d\'export inconnu dans le réglage geolocation_export.format', { format: code });
    }
    const startedAt = Date.now();
    await this.queues.add('exports', 'geolocation', { kind: 'geolocation', month, force: true, requestedBy: actor.userId }, { jobId: `geolocation-${month}-${startedAt}` });
    const view = await this.byMonth(month);
    return { month, format: code, status: view && Date.parse(view.producedAt) >= startedAt ? 'done' : 'queued', export: view };
  }

  /** Tâche planifiée : export du mois précédent (heure de Montréal) s'il n'existe pas encore au format en vigueur. */
  async runDue(now = new Date()): Promise<GeolocationProduceResult & { month: string }> {
    const month = previousMonth(monthOf(now, await this.timeZone()));
    return { month, ...(await this.produce(month, { force: false })) };
  }

  private view(row: ExportRow): GeolocationExportView {
    return {
      id: row.id,
      period: row.periodStart.slice(0, 7),
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      format: row.format,
      rideCount: row.rideCount,
      fileName: row.fileKey ? row.fileKey.slice(row.fileKey.lastIndexOf('/') + 1) : null,
      downloadPath: row.fileKey ? `/admin/geolocation-exports/${row.id}/file` : null,
      producedAt: row.createdAt.toISOString(),
      transmittedAt: row.transmittedAt?.toISOString() ?? null,
      acknowledgement: row.acknowledgement,
    };
  }

  async list(): Promise<GeolocationExportView[]> {
    const g = schema.geolocationExports;
    const rows = await this.db.select().from(g).orderBy(desc(g.periodStart), g.format).limit(36);
    return rows.map((row) => this.view(row));
  }

  async byMonth(month: string): Promise<GeolocationExportView | null> {
    const period = parseLedgerPeriod(month)!;
    const g = schema.geolocationExports;
    const [row] = await this.db.select().from(g).where(and(eq(g.periodStart, period.startDate), eq(g.periodEnd, period.endDate), eq(g.format, await this.formatCode()))).limit(1);
    return row ? this.view(row) : null;
  }

  /** Fichier archivé d'un export ; le téléchargement (données de localisation) est journalisé. */
  async file(id: string, actor: UserActor): Promise<{ body: Buffer; fileName: string }> {
    const g = schema.geolocationExports;
    const [row] = await this.db.select().from(g).where(eq(g.id, id)).limit(1);
    if (!row) throw AppError.notFound('GEOLOCATION_EXPORT_NOT_FOUND', 'Export de géolocalisation introuvable');
    const object = row.fileKey ? await this.storage.getObject(row.fileKey) : null;
    if (!object) throw AppError.notFound('GEOLOCATION_FILE_MISSING', 'Fichier introuvable dans le stockage : relancez l\'export de ce mois');
    await this.audit.write([{ action: 'geolocation.export_downloaded', entity: 'geolocation_exports', entityId: id, after: { period: row.periodStart.slice(0, 7), format: row.format } }], { actor, ip: null, correlationId: currentCorrelationId() ?? null });
    return { body: object.body, fileName: row.fileKey!.slice(row.fileKey!.lastIndexOf('/') + 1) };
  }
}
