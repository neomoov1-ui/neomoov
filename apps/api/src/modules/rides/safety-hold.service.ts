/**
 * Blocage préventif du chauffeur sur incident de sécurité (cahier des charges 5.11, parcours 20) : SOS du client ou
 * plainte grave. Le chauffeur de la course est suspendu aussitôt (sanction `suspension` rattachée à l'incident, motif
 * préfixé), ne reçoit plus d'offres et, s'il n'a pas de course en cours, est retiré de la présence ; la course en cours
 * n'est pas interrompue : l'exploitation, alertée par le SOS, décide. La décision humaine sur l'incident lève le blocage
 * ou le maintient ; rien n'est levé automatiquement.
 */
import { schema } from '@neomoov/db';
import { triggersSafetyHold, type SafetyHoldOutcome, type SafetyHoldState } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { AppError } from '../../common/app-error.js';
import { APP_LOGGER } from '../../common/logger.js';
import type { UserActor } from '../auth/actor.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsOutbox } from './notifications-outbox.js';
import { PresenceService } from './presence.service.js';

/** Préfixe du motif des blocages préventifs : jamais levés par la conformité ni par le solde. */
export const SAFETY_SANCTION_PREFIX = 'Sécurité : ';

type SanctionRow = typeof schema.sanctions.$inferSelect;

