/**
 * Parrainage (section 5.9, prompt 08 tâche 4). Chaque compte a un code personnel (`users.referral_code`), créé au
 * premier affichage et partagé par lien. Côté client : le filleul saisit le code à l'inscription (`POST /v1/me/referral/apply`),
 * parrain et filleul reçoivent chacun un crédit à la première course terminée du filleul. Côté chauffeur : le code est
 * donné à la candidature (`POST /v1/driver/apply`), le parrain chauffeur reçoit un crédit de pack quand le filleul
 * atteint `referral.driver_threshold_rides` courses. Montants, seuils et délais viennent des réglages, jamais du code.
 * La récompense est idempotente : la ligne `referrals` passe de `pending` à `completed` une seule fois, dans la
 * transaction qui crée les crédits.
 */
import { schema } from '@neomoov/db';
import type { ReferralView } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import type { Logger } from 'pino';
import { AppError } from '../../common/app-error.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AuditService } from '../audit/audit.service.js';
import { CreditsService } from './credits.service.js';

export type ReferralKind = 'client' | 'driver';

/** Alphabet sans caractères ambigus (ni 0, O, 1, I, L) : un code se dicte et se recopie sans erreur. */
export const REFERRAL_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const REFERRAL_CODE_LENGTH = 6;
/** Note des crédits de pack du parrainage chauffeur : appliqués au relevé hebdomadaire (étape 9). */
export const DRIVER_PACK_CREDIT_NOTE = 'Crédit de pack';
const CODE_ATTEMPTS = 8;

export function newReferralCode(): string {
  let code = '';
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i += 1) code += REFERRAL_ALPHABET[randomInt(REFERRAL_ALPHABET.length)];
  return code;
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}

interface Referrer {
  userId: string;
  code: string;
}

