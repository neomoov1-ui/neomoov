/**
 * Durées de conservation (Loi 25, prompt 14 tâche 3). Chaque tâche est irréversible : elle ne tourne qu'après une
 * sauvegarde vérifiée depuis moins de 26 heures (`retention.backup_verified_at`, confirmée par l'exploitation ou par la
 * surveillance de l'étape 16) et laisse une ligne `retention_jobs` (nombre de lignes, détails), même quand elle est
 * bloquée. Les délais sont des réglages :
 * - positions brutes : 90 jours (les trajets et les statistiques de conduite en gardent l'agrégat) ;
 * - courses : anonymisées après 12 mois (tiers, adresses, trajet précis, messages) ; les montants restent (comptabilité) ;
 * - documents des chauffeurs : supprimés 12 mois après la fin de la relation ;
 * - journal d'audit et factures : 7 ans.
 */
import { schema } from '@neomoov/db';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { STORAGE_PROVIDER, type StorageProvider } from '../../adapters/types.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';

export const ANONYMIZED_ADDRESS = 'Adresse anonymisée';
const BACKUP_MAX_AGE_MS = 26 * 3_600_000;
const BATCH = 1_000;

export type RetentionJobType = 'driver_locations' | 'ride_anonymization' | 'driver_documents' | 'audit_log' | 'invoices';
export interface RetentionResult {
  type: RetentionJobType | 'blocked_no_backup';
  rowsProcessed: number;
  details: Record<string, unknown>;
}

