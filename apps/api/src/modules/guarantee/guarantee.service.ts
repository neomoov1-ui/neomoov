/**
 * Garantie modèle (section 5.2, prompt 08 tâche 6) : décision de l'exploitation sur un incident `model_guarantee` signalé
 * par le client (véhicule présenté différent de celui garanti). Validée : remboursement intégral de ce que le client a
 * payé pour la course (sur la carte, ou en crédit s'il le préfère ou s'il a payé le chauffeur directement) ; tarif normal
 * maintenu au chauffeur quand la faute n'est pas la sienne (`rides.driver_fare_protected`, lu par le relevé hebdomadaire
 * de l'étape 9), sinon sanction proposée par une note interne sur le chauffeur, jamais appliquée automatiquement.
 * Refusée : clôture motivée. Dans les deux cas, l'incident est tranché, journalisé et le client est prévenu.
 */
import { schema } from '@neomoov/db';
import { refundableCents, type GuaranteeResult } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { AppError } from '../../common/app-error.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AuditService } from '../audit/audit.service.js';
import type { UserActor } from '../auth/actor.js';
import { PaymentsService } from '../payments/payments.service.js';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';
import { RidesService } from '../rides/rides.service.js';

export interface GuaranteeDecisionInput {
  outcome: 'validated' | 'rejected';
  decision: string;
  driverAtFault: boolean;
  refundMode: 'refund' | 'credit';
}

type Executor = Pick<Database['db'], 'select'>;
interface RideFacts {
  id: string;
  publicNumber: string;
  clientId: string | null;
  driverId: string | null;
  finalPriceCents: number | null;
  quotedTotalCents: number;
}

/** Un incident se tranche une seule fois : ouvert ou en instruction. */
const DECIDABLE = ['open', 'investigating'];

@Injectable()
export class GuaranteeService {
  constructor(
    @Inject(DB) private readonly database: Database,
    private readonly payments: PaymentsService,
    private readonly rides: RidesService,
    private readonly audit: AuditService,
    private readonly outbox: NotificationsOutbox,
  ) {}

  private get db() {
    return this.database.db;
  }

  /**
   * `POST /v1/admin/incidents/{id}/guarantee`. L'incident est verrouillé le temps de la décision : deux décisions
   * simultanées ne remboursent pas deux fois (la seconde trouve l'incident tranché). Le remboursement porte une clé
   * d'idempotence propre à l'incident : rejouée après un échec, la décision retrouve le même remboursement.
   */
  async decide(incidentId: string, input: GuaranteeDecisionInput, actor: UserActor): Promise<GuaranteeResult> {
    const validated = input.outcome === 'validated';
    const done = await this.db.transaction(async (tx) => {
      const [incident] = await tx.select().from(schema.incidents).where(eq(schema.incidents.id, incidentId)).limit(1).for('update');
      if (!incident) throw AppError.notFound('INCIDENT_NOT_FOUND', 'Incident introuvable');
      if (incident.type !== 'model_guarantee') throw AppError.conflict('NOT_MODEL_GUARANTEE', 'Cet incident ne relève pas de la garantie modèle', { type: incident.type });
      if (!DECIDABLE.includes(incident.status)) throw AppError.conflict('INCIDENT_ALREADY_DECIDED', 'Cet incident a déjà été tranché', { status: incident.status });
      const [ride] = incident.rideId
        ? await tx
            .select({ id: schema.rides.id, publicNumber: schema.rides.publicNumber, clientId: schema.rides.clientId, driverId: schema.rides.driverId, finalPriceCents: schema.rides.finalPriceCents, quotedTotalCents: schema.rides.quotedTotalCents })
            .from(schema.rides)
            .where(eq(schema.rides.id, incident.rideId))
            .limit(1)
        : [];
      if (!ride) throw AppError.notFound('RIDE_NOT_FOUND', 'Course introuvable');

      let refundedCents = 0;
      let refundMode: 'refund' | 'credit' | null = null;
      if (validated) {
        const plan = await this.refundPlan(tx, ride, incident.id, input.refundMode);
        if (plan.amountCents > 0) {
          const refund = await this.payments.refund(ride.id, { amountCents: plan.amountCents, reason: `Garantie modèle validée (incident ${incident.id})`, mode: plan.mode }, { userId: actor.userId }, this.refundKey(incident.id));
          refundedCents = refund.amountCents;
          refundMode = refund.mode;
          // Le crédit rendu au client est présenté comme une garantie (origine lue par « Mes crédits »).
          if (refund.mode === 'credit') await tx.execute(sql`UPDATE credits SET origin = 'guarantee' WHERE id = (SELECT credit_id FROM refunds WHERE id = ${refund.id}::uuid)`);
        }
      }
      const driverFareProtected = validated && !input.driverAtFault;
      const sanctionProposed = validated && input.driverAtFault && ride.driverId !== null;
      await tx
        .update(schema.rides)
        .set({ guaranteeOutcome: input.outcome, ...(validated ? { driverFareProtected, modelGuaranteeApplied: true } : {}) })
        .where(eq(schema.rides.id, ride.id));
      if (sanctionProposed) {
        await tx.insert(schema.staffNotes).values({
          entityType: 'driver', entityId: ride.driverId!, authorUserId: actor.userId,
          body: `Sanction proposée : garantie modèle validée avec faute du chauffeur, course ${ride.publicNumber} (incident ${incident.id}). ${input.decision}`,
        });
      }
      await tx.update(schema.incidents).set({ status: 'decided', decision: input.decision, decidedByUserId: actor.userId, decidedAt: new Date() }).where(eq(schema.incidents.id, incident.id));
      return { incident, ride, refundedCents, refundMode, driverFareProtected, sanctionProposed };
    });

    const { incident, ride, refundedCents, refundMode, driverFareProtected, sanctionProposed } = done;
    this.audit.record({
      action: `admin.guarantee_${input.outcome}`, entity: 'incidents', entityId: incident.id, before: { status: incident.status },
      after: { status: 'decided', rideId: ride.id, outcome: input.outcome, driverAtFault: input.driverAtFault, refundedCents, refundMode, driverFareProtected, sanctionProposed },
    });
    await this.rides.mark(ride.id, 'guarantee_decided', { kind: 'operator', userId: actor.userId }, { incidentId: incident.id, outcome: input.outcome, refundedCents, refundMode, driverFareProtected });
    const [client] = ride.clientId ? await this.db.select({ userId: schema.clients.userId }).from(schema.clients).where(eq(schema.clients.id, ride.clientId)).limit(1) : [];
    if (client) {
      await this.outbox.queue({ recipientUserId: client.userId, template: 'guarantee.decided', data: { rideId: ride.id, publicNumber: ride.publicNumber, incidentId: incident.id, outcome: input.outcome, decision: input.decision, refundedCents, refundMode } });
    }
    return { incidentId: incident.id, outcome: input.outcome, refundedCents, refundMode, driverFareProtected, sanctionProposed };
  }

