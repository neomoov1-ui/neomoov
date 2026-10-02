/**
 * Crédits du client (section 5.9, prompt 08 tâche 4) : consultation (`GET /v1/me/credits`), octroi (parrainage,
 * remboursement en crédit, geste commercial), réservation à la réservation de la course et consommation à la fin.
 * Le devis déduit les crédits disponibles (`availableCents`) et la course garde le montant déduit
 * (`rides.credits_applied_cents`). Revue du 2 octobre 2026 : ce montant est réservé dans la transaction qui crée la
 * course (constat 3 : retiré du reste des crédits, le plus proche de son expiration d'abord, une ligne `credit_uses`
 * « reserved » par crédit entamé ; deux courses ne consomment jamais le même crédit), confirmé à la fin de course
 * (« consumed ») ou rendu au compte à l'annulation (« released »). Les crédits ne s'appliquent jamais à une course payée
 * au chauffeur (constat 2, décision). Rejouée, la consommation ne décrémente jamais deux fois.
 */
import { schema } from '@neomoov/db';
import { TERMINAL_RIDE_STATES, type CreditsView } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, ne, or, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { AppError } from '../../common/app-error.js';
import { APP_LOGGER } from '../../common/logger.js';
import { organizationIdFor } from '../../common/org-scope.context.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';

type Executor = Pick<Database['db'], 'insert' | 'update' | 'select' | 'execute'>;
type CreditOrigin = (typeof schema.credits.$inferInsert)['origin'];
type ReservedUse = { id: string; credit_id: string; amount_cents: number };

/** États d'une course terminée : seuls ceux-là consomment des crédits. */
const COMPLETED_STATES = ['completed', 'rated', 'disputed'];
/** États terminaux sans course faite : une réservation de crédits qui y reste est rendue au compte. */
const RELEASABLE_STATES = TERMINAL_RIDE_STATES.filter((s) => !COMPLETED_STATES.includes(s));
const RELEASABLE_STATES_SQL = sql.raw(RELEASABLE_STATES.map((s) => `'${s}'`).join(', '));
/** Nombre maximal de crédits listés (les plus récents). */
const LIST_LIMIT = 200;

export interface CreditGrant {
  userId: string;
  amountCents: number;
  origin: CreditOrigin;
  reference?: string | null;
  note?: string | null;
  /** Organisation de la course ou du chauffeur concerné (étape 20) ; le contexte courant a priorité, la base dérive du profil sinon. */
  organizationId?: string | null;
}

export interface CreditConsumption {
  rideId: string;
  /** Montant déduit par le devis de la course. */
  appliedCents: number;
  /** Montant effectivement prélevé sur les crédits par ce traitement (0 s'il avait déjà eu lieu). */
  consumedCents: number;
  /** Vrai si la consommation de cette course avait déjà été enregistrée (événement rejoué). */
  replayed: boolean;
}

