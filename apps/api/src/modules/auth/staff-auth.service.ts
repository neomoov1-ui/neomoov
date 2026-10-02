/**
 * Personnel de My Hub (rôles admin, operator, finance, readonly) : courriel et mot de passe argon2id, puis second
 * facteur TOTP obligatoire (inscription au premier accès, codes de secours), verrouillage progressif après cinq échecs.
 * Un membre du personnel connecté par code SMS (comme client) n'obtient jamais ses rôles du personnel (voir AuthService).
 * Étape 21 : le même second facteur (secret TOTP, codes de secours, verrouillage) sert aux membres des organisations
 * clientes connectés par code SMS (`member`) : jetons de passage distincts, session sans mot de passe ni rôle du
 * personnel, `amr` = premier facteur et `mfa`.
 */
import { schema } from '@neomoov/db';
import type { StaffCreate, UserRole } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import QRCode from 'qrcode';
import { AppError } from '../../common/app-error.js';
import { decryptString, encryptString, generateTotpSecret, otpauthUri, randomBackupCode, sha256Hex, verifyTotp } from '../../common/crypto.js';
import { dummyPasswordHash, hashPassword, verifyPassword } from '../../common/passwords.js';
import { RateLimitService } from '../../common/rate-limit.service.js';
import { SettingsService } from '../../common/settings.service.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { DB, type Database } from '../../infra/db.module.js';
import { hasStaffRole, isStaffRole, type UserActor } from './actor.js';
import { TokensService } from './tokens.service.js';
import { UsersService, type UserRow } from '../users/users.service.js';

type CredentialsRow = typeof schema.staffCredentials.$inferSelect;

/** Un code TOTP accepté ne sert qu'une fois : trois pas de 30 secondes, la fenêtre de tolérance (RFC 6238), pas un réglage métier. */
const TOTP_REPLAY_TTL_SECONDS = 90;

/** Second facteur du personnel (après le mot de passe) ou d'un membre d'organisation (après le code SMS). */
export type MfaKind = 'staff' | 'member';
const PURPOSES = {
  staff: { verify: 'mfa_verify', enroll: 'mfa_enroll' },
  member: { verify: 'member_mfa_verify', enroll: 'member_mfa_enroll' },
} as const;
/** Méthodes d'un premier facteur reprises dans la session d'un membre (jamais `pwd`, `mfa` ni `backup`). */
const FIRST_FACTORS = new Set(['otp', 'apple', 'google']);

export interface StaffLoginResult {
  status: 'mfa_required' | 'mfa_enrollment_required';
  mfaToken: string;
}

