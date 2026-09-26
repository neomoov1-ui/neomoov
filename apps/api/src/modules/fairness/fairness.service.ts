/**
 * Charte d'équité chauffeurs (D7, 26 septembre 2026) : le chauffeur voit ses sanctions et leur motif écrit, présente sa
 * version (réponse) ou demande une révision (appel) ; une personne tranche, l'appel par une autre personne que celle qui
 * a décidé la sanction ; une note peut être retirée du calcul. Délais tenus par des alertes au personnel : blocage de
 * précaution sans décision humaine après 24 heures, réponse ou appel sans décision après 4 heures ouvrables. Chaque
 * alerte part une seule fois (marqueur au journal d'audit).
 */
import { schema } from '@neomoov/db';
import {
  appealOverdue, canDecideAppeal, DEFAULT_RATING_WINDOW, parseBusinessHours, precautionaryReviewOverdue, type AdminSanctionAppealView, type AppealKind,
  type AppealStatus, type DriverSanctionView, type SanctionAppealDecision, type SanctionAppealInput, type SanctionType,
} from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, like, lte, or, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { AppError } from '../../common/app-error.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import type { UserActor } from '../auth/actor.js';
import { AuditService } from '../audit/audit.service.js';
import { refreshDriverRating } from '../drivers/driver-rating.js';
import { statusAfterSuspension } from '../drivers/driver-status.js';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';
import { SAFETY_SANCTION_PREFIX } from '../rides/safety-hold.service.js';

type AppealRow = typeof schema.sanctionAppeals.$inferSelect;
type SanctionRow = typeof schema.sanctions.$inferSelect;

function uniqueViolation(error: unknown): string | null {
  const e = error as { code?: string; constraint_name?: string; cause?: { code?: string; constraint_name?: string } };
  return (e?.code ?? e?.cause?.code) === '23505' ? (e?.constraint_name ?? e?.cause?.constraint_name ?? '23505') : null;
}

const appealView = (a: AppealRow) => ({
  id: a.id, kind: a.kind as AppealKind, message: a.message, status: a.status as AppealStatus, decisionNote: a.decisionNote,
  createdAt: a.createdAt.toISOString(), decidedAt: a.decidedAt?.toISOString() ?? null,
});

