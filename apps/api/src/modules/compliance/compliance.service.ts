/**
 * Conformité des chauffeurs et des véhicules (prompt 14, tâche 1). Les échéances (`compliance_checks`) viennent des
 * documents exigés approuvés (permis, assurance, immatriculation…), de la vérification mécanique (certificat, sinon la
 * règle 4 ans ou 80 000 km) et de l'inspection trimestrielle de Neomoov. Chaque jour : rappels J-30, J-7, J-1, puis, le
 * lendemain de l'échéance, suspension automatique (chauffeur suspendu avec motif et retiré de la présence, ou véhicule
 * non conforme). Le nouveau document approuvé ou l'inspection enregistrée lève la suspension, sans intervention.
 * Aucune suspension définitive n'est automatique : ces suspensions tombent d'elles-mêmes à la régularisation.
 */
import { schema } from '@neomoov/db';
import { addMonths, complianceStep, currentDocument, localDate, mechanicalInspectionDueOn, type DocumentType } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { AppError } from '../../common/app-error.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';
import { PresenceService } from '../rides/presence.service.js';

type CheckRow = typeof schema.complianceChecks.$inferSelect;
type EntityType = CheckRow['entityType'];

/** Préfixe du motif des suspensions de conformité : elles seules sont levées automatiquement. */
export const COMPLIANCE_SANCTION_PREFIX = 'Conformité : ';

const LABELS: Record<string, string> = {
  'document:licence': 'permis de conduire',
  'document:insurance': 'assurance',
  'document:registration': 'immatriculation',
  'document:training': 'formation',
  'document:background_check': 'vérification des antécédents',
  mechanical_inspection: 'vérification mécanique',
  neomoov_inspection: 'inspection trimestrielle Neomoov',
};

export function complianceLabel(type: string): string {
  return LABELS[type] ?? type.replace(/^document:/, 'document ');
}

interface DesiredCheck {
  entityType: EntityType;
  entityId: string;
  type: string;
  dueOn: string;
  driverId: string;
}

export interface ComplianceRunReport {
  synced: number;
  reminders: number;
  suspended: number;
  lifted: number;
}