  /** Clé d'idempotence du remboursement, propre à l'incident (le service des paiements la préfixe par la course). */
  private refundKey(incidentId: string): string {
    return `guarantee-${incidentId}`;
  }

  /**
   * Ce que le client a payé pour la course, moins ce qui lui a déjà été rendu : le capturé sur la carte, ou le montant
   * confirmé par le chauffeur pour un paiement direct (plafonné au prix de la course), toujours rendu en crédit dans ce
   * cas. Un remboursement déjà fait pour cet incident (décision rejouée) est repris tel quel.
   */
  private async refundPlan(tx: Executor, ride: RideFacts, incidentId: string, requested: 'refund' | 'credit'): Promise<{ amountCents: number; mode: 'refund' | 'credit' }> {
    const [previous] = await tx
      .select({ amountCents: schema.refunds.amountCents, mode: schema.refunds.mode })
      .from(schema.refunds)
      .where(eq(schema.refunds.idempotencyKey, `refund:${ride.id}:${this.refundKey(incidentId)}`))
      .limit(1);
    if (previous) return { amountCents: previous.amountCents, mode: previous.mode === 'credit' ? 'credit' : 'refund' };
    const rows = await tx.select().from(schema.payments).where(and(eq(schema.payments.rideId, ride.id), eq(schema.payments.kind, 'ride'))).orderBy(desc(schema.payments.createdAt));
    const payment = rows.find((p) => p.status === 'captured' || p.status === 'refunded' || p.status === 'paid_direct') ?? rows[0];
    if (!payment) throw AppError.conflict('NOTHING_TO_REFUND', 'Aucun paiement enregistré pour cette course');
    const direct = payment.collectedBy === 'driver' || !payment.stripePaymentIntentId;
    if (!direct && payment.status !== 'captured' && payment.status !== 'refunded') {
      throw AppError.conflict('PAYMENT_NOT_CAPTURED', 'Le paiement de la course n\'est pas encore encaissé : la garantie se décide après la capture', { status: payment.status });
    }
    const [refunded] = await tx
      .select({ total: sql<number>`COALESCE(sum(${schema.refunds.amountCents}), 0)::int` })
      .from(schema.refunds)
      .where(and(eq(schema.refunds.paymentId, payment.id), ne(schema.refunds.status, 'failed')));
    const already = Number(refunded?.total ?? 0);
    const price = ride.finalPriceCents ?? ride.quotedTotalCents;
    if (direct) return { amountCents: Math.max(0, Math.min(payment.driverConfirmedCents ?? price, price) - already), mode: 'credit' };
    const amountCents = refundableCents(payment.capturedCents, already);
    return { amountCents: requested === 'credit' ? Math.min(amountCents, Math.max(0, price - already)) : amountCents, mode: requested };
  }
}