@Injectable()
export class FairnessService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly settings: SettingsService,
    private readonly outbox: NotificationsOutbox,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.database.db;
  }

  private async driverOfUser(userId: string): Promise<{ id: string; publicNumber: string }> {
    const [driver] = await this.db.select({ id: schema.drivers.id, publicNumber: schema.drivers.publicNumber }).from(schema.drivers).where(eq(schema.drivers.userId, userId)).limit(1);
    if (!driver) throw AppError.forbidden('DRIVER_PROFILE_REQUIRED', 'Profil chauffeur requis');
    return driver;
  }

  private sanctionView(s: SanctionRow, appeals: AppealRow[], now: Date): DriverSanctionView {
    return {
      id: s.id, type: s.type as SanctionType, reason: s.reason, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt?.toISOString() ?? null,
      active: !s.endsAt || s.endsAt > now, decidedByPerson: s.decidedByUserId !== null,
      appeals: appeals.filter((a) => a.sanctionId === s.id).map(appealView),
    };
  }

  /** Sanctions du chauffeur, de la plus récente à la plus ancienne (50 au plus), avec ses réponses et appels. */
  async driverSanctions(userId: string, now = new Date()): Promise<DriverSanctionView[]> {
    const driver = await this.driverOfUser(userId);
    const sanctions = await this.db.select().from(schema.sanctions).where(eq(schema.sanctions.driverId, driver.id)).orderBy(desc(schema.sanctions.startsAt)).limit(50);
    if (!sanctions.length) return [];
    const appeals = await this.db.select().from(schema.sanctionAppeals).where(inArray(schema.sanctionAppeals.sanctionId, sanctions.map((s) => s.id))).orderBy(asc(schema.sanctionAppeals.createdAt));
    return sanctions.map((s) => this.sanctionView(s, appeals, now));
  }

  /** Réponse ou appel du chauffeur sur une de ses sanctions ; une seule demande ouverte à la fois ; le personnel est prévenu. */
  async appeal(userId: string, sanctionId: string, input: SanctionAppealInput, now = new Date()): Promise<DriverSanctionView> {
    const driver = await this.driverOfUser(userId);
    const [sanction] = await this.db.select().from(schema.sanctions).where(and(eq(schema.sanctions.id, sanctionId), eq(schema.sanctions.driverId, driver.id))).limit(1);
    if (!sanction) throw AppError.notFound('SANCTION_NOT_FOUND', 'Sanction introuvable');
    let appealId: string;
    try {
      const [row] = await this.db.insert(schema.sanctionAppeals).values({ sanctionId, driverId: driver.id, kind: input.kind, message: input.message }).returning({ id: schema.sanctionAppeals.id });
      appealId = row!.id;
    } catch (error) {
      if (uniqueViolation(error) === 'sanction_appeals_one_open') throw AppError.conflict('APPEAL_ALREADY_OPEN', 'Une demande est déjà en cours d\'examen pour cette sanction');
      throw error;
    }
    await this.outbox.queueForStaff('alert.appeal_received', { kind: input.kind, driverPublicNumber: driver.publicNumber, sanctionType: sanction.type, appealId });
    // Le texte du chauffeur n'entre pas au journal (en ajout seul) : il peut contenir des renseignements personnels.
    this.audit.record({ action: 'fairness.appeal_submitted', entity: 'sanction_appeals', entityId: appealId, after: { sanctionId, kind: input.kind } });
    const appeals = await this.db.select().from(schema.sanctionAppeals).where(eq(schema.sanctionAppeals.sanctionId, sanctionId)).orderBy(asc(schema.sanctionAppeals.createdAt));
    return this.sanctionView(sanction, appeals, now);
  }

  private async deadlines() {
    const [raw, timeZone, callbackHours, reviewHours] = await Promise.all([
      this.settings.get<unknown>('fairness.business_hours', null),
      this.settings.string('service.time_zone', 'America/Toronto'),
      this.settings.number('fairness.callback_business_hours', 4),
      this.settings.number('fairness.precautionary_review_hours', 24),
    ]);
    return { hours: parseBusinessHours(raw), timeZone, callbackSeconds: callbackHours * 3600, reviewSeconds: reviewHours * 3600 };
  }

  /** My Hub : réponses et appels, les plus anciens d'abord (200 au plus), avec la sanction et le retard. */
  async list(query: { status?: AppealStatus | undefined; id?: string }, now = new Date()): Promise<AdminSanctionAppealView[]> {
    const conditions = [];
    if (query.status) conditions.push(eq(schema.sanctionAppeals.status, query.status));
    if (query.id) conditions.push(eq(schema.sanctionAppeals.id, query.id));
    const rows = await this.db
      .select({ appeal: schema.sanctionAppeals, sanction: schema.sanctions, publicNumber: schema.drivers.publicNumber, firstName: schema.users.firstName, lastName: schema.users.lastName })
      .from(schema.sanctionAppeals)
      .innerJoin(schema.sanctions, eq(schema.sanctions.id, schema.sanctionAppeals.sanctionId))
      .innerJoin(schema.drivers, eq(schema.drivers.id, schema.sanctionAppeals.driverId))
      .innerJoin(schema.users, eq(schema.users.id, schema.drivers.userId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(schema.sanctionAppeals.createdAt))
      .limit(200);
    const d = await this.deadlines();
    return rows.map((r) => ({
      ...appealView(r.appeal),
      sanctionId: r.sanction.id, driverId: r.appeal.driverId, driverPublicNumber: r.publicNumber,
      driverName: [r.firstName, r.lastName].filter(Boolean).join(' ') || null,
      sanction: { type: r.sanction.type as SanctionType, reason: r.sanction.reason, startsAt: r.sanction.startsAt.toISOString(), endsAt: r.sanction.endsAt?.toISOString() ?? null, decidedByUserId: r.sanction.decidedByUserId },
      overdue: r.appeal.status === 'open' && appealOverdue(r.appeal.createdAt, now, d.hours, d.timeZone, d.callbackSeconds),
    }));
  }

  /**
   * Décision d'une personne sur une réponse ou un appel. `overturned` lève la sanction (fin immédiate, statut du chauffeur
   * recalculé : une autre sanction en cours le garde restreint ou suspendu). Le chauffeur est prévenu, avec le motif.
   */
  async decide(appealId: string, input: SanctionAppealDecision, actor: UserActor, now = new Date()): Promise<AdminSanctionAppealView> {
    const decided = await this.db.transaction(async (tx) => {
      const [appeal] = await tx.select().from(schema.sanctionAppeals).where(eq(schema.sanctionAppeals.id, appealId)).for('update').limit(1);
      if (!appeal) throw AppError.notFound('APPEAL_NOT_FOUND', 'Demande introuvable');
      if (appeal.status !== 'open') throw AppError.conflict('APPEAL_ALREADY_DECIDED', 'Cette demande a déjà reçu une décision', { status: appeal.status });
      const [sanction] = await tx.select().from(schema.sanctions).where(eq(schema.sanctions.id, appeal.sanctionId)).for('update').limit(1);
      if (!canDecideAppeal(appeal.kind as AppealKind, sanction!.decidedByUserId, actor.userId)) {
        throw AppError.forbidden('SAME_DECIDER', 'Un appel est tranché par une autre personne que celle qui a décidé la sanction');
      }
      await tx.update(schema.sanctionAppeals).set({ status: input.decision, decidedByUserId: actor.userId, decidedAt: now, decisionNote: input.note }).where(eq(schema.sanctionAppeals.id, appealId));
      const lifted = input.decision === 'overturned' && (!sanction!.endsAt || sanction!.endsAt > now);
      if (lifted) await tx.update(schema.sanctions).set({ endsAt: now, decidedByUserId: sanction!.decidedByUserId ?? actor.userId }).where(eq(schema.sanctions.id, sanction!.id));
      return { appeal, sanction: sanction!, lifted };
    });
    const [driver] = await this.db.select({ userId: schema.drivers.userId, status: schema.drivers.status }).from(schema.drivers).where(eq(schema.drivers.id, decided.appeal.driverId)).limit(1);
    if (decided.lifted && driver && (driver.status === 'restricted' || driver.status === 'suspended')) {
      const next = await statusAfterSuspension(this.db, decided.appeal.driverId, now);
      if (next !== driver.status) await this.db.update(schema.drivers).set({ status: next }).where(and(eq(schema.drivers.id, decided.appeal.driverId), eq(schema.drivers.status, driver.status)));
    }
    if (driver) await this.outbox.queue({ recipientUserId: driver.userId, template: 'fairness.appeal_decided', data: { decision: input.decision, note: input.note, sanctionType: decided.sanction.type } });
    this.audit.record({ action: 'fairness.appeal_decided', entity: 'sanction_appeals', entityId: appealId, after: { sanctionId: decided.sanction.id, decision: input.decision, lifted: decided.lifted } });
    return (await this.list({ id: appealId }, now))[0]!;
  }

  /** Retire une note du client du calcul (réponse du chauffeur admise, cause extérieure établie) ; rejouable. */
  async excludeRating(ratingId: string, reason: string, actor: UserActor, now = new Date()): Promise<{ id: string; excludedAt: string; driverRating: { average: number; count: number } | null }> {
    const [row] = await this.db
      .select({ rating: schema.rideRatings, driverId: schema.rides.driverId })
      .from(schema.rideRatings)
      .innerJoin(schema.rides, eq(schema.rides.id, schema.rideRatings.rideId))
      .where(and(eq(schema.rideRatings.id, ratingId), eq(schema.rideRatings.authorKind, 'client')))
      .limit(1);
    if (!row) throw AppError.notFound('RATING_NOT_FOUND', 'Note introuvable');
    const excludedAt = row.rating.excludedAt ?? now;
    if (!row.rating.excludedAt) {
      await this.db.update(schema.rideRatings).set({ excludedAt, excludedReason: reason, excludedByUserId: actor.userId }).where(eq(schema.rideRatings.id, ratingId));
      this.audit.record({ action: 'fairness.rating_excluded', entity: 'ride_ratings', entityId: ratingId, after: { rideId: row.rating.rideId, driverId: row.driverId } });
    }
    let driverRating: { average: number; count: number } | null = null;
    if (row.driverId) {
      await refreshDriverRating(this.db, row.driverId, await this.settings.number('quality.rating_window', DEFAULT_RATING_WINDOW));
      const [d] = await this.db.select({ average: schema.drivers.ratingAverage, count: schema.drivers.ratingCount }).from(schema.drivers).where(eq(schema.drivers.id, row.driverId)).limit(1);
      driverRating = d ? { average: Number(d.average), count: d.count } : null;
    }
    return { id: ratingId, excludedAt: excludedAt.toISOString(), driverRating };
  }

  private async alreadyAlerted(action: string, entityIds: string[]): Promise<Set<string>> {
    if (!entityIds.length) return new Set();
    const rows = await this.db.select({ entityId: schema.auditLog.entityId }).from(schema.auditLog).where(and(eq(schema.auditLog.action, action), inArray(schema.auditLog.entityId, entityIds)));
    return new Set(rows.map((r) => r.entityId).filter((id): id is string => Boolean(id)));
  }

  /** Alertes de délai de la Charte : envoyées une seule fois par blocage ou par demande. */
  async alertOverdue(now = new Date()): Promise<{ precautionary: number; appeals: number }> {
    const d = await this.deadlines();
    const holds = await this.db
      .select({ id: schema.sanctions.id, driverId: schema.sanctions.driverId, startsAt: schema.sanctions.startsAt, publicNumber: schema.drivers.publicNumber })
      .from(schema.sanctions)
      .innerJoin(schema.drivers, eq(schema.drivers.id, schema.sanctions.driverId))
      .where(and(
        like(schema.sanctions.reason, `${SAFETY_SANCTION_PREFIX}%`), isNull(schema.sanctions.decidedByUserId),
        or(isNull(schema.sanctions.endsAt), sql`${schema.sanctions.endsAt} > ${now.toISOString()}::timestamptz`),
        lte(schema.sanctions.startsAt, new Date(now.getTime() - d.reviewSeconds * 1000)),
      ))
      .limit(200);
    const overdueHolds = holds.filter((h) => precautionaryReviewOverdue(h.startsAt, now, d.reviewSeconds));
    const holdsDone = await this.alreadyAlerted('alert.precautionary_review_overdue', overdueHolds.map((h) => h.id));
    let precautionary = 0;
    for (const h of overdueHolds) {
      if (holdsDone.has(h.id)) continue;
      await this.outbox.queueForStaff('alert.precautionary_review_overdue', { driverPublicNumber: h.publicNumber, hours: Math.floor((now.getTime() - h.startsAt.getTime()) / 3_600_000) });
      await this.audit.recordSystem({ action: 'alert.precautionary_review_overdue', entity: 'sanctions', entityId: h.id, after: { driverId: h.driverId } });
      precautionary += 1;
    }
    const open = await this.db
      .select({ id: schema.sanctionAppeals.id, kind: schema.sanctionAppeals.kind, createdAt: schema.sanctionAppeals.createdAt, publicNumber: schema.drivers.publicNumber })
      .from(schema.sanctionAppeals)
      .innerJoin(schema.drivers, eq(schema.drivers.id, schema.sanctionAppeals.driverId))
      .where(eq(schema.sanctionAppeals.status, 'open'))
      .orderBy(asc(schema.sanctionAppeals.createdAt))
      .limit(200);
    const late = open.filter((a) => appealOverdue(a.createdAt, now, d.hours, d.timeZone, d.callbackSeconds));
    const appealsDone = await this.alreadyAlerted('alert.appeal_overdue', late.map((a) => a.id));
    let appeals = 0;
    for (const a of late) {
      if (appealsDone.has(a.id)) continue;
      await this.outbox.queueForStaff('alert.appeal_overdue', { kind: a.kind, driverPublicNumber: a.publicNumber, appealId: a.id });
      await this.audit.recordSystem({ action: 'alert.appeal_overdue', entity: 'sanction_appeals', entityId: a.id, after: { kind: a.kind } });
      appeals += 1;
    }
    if (precautionary || appeals) this.logger.warn({ precautionary, appeals }, 'Charte d\'équité : délais dépassés, personnel alerté');
    return { precautionary, appeals };
  }
}