@Injectable()
export class StaffAuthService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly users: UsersService,
    private readonly tokens: TokensService,
    private readonly settings: SettingsService,
    private readonly store: RateLimitService,
  ) {}

  private get db() {
    return this.database.db;
  }

  private async credentialsOf(userId: string): Promise<CredentialsRow | null> {
    const [row] = await this.db.select().from(schema.staffCredentials).where(eq(schema.staffCredentials.userId, userId)).limit(1);
    return row ?? null;
  }

  /** Première étape : courriel et mot de passe. La réponse ne distingue pas un courriel inconnu d'un mot de passe faux. */
  async login(email: string, password: string, ip: string | null): Promise<StaffLoginResult> {
    // Limites propres à cet endpoint sensible (section 8), en plus de la limite globale par adresse ; seuils en base.
    const [perEmail, perIp] = await Promise.all([this.settings.number('auth.staff_login_per_email_per_10min', 10), this.settings.number('auth.staff_login_per_ip_per_10min', 30)]);
    const byEmail = await this.store.hit(`staff-login:email:${email.toLowerCase()}`, perEmail, 600);
    const byIp = ip ? await this.store.hit(`staff-login:ip:${ip}`, perIp, 600) : { allowed: true, resetIn: 0 };
    if (!byEmail.allowed || !byIp.allowed) {
      throw new AppError('RATE_LIMITED', 'Trop de tentatives de connexion, réessayez plus tard', 429, { retryAfter: Math.max(byEmail.resetIn, byIp.resetIn) });
    }
    const user = await this.users.findByEmail(email);
    const roles = user ? await this.users.rolesOf(user.id) : [];
    const credentials = user && hasStaffRole(roles) ? await this.credentialsOf(user.id) : null;
    // Étape 21 : un second facteur de membre d'organisation n'a pas de mot de passe ; il n'ouvre jamais de session du personnel.
    if (!user || !credentials?.passwordHash || user.status !== 'active') {
      await verifyPassword(password, await dummyPasswordHash());
      throw AppError.unauthorized('INVALID_CREDENTIALS', 'Courriel ou mot de passe incorrect');
    }
    this.assertNotLocked(credentials);
    if (!(await verifyPassword(password, credentials.passwordHash))) {
      await this.registerFailure(credentials);
      throw AppError.unauthorized('INVALID_CREDENTIALS', 'Courriel ou mot de passe incorrect');
    }
    // Le compteur d'échecs n'est remis à zéro qu'après le second facteur (openSession) : le verrouillage couvre aussi le TOTP.
    const ttl = await this.settings.number('auth.mfa_token_ttl_seconds', 300);
    const stage = credentials.totpEnabledAt ? 'mfa_verify' : 'mfa_enroll';
    const mfaToken = await this.tokens.issueTransientToken(stage, user.id, {}, ttl);
    return { status: stage === 'mfa_verify' ? 'mfa_required' : 'mfa_enrollment_required', mfaToken };
  }

  /** Verrouillage en cours : 423 avec le délai restant. Vérifié au mot de passe et à chaque étape du second facteur. */
  private assertNotLocked(credentials: CredentialsRow): void {
    if (credentials.lockedUntil && credentials.lockedUntil > new Date()) {
      throw new AppError('ACCOUNT_LOCKED', 'Compte verrouillé après trop d\'échecs, réessayez plus tard', 423, { retryAfter: Math.ceil((credentials.lockedUntil.getTime() - Date.now()) / 1000) });
    }
  }

  /**
   * Verrouillage progressif : 15 minutes au cinquième échec, doublées à chaque nouvelle série (section 8). Le compteur est
   * incrémenté en base (revue 17.B) : des essais parallèles comptent chacun, celui qui atteint le seuil pose le verrou.
   */
  private async registerFailure(credentials: CredentialsRow): Promise<void> {
    const [threshold, minutes] = await Promise.all([this.settings.number('auth.staff_lockout_threshold', 5), this.settings.number('auth.staff_lockout_minutes', 15)]);
    const [counted] = await this.db
      .update(schema.staffCredentials)
      .set({ failedAttempts: sql`${schema.staffCredentials.failedAttempts} + 1` })
      .where(eq(schema.staffCredentials.userId, credentials.userId))
      .returning({ failedAttempts: schema.staffCredentials.failedAttempts });
    const failedAttempts = counted?.failedAttempts ?? credentials.failedAttempts + 1;
    if (failedAttempts % threshold !== 0) return;
    const lockedUntil = new Date(Date.now() + minutes * 2 ** (failedAttempts / threshold - 1) * 60_000);
    await this.db.update(schema.staffCredentials).set({ lockedUntil }).where(eq(schema.staffCredentials.userId, credentials.userId));
  }

  /** Inscription du second facteur : secret et QR, à confirmer par un premier code. */
  async enroll(mfaToken: string, kind: MfaKind = 'staff'): Promise<{ secret: string; otpauthUri: string; qrSvg: string }> {
    const { subject: userId } = await this.tokens.verifyTransientToken(PURPOSES[kind].enroll, mfaToken);
    const user = this.users.requireUsable(await this.users.findById(userId));
    const secret = generateTotpSecret();
    const pending = encryptString(secret, this.env.ENCRYPTION_KEY!);
    if (kind === 'member') {
      // Membre d'organisation : la ligne naît ici, sans mot de passe.
      await this.db.insert(schema.staffCredentials).values({ userId, passwordHash: null, totpPendingSecretEncrypted: pending })
        .onConflictDoUpdate({ target: schema.staffCredentials.userId, set: { totpPendingSecretEncrypted: pending } });
    } else {
      await this.db.update(schema.staffCredentials).set({ totpPendingSecretEncrypted: pending }).where(eq(schema.staffCredentials.userId, userId));
    }
    const uri = otpauthUri(this.env.MFA_ISSUER, user.email ?? user.phone, secret);
    const qrSvg = await QRCode.toString(uri, { type: 'svg', margin: 1, width: 240 });
    return { secret, otpauthUri: uri, qrSvg };
  }

  /** Confirme l'inscription avec un code valide : active le TOTP, remet dix codes de secours et ouvre la session. */
  async confirmEnrollment(mfaToken: string, code: string, ctx: SessionContext, kind: MfaKind = 'staff') {
    const { subject: userId, jti, data } = await this.tokens.verifyTransientToken(PURPOSES[kind].enroll, mfaToken);
    const credentials = await this.credentialsOf(userId);
    if (!credentials?.totpPendingSecretEncrypted) throw new AppError('MFA_ENROLLMENT_NOT_STARTED', 'Commencez par demander le QR d\'inscription', 400);
    // Un membre déjà inscrit ne remplace pas son second facteur par un ancien jeton d'inscription.
    if (kind === 'member' && credentials.totpEnabledAt) throw AppError.conflict('MFA_ALREADY_ENROLLED', 'Second facteur déjà inscrit : utilisez votre code');
    this.assertNotLocked(credentials);
    const secret = decryptString(credentials.totpPendingSecretEncrypted, this.env.ENCRYPTION_KEY!);
    if (verifyTotp(secret, code) === null) {
      await this.registerFailure(credentials);
      throw new AppError('MFA_CODE_INVALID', 'Code incorrect', 400);
    }
    const backupCodes = Array.from({ length: 10 }, randomBackupCode);
    await this.db
      .update(schema.staffCredentials)
      .set({ totpSecretEncrypted: credentials.totpPendingSecretEncrypted, totpPendingSecretEncrypted: null, totpEnabledAt: new Date(), backupCodeHashes: backupCodes.map((c) => sha256Hex(c)) })
      .where(eq(schema.staffCredentials.userId, userId));
    await this.consumeTransient(jti);
    return { backupCodes, ...(await this.openSession(userId, ctx, ['pwd', 'mfa'], kind === 'member' ? memberOf(data) : null)) };
  }

  /** Deuxième étape : code TOTP (un même code ne sert qu'une fois). */
  async verifyCode(mfaToken: string, code: string, ctx: SessionContext, kind: MfaKind = 'staff') {
    const { subject: userId, jti, data } = await this.tokens.verifyTransientToken(PURPOSES[kind].verify, mfaToken);
    const credentials = await this.credentialsOf(userId);
    if (!credentials?.totpSecretEncrypted) throw new AppError('MFA_NOT_ENROLLED', 'Second facteur non inscrit', 400);
    this.assertNotLocked(credentials);
    const step = verifyTotp(decryptString(credentials.totpSecretEncrypted, this.env.ENCRYPTION_KEY!), code);
    if (step === null || !(await this.store.claimOnce(`totp:${userId}:${step}`, TOTP_REPLAY_TTL_SECONDS))) {
      await this.registerFailure(credentials);
      throw new AppError('MFA_CODE_INVALID', 'Code incorrect ou déjà utilisé', 400);
    }
    await this.consumeTransient(jti);
    return this.openSession(userId, ctx, ['pwd', 'mfa'], kind === 'member' ? memberOf(data) : null);
  }

  /** Deuxième étape avec un code de secours, consommé. */
  async verifyBackupCode(mfaToken: string, backupCode: string, ctx: SessionContext, kind: MfaKind = 'staff') {
    const { subject: userId, jti, data } = await this.tokens.verifyTransientToken(PURPOSES[kind].verify, mfaToken);
    const credentials = await this.credentialsOf(userId);
    if (credentials) this.assertNotLocked(credentials);
    const hashes = (credentials?.backupCodeHashes as string[] | null) ?? [];
    const hash = sha256Hex(backupCode.toLowerCase());
    if (!credentials || !hashes.includes(hash)) {
      if (credentials) await this.registerFailure(credentials);
      throw new AppError('MFA_CODE_INVALID', 'Code de secours incorrect', 400);
    }
    await this.db.update(schema.staffCredentials).set({ backupCodeHashes: hashes.filter((h) => h !== hash) }).where(eq(schema.staffCredentials.userId, userId));
    await this.consumeTransient(jti);
    return this.openSession(userId, ctx, ['pwd', 'mfa', 'backup'], kind === 'member' ? memberOf(data) : null);
  }

  private async consumeTransient(jti: string): Promise<void> {
    const ttl = await this.settings.number('auth.mfa_token_ttl_seconds', 300);
    if (!(await this.store.claimOnce(`transient:${jti}`, ttl + 60))) throw AppError.unauthorized('INVALID_TRANSIENT_TOKEN', 'Jeton de passage déjà utilisé');
  }

  /**
   * Second facteur d'un membre d'organisation (étape 21), proposé dès qu'une permission sensible est nécessaire : jeton
   * de passage pour vérifier son code TOTP, ou pour l'inscrire s'il n'en a pas. Le jeton porte la session à remplacer et
   * les méthodes du premier facteur.
   */
  async startMember(actor: UserActor): Promise<StaffLoginResult> {
    this.users.requireUsable(await this.users.findById(actor.userId));
    const credentials = await this.credentialsOf(actor.userId);
    if (credentials) this.assertNotLocked(credentials);
    // Un membre du personnel inscrit son second facteur par sa propre connexion (mot de passe) : jamais par le code SMS,
    // qui laisserait le détenteur du téléphone choisir le TOTP de son compte du personnel.
    if (credentials?.passwordHash && !credentials.totpEnabledAt) throw AppError.conflict('MFA_STAFF_ENROLLMENT_REQUIRED', 'Inscrivez d\'abord votre second facteur par la connexion du personnel');
    const ttl = await this.settings.number('auth.mfa_token_ttl_seconds', 300);
    const enrolled = Boolean(credentials?.totpEnabledAt);
    const firstFactor = actor.amr.filter((m) => FIRST_FACTORS.has(m));
    const mfaToken = await this.tokens.issueTransientToken(enrolled ? 'member_mfa_verify' : 'member_mfa_enroll', actor.userId, { sid: actor.sessionId, amr: firstFactor }, ttl);
    return { status: enrolled ? 'mfa_required' : 'mfa_enrollment_required', mfaToken };
  }

  private async openSession(userId: string, ctx: SessionContext, amr: string[] = ['pwd', 'mfa'], member: MemberSession | null = null) {
    const user = this.users.requireUsable(await this.users.findById(userId));
    // Membre d'organisation : jamais de rôle du personnel ni de `pwd` ; la session d'avant (code SMS seul) est remplacée.
    const allRoles = await this.users.rolesOf(userId);
    const roles = member ? allRoles.filter((r) => !isStaffRole(r)) : allRoles;
    if (member) amr = [...new Set([...member.firstFactor, ...amr.filter((m) => m !== 'pwd')])];
    // Remise à zéro seulement si aucun verrou n'a été posé entre-temps (essais parallèles) : sinon 423, pas de session.
    const reset = await this.db
      .update(schema.staffCredentials)
      .set({ failedAttempts: 0, lockedUntil: null })
      .where(and(eq(schema.staffCredentials.userId, userId), or(isNull(schema.staffCredentials.lockedUntil), lte(schema.staffCredentials.lockedUntil, new Date()))))
      .returning({ userId: schema.staffCredentials.userId });
    if (!reset.length) {
      const credentials = await this.credentialsOf(userId);
      if (credentials) this.assertNotLocked(credentials);
    }
    const session = await this.tokens.createSession({ userId, deviceId: null, ip: ctx.ip, userAgent: ctx.userAgent, amr });
    const access = await this.tokens.issueAccessToken({ userId, sessionId: session.sessionId, primaryRole: user.primaryRole, roles, amr });
    if (member?.previousSessionId) await this.tokens.revokeSession(member.previousSessionId);
    return {
      tokenType: 'Bearer' as const,
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: session.refreshToken,
      created: false,
      user: await this.users.meViewOf(user, roles),
    };
  }

  /**
   * Administration : crée un membre du personnel, ou met à jour celui qui porte déjà ce courriel (nom, rôles ajoutés,
   * mot de passe remplacé et sessions révoquées). Sert aussi à reprendre l'accès au seul administrateur depuis le
   * serveur. Revue du 2 octobre 2026 (sécurité 6) : jamais de fusion silencieuse avec un autre compte : 409 si le
   * téléphone est celui d'un autre compte, ou si le compte trouvé par courriel a un profil client ou chauffeur ; le
   * téléphone d'un compte existant n'est jamais modifié.
   */
  async createStaff(input: StaffCreate): Promise<UserRow> {
    const email = input.email.toLowerCase();
    const passwordHash = await hashPassword(input.password);
    const primaryRole: UserRole = input.roles.includes('admin') ? 'admin' : input.roles[0]!;
    const { user, existed } = await this.db.transaction(async (tx) => {
      const [byEmail] = await tx.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
      const [byPhone] = await tx.select().from(schema.users).where(eq(schema.users.phone, input.phone)).limit(1);
      if (byEmail && byPhone && byEmail.id !== byPhone.id) throw AppError.conflict('EMAIL_TAKEN', 'Ce courriel et ce téléphone appartiennent à deux comptes différents');
      if (byPhone && !byEmail) throw AppError.conflict('PHONE_TAKEN', 'Ce téléphone appartient à un autre compte');
      let user = byEmail;
      if (user) {
        if (user.status !== 'active') throw AppError.conflict('USER_NOT_ACTIVE', 'Ce compte est bloqué ou supprimé');
        const [client] = await tx.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.userId, user.id)).limit(1);
        const [driver] = await tx.select({ id: schema.drivers.id }).from(schema.drivers).where(eq(schema.drivers.userId, user.id)).limit(1);
        if (client || driver) throw AppError.conflict('USER_HAS_PROFILE', 'Ce courriel est celui d\'un compte client ou chauffeur : un compte du personnel a son propre courriel');
        [user] = await tx
          .update(schema.users)
          .set({ firstName: input.firstName, lastName: input.lastName, primaryRole })
          .where(eq(schema.users.id, user.id))
          .returning();
      } else {
        [user] = await tx
          .insert(schema.users)
          .values({ phone: input.phone, email, firstName: input.firstName, lastName: input.lastName, language: input.language, primaryRole, termsAcceptedAt: new Date(), privacyPolicyVersion: await this.users.currentPrivacyPolicyVersion() })
          .returning();
      }
      for (const role of input.roles) await tx.insert(schema.userRoles).values({ userId: user!.id, role, scope: '*' }).onConflictDoNothing();
      await tx
        .insert(schema.staffCredentials)
        .values({ userId: user!.id, passwordHash })
        .onConflictDoUpdate({ target: schema.staffCredentials.userId, set: { passwordHash, passwordChangedAt: new Date(), failedAttempts: 0, lockedUntil: null } });
      return { user: user!, existed: Boolean(byEmail) };
    });
    // Mot de passe remplacé sur un compte existant : ses sessions ouvertes (ancien mot de passe ou code SMS) sont révoquées.
    if (existed) await this.tokens.revokeAllForUser(user.id);
    return user;
  }

  async setPassword(userId: string, password: string): Promise<void> {
    const credentials = await this.credentialsOf(userId);
    if (!credentials) throw AppError.notFound('STAFF_NOT_FOUND', 'Ce compte n\'est pas un compte du personnel');
    await this.db
      .update(schema.staffCredentials)
      .set({ passwordHash: await hashPassword(password), passwordChangedAt: new Date(), failedAttempts: 0, lockedUntil: null })
      .where(eq(schema.staffCredentials.userId, userId));
    await this.tokens.revokeAllForUser(userId);
  }

  /** Réinitialise le second facteur (téléphone perdu) : la prochaine connexion refait l'inscription. */
  async resetMfa(userId: string): Promise<void> {
    const credentials = await this.credentialsOf(userId);
    if (!credentials) throw AppError.notFound('STAFF_NOT_FOUND', 'Ce compte n\'est pas un compte du personnel');
    await this.db
      .update(schema.staffCredentials)
      .set({ totpSecretEncrypted: null, totpPendingSecretEncrypted: null, totpEnabledAt: null, backupCodeHashes: [], failedAttempts: 0, lockedUntil: null })
      .where(eq(schema.staffCredentials.userId, userId));
    await this.tokens.revokeAllForUser(userId);
  }
}

interface MemberSession {
  previousSessionId: string | null;
  firstFactor: string[];
}

/** Session d'avant et premier facteur, portés par le jeton de passage d'un membre. */
function memberOf(data: Record<string, unknown>): MemberSession {
  const amr = Array.isArray(data['amr']) ? (data['amr'] as unknown[]).filter((m): m is string => typeof m === 'string' && FIRST_FACTORS.has(m)) : [];
  return { previousSessionId: typeof data['sid'] === 'string' ? data['sid'] : null, firstFactor: amr.length ? amr : ['otp'] };
}

export interface SessionContext {
  ip: string | null;
  userAgent: string | null;
}
