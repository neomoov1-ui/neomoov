/**
 * Jetons (section 7.1 et 8) : jeton d'accès JWT HS256 de 15 minutes, jeton de rafraîchissement opaque de 30 jours
 * stocké haché dans `sessions`, rotation à chaque usage, détection de réutilisation (toute la famille est révoquée),
 * révocation immédiate des jetons d'accès par un drapeau partagé (Redis, ou mémoire en développement).
 */
import { schema } from '@neomoov/db';
import type { UserRole } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { SignJWT, jwtVerify, errors as joseErrors, type JWTPayload } from 'jose';
import { AppError } from '../../common/app-error.js';
import { randomToken, sha256Hex } from '../../common/crypto.js';
import { RateLimitService } from '../../common/rate-limit.service.js';
import { SettingsService } from '../../common/settings.service.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { DB, type Database } from '../../infra/db.module.js';

const ISSUER = 'neomoov';
const AUDIENCE = 'neomoov-api';

export interface AccessClaims {
  userId: string;
  sessionId: string;
  primaryRole: UserRole;
  roles: UserRole[];
  amr: string[];
}

export type TransientPurpose = 'mfa_verify' | 'mfa_enroll' | 'link';

export interface SessionInput {
  userId: string;
  deviceId: string | null;
  ip: string | null;
  userAgent: string | null;
  /** Méthodes d'authentification (otp, apple, google, pwd, mfa), conservées à la rotation. */
  amr: string[];
  family?: string;
}

export interface IssuedSession {
  sessionId: string;
  family: string;
  refreshToken: string;
  expiresAt: Date;
}

