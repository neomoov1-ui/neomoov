/**
 * Personnel de My Hub (rôles admin, operator, finance, readonly) : courriel et mot de passe argon2id, puis second
 * facteur TOTP obligatoire (inscription au premier accès, codes de secours), verrouillage progressif après cinq échecs.
 * Un membre du personnel connecté par code SMS (comme client) n'obtient jamais ses rôles du personnel (voir AuthService).
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
import { hasStaffRole } from './actor.js';
import { TokensService } from './tokens.service.js';
import { UsersService, type UserRow } from '../users/users.service.js';

type CredentialsRow = typeof schema.staffCredentials.$inferSelect;

/** Un code TOTP accepté ne sert qu'une fois : trois pas de 30 secondes, la fenêtre de tolérance (RFC 6238), pas un réglage métier. */
const TOTP_REPLAY_TTL_SECONDS = 90;

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
    if (!user || !credentials || user.status !== 'active') {
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
  async enroll(mfaToken: string): Promise<{ secret: string; otpauthUri: string; qrSvg: string }> {
    const { subject: userId } = await this.tokens.verifyTransientToken('mfa_enroll', mfaToken);
    const user = this.users.requireUsable(await this.users.findById(userId));
    const secret = generateTotpSecret();
    await this.db.update(schema.staffCredentials).set({ totpPendingSecretEncrypted: encryptString(secret, this.env.ENCRYPTION_KEY!) }).where(eq(schema.staffCredentials.userId, userId));
    const uri = otpauthUri(this.env.MFA_ISSUER, user.email ?? user.phone, secret);
    const qrSvg = await QRCode.toString(uri, { type: 'svg', margin: 1, width: 240 });
    return { secret, otpauthUri: uri, qrSvg };
  }

  /** Confirme l'inscription avec un code valide : active le TOTP, remet dix codes de secours et ouvre la session. */
  async confirmEnrollment(mfaToken: string, code: string, ctx: SessionContext) {
    const { subject: userId, jti } = await this.tokens.verifyTransientToken('mfa_enroll', mfaToken);
    const credentials = await this.credentialsOf(userId);
    if (!credentials?.totpPendingSecretEncrypted) throw new AppError('MFA_ENROLLMENT_NOT_STARTED', 'Commencez par demander le QR d\'inscription', 400);
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
    return { backupCodes, ...(await this.openSession(userId, ctx)) };
  }

  /** Deuxième étape : code TOTP (un même code ne sert qu'une fois). */
  async verifyCode(mfaToken: string, code: string, ctx: SessionContext) {
    const { subject: userId, jti } = await this.tokens.verifyTransientToken('mfa_verify', mfaToken);
    const credentials = await this.credentialsOf(userId);
    if (!credentials?.totpSecretEncrypted) throw new AppError('MFA_NOT_ENROLLED', 'Second facteur non inscrit', 400);
    this.assertNotLocked(credentials);
    const step = verifyTotp(decryptString(credentials.totpSecretEncrypted, this.env.ENCRYPTION_KEY!), code);
    if (step === null || !(await this.store.claimOnce(`totp:${userId}:${step}`, TOTP_REPLAY_TTL_SECONDS))) {
      await this.registerFailure(credentials);
      throw new AppError('MFA_CODE_INVALID', 'Code incorrect ou déjà utilisé', 400);
    }
    await this.consumeTransient(jti);
    return this.openSession(userId, ctx);
  }

  /** Deuxième étape avec un code de secours, consommé. */
  async verifyBackupCode(mfaToken: string, backupCode: string, ctx: SessionContext) {
    const { subject: userId, jti } = await this.tokens.verifyTransientToken('mfa_verify', mfaToken);
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
    return this.openSession(userId, ctx, ['pwd', 'mfa', 'backup']);
  }

  private async consumeTransient(jti: string): Promise<void> {
    const ttl = await this.settings.number('auth.mfa_token_ttl_seconds', 300);
    if (!(await this.store.claimOnce(`transient:${jti}`, ttl + 60))) throw AppError.unauthorized('INVALID_TRANSIENT_TOKEN', 'Jeton de passage déjà utilisé');
  }

  private async openSession(userId: string, ctx: SessionContext, amr: string[] = ['pwd', 'mfa']) {
    const user = this.users.requireUsable(await this.users.findById(userId));
    const roles = await this.users.rolesOf(userId);
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
    return {
      tokenType: 'Bearer' as const,
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: session.refreshToken,
      created: false,
      user: await this.users.meViewOf(user),
    };
  }

  /**
   * Administration : crée un membre du personnel, ou met à jour celui qui porte déjà ce courriel ou ce téléphone (nom,
   * rôles ajoutés, mot de passe remplacé). Sert aussi à reprendre l'accès au seul administrateur depuis le serveur.
   */
  async createStaff(input: StaffCreate): Promise<UserRow> {
    const email = input.email.toLowerCase();
    const passwordHash = await hashPassword(input.password);
    const primaryRole: UserRole = input.roles.includes('admin') ? 'admin' : input.roles[0]!;
    return this.db.transaction(async (tx) => {
      const [byEmail] = await tx.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
      const [byPhone] = await tx.select().from(schema.users).where(eq(schema.users.phone, input.phone)).limit(1);
      if (byEmail && byPhone && byEmail.id !== byPhone.id) throw AppError.conflict('EMAIL_TAKEN', 'Ce courriel et ce téléphone appartiennent à deux comptes différents');
      let user = byEmail ?? byPhone;
      if (user) {
        if (user.status !== 'active') throw AppError.conflict('USER_NOT_ACTIVE', 'Ce compte est bloqué ou supprimé');
        [user] = await tx
          .update(schema.users)
          .set({ email, phone: input.phone, firstName: input.firstName, lastName: input.lastName, primaryRole })
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
      return user!;
    });
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

export interface SessionContext {
  ip: string | null;
  userAgent: string | null;
}
