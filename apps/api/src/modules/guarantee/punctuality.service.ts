/**
 * Garantie de ponctualité (D10) : à l'arrivée du chauffeur sur une réservation, le retard par rapport à l'heure prévue
 * donne droit à un crédit (5 $ de 10 à 20 minutes, 10 $ de 20 à 30 minutes) ou au remboursement de la course en crédit
 * (au-delà de 30 minutes). Montants proposés au fondateur, en attente de validation : `punctuality.enabled` reste faux
 * tant qu'il ne les a pas validés. Neomoov finance la garantie : le tarif du chauffeur n'est pas touché. Idempotente : un
 * seul crédit par course (référence `punctuality:<course>`, verrou consultatif de transaction), même si chaque processus
 * de l'API reçoit l'événement.
 */
import { schema } from '@neomoov/db';
import { parsePunctualityRules, punctualityCompensation, type PunctualityCompensation } from '@neomoov/domain';
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { DomainEventsService } from '../../common/domain-events.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AuditService } from '../audit/audit.service.js';
import { CreditsService } from '../credits/credits.service.js';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';

export const PUNCTUALITY_REFERENCE = 'punctuality:';

@Injectable()
export class PunctualityService implements OnModuleInit, OnModuleDestroy {
  private unsubscribe: (() => void) | null = null;

  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly events: DomainEventsService,
    private readonly settings: SettingsService,
    private readonly credits: CreditsService,
    private readonly outbox: NotificationsOutbox,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.unsubscribe = this.events.on('ride.state_changed', (p) => {
      if (p.event !== 'driver_arrives') return;
      void this.onArrived(p.rideId, p.occurredAt).catch((error: unknown) => this.logger.error({ err: error, rideId: p.rideId }, 'Garantie de ponctualité : traitement en échec'));
    });
  }

  onModuleDestroy() {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Compensation d'une arrivée ; rejouable (le crédit n'est accordé qu'une fois). */
  async onArrived(rideId: string, arrivedAt: Date): Promise<PunctualityCompensation | null> {
    if (!(await this.settings.get<unknown>('punctuality.enabled', false))) return null;
    const [ride] = await this.database.db
      .select({ type: schema.rides.type, requestedAt: schema.rides.requestedAt, quotedTotalCents: schema.rides.quotedTotalCents, agreedTotalCents: schema.rides.agreedTotalCents, publicNumber: schema.rides.publicNumber, clientUserId: schema.clients.userId })
      .from(schema.rides)
      .leftJoin(schema.clients, eq(schema.clients.id, schema.rides.clientId))
      .where(eq(schema.rides.id, rideId))
      .limit(1);
    if (!ride || ride.type !== 'scheduled' || !ride.requestedAt || !ride.clientUserId) return null;
    const rules = parsePunctualityRules(await this.settings.get<unknown>('punctuality.rules', null));
    const compensation = punctualityCompensation(ride.requestedAt, arrivedAt, ride.agreedTotalCents ?? ride.quotedTotalCents, rules);
    if (compensation.kind === 'none' || compensation.amountCents === 0) return compensation;
    const reference = `${PUNCTUALITY_REFERENCE}${rideId}`;
    const clientUserId = ride.clientUserId;
    const granted = await this.database.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${reference}))`);
      const [existing] = await tx.select({ id: schema.credits.id }).from(schema.credits).where(and(eq(schema.credits.userId, clientUserId), eq(schema.credits.reference, reference))).limit(1);
      if (existing) return false;
      await this.credits.grant(tx, { userId: clientUserId, amountCents: compensation.amountCents, origin: 'guarantee', reference, note: `Garantie de ponctualité : ${compensation.minutesLate} minutes de retard (${compensation.kind === 'refund' ? 'course remboursée' : 'crédit'})` });
      return true;
    });
    if (!granted) return compensation;
    await this.outbox.queue({ recipientUserId: clientUserId, template: 'punctuality.compensated', data: { rideId, publicNumber: ride.publicNumber, minutesLate: compensation.minutesLate, amountCents: compensation.amountCents, refund: compensation.kind === 'refund' } });
    await this.audit.recordSystem({ action: 'punctuality.compensated', entity: 'rides', entityId: rideId, after: { kind: compensation.kind, minutesLate: compensation.minutesLate, amountCents: compensation.amountCents } });
    return compensation;
  }
}