@Injectable()
export class SafetyHoldService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly outbox: NotificationsOutbox,
    private readonly presence: PresenceService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.database.db;
  }

  /**
   * Bloque le chauffeur de la course de l'incident si celui-ci l'exige (`triggersSafetyHold`) ; idempotent : un seul
   * blocage par incident. Renvoie le chauffeur bloqué, ou null (pas de chauffeur, incident hors sécurité, déjà bloqué).
   */
  async holdForIncident(incidentId: string, now = new Date()): Promise<{ driverId: string } | null> {
    const [incident] = await this.db
      .select({ id: schema.incidents.id, type: schema.incidents.type, severity: schema.incidents.severity, reportedByKind: schema.incidents.reportedByKind, driverId: schema.rides.driverId, publicNumber: schema.rides.publicNumber })
      .from(schema.incidents)
      .innerJoin(schema.rides, eq(schema.rides.id, schema.incidents.rideId))
      .where(eq(schema.incidents.id, incidentId))
      .limit(1);
    if (!incident?.driverId || !triggersSafetyHold(incident)) return null;
    const driverId = incident.driverId;
    const inserted = await this.db.transaction(async (tx) => {
      // Verrou sur le chauffeur : deux signalements simultanés du même incident ne créent qu'un blocage.
      const [driver] = await tx.execute<{ status: string; user_id: string }>(sql`SELECT status, user_id FROM drivers WHERE id = ${driverId}::uuid FOR UPDATE`);
      const [existing] = await tx.select({ id: schema.sanctions.id }).from(schema.sanctions).where(and(eq(schema.sanctions.incidentId, incidentId), like(schema.sanctions.reason, `${SAFETY_SANCTION_PREFIX}%`))).limit(1);
      if (existing || !driver) return null;
      const label = incident.type === 'sos' ? 'SOS' : 'plainte';
      await tx.insert(schema.sanctions).values({ driverId, incidentId, type: 'suspension', reason: `${SAFETY_SANCTION_PREFIX}${label} sur la course ${incident.publicNumber}, en attente de décision`, startsAt: now });
      if (driver.status === 'active' || driver.status === 'restricted') await tx.update(schema.drivers).set({ status: 'suspended' }).where(eq(schema.drivers.id, driverId));
      return { userId: driver.user_id, previousStatus: driver.status };
    });
    if (!inserted) return null;
    // Hors course : retiré de la présence ; en course : la course continue, aucune nouvelle offre (statut suspendu).
    const [presence] = await this.db.select({ currentRideId: schema.driverPresence.currentRideId }).from(schema.driverPresence).where(eq(schema.driverPresence.driverId, driverId)).limit(1);
    if (presence && !presence.currentRideId) await this.presence.setStatus(inserted.userId, { status: 'offline' }).catch(() => undefined);
    await this.outbox.queue({ recipientUserId: inserted.userId, template: 'safety.hold', data: { publicNumber: incident.publicNumber } });
    this.audit.record({ action: 'safety.hold', entity: 'drivers', entityId: driverId, before: { status: inserted.previousStatus }, after: { status: 'suspended', incidentId } });
    this.logger.warn({ driverId, incidentId }, 'Chauffeur bloqué à titre préventif (incident de sécurité)');
    return { driverId };
  }

  /** Blocage en cours pour cet incident (sanction préventive non terminée). */
  async activeHold(incidentId: string): Promise<SanctionRow | null> {
    const [row] = await this.db
      .select()
      .from(schema.sanctions)
      .where(and(eq(schema.sanctions.incidentId, incidentId), like(schema.sanctions.reason, `${SAFETY_SANCTION_PREFIX}%`), isNull(schema.sanctions.decidedByUserId), or(isNull(schema.sanctions.endsAt), sql`${schema.sanctions.endsAt} > now()`)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Décision humaine : `lift` termine le blocage (le chauffeur redevient actif s'il n'a pas d'autre suspension en cours),
   * `keep` le maintient comme décision humaine (le personnel peut ensuite radier le chauffeur depuis sa fiche).
   */
  async resolve(incidentId: string, outcome: SafetyHoldOutcome, actor: UserActor, now = new Date()): Promise<void> {
    const hold = await this.activeHold(incidentId);
    if (!hold) throw AppError.conflict('NO_SAFETY_HOLD', 'Aucun blocage préventif en cours pour cet incident');
    const [driver] = await this.db.select({ userId: schema.drivers.userId, status: schema.drivers.status }).from(schema.drivers).where(eq(schema.drivers.id, hold.driverId)).limit(1);
    if (outcome === 'keep') {
      await this.db.update(schema.sanctions).set({ decidedByUserId: actor.userId, reason: hold.reason.replace(', en attente de décision', ', maintenue par décision humaine') }).where(eq(schema.sanctions.id, hold.id));
      this.audit.record({ action: 'safety.kept', entity: 'drivers', entityId: hold.driverId, after: { incidentId } });
      return;
    }
    await this.db.update(schema.sanctions).set({ endsAt: now, decidedByUserId: actor.userId }).where(eq(schema.sanctions.id, hold.id));
    const [still] = await this.db
      .select({ id: schema.sanctions.id })
      .from(schema.sanctions)
      .where(and(eq(schema.sanctions.driverId, hold.driverId), eq(schema.sanctions.type, 'suspension'), or(isNull(schema.sanctions.endsAt), sql`${schema.sanctions.endsAt} > ${now.toISOString()}::timestamptz`)))
      .limit(1);
    if (!still) await this.db.update(schema.drivers).set({ status: 'active' }).where(and(eq(schema.drivers.id, hold.driverId), eq(schema.drivers.status, 'suspended')));
    if (driver) await this.outbox.queue({ recipientUserId: driver.userId, template: 'safety.lifted', data: {} });
    this.audit.record({ action: 'safety.lifted', entity: 'drivers', entityId: hold.driverId, before: { status: driver?.status ?? null }, after: { incidentId, status: still ? driver?.status ?? null : 'active' } });
  }

  /** État du blocage de chaque incident (My Hub) : en cours, levé, maintenu ; absent sans blocage. */
  async statesOf(incidentIds: string[]): Promise<Map<string, SafetyHoldState>> {
    const states = new Map<string, SafetyHoldState>();
    if (!incidentIds.length) return states;
    const rows = await this.db
      .select({ incidentId: schema.sanctions.incidentId, endsAt: schema.sanctions.endsAt, decidedByUserId: schema.sanctions.decidedByUserId })
      .from(schema.sanctions)
      .where(and(inArray(schema.sanctions.incidentId, incidentIds), like(schema.sanctions.reason, `${SAFETY_SANCTION_PREFIX}%`)));
    for (const r of rows) {
      if (!r.incidentId) continue;
      states.set(r.incidentId, r.decidedByUserId === null ? 'active' : r.endsAt ? 'lifted' : 'kept');
    }
    return states;
  }
}