@Injectable()
export class TokensService {
  private readonly accessKey: Uint8Array;
  private readonly transientKey: Uint8Array;

  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_ENV) env: AppEnv,
    private readonly settings: SettingsService,
    private readonly store: RateLimitService,
  ) {
    this.accessKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
    this.transientKey = new TextEncoder().encode(env.JWT_REFRESH_SECRET);
  }

  async accessTtlSeconds(): Promise<number> {
    return this.settings.number('auth.access_token_ttl_seconds', 900);
  }

  async issueAccessToken(claims: AccessClaims): Promise<{ token: string; expiresIn: number }> {
    const expiresIn = await this.accessTtlSeconds();
    const token = await new SignJWT({ sid: claims.sessionId, roles: claims.roles, primaryRole: claims.primaryRole, amr: claims.amr, typ: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(claims.userId)
      .setIssuedAt()
      .setExpirationTime(`${expiresIn}s`)
      .sign(this.accessKey);
    return { token, expiresIn };
  }

  async verifyAccessToken(token: string): Promise<AccessClaims> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.accessKey, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] }));
    } catch (error) {
      if (error instanceof joseErrors.JWTExpired) throw AppError.unauthorized('ACCESS_TOKEN_EXPIRED', 'Jeton d\'accès expiré');
      throw AppError.unauthorized('INVALID_ACCESS_TOKEN', 'Jeton d\'accès invalide');
    }
    if (payload['typ'] !== 'access' || typeof payload.sub !== 'string' || typeof payload['sid'] !== 'string') {
      throw AppError.unauthorized('INVALID_ACCESS_TOKEN', 'Jeton d\'accès invalide');
    }
    if (await this.isSessionRevoked(payload['sid'])) throw AppError.unauthorized('SESSION_REVOKED', 'Session révoquée');
    return {
      userId: payload.sub,
      sessionId: payload['sid'],
      primaryRole: (payload['primaryRole'] as UserRole) ?? 'client',
      roles: Array.isArray(payload['roles']) ? (payload['roles'] as UserRole[]) : [],
      amr: Array.isArray(payload['amr']) ? (payload['amr'] as string[]) : [],
    };
  }

  /** Jeton de passage court (second facteur, liaison Apple ou Google à un téléphone) : jamais un jeton d'accès. */
  async issueTransientToken(purpose: TransientPurpose, subject: string, data: Record<string, unknown>, ttlSeconds: number): Promise<string> {
    return new SignJWT({ ...data, typ: purpose })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(subject)
      .setIssuedAt()
      .setJti(randomToken(12))
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(this.transientKey);
  }

  async verifyTransientToken(purpose: TransientPurpose, token: string): Promise<{ subject: string; jti: string; data: JWTPayload }> {
    try {
      const { payload } = await jwtVerify(token, this.transientKey, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
      if (payload['typ'] !== purpose || typeof payload.sub !== 'string' || typeof payload.jti !== 'string') throw new Error('type');
      return { subject: payload.sub, jti: payload.jti, data: payload };
    } catch {
      throw AppError.unauthorized('INVALID_TRANSIENT_TOKEN', 'Jeton de passage invalide ou expiré : recommencez la connexion');
    }
  }

  /** Crée une session (famille nouvelle ou héritée) et renvoie le jeton de rafraîchissement en clair, une seule fois. */
  async createSession(input: SessionInput): Promise<IssuedSession> {
    const days = await this.settings.number('auth.refresh_token_ttl_days', 30);
    const refreshToken = `rt_${randomToken(32)}`;
    const expiresAt = new Date(Date.now() + days * 86_400_000);
    const family = input.family ?? crypto.randomUUID();
    const [row] = await this.database.db
      .insert(schema.sessions)
      .values({ userId: input.userId, deviceId: input.deviceId, refreshTokenHash: sha256Hex(refreshToken), family, expiresAt, ipAddress: input.ip, userAgent: input.userAgent, amr: input.amr })
      .returning({ id: schema.sessions.id });
    return { sessionId: row!.id, family, refreshToken, expiresAt };
  }

  /** Lecture sans effet : à qui appartient ce jeton de rafraîchissement (pour vérifier le compte avant toute rotation). */
  async findSessionByRefreshToken(refreshToken: string): Promise<{ userId: string; sessionId: string } | null> {
    const [row] = await this.database.db
      .select({ userId: schema.sessions.userId, sessionId: schema.sessions.id })
      .from(schema.sessions)
      .where(eq(schema.sessions.refreshTokenHash, sha256Hex(refreshToken)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Rotation : le jeton présenté est révoqué et remplacé dans la même famille. Un jeton déjà tourné (volé puis rejoué,
   * ou rejoué par le client légitime après un vol) révoque toute la famille : les deux parties doivent se reconnecter.
   */
  async rotateSession(refreshToken: string, ctx: { ip: string | null; userAgent: string | null }): Promise<{ userId: string; deviceId: string | null; amr: string[]; session: IssuedSession }> {
    const now = new Date();
    const [row] = await this.database.db.select().from(schema.sessions).where(eq(schema.sessions.refreshTokenHash, sha256Hex(refreshToken))).limit(1);
    if (!row) throw AppError.unauthorized('INVALID_REFRESH_TOKEN', 'Jeton de rafraîchissement inconnu');
    if (row.revokedAt) {
      await this.revokeFamily(row.family);
      throw AppError.unauthorized('REFRESH_TOKEN_REUSED', 'Jeton de rafraîchissement déjà utilisé : toutes les sessions de cet appareil sont révoquées, reconnectez-vous');
    }
    if (row.expiresAt <= now) throw AppError.unauthorized('REFRESH_TOKEN_EXPIRED', 'Session expirée, reconnectez-vous');
    // Un seul gagnant en cas de rotation concurrente : la ligne n'est révoquée qu'une fois.
    const claimed = await this.database.db
      .update(schema.sessions)
      .set({ revokedAt: now })
      .where(and(eq(schema.sessions.id, row.id), isNull(schema.sessions.revokedAt)))
      .returning({ id: schema.sessions.id });
    if (!claimed.length) {
      await this.revokeFamily(row.family);
      throw AppError.unauthorized('REFRESH_TOKEN_REUSED', 'Jeton de rafraîchissement déjà utilisé : reconnectez-vous');
    }
    await this.flagRevoked(row.id);
    const amr = Array.isArray(row.amr) ? (row.amr as string[]) : [];
    const session = await this.createSession({ userId: row.userId, deviceId: row.deviceId, ip: ctx.ip, userAgent: ctx.userAgent, amr, family: row.family });
    return { userId: row.userId, deviceId: row.deviceId, amr, session };
  }

  /** Déconnexion : révoque la session du jeton présenté (si elle appartient à l'utilisateur), ou toutes ses sessions. */
  async revokeByRefreshToken(refreshToken: string, userId: string): Promise<boolean> {
    const rows = await this.database.db
      .update(schema.sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.sessions.refreshTokenHash, sha256Hex(refreshToken)), eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)))
      .returning({ id: schema.sessions.id });
    await Promise.all(rows.map((r) => this.flagRevoked(r.id)));
    return rows.length > 0;
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.database.db.update(schema.sessions).set({ revokedAt: new Date() }).where(and(eq(schema.sessions.id, sessionId), isNull(schema.sessions.revokedAt)));
    await this.flagRevoked(sessionId);
  }

  async revokeAllForUser(userId: string): Promise<number> {
    const rows = await this.database.db
      .update(schema.sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)))
      .returning({ id: schema.sessions.id });
    await Promise.all(rows.map((r) => this.flagRevoked(r.id)));
    return rows.length;
  }

  private async revokeFamily(family: string): Promise<void> {
    const rows = await this.database.db
      .update(schema.sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.sessions.family, family), isNull(schema.sessions.revokedAt)))
      .returning({ id: schema.sessions.id });
    await Promise.all(rows.map((r) => this.flagRevoked(r.id)));
  }

  /** Le drapeau vit le temps d'un jeton d'accès : au-delà, le jeton est expiré de toute façon. */
  private async flagRevoked(sessionId: string): Promise<void> {
    await this.store.flag(`revoked:${sessionId}`, (await this.accessTtlSeconds()) + 60);
  }

  async isSessionRevoked(sessionId: string): Promise<boolean> {
    return this.store.hasFlag(`revoked:${sessionId}`);
  }
}
