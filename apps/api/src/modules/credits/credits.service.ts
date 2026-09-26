/**
 * Crédits du client (section 5.9, prompt 08 tâche 4) : consultation (`GET /v1/me/credits`), octroi (parrainage,
 * remboursement en crédit, geste commercial) et consommation à la fin de course. Le devis déduit déjà les crédits
 * disponibles (`QuotesService.creditsOf`) et la course garde le montant déduit (`rides.credits_applied_cents`) : à la fin,
 * ce montant est prélevé sur les crédits du client, le plus proche de son expiration d'abord (sans expiration en
 * dernier), une ligne `credit_uses` par crédit entamé. Rejouée, la consommation ne décrémente jamais deux fois.
 */
import { schema } from '@neomoov/db';
import type { CreditsView } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';

type Executor = Pick<Database['db'], 'insert' | 'update' | 'select' | 'execute'>;
type CreditOrigin = (typeof schema.credits.$inferInsert)['origin'];

/** États d'une course terminée : seuls ceux-là consomment des crédits. */
const COMPLETED_STATES = ['completed', 'rated', 'disputed'];
/** Nombre maximal de crédits listés (les plus récents). */
const LIST_LIMIT = 200;

export interface CreditGrant {
  userId: string;
  amountCents: number;
  origin: CreditOrigin;
  reference?: string | null;
  note?: string | null;
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
      .values({ userId: input.userId, amountCents: input.amountCents, remainingCents: input.amountCents, origin: input.origin, reference: input.reference ?? null, note: input.note ?? null, expiresAt })
      .returning({ id: schema.credits.id });
    return row!.id;
  }

  /** `GET /v1/me/credits` : total disponible et liste, crédits utilisables d'abord (non expirés, reste positif), les plus récents en tête. */
  async list(userId: string, now = new Date()): Promise<CreditsView> {
    const rows = await this.db
      .select()
      .from(schema.credits)
      .where(eq(schema.credits.userId, userId))
      .orderBy(
        sql`CASE WHEN ${schema.credits.remainingCents} > 0 AND (${schema.credits.expiresAt} IS NULL OR ${schema.credits.expiresAt} > ${now.toISOString()}::timestamptz) THEN 0 ELSE 1 END`,
        sql`${schema.credits.createdAt} DESC`,
      )
      .limit(LIST_LIMIT);
    const usable = (r: (typeof rows)[number]) => r.remainingCents > 0 && (!r.expiresAt || r.expiresAt.getTime() > now.getTime());
    return {
      availableCents: rows.filter(usable).reduce((sum, r) => sum + r.remainingCents, 0),
      credits: rows.map((r) => ({
        id: r.id, origin: r.origin, amountCents: r.amountCents, remainingCents: r.remainingCents, reference: r.reference ?? null,
        expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null, createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Fin de course : prélève `rides.credits_applied_cents` sur les crédits du client, valables à la réservation, par
   * expiration la plus proche (sans expiration en dernier), puis par ancienneté. Une seule transaction : les crédits du
   * client sont verrouillés, puis la présence de lignes `credit_uses` pour la course est vérifiée ; deux traitements du
   * même événement (processus multiples, reprise) passent donc l'un après l'autre et le second ne prélève rien.
   * L'index unique (crédit, course) reste le dernier garde-fou.
   */
  async consumeForRide(rideId: string): Promise<CreditConsumption> {
    const [ride] = await this.db
      .select({ id: schema.rides.id, state: schema.rides.state, clientId: schema.rides.clientId, appliedCents: schema.rides.creditsAppliedCents, bookedAt: schema.rides.createdAt, publicNumber: schema.rides.publicNumber })
      .from(schema.rides)
      .where(eq(schema.rides.id, rideId))
      .limit(1);
    const none = (appliedCents = 0, replayed = false): CreditConsumption => ({ rideId, appliedCents, consumedCents: 0, replayed });
    if (!ride || !ride.clientId || ride.appliedCents <= 0 || !COMPLETED_STATES.includes(ride.state)) return none(ride?.appliedCents ?? 0);
    const [client] = await this.db.select({ userId: schema.clients.userId }).from(schema.clients).where(eq(schema.clients.id, ride.clientId)).limit(1);
    if (!client) return none(ride.appliedCents);
    if (await this.alreadyConsumed(this.db, rideId)) return none(ride.appliedCents, true);

    const result = await this.db.transaction(async (tx) => {
      const credits = await tx.execute<{ id: string; remaining_cents: number }>(sql`
        SELECT id, remaining_cents FROM credits
        WHERE user_id = ${client.userId}::uuid AND remaining_cents > 0 AND (expires_at IS NULL OR expires_at > ${ride.bookedAt.toISOString()}::timestamptz)
        ORDER BY expires_at ASC NULLS LAST, created_at ASC, id ASC
        FOR UPDATE`);
      // Relu après le verrou : un traitement concurrent du même événement a pu terminer entre-temps.
      if (await this.alreadyConsumed(tx, rideId)) return { consumed: 0, replayed: true };
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

  private async alreadyConsumed(executor: Executor, rideId: string): Promise<boolean> {
    const [row] = await executor.select({ id: schema.creditUses.id }).from(schema.creditUses).where(eq(schema.creditUses.rideId, rideId)).limit(1);
    return Boolean(row);
  }
}