function monthsAgo(now: Date, months: number): Date {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

@Injectable()
export class RetentionService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly settings: SettingsService,
  ) {}

  private get db() {
    return this.database.db;
  }

  /** Toutes les tâches, ou aucune si la sauvegarde n'est pas vérifiée (une ligne `blocked_no_backup` le trace). */
  async run(now = new Date()): Promise<RetentionResult[]> {
    const verified = await this.settings.string('retention.backup_verified_at', '');
    const verifiedAt = verified ? Date.parse(verified) : Number.NaN;
    if (Number.isNaN(verifiedAt) || now.getTime() - verifiedAt > BACKUP_MAX_AGE_MS || verifiedAt > now.getTime() + 60_000) {
      const blocked: RetentionResult = { type: 'blocked_no_backup', rowsProcessed: 0, details: { backupVerifiedAt: verified || null, reason: 'Aucune sauvegarde vérifiée depuis moins de 26 heures' } };
      await this.log(blocked);
      this.logger.warn(blocked.details, 'Conservation : purges suspendues, sauvegarde non vérifiée');
      return [blocked];
    }
    const results: RetentionResult[] = [];
    for (const job of [this.driverLocations, this.anonymizeRides, this.driverDocuments, this.auditLog, this.invoices]) {
      const result = await job.call(this, now);
      await this.log(result);
      results.push(result);
    }
    return results;
  }

  private async log(result: RetentionResult): Promise<void> {
    await this.db.insert(schema.retentionJobs).values({ type: result.type, rowsProcessed: result.rowsProcessed, details: result.details });
  }

  /** Positions brutes : partitions journalières échues supprimées, lignes anciennes de la partition par défaut effacées. */
  private async driverLocations(now: Date): Promise<RetentionResult> {
    const days = await this.settings.number('retention.driver_locations_days', 90);
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const cutoffDay = cutoff.toISOString().slice(0, 10).replace(/-/g, '');
    const partitions = await this.db.execute<{ relname: string }>(sql`
      SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent
      WHERE p.relname = 'driver_locations' AND c.relname ~ '^driver_locations_[0-9]{8}$'`);
    const expired = partitions.map((p) => p.relname).filter((name) => name.slice(-8) < cutoffDay);
    for (const name of expired) await this.db.execute(sql.raw(`DROP TABLE IF EXISTS "${name.replace(/"/g, '')}"`));
    const deleted = await this.db.execute<{ n: number }>(sql`WITH d AS (DELETE FROM driver_locations_default WHERE recorded_at < ${cutoff.toISOString()}::timestamptz RETURNING 1) SELECT count(*)::int AS n FROM d`);
    const rows = Number(deleted[0]?.n ?? 0);
    return { type: 'driver_locations', rowsProcessed: rows + expired.length, details: { retentionDays: days, partitionsDropped: expired, defaultRowsDeleted: rows } };
  }

  /** Courses de plus de 12 mois : tiers, adresses exactes, trajet et messages effacés ; positions arrondies (~1 km). */
  private async anonymizeRides(now: Date): Promise<RetentionResult> {
    const months = await this.settings.number('retention.rides_anonymize_months', 12);
    const cutoff = monthsAgo(now, months);
    const rides = await this.db
      .select({ id: schema.rides.id })
      .from(schema.rides)
      .where(and(lt(schema.rides.createdAt, cutoff), sql`${schema.rides.originAddress} <> ${ANONYMIZED_ADDRESS}`))
      .limit(BATCH);
    const ids = rides.map((r) => r.id);
    if (ids.length) {
      await this.db.transaction(async (tx) => {
        await tx.delete(schema.rideTracks).where(inArray(schema.rideTracks.rideId, ids));
        await tx.delete(schema.rideMessages).where(inArray(schema.rideMessages.rideId, ids));
        await tx
          .update(schema.rides)
          .set({
            guestName: null, guestPhone: null, passengerName: null, passengerPhone: null, specialRequests: null, flightNumber: null,
            originAddress: ANONYMIZED_ADDRESS, destinationAddress: ANONYMIZED_ADDRESS,
            originPosition: sql`ST_SnapToGrid(${schema.rides.originPosition}::geometry, 0.01)::geography`,
            destinationPosition: sql`ST_SnapToGrid(${schema.rides.destinationPosition}::geometry, 0.01)::geography`,
          })
          .where(inArray(schema.rides.id, ids));
      });
    }
    return { type: 'ride_anonymization', rowsProcessed: ids.length, details: { retentionMonths: months, cutoff: cutoff.toISOString(), more: ids.length === BATCH } };
  }

  /** Documents d'un chauffeur parti depuis plus de 12 mois : fichiers et lignes supprimés. */
  private async driverDocuments(now: Date): Promise<RetentionResult> {
    const months = await this.settings.number('retention.driver_documents_months', 12);
    const cutoff = monthsAgo(now, months);
    const docs = await this.db
      .select({ id: schema.driverDocuments.id, fileKey: schema.driverDocuments.fileKey })
      .from(schema.driverDocuments)
      .innerJoin(schema.drivers, eq(schema.drivers.id, schema.driverDocuments.driverId))
      .where(and(eq(schema.drivers.status, 'offboarded'), isNotNull(schema.drivers.offboardedAt), lt(schema.drivers.offboardedAt, cutoff)))
      .limit(BATCH);
    let filesDeleted = 0;
    for (const doc of docs) {
      await this.storage.deleteObject(doc.fileKey).then(() => { filesDeleted += 1; }).catch((error: unknown) => this.logger.warn({ err: error, documentId: doc.id }, 'Fichier de document non supprimé'));
    }
    if (docs.length) await this.db.delete(schema.driverDocuments).where(inArray(schema.driverDocuments.id, docs.map((d) => d.id)));
    return { type: 'driver_documents', rowsProcessed: docs.length, details: { retentionMonths: months, filesDeleted } };
  }

  /** Journal d'audit de plus de 7 ans : le déclencheur « ajout seul » est suspendu le temps de la purge seulement. */
  private async auditLog(now: Date): Promise<RetentionResult> {
    const years = await this.settings.number('retention.audit_log_years', 7);
    const cutoff = monthsAgo(now, years * 12);
    const deleted = await this.db.transaction(async (tx) => {
      await tx.execute(sql`ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only`);
      const rows = await tx.execute<{ n: number }>(sql`WITH d AS (DELETE FROM audit_log WHERE occurred_at < ${cutoff.toISOString()}::timestamptz RETURNING 1) SELECT count(*)::int AS n FROM d`);
      await tx.execute(sql`ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only`);
      return Number(rows[0]?.n ?? 0);
    });
    return { type: 'audit_log', rowsProcessed: deleted, details: { retentionYears: years, cutoff: cutoff.toISOString() } };
  }

  /** Factures (et notes de crédit, transmissions au SEV) de plus de 7 ans. */
  private async invoices(now: Date): Promise<RetentionResult> {
    const years = await this.settings.number('retention.invoices_years', 7);
    const cutoff = monthsAgo(now, years * 12);
    const old = await this.db.select({ id: schema.invoices.id }).from(schema.invoices).where(lt(schema.invoices.issuedAt, cutoff)).limit(BATCH);
    const ids = old.map((i) => i.id);
    if (ids.length) {
      await this.db.transaction(async (tx) => {
        await tx.delete(schema.sevTransmissions).where(inArray(schema.sevTransmissions.invoiceId, ids));
        await tx.execute(sql`DELETE FROM invoices WHERE id IN ${ids} AND credit_note_of_id IS NOT NULL`);
        await tx.execute(sql`DELETE FROM invoices WHERE id IN ${ids}`);
      });
    }
    return { type: 'invoices', rowsProcessed: ids.length, details: { retentionYears: years, cutoff: cutoff.toISOString() } };
  }

  /** Confirmation de la sauvegarde vérifiée (exploitation ou surveillance), préalable à toute purge. */
  async confirmBackup(verifiedAt: Date, note: string | null): Promise<void> {
    await this.db
      .insert(schema.settings)
      .values({ key: 'retention.backup_verified_at', scope: 'global', value: verifiedAt.toISOString(), description: note ? `Sauvegarde vérifiée : ${note.slice(0, 200)}` : 'Dernière sauvegarde vérifiée avant les purges de conservation' })
      .onConflictDoUpdate({ target: [schema.settings.key, schema.settings.scope], set: { value: verifiedAt.toISOString() } });
    this.settings.invalidate();
  }

  async recentJobs(limit = 50) {
    const rows = await this.db.select().from(schema.retentionJobs).orderBy(sql`${schema.retentionJobs.executedAt} DESC`).limit(limit);
    return rows.map((r) => ({ id: r.id, type: r.type, executedAt: r.executedAt.toISOString(), rowsProcessed: r.rowsProcessed, details: (r.details ?? {}) as Record<string, unknown> }));
  }
}