@Injectable()
export class CreditsService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly settings: SettingsService,
  ) {}

  private get db() {
    return this.database.db;
  }

  /** Date d'expiration d'un nouveau crédit : `credits.validity_days` (365 par défaut) après `from`. */
  async expiryFrom(from = new Date()): Promise<Date> {
    const days = await this.settings.number('credits.validity_days', 365);
    return new Date(from.getTime() + days * 86_400_000);
  }

  /** Octroi d'un crédit dans la transaction de l'appelant ; l'expiration suit le réglage `credits.validity_days`. */
  async grant(tx: Executor, input: CreditGrant): Promise<string> {
    const expiresAt = await this.expiryFrom();
    const [row] = await tx
      .insert(schema.credits)
      .values({ userId: input.userId, organizationId: organizationIdFor(input.organizationId), amountCents: input.amountCents, remainingCents: input.amountCents, origin: input.origin, reference: input.reference ?? null, note: input.note ?? null, expiresAt })
      .returning({ id: schema.credits.id });
    return row!.id;
  }

  /**
   * Crédits utilisables d'un client pour une course : non expirés, reste positif, hors crédits de pack. Le reste d'un
   * crédit est déjà net des réservations en cours (constat 3) : le devis ne déduit jamais un crédit promis à une autre
   * course. Les réservations de courses closes sans course faite (événement perdu) sont d'abord rendues au compte.
   */
  async availableCents(userId: string, now = new Date()): Promise<number> {
    await this.releaseStale(userId);
    const [row] = await this.db
      .select({ total: sql<number>`coalesce(sum(${schema.credits.remainingCents}), 0)::int` })
      .from(schema.credits)
      .where(and(eq(schema.credits.userId, userId), ne(schema.credits.origin, 'driver_pack'), gt(schema.credits.remainingCents, 0), or(isNull(schema.credits.expiresAt), gt(schema.credits.expiresAt, now))));
    return row?.total ?? 0;
  }

  /**
   * Réservation (constat 3), dans la transaction qui crée la course : le montant déduit par le devis est retiré des
   * crédits du client (le plus proche de son expiration d'abord, sans expiration en dernier), une ligne `credit_uses`
   * « reserved » par crédit entamé. Les crédits sont verrouillés : deux réservations simultanées ne prennent jamais le
   * même crédit. Le compte ne couvre plus le devis (autre course réservée entre-temps, crédit expiré) : 409
   * `CREDITS_INSUFFICIENT`, le client demande un nouveau prix.
   */
  async reserveForRide(tx: Executor, input: { rideId: string; userId: string; amountCents: number; at: Date }): Promise<number> {
    if (input.amountCents <= 0) return 0;
    const credits = await tx.execute<{ id: string; remaining_cents: number }>(sql`
      SELECT id, remaining_cents FROM credits
      WHERE user_id = ${input.userId}::uuid AND origin <> 'driver_pack' AND remaining_cents > 0 AND (expires_at IS NULL OR expires_at > ${input.at.toISOString()}::timestamptz)
      ORDER BY expires_at ASC NULLS LAST, created_at ASC, id ASC
      FOR UPDATE`);
    const available = [...credits].reduce((sum, c) => sum + Number(c.remaining_cents), 0);
    if (available < input.amountCents) {
      throw AppError.conflict('CREDITS_INSUFFICIENT', 'Vos crédits ne couvrent plus le montant déduit par ce devis : demandez un nouveau prix', { requestedCents: input.amountCents, availableCents: available });
    }
    let left = input.amountCents;
    for (const credit of credits) {
      if (left <= 0) break;
      const take = Math.min(Number(credit.remaining_cents), left);
      await tx.insert(schema.creditUses).values({ creditId: credit.id, rideId: input.rideId, amountCents: take, status: 'reserved' });
      await tx.update(schema.credits).set({ remainingCents: sql`${schema.credits.remainingCents} - ${take}` }).where(eq(schema.credits.id, credit.id));
      left -= take;
    }
    return input.amountCents;
  }

  /**
   * Annulation, absence, aucun chauffeur, interruption : la réservation de crédits de la course est rendue au compte
   * (ligne « released », reste du crédit rétabli). Rejouable ; sans effet sur une course faite ou encore en cours.
   */
  async releaseForRide(rideId: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      const reserved = await tx.execute<ReservedUse>(sql`
        SELECT cu.id, cu.credit_id, cu.amount_cents FROM credit_uses cu JOIN rides r ON r.id = cu.ride_id
        WHERE cu.ride_id = ${rideId}::uuid AND cu.status = 'reserved' AND r.state IN (${RELEASABLE_STATES_SQL})
        FOR UPDATE OF cu`);
      let released = 0;
      for (const use of reserved) {
        await tx.update(schema.credits).set({ remainingCents: sql`${schema.credits.remainingCents} + ${Number(use.amount_cents)}` }).where(eq(schema.credits.id, use.credit_id));
        await tx.update(schema.creditUses).set({ status: 'released' }).where(eq(schema.creditUses.id, use.id));
        released += Number(use.amount_cents);
      }
      return released;
    });
  }

  /** Filet de sécurité (événement perdu, API redémarrée) : réservations des courses closes sans course faite de ce client, rendues au compte. */
  private async releaseStale(userId: string): Promise<void> {
    const rows = await this.db.execute<{ ride_id: string }>(sql`
      SELECT DISTINCT cu.ride_id FROM credit_uses cu JOIN credits c ON c.id = cu.credit_id JOIN rides r ON r.id = cu.ride_id
      WHERE c.user_id = ${userId}::uuid AND cu.status = 'reserved' AND r.state IN (${RELEASABLE_STATES_SQL})`);
    for (const row of rows) await this.releaseForRide(row.ride_id);
  }

  /** `GET /v1/me/credits` : total disponible (net des réservations en cours) et liste, crédits utilisables d'abord (non expirés, reste positif), les plus récents en tête. */
  async list(userId: string, now = new Date()): Promise<CreditsView> {
    await this.releaseStale(userId);
    const rows = await this.db
      .select()
      .from(schema.credits)
      .where(eq(schema.credits.userId, userId))
      .orderBy(
        sql`CASE WHEN ${schema.credits.remainingCents} > 0 AND (${schema.credits.expiresAt} IS NULL OR ${schema.credits.expiresAt} > ${now.toISOString()}::timestamptz) THEN 0 ELSE 1 END`,
        sql`${schema.credits.createdAt} DESC`,
      )
      .limit(LIST_LIMIT);
    // Les crédits de pack d'un chauffeur sont listés mais ne comptent pas dans le disponible des courses.
    const usable = (r: (typeof rows)[number]) => r.origin !== 'driver_pack' && r.remainingCents > 0 && (!r.expiresAt || r.expiresAt.getTime() > now.getTime());
    return {
      availableCents: rows.filter(usable).reduce((sum, r) => sum + r.remainingCents, 0),
      credits: rows.map((r) => ({
        id: r.id, origin: r.origin, amountCents: r.amountCents, remainingCents: r.remainingCents, reference: r.reference ?? null,
        expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null, createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Fin de course : confirme la réservation faite à la réservation de la course (lignes « reserved » passées
   * « consumed », dans la limite du montant finalement appliqué ; l'excédent, prix final plus bas, revient au crédit).
   * Une course réservée avant la réservation des crédits (sans ligne) est prélevée comme avant : crédits du client
   * valables à la réservation, par expiration la plus proche (sans expiration en dernier), puis par ancienneté. Une
   * seule transaction, crédits et lignes verrouillés : deux traitements du même événement (processus multiples, reprise)
   * passent l'un après l'autre et le second ne prélève rien. L'index unique (crédit, course) reste le dernier garde-fou.
   * Course payée au chauffeur : aucun crédit (décision du 2 octobre 2026), même si une ancienne course en porte un montant.
   */
  async consumeForRide(rideId: string): Promise<CreditConsumption> {
    const [ride] = await this.db
      .select({ id: schema.rides.id, state: schema.rides.state, clientId: schema.rides.clientId, paymentChoice: schema.rides.paymentChoice, appliedCents: schema.rides.creditsAppliedCents, bookedAt: schema.rides.createdAt, publicNumber: schema.rides.publicNumber })
      .from(schema.rides)
      .where(eq(schema.rides.id, rideId))
      .limit(1);
    const none = (appliedCents = 0, replayed = false): CreditConsumption => ({ rideId, appliedCents, consumedCents: 0, replayed });
    if (!ride || !ride.clientId || ride.appliedCents <= 0 || ride.paymentChoice === 'pay_driver_after' || !COMPLETED_STATES.includes(ride.state)) return none(ride?.appliedCents ?? 0);
    const [client] = await this.db.select({ userId: schema.clients.userId }).from(schema.clients).where(eq(schema.clients.id, ride.clientId)).limit(1);
    if (!client) return none(ride.appliedCents);
    const before = await this.usesOf(this.db, rideId);
    if (before.some((u) => u.status === 'consumed')) return none(ride.appliedCents, true);
    // Réservation déjà rendue au compte (course close sans course faite) : rien à prélever.
    if (before.length && before.every((u) => u.status === 'released')) return none(ride.appliedCents);

    const result = await this.db.transaction(async (tx) => {
      const reserved = await tx.execute<ReservedUse>(sql`
        SELECT cu.id, cu.credit_id, cu.amount_cents FROM credit_uses cu JOIN credits c ON c.id = cu.credit_id
        WHERE cu.ride_id = ${rideId}::uuid AND cu.status = 'reserved'
        ORDER BY c.expires_at ASC NULLS LAST, c.created_at ASC, c.id ASC
        FOR UPDATE OF cu, c`);
      if (reserved.length) return this.confirmReservation(tx, [...reserved], ride.appliedCents);
      const credits = await tx.execute<{ id: string; remaining_cents: number }>(sql`
        SELECT id, remaining_cents FROM credits
        WHERE user_id = ${client.userId}::uuid AND origin <> 'driver_pack' AND remaining_cents > 0 AND (expires_at IS NULL OR expires_at > ${ride.bookedAt.toISOString()}::timestamptz)
        ORDER BY expires_at ASC NULLS LAST, created_at ASC, id ASC
        FOR UPDATE`);
      // Relu après le verrou : un traitement concurrent du même événement a pu terminer entre-temps.
      if ((await this.usesOf(tx, rideId)).length) return { consumed: 0, replayed: true };
      let left = ride.appliedCents;
      let consumed = 0;
      for (const credit of credits) {
        if (left <= 0) break;
        const take = Math.min(Number(credit.remaining_cents), left);
        if (take <= 0) continue;
        const [use] = await tx.insert(schema.creditUses).values({ creditId: credit.id, rideId, amountCents: take }).onConflictDoNothing().returning({ id: schema.creditUses.id });
        if (!use) continue;
        await tx.update(schema.credits).set({ remainingCents: sql`${schema.credits.remainingCents} - ${take}` }).where(eq(schema.credits.id, credit.id));
        left -= take;
        consumed += take;
      }
      return { consumed, replayed: false };
    });
    if (!result.replayed && result.consumed < ride.appliedCents) {
      // Crédits utilisés entre la réservation et la fin de course (autre course, expiration) : l'écart est signalé.
      this.logger.warn({ rideId, publicNumber: ride.publicNumber, appliedCents: ride.appliedCents, consumedCents: result.consumed }, 'Crédits insuffisants à la fin de course');
    }
    return { rideId, appliedCents: ride.appliedCents, consumedCents: result.consumed, replayed: result.replayed };
  }

  /** Lignes « reserved » d'une course passées « consumed » jusqu'au montant appliqué ; le reste (prix final plus bas) revient aux crédits. */
  private async confirmReservation(tx: Executor, reserved: ReservedUse[], appliedCents: number): Promise<{ consumed: number; replayed: boolean }> {
    let left = appliedCents;
    let consumed = 0;
    for (const use of reserved) {
      const amount = Number(use.amount_cents);
      const take = Math.min(amount, left);
      if (take > 0) await tx.update(schema.creditUses).set({ status: 'consumed', amountCents: take }).where(eq(schema.creditUses.id, use.id));
      else await tx.update(schema.creditUses).set({ status: 'released' }).where(eq(schema.creditUses.id, use.id));
      if (amount > take) await tx.update(schema.credits).set({ remainingCents: sql`${schema.credits.remainingCents} + ${amount - take}` }).where(eq(schema.credits.id, use.credit_id));
      consumed += take;
      left -= take;
    }
    return { consumed, replayed: false };
  }

  private async usesOf(executor: Executor, rideId: string): Promise<Array<{ id: string; status: string }>> {
    return executor.select({ id: schema.creditUses.id, status: schema.creditUses.status }).from(schema.creditUses).where(eq(schema.creditUses.rideId, rideId));
  }
}