@Injectable()
export class ComplianceService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly settings: SettingsService,
    private readonly outbox: NotificationsOutbox,
    private readonly presence: PresenceService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.database.db;
  }

  async today(now = new Date()): Promise<string> {
    return localDate(now, await this.settings.string('service.time_zone', 'America/Toronto')).date;
  }

  /** Passe quotidienne (ou d'un seul chauffeur) : échéances à jour, rappels, suspensions et levées. */
  async run(now = new Date(), onlyDriverId?: string): Promise<ComplianceRunReport> {
    const today = await this.today(now);
    const report: ComplianceRunReport = { synced: 0, reminders: 0, suspended: 0, lifted: 0 };
    const desired = await this.desiredChecks(today, onlyDriverId);
    for (const d of desired) {
      const outcome = await this.upsert(d, today, now);
      if (outcome.changed) report.synced += 1;
      if (outcome.lifted) report.lifted += 1;
    }
    const reminderDays = (await this.settings.get<number[]>('drivers.document_reminder_days', [30, 7, 1])).filter((n) => Number.isInteger(n));
    const pending = await this.db
      .select()
      .from(schema.complianceChecks)
      .where(and(eq(schema.complianceChecks.status, 'pending'), onlyDriverId ? inArray(schema.complianceChecks.entityId, [onlyDriverId, ...desired.filter((d) => d.entityType === 'vehicle').map((d) => d.entityId)]) : undefined));
    const ownerOf = new Map(desired.map((d) => [`${d.entityType}:${d.entityId}`, d.driverId]));
    for (const check of pending) {
      const step = complianceStep({ dueOn: check.dueOn, status: 'pending', remindersSent: check.remindersSent }, today, reminderDays);
      const driverId = ownerOf.get(`${check.entityType}:${check.entityId}`) ?? (check.entityType === 'driver' ? check.entityId : null);
      if (step.reminderDays !== null) {
        await this.db.update(schema.complianceChecks).set({ remindersSent: step.remindersSent }).where(eq(schema.complianceChecks.id, check.id));
        if (driverId) await this.notifyDriver(driverId, check.type.startsWith('document:') ? 'document.expiring' : 'vehicle.inspection_due', { type: check.type.replace(/^document:/, ''), label: complianceLabel(check.type), expiresOn: check.dueOn, dueOn: check.dueOn, days: step.reminderDays });
        report.reminders += 1;
      }
      if (step.becomesOverdue) {
        await this.suspend(check, driverId, now);
        report.suspended += 1;
      }
    }
    return report;
  }

  /** Après l'approbation d'un document ou une inspection : les échéances du chauffeur sont recalculées aussitôt. */
  async refreshDriver(driverId: string, now = new Date()): Promise<ComplianceRunReport> {
    return this.run(now, driverId);
  }

  private async desiredChecks(today: string, onlyDriverId?: string): Promise<DesiredCheck[]> {
    const drivers = await this.db
      .select({ id: schema.drivers.id })
      .from(schema.drivers)
      .where(and(inArray(schema.drivers.status, ['active', 'restricted', 'suspended']), onlyDriverId ? eq(schema.drivers.id, onlyDriverId) : undefined));
    if (!drivers.length) return [];
    const ids = drivers.map((d) => d.id);
    const required = (await this.settings.get<string[]>('drivers.required_documents', ['licence', 'insurance', 'registration'])).filter((t): t is DocumentType => typeof t === 'string');
    const [docs, vehicles] = await Promise.all([
      this.db
        .select({ driverId: schema.driverDocuments.driverId, type: schema.driverDocuments.type, status: schema.driverDocuments.status, expiresOn: schema.driverDocuments.expiresOn, createdAt: schema.driverDocuments.createdAt })
        .from(schema.driverDocuments)
        .where(inArray(schema.driverDocuments.driverId, ids)),
      this.db
        .select()
        .from(schema.vehicles)
        .innerJoin(schema.drivers, eq(schema.drivers.currentVehicleId, schema.vehicles.id))
        .where(and(inArray(schema.vehicles.driverId, ids), inArray(schema.vehicles.status, ['active', 'non_compliant']))),
    ]);
    const desired: DesiredCheck[] = [];
    for (const driverId of ids) {
      const mine = docs.filter((d) => d.driverId === driverId).map((d) => ({ ...d, type: d.type as DocumentType }));
      for (const type of required) {
        const { current } = currentDocument(mine, type, today);
        if (current?.status === 'approved' && current.expiresOn) desired.push({ entityType: 'driver', entityId: driverId, type: `document:${type}`, dueOn: current.expiresOn, driverId });
      }
      const vehicle = vehicles.find((v) => v.vehicles.driverId === driverId)?.vehicles;
      if (!vehicle) continue;
      // Vérification mécanique : le certificat approuvé fait foi ; sans certificat, la règle (4 ans ou 80 000 km).
      const { current: certificate } = currentDocument(mine, 'mechanical_check', today);
      const mechanicalDue = certificate?.status === 'approved' && certificate.expiresOn
        ? certificate.expiresOn
        : mechanicalInspectionDueOn({ year: vehicle.year, odometerKm: vehicle.odometerKm, lastInspectionOn: null, lastInspectionKm: null }, today);
      desired.push({ entityType: 'vehicle', entityId: vehicle.id, type: 'mechanical_inspection', dueOn: mechanicalDue, driverId });
      const since = vehicle.lastInspectionOn ?? vehicle.createdAt.toISOString().slice(0, 10);
      desired.push({ entityType: 'vehicle', entityId: vehicle.id, type: 'neomoov_inspection', dueOn: vehicle.nextInspectionDueOn ?? addMonths(since, 3), driverId });
    }
    return desired;
  }

  /**
   * Une échéance par (entité, type) : même date, rien ; nouvelle date (document renouvelé, inspection faite) : l'ancienne
   * est résolue et sa suspension éventuelle levée.
   */
  private async upsert(d: DesiredCheck, today: string, now: Date): Promise<{ changed: boolean; lifted: boolean }> {
    const open = await this.db
      .select()
      .from(schema.complianceChecks)
      .where(and(eq(schema.complianceChecks.entityType, d.entityType), eq(schema.complianceChecks.entityId, d.entityId), eq(schema.complianceChecks.type, d.type), inArray(schema.complianceChecks.status, ['pending', 'overdue'])));
    if (open.some((c) => c.dueOn === d.dueOn)) return { changed: false, lifted: false };
    let lifted = false;
    for (const old of open) {
      // Une nouvelle échéance déjà passée ne régularise rien (document renouvelé mais lui aussi échu).
      if (d.dueOn < today && old.status === 'overdue') continue;
      await this.db.update(schema.complianceChecks).set({ status: 'resolved', resolvedAt: now }).where(eq(schema.complianceChecks.id, old.id));
      if (old.status === 'overdue') lifted = (await this.lift(old, d.driverId, now)) || lifted;
    }
    if (open.length && open.every((c) => c.status === 'overdue') && d.dueOn < today) return { changed: false, lifted };
    await this.db.insert(schema.complianceChecks).values({ entityType: d.entityType, entityId: d.entityId, type: d.type, dueOn: d.dueOn, status: 'pending', remindersSent: 0 });
    return { changed: true, lifted };
  }

  private async suspend(check: CheckRow, driverId: string | null, now: Date): Promise<void> {
    await this.db.update(schema.complianceChecks).set({ status: 'overdue', suspensionAppliedAt: now }).where(eq(schema.complianceChecks.id, check.id));
    const label = complianceLabel(check.type);
    if (check.entityType === 'vehicle') {
      await this.db.update(schema.vehicles).set({ status: 'non_compliant' }).where(eq(schema.vehicles.id, check.entityId));
    } else {
      const [driver] = await this.db.select({ status: schema.drivers.status }).from(schema.drivers).where(eq(schema.drivers.id, check.entityId)).limit(1);
      await this.db.insert(schema.sanctions).values({ driverId: check.entityId, type: 'suspension', reason: `${COMPLIANCE_SANCTION_PREFIX}${label} échu le ${check.dueOn}`, startsAt: now });
      if (driver?.status === 'active' || driver?.status === 'restricted') await this.db.update(schema.drivers).set({ status: 'suspended' }).where(eq(schema.drivers.id, check.entityId));
    }
    if (driverId) {
      const [owner] = await this.db.select({ userId: schema.drivers.userId }).from(schema.drivers).where(eq(schema.drivers.id, driverId)).limit(1);
      if (owner) await this.presence.setStatus(owner.userId, { status: 'offline' }).catch(() => undefined);
      await this.notifyDriver(driverId, 'compliance.suspended', { type: check.type, label, dueOn: check.dueOn, entity: check.entityType });
    }
    this.audit.record({ action: 'compliance.suspended', entity: check.entityType === 'vehicle' ? 'vehicles' : 'drivers', entityId: check.entityId, after: { type: check.type, dueOn: check.dueOn } });
    this.logger.info({ checkId: check.id, type: check.type, entityId: check.entityId }, 'Suspension automatique de conformité');
  }

  /** Lève la suspension d'une échéance régularisée, s'il ne reste aucune autre échéance dépassée pour l'entité. */
  private async lift(check: CheckRow, driverId: string, now: Date): Promise<boolean> {
    const [other] = await this.db
      .select({ id: schema.complianceChecks.id })
      .from(schema.complianceChecks)
      .where(and(eq(schema.complianceChecks.entityType, check.entityType), eq(schema.complianceChecks.entityId, check.entityId), eq(schema.complianceChecks.status, 'overdue')))
      .limit(1);
    if (other) return false;
    if (check.entityType === 'vehicle') {
      await this.db.update(schema.vehicles).set({ status: 'active' }).where(and(eq(schema.vehicles.id, check.entityId), eq(schema.vehicles.status, 'non_compliant')));
    } else {
      await this.db
        .update(schema.sanctions)
        .set({ endsAt: now })
        .where(and(eq(schema.sanctions.driverId, check.entityId), eq(schema.sanctions.type, 'suspension'), like(schema.sanctions.reason, `${COMPLIANCE_SANCTION_PREFIX}%`), or(isNull(schema.sanctions.endsAt), sql`${schema.sanctions.endsAt} > now()`)));
      // Une autre suspension (décision humaine, solde) reste : le statut ne change alors pas.
      const [still] = await this.db
        .select({ id: schema.sanctions.id })
        .from(schema.sanctions)
        .where(and(eq(schema.sanctions.driverId, check.entityId), eq(schema.sanctions.type, 'suspension'), or(isNull(schema.sanctions.endsAt), sql`${schema.sanctions.endsAt} > now()`)))
        .limit(1);
      if (!still) await this.db.update(schema.drivers).set({ status: 'active' }).where(and(eq(schema.drivers.id, check.entityId), eq(schema.drivers.status, 'suspended')));
    }
    await this.notifyDriver(driverId, 'compliance.reactivated', { type: check.type, label: complianceLabel(check.type) });
    this.audit.record({ action: 'compliance.reactivated', entity: check.entityType === 'vehicle' ? 'vehicles' : 'drivers', entityId: check.entityId, after: { type: check.type } });
    return true;
  }

  private async notifyDriver(driverId: string, template: string, data: Record<string, unknown>): Promise<void> {
    const [driver] = await this.db.select({ userId: schema.drivers.userId }).from(schema.drivers).where(eq(schema.drivers.id, driverId)).limit(1);
    if (driver) await this.outbox.queue({ recipientUserId: driver.userId, template, data });
  }

  /** Inspection trimestrielle de Neomoov enregistrée dans My Hub : prochaine échéance, ou véhicule non conforme. */
  async recordInspection(vehicleId: string, input: { inspectedOn: string; passed: boolean; odometerKm?: number | undefined; notes?: string | undefined }, now = new Date()): Promise<{ vehicleId: string; status: string; nextInspectionDueOn: string | null }> {
    const [vehicle] = await this.db.select().from(schema.vehicles).where(eq(schema.vehicles.id, vehicleId)).limit(1);
    if (!vehicle) throw AppError.notFound('VEHICLE_NOT_FOUND', 'Véhicule introuvable');
    const next = input.passed ? addMonths(input.inspectedOn, 3) : null;
    await this.db
      .update(schema.vehicles)
      .set({
        lastInspectionOn: input.inspectedOn, nextInspectionDueOn: next, ...(input.odometerKm !== undefined ? { odometerKm: input.odometerKm } : {}),
        ...(input.passed ? {} : { status: 'non_compliant' as const }),
      })
      .where(eq(schema.vehicles.id, vehicleId));
    this.audit.record({ action: 'compliance.inspection_recorded', entity: 'vehicles', entityId: vehicleId, after: { inspectedOn: input.inspectedOn, passed: input.passed, odometerKm: input.odometerKm ?? null, notes: input.notes ?? null } });
    await this.refreshDriver(vehicle.driverId, now);
    const [after] = await this.db.select({ status: schema.vehicles.status, next: schema.vehicles.nextInspectionDueOn }).from(schema.vehicles).where(eq(schema.vehicles.id, vehicleId)).limit(1);
    return { vehicleId, status: after!.status, nextInspectionDueOn: after!.next };
  }

  /** Échéances pour My Hub (dépassées d'abord) ou pour un chauffeur (les siennes et celles de ses véhicules). */
  async list(filter: { status?: 'pending' | 'overdue' | undefined; driverId?: string | undefined }) {
    const vehicleIds = filter.driverId ? (await this.db.select({ id: schema.vehicles.id }).from(schema.vehicles).where(eq(schema.vehicles.driverId, filter.driverId))).map((v) => v.id) : [];
    const rows = await this.db
      .select()
      .from(schema.complianceChecks)
      .where(and(
        filter.status ? eq(schema.complianceChecks.status, filter.status) : inArray(schema.complianceChecks.status, ['pending', 'overdue']),
        filter.driverId ? inArray(schema.complianceChecks.entityId, [filter.driverId, ...vehicleIds]) : undefined,
      ))
      .orderBy(sql`${schema.complianceChecks.status} = 'overdue' DESC`, schema.complianceChecks.dueOn)
      .limit(500);
    return rows.map((c) => ({ id: c.id, entityType: c.entityType, entityId: c.entityId, type: c.type, label: complianceLabel(c.type), dueOn: c.dueOn, status: c.status as 'pending' | 'overdue', remindersSent: c.remindersSent, suspendedAt: c.suspensionAppliedAt?.toISOString() ?? null }));
  }
}
