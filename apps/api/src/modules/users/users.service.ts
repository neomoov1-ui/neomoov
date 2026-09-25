/**
 * Utilisateurs : lecture d'un compte avec ses rôles, vue `MeView` (GET /v1/me), appareils, création d'un compte client
 * à la première connexion (section 4.1). Les règles d'authentification sont dans `auth/`.
 */
import { schema } from '@neomoov/db';
import type { DeviceInput, Language, MeView, UserRole } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { AppError } from '../../common/app-error.js';
import { sha256Hex } from '../../common/crypto.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';

/** Numéro de remplacement d'un compte supprimé : indicatif 999 (non attribué) et 11 chiffres dérivés de l'identifiant (5.15). */
export function anonymizedPhone(userId: string): string {
  const digits = BigInt(`0x${sha256Hex(userId).slice(0, 16)}`).toString().padStart(11, '0').slice(-11);
  return `+999${digits}`;
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}

export type UserRow = typeof schema.users.$inferSelect;
export type DeviceRow = typeof schema.devices.$inferSelect;

export interface NewClientAccount {
  phone: string;
  language: Language;
  privacyPolicyVersion: string;
  email?: string | null;
  appleId?: string | null;
  googleId?: string | null;
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly database: Database,
    private readonly settings: SettingsService,
  ) {}

  get db() {
    return this.database.db;
  }

  async findById(id: string): Promise<UserRow | null> {
    const [row] = await this.db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
    return row ?? null;
  }

  async findByPhone(phone: string): Promise<UserRow | null> {
    const [row] = await this.db.select().from(schema.users).where(eq(schema.users.phone, phone)).limit(1);
    return row ?? null;
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const [row] = await this.db.select().from(schema.users).where(eq(schema.users.email, email.toLowerCase())).limit(1);
    return row ?? null;
  }

  async findBySocialId(provider: 'apple' | 'google', subject: string): Promise<UserRow | null> {
    const column = provider === 'apple' ? schema.users.appleId : schema.users.googleId;
    const [row] = await this.db.select().from(schema.users).where(eq(column, subject)).limit(1);
    return row ?? null;
  }

  async rolesOf(userId: string): Promise<UserRole[]> {
    const rows = await this.db.select({ role: schema.userRoles.role }).from(schema.userRoles).where(eq(schema.userRoles.userId, userId));
    return [...new Set(rows.map((r) => r.role))];
  }

  async grantRole(userId: string, role: UserRole, scope = '*'): Promise<void> {
    await this.db.insert(schema.userRoles).values({ userId, role, scope }).onConflictDoNothing();
  }

  /** Refuse un compte bloqué ou supprimé ; renvoie l'utilisateur sinon. */
  requireUsable(user: UserRow | null): UserRow {
    if (!user || user.status === 'deleted' || user.deletedAt) throw AppError.notFound('USER_NOT_FOUND', 'Compte introuvable');
    if (user.status === 'blocked') throw AppError.forbidden('ACCOUNT_BLOCKED', 'Ce compte est bloqué. Contactez le service à la clientèle.');
    return user;
  }

  /** Compte supprimé dont le numéro n'a pas encore été anonymisé par le worker : le numéro est libéré tout de suite. */
  async releasePhone(userId: string): Promise<void> {
    await this.db.update(schema.users).set({ phone: anonymizedPhone(userId), status: 'deleted' }).where(and(eq(schema.users.id, userId), eq(schema.users.status, 'deleted')));
  }

  /** Création d'un compte client (téléphone vérifié par code SMS) avec son profil client et son rôle. */
  async createClientAccount(input: NewClientAccount): Promise<UserRow> {
    try {
      return await this.insertClientAccount(input);
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('ACCOUNT_CONFLICT', 'Ce téléphone ou ce courriel est déjà utilisé par un autre compte');
      throw error;
    }
  }

  private async insertClientAccount(input: NewClientAccount): Promise<UserRow> {
    return this.db.transaction(async (tx) => {
      const [user] = await tx
        .insert(schema.users)
        .values({
          phone: input.phone,
          email: input.email ?? null,
          language: input.language,
          primaryRole: 'client',
          appleId: input.appleId ?? null,
          googleId: input.googleId ?? null,
          termsAcceptedAt: new Date(),
          privacyPolicyVersion: input.privacyPolicyVersion,
        })
        .returning();
      await tx.insert(schema.userRoles).values({ userId: user!.id, role: 'client', scope: '*' });
      await tx.insert(schema.clients).values({ userId: user!.id });
      return user!;
    });
  }

  async linkSocialId(userId: string, provider: 'apple' | 'google', subject: string, email: string | null): Promise<void> {
    const user = await this.findById(userId);
    await this.db
      .update(schema.users)
      .set({ ...(provider === 'apple' ? { appleId: subject } : { googleId: subject }), ...(email && !user?.email ? { email } : {}) })
      .where(eq(schema.users.id, userId));
  }

  /**
   * Enregistre ou met à jour un appareil : par jeton push quand il y en a un (un jeton réattribué à un autre compte suit
   * ce compte), sinon un seul appareil sans jeton par utilisateur et par plateforme (web, notifications refusées).
   */
  async upsertDevice(userId: string, input: DeviceInput): Promise<DeviceRow> {
    const now = new Date();
    const [existing] = input.pushToken
      ? await this.db.select().from(schema.devices).where(eq(schema.devices.pushToken, input.pushToken)).limit(1)
      : await this.db
          .select()
          .from(schema.devices)
          .where(and(eq(schema.devices.userId, userId), eq(schema.devices.platform, input.platform), isNull(schema.devices.pushToken)))
          .limit(1);
    if (existing) {
      const [updated] = await this.db
        .update(schema.devices)
        .set({ userId, platform: input.platform, appVersion: input.appVersion ?? existing.appVersion, lastSeenAt: now })
        .where(eq(schema.devices.id, existing.id))
        .returning();
      return updated!;
    }
    const [created] = await this.db
      .insert(schema.devices)
      .values({ userId, platform: input.platform, pushToken: input.pushToken ?? null, appVersion: input.appVersion ?? null, lastSeenAt: now })
      .returning();
    return created!;
  }

  async listDevices(userId: string): Promise<DeviceRow[]> {
    return this.db.select().from(schema.devices).where(eq(schema.devices.userId, userId));
  }

  async deleteDevice(userId: string, deviceId: string): Promise<boolean> {
    const rows = await this.db.delete(schema.devices).where(and(eq(schema.devices.id, deviceId), eq(schema.devices.userId, userId))).returning({ id: schema.devices.id });
    return rows.length > 0;
  }

  async currentPrivacyPolicyVersion(): Promise<string> {
    return this.settings.string('legal.privacy_policy_version', '1.0');
  }

  async meView(userId: string, sessionRoles?: UserRole[]): Promise<MeView> {
    const user = await this.findById(userId);
    if (!user) throw AppError.notFound('USER_NOT_FOUND', 'Compte introuvable');
    return this.meViewOf(user, sessionRoles);
  }

  /**
   * `roles` : ceux de la session quand ils sont fournis (un membre du personnel connecté par code SMS n'y voit pas ses
   * rôles du personnel, qui exigent le second facteur), sinon tous les rôles du compte.
   */
  async meViewOf(user: UserRow, sessionRoles?: UserRole[]): Promise<MeView> {
    const [roles, currentVersion, [credentials]] = await Promise.all([
      sessionRoles ? Promise.resolve(sessionRoles) : this.rolesOf(user.id),
      this.currentPrivacyPolicyVersion(),
      this.db.select({ totpEnabledAt: schema.staffCredentials.totpEnabledAt }).from(schema.staffCredentials).where(eq(schema.staffCredentials.userId, user.id)).limit(1),
    ]);
    const linkedProviders: Array<'apple' | 'google'> = [];
    if (user.appleId) linkedProviders.push('apple');
    if (user.googleId) linkedProviders.push('google');
    return {
      id: user.id,
      phone: user.phone,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      language: user.language,
      primaryRole: user.primaryRole,
      roles,
      status: user.status,
      termsAcceptedAt: user.termsAcceptedAt?.toISOString() ?? null,
      privacyPolicyVersion: user.privacyPolicyVersion,
      privacyPolicyCurrentVersion: currentVersion,
      privacyPolicyAccepted: user.privacyPolicyVersion === currentVersion,
      linkedProviders,
      mfaEnabled: Boolean(credentials?.totpEnabledAt),
      createdAt: user.createdAt.toISOString(),
    };
  }

  static deviceView(d: DeviceRow) {
    return {
      id: d.id,
      platform: d.platform as 'ios' | 'android' | 'web',
      pushToken: d.pushToken,
      appVersion: d.appVersion,
      lastSeenAt: d.lastSeenAt.toISOString(),
      createdAt: d.createdAt.toISOString(),
    };
  }
}
