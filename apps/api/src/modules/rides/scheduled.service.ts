/**
 * Réservation planifiée (section 5.3, prompt 05, tâche 6) : rappel la veille, déclenchement de l'attribution à 60 minutes
 * (événement consommé par la répartition à l'étape 6), alerte à l'opérateur si rien n'est confirmé à 30 minutes ;
 * offres volontaires des chauffeurs (`claim`) et confirmation (`confirm`). `tick(now)` est exécuté par le worker chaque
 * minute et par les tests avec une horloge simulée. Chaque signal n'est émis qu'une fois par course (`ride_events`).
 */
import { schema } from '@neomoov/db';
import { type RideState, type ScheduledRideView } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { AppError } from '../../common/app-error.js';
import { DomainEventsService } from '../../common/domain-events.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import type { UserActor } from '../auth/actor.js';
import { NotificationsOutbox } from './notifications-outbox.js';
import { parseGeoPoint, selectRides, type RideRow } from './ride-view.js';
import { RidesService } from './rides.service.js';

const OPEN_STATES: RideState[] = ['requested', 'offering', 'assigned'];

export interface TickReport {
  reminders: string[];
  dispatchDue: string[];
  operatorAlerts: string[];
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}

@Injectable()
export class ScheduledService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly settings: SettingsService,
    private readonly events: DomainEventsService,
    private readonly outbox: NotificationsOutbox,
    private readonly rides: RidesService,
  ) {}

  private get db() {
    return this.database.db;
  }

  /** Passe sur les courses planifiées ouvertes dont l'heure approche ; chaque signal est enregistré une fois. */
  async tick(now = new Date()): Promise<TickReport> {
    const [reminderBefore, assignBefore, reassignBefore] = await Promise.all([
      this.settings.number('rides.scheduled_reminder_before_seconds', 86_400),
      this.settings.number('rides.scheduled_assign_before_seconds', 3600),
      this.settings.number('rides.scheduled_reassign_before_seconds', 1800),
    ]);
    const horizon = new Date(now.getTime() + Math.max(reminderBefore, assignBefore, reassignBefore) * 1000 + 60_000);
    const rides = await selectRides(this.db, and(eq(schema.rides.type, 'scheduled'), inArray(schema.rides.state, OPEN_STATES), lte(schema.rides.requestedAt, horizon), gt(schema.rides.requestedAt, now)), { limit: 500 });
    const report: TickReport = { reminders: [], dispatchDue: [], operatorAlerts: [] };
    if (!rides.length) return report;
    // Signaux déjà émis, en une seule requête pour toutes les courses de la passe.
    const marks = await this.db
      .select({ rideId: schema.rideEvents.rideId, type: schema.rideEvents.type })
      .from(schema.rideEvents)
      .where(and(inArray(schema.rideEvents.rideId, rides.map((r) => r.id)), inArray(schema.rideEvents.type, ['scheduled_reminder', 'scheduled_dispatch_due', 'scheduled_operator_alert'])));
    const done = new Map<string, Set<string>>();
    for (const m of marks) done.set(m.rideId, (done.get(m.rideId) ?? new Set()).add(m.type));
    const assignments = await this.db.select().from(schema.scheduledAssignments).where(and(inArray(schema.scheduledAssignments.rideId, rides.map((r) => r.id)), isNull(schema.scheduledAssignments.declinedAt)));

    for (const ride of rides) {
      if (!ride.requestedAt) continue;
      const secondsLeft = (ride.requestedAt.getTime() - now.getTime()) / 1000;
      const seen = done.get(ride.id) ?? new Set<string>();
      // Rappel la veille (pour les courses réservées plus de 24 heures à l'avance), au client de la course.
      if (secondsLeft <= reminderBefore && !seen.has('scheduled_reminder') && ride.createdAt.getTime() < ride.requestedAt.getTime() - reminderBefore * 1000) {
        await this.mark(ride, 'scheduled_reminder', now, { secondsLeft: Math.round(secondsLeft) });
        this.events.emit('scheduled.reminder', { rideId: ride.id, requestedAt: ride.requestedAt });
        const recipient = await this.rides.recipientOf(ride);
        await this.outbox.queue({ ...recipient, template: 'ride.scheduled_reminder', data: { rideId: ride.id, requestedAt: ride.requestedAt.toISOString() } });
        report.reminders.push(ride.id);
      }
      // Déclenchement de l'attribution à 60 minutes si aucun chauffeur n'est attribué.
      if (secondsLeft <= assignBefore && (ride.state === 'requested' || ride.state === 'offering') && !seen.has('scheduled_dispatch_due')) {
        await this.mark(ride, 'scheduled_dispatch_due', now, { secondsLeft: Math.round(secondsLeft) });
        this.events.emit('scheduled.dispatch_due', { rideId: ride.id, requestedAt: ride.requestedAt });
        report.dispatchDue.push(ride.id);
      }
      // Alerte à l'opérateur à 30 minutes si rien n'est confirmé.
      if (secondsLeft <= reassignBefore && !seen.has('scheduled_operator_alert')) {
        const assignment = assignments.find((a) => a.rideId === ride.id) ?? null;
        const confirmed = ride.state === 'assigned' && ride.driverId !== null;
        if (!confirmed) {
          await this.mark(ride, 'scheduled_operator_alert', now, { secondsLeft: Math.round(secondsLeft), driverId: ride.driverId });
          if (assignment) await this.db.update(schema.scheduledAssignments).set({ operatorAlertedAt: now }).where(eq(schema.scheduledAssignments.id, assignment.id));
          this.events.emit('scheduled.unconfirmed_alert', { rideId: ride.id, requestedAt: ride.requestedAt, driverId: ride.driverId });
          await this.outbox.queueForStaff('alert.scheduled_unconfirmed', { rideId: ride.id, publicNumber: ride.publicNumber, requestedAt: ride.requestedAt.toISOString() });
          report.operatorAlerts.push(ride.id);
        }
      }
    }
    if (report.reminders.length || report.dispatchDue.length || report.operatorAlerts.length) this.logger.info(report, 'Courses planifiées : signaux émis');
    return report;
  }

  private async mark(ride: RideRow, type: string, at: Date, data: Record<string, unknown>): Promise<void> {
    await this.db.insert(schema.rideEvents).values({ rideId: ride.id, type, fromState: ride.state, toState: ride.state, actorUserId: null, actorKind: 'system', data, occurredAt: at });
  }

  /** GET /v1/driver/scheduled : courses planifiées ouvertes de la catégorie du chauffeur (ou de rang inférieur), plus celles qui lui sont attribuées. */
  async listForDriver(actor: UserActor): Promise<ScheduledRideView[]> {
    const driver = await this.requireDriver(actor);
    const [vehicle] = driver.currentVehicleId ? await this.db.select({ category: schema.vehicles.category }).from(schema.vehicles).where(eq(schema.vehicles.id, driver.currentVehicleId)).limit(1) : [];
    const ranks = await this.db.select({ code: schema.vehicleCategories.code, rank: schema.vehicleCategories.rank }).from(schema.vehicleCategories);
    const myRank = vehicle ? (ranks.find((r) => r.code === vehicle.category)?.rank ?? 0) : 0;
    const eligibleCategories = ranks.filter((r) => r.rank <= myRank).map((r) => r.code);
    const now = new Date();
    const open = await selectRides(this.db, and(eq(schema.rides.type, 'scheduled'), gt(schema.rides.requestedAt, now), inArray(schema.rides.state, ['requested', 'offering']), eligibleCategories.length ? inArray(schema.rides.reservedCategory, eligibleCategories) : sql`false`), { limit: 100 });
    const mine = await selectRides(this.db, and(eq(schema.rides.type, 'scheduled'), gt(schema.rides.requestedAt, now), eq(schema.rides.driverId, driver.id), eq(schema.rides.state, 'assigned')), { limit: 100 });
    const all = [...mine, ...open.filter((o) => !mine.some((m) => m.id === o.id))].sort((a, b) => a.requestedAt!.getTime() - b.requestedAt!.getTime());
    const assignments = all.length
      ? await this.db.select().from(schema.scheduledAssignments).where(and(inArray(schema.scheduledAssignments.rideId, all.map((r) => r.id)), eq(schema.scheduledAssignments.driverId, driver.id), isNull(schema.scheduledAssignments.declinedAt))).orderBy(asc(schema.scheduledAssignments.proposedAt))
      : [];
    return all.map((r) => {
      const a = assignments.find((x) => x.rideId === r.id) ?? null;
      return {
        id: r.id,
        publicNumber: r.publicNumber,
        state: r.state,
        category: r.reservedCategory,
        requestedAt: r.requestedAt!.toISOString(),
        origin: { address: r.originAddress, coordinates: parseGeoPoint(r.originGeo) },
        destination: { address: r.destinationAddress, coordinates: parseGeoPoint(r.destinationGeo) },
        driverFareCents: r.fareCents ?? 0,
        paymentMethod: r.paymentMethod,
        assignment: a ? { id: a.id, proposedAt: a.proposedAt.toISOString(), confirmedAt: a.confirmedAt?.toISOString() ?? null } : null,
      };
    });
  }

  private async requireDriver(actor: UserActor) {
    const driver = await this.rides.driverOfUser(actor.userId);
    if (!driver) throw AppError.forbidden('DRIVER_PROFILE_REQUIRED', 'Profil chauffeur requis');
    return driver;
  }

  /** Le chauffeur se propose sur une course planifiée ouverte : une seule proposition active par course (index unique partiel). */
  async claim(rideId: string, actor: UserActor): Promise<{ assignmentId: string; status: 'proposed' }> {
    const driver = await this.requireDriver(actor);
    if (driver.status !== 'active') throw AppError.conflict('DRIVER_NOT_ACTIVE', 'Ce chauffeur n\'est pas actif');
    const ride = await this.rides.getRide(rideId);
    if (ride.type !== 'scheduled' || !['requested', 'offering'].includes(ride.state)) throw AppError.conflict('RIDE_NOT_CLAIMABLE', 'Cette course n\'est pas ouverte aux propositions', { state: ride.state, type: ride.type });
    const [active] = await this.db.select().from(schema.scheduledAssignments).where(and(eq(schema.scheduledAssignments.rideId, rideId), isNull(schema.scheduledAssignments.declinedAt))).limit(1);
    if (active && active.driverId !== driver.id) throw AppError.conflict('RIDE_ALREADY_CLAIMED', 'Un autre chauffeur s\'est déjà proposé');
    if (active) return { assignmentId: active.id, status: 'proposed' };
    try {
      const [row] = await this.db.insert(schema.scheduledAssignments).values({ rideId, driverId: driver.id }).returning({ id: schema.scheduledAssignments.id });
      await this.db.insert(schema.rideEvents).values({ rideId, type: 'scheduled_claimed', fromState: ride.state, toState: ride.state, actorUserId: actor.userId, actorKind: 'driver', data: { driverId: driver.id, assignmentId: row!.id } });
      return { assignmentId: row!.id, status: 'proposed' };
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('RIDE_ALREADY_CLAIMED', 'Un autre chauffeur s\'est déjà proposé');
      throw error;
    }
  }

  /** Confirmation obligatoire du chauffeur (5.3) : la course lui est attribuée par la machine à états. */
  async confirm(rideId: string, actor: UserActor) {
    const driver = await this.requireDriver(actor);
    const [assignment] = await this.db.select().from(schema.scheduledAssignments).where(and(eq(schema.scheduledAssignments.rideId, rideId), eq(schema.scheduledAssignments.driverId, driver.id), isNull(schema.scheduledAssignments.declinedAt))).limit(1);
    if (!assignment) throw AppError.notFound('ASSIGNMENT_NOT_FOUND', 'Aucune proposition à confirmer pour ce chauffeur');
    const ride = await this.rides.getRide(rideId);
    if (assignment.confirmedAt && ride.driverId === driver.id) return this.rides.view(ride);
    const view = await this.rides.assign(rideId, { driverId: driver.id }, { kind: 'driver', userId: actor.userId });
    await this.outbox.queue({ recipientUserId: actor.userId, template: 'ride.scheduled_confirmed_driver', data: { rideId } });
    return view;
  }

  /** Le chauffeur retire sa proposition ; la course reste ouverte. */
  async decline(rideId: string, actor: UserActor): Promise<void> {
    const driver = await this.requireDriver(actor);
    await this.db.update(schema.scheduledAssignments).set({ declinedAt: new Date() }).where(and(eq(schema.scheduledAssignments.rideId, rideId), eq(schema.scheduledAssignments.driverId, driver.id), isNull(schema.scheduledAssignments.declinedAt), isNull(schema.scheduledAssignments.confirmedAt)));
  }
}