@Injectable()
export class ReferralsService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly credits: CreditsService,
  ) {}

  private get db() {
    return this.database.db;
  }

  /** Montants et seuil d'un type de parrainage, lus dans les réglages. */
  async rules(kind: ReferralKind): Promise<{ referrerCents: number; referredCents: number; thresholdRides: number }> {
    if (kind === 'driver') {
      const [referrerCents, thresholdRides] = await Promise.all([this.settings.number('referral.driver_referrer_cents', 5_000), this.settings.number('referral.driver_threshold_rides', 50)]);
      return { referrerCents, referredCents: 0, thresholdRides: Math.max(1, thresholdRides) };
    }
    const [referrerCents, referredCents] = await Promise.all([this.settings.number('referral.client_referrer_cents', 1_000), this.settings.number('referral.client_referred_cents', 1_000)]);
    return { referrerCents, referredCents, thresholdRides: 1 };
  }

  /** Code personnel du compte, créé au premier besoin (6 caractères sans ambiguïté, unique, nouvel essai en cas de collision). */
  async codeOf(userId: string): Promise<string> {
    const [user] = await this.db.select({ code: schema.users.referralCode }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    if (!user) throw AppError.notFound('USER_NOT_FOUND', 'Utilisateur introuvable');
    if (user.code) return user.code;
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      try {
        const [updated] = await this.db
          .update(schema.users)
          .set({ referralCode: newReferralCode() })
          .where(and(eq(schema.users.id, userId), isNull(schema.users.referralCode)))
          .returning({ code: schema.users.referralCode });
        if (updated?.code) return updated.code;
        // Créé entre-temps par une autre requête du même compte : relu.
        const [stored] = await this.db.select({ code: schema.users.referralCode }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
        if (stored?.code) return stored.code;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw new AppError('REFERRAL_CODE_UNAVAILABLE', 'Code de parrainage indisponible pour le moment, réessayez', 503);
  }

  private async isDriver(userId: string): Promise<boolean> {
    const [driver] = await this.db.select({ id: schema.drivers.id }).from(schema.drivers).where(and(eq(schema.drivers.userId, userId), ne(schema.drivers.status, 'offboarded'))).limit(1);
    return Boolean(driver);
  }

  /** `GET /v1/me/referral` : code, lien de partage, montants, statistiques de parrainage et parrain éventuel du compte. */
  async view(userId: string, requested?: ReferralKind): Promise<ReferralView> {
    // Type affiché par défaut : parrainage chauffeur pour un chauffeur, client sinon.
    const driver = await this.isDriver(userId);
    const kind = requested ?? (driver ? 'driver' : 'client');
    if (kind === 'driver' && !driver) throw AppError.forbidden('DRIVER_PROFILE_REQUIRED', 'Le parrainage chauffeur est réservé aux chauffeurs');
    const [code, rules, base] = await Promise.all([this.codeOf(userId), this.rules(kind), this.settings.string('referral.link_base_url', 'https://neomoov.net/parrainage')]);
    const [stats] = await this.db.execute<{ invited: number; completed: number; earned: number }>(sql`
      SELECT count(*)::int AS invited, count(*) FILTER (WHERE status = 'completed')::int AS completed, COALESCE(sum(referrer_credit_cents), 0)::int AS earned
      FROM referrals WHERE referrer_user_id = ${userId}::uuid AND kind = ${kind}`);
    const [parent] = await this.db
      .select({ code: schema.referrals.code, status: schema.referrals.status })
      .from(schema.referrals)
      .where(and(eq(schema.referrals.referredUserId, userId), eq(schema.referrals.kind, kind)))
      .limit(1);
    return {
      code,
      link: `${base.replace(/\/+$/, '')}/${encodeURIComponent(code)}`,
      kind,
      referrerRewardCents: rules.referrerCents,
      referredRewardCents: rules.referredCents,
      thresholdRides: rules.thresholdRides,
      stats: { invited: Number(stats?.invited ?? 0), completed: Number(stats?.completed ?? 0), earnedCents: Number(stats?.earned ?? 0) },
      referredBy: parent ? { code: parent.code, status: parent.status as 'pending' | 'completed' | 'expired' } : null,
    };
  }

  /** Titulaire d'un code (compte actif), ou `null`. */
  private async referrerOf(code: string): Promise<Referrer | null> {
    const normalized = code.trim().toUpperCase();
    if (!normalized) return null;
    const [row] = await this.db
      .select({ userId: schema.users.id, code: schema.users.referralCode })
      .from(schema.users)
      .where(and(eq(schema.users.referralCode, normalized), isNull(schema.users.deletedAt), eq(schema.users.status, 'active')))
      .limit(1);
    return row?.code ? { userId: row.userId, code: row.code } : null;
  }

  /**
   * `POST /v1/me/referral/apply` : le filleul client saisit le code d'un parrain. Refusé pour son propre code, après une
   * course terminée, au-delà de `referral.apply_window_days` jours après l'inscription, ou si un parrain est déjà
   * enregistré ; un parrainage croisé (le parrain déjà filleul de ce compte) est aussi refusé.
   */
  async apply(userId: string, code: string, now = new Date()): Promise<ReferralView> {
    const referrer = await this.referrerOf(code);
    if (!referrer) throw AppError.notFound('REFERRAL_CODE_UNKNOWN', 'Code de parrainage inconnu');
    if (referrer.userId === userId) throw new AppError('REFERRAL_OWN_CODE', 'Vous ne pouvez pas utiliser votre propre code', 400);
    const [user] = await this.db.select({ createdAt: schema.users.createdAt }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    if (!user) throw AppError.notFound('USER_NOT_FOUND', 'Utilisateur introuvable');
    const [client] = await this.db.select({ rideCount: schema.clients.rideCount }).from(schema.clients).where(eq(schema.clients.userId, userId)).limit(1);
    if (!client) throw AppError.forbidden('CLIENT_PROFILE_REQUIRED', 'Un profil client est requis');
    const [existing] = await this.db.select({ code: schema.referrals.code }).from(schema.referrals).where(and(eq(schema.referrals.referredUserId, userId), eq(schema.referrals.kind, 'client'))).limit(1);
    if (existing) throw AppError.conflict('REFERRAL_ALREADY_APPLIED', 'Un code de parrainage est déjà enregistré sur ce compte', { code: existing.code });
    if (client.rideCount > 0) throw AppError.conflict('REFERRAL_AFTER_FIRST_RIDE', 'Le code de parrainage se saisit avant la première course');
    const windowDays = await this.settings.number('referral.apply_window_days', 30);
    if (now.getTime() - user.createdAt.getTime() > windowDays * 86_400_000) throw AppError.conflict('REFERRAL_WINDOW_CLOSED', `Le code de parrainage se saisit dans les ${windowDays} jours suivant l'inscription`, { windowDays });
    const [reciprocal] = await this.db
      .select({ id: schema.referrals.id })
      .from(schema.referrals)
      .where(and(eq(schema.referrals.referrerUserId, userId), eq(schema.referrals.referredUserId, referrer.userId), eq(schema.referrals.kind, 'client')))
      .limit(1);
    if (reciprocal) throw AppError.conflict('REFERRAL_RECIPROCAL', 'Ce compte est déjà votre filleul : parrainage croisé impossible');
    const [row] = await this.db
      .insert(schema.referrals)
      .values({ referrerUserId: referrer.userId, referredUserId: userId, code: referrer.code, kind: 'client', thresholdRides: 1, status: 'pending' })
      .onConflictDoNothing()
      .returning({ id: schema.referrals.id });
    if (!row) throw AppError.conflict('REFERRAL_ALREADY_APPLIED', 'Un code de parrainage est déjà enregistré sur ce compte');
    this.audit.record({ action: 'referral.applied', entity: 'referrals', entityId: row.id, after: { kind: 'client', referralCode: referrer.code, referrerUserId: referrer.userId } });
    return this.view(userId, 'client');
  }

  /**
   * Candidature chauffeur avec un code : vérifié avant la création du dossier (code inconnu, propre code, parrain qui
   * n'est pas chauffeur : refus lisible). Renvoie le parrain à enregistrer après la création (`recordDriverReferral`).
   */
  async driverReferrerFor(userId: string, code: string): Promise<Referrer> {
    const referrer = await this.referrerOf(code);
    if (!referrer) throw AppError.notFound('REFERRAL_CODE_UNKNOWN', 'Code de parrainage inconnu');
    if (referrer.userId === userId) throw new AppError('REFERRAL_OWN_CODE', 'Vous ne pouvez pas utiliser votre propre code', 400);
    if (!(await this.isDriver(referrer.userId))) throw new AppError('REFERRAL_NOT_A_DRIVER', 'Ce code n\'est pas celui d\'un chauffeur Neomoov', 400);
    return referrer;
  }

  /** Parrainage chauffeur enregistré à la candidature (un seul parrain chauffeur par compte). */
  async recordDriverReferral(userId: string, referrer: Referrer): Promise<void> {
    const { thresholdRides } = await this.rules('driver');
    const [row] = await this.db
      .insert(schema.referrals)
      .values({ referrerUserId: referrer.userId, referredUserId: userId, code: referrer.code, kind: 'driver', thresholdRides, status: 'pending' })
      .onConflictDoNothing()
      .returning({ id: schema.referrals.id });
    if (row) this.audit.record({ action: 'referral.applied', entity: 'referrals', entityId: row.id, after: { kind: 'driver', referralCode: referrer.code, referrerUserId: referrer.userId, thresholdRides } });
  }

  /**
   * Fin de course : récompense du parrainage client (filleul client de la course) et du parrainage chauffeur (filleul
   * chauffeur de la course) quand le filleul atteint le seuil de courses terminées. Rejouée, ne crédite jamais deux fois.
   */
  async rewardAfterRide(rideId: string): Promise<{ client: boolean; driver: boolean }> {
    const [ride] = await this.db
      .select({ state: schema.rides.state, clientUserId: schema.clients.userId, clientRides: schema.clients.rideCount, driverUserId: schema.drivers.userId, driverRides: schema.drivers.rideCount })
      .from(schema.rides)
      .leftJoin(schema.clients, eq(schema.clients.id, schema.rides.clientId))
      .leftJoin(schema.drivers, eq(schema.drivers.id, schema.rides.driverId))
      .where(eq(schema.rides.id, rideId))
      .limit(1);
    if (!ride || !['completed', 'rated', 'disputed'].includes(ride.state)) return { client: false, driver: false };
    const client = ride.clientUserId ? await this.reward(ride.clientUserId, 'client', ride.clientRides ?? 0) : false;
    const driver = ride.driverUserId ? await this.reward(ride.driverUserId, 'driver', ride.driverRides ?? 0) : false;
    return { client, driver };
  }

  private async reward(referredUserId: string, kind: ReferralKind, completedRides: number): Promise<boolean> {
    const [referral] = await this.db
      .select()
      .from(schema.referrals)
      .where(and(eq(schema.referrals.referredUserId, referredUserId), eq(schema.referrals.kind, kind), eq(schema.referrals.status, 'pending')))
      .limit(1);
    if (!referral || completedRides < referral.thresholdRides) return false;
    const rules = await this.rules(kind);
    const done = await this.db.transaction(async (tx) => {
      // Passage à `completed` d'abord : un second traitement du même événement ne trouve plus de ligne en attente.
      const [updated] = await tx
        .update(schema.referrals)
        .set({ status: 'completed', completedAt: new Date(), referrerCreditCents: rules.referrerCents, referredCreditCents: rules.referredCents })
        .where(and(eq(schema.referrals.id, referral.id), eq(schema.referrals.status, 'pending')))
        .returning({ id: schema.referrals.id });
      if (!updated) return false;
      const note = kind === 'driver' ? DRIVER_PACK_CREDIT_NOTE : 'Parrainage';
      if (rules.referrerCents > 0) await this.credits.grant(tx, { userId: referral.referrerUserId, amountCents: rules.referrerCents, origin: 'referral', reference: referral.code, note });
      if (rules.referredCents > 0) await this.credits.grant(tx, { userId: referredUserId, amountCents: rules.referredCents, origin: 'referral', reference: referral.code, note });
      return true;
    });
    if (done) {
      this.logger.info({ referralId: referral.id, kind, referrerCents: rules.referrerCents, referredCents: rules.referredCents }, 'Parrainage récompensé');
      this.audit.record({ action: 'referral.rewarded', entity: 'referrals', entityId: referral.id, after: { kind, referrerCreditCents: rules.referrerCents, referredCreditCents: rules.referredCents } });
    }
    return done;
  }
}
