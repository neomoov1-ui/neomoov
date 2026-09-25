/**
 * Gardes globales, exécutées dans cet ordre sur chaque route : limitation de débit par adresse IP, authentification et
 * politique (rôles, portées, limite par utilisateur), propriété de la ressource. Politique par défaut : refus.
 */
import { schema } from '@neomoov/db';
import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { Inject } from '@nestjs/common';
import { AppError } from '../../common/app-error.js';
import { RateLimitService } from '../../common/rate-limit.service.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AUTHENTICATED_KEY, OWNS_KEY, PUBLIC_KEY, ROLES_KEY, SCOPES_KEY, isStaffRole, hasStaffRole, requestContext, type Actor, type OwnsOptions, type UserActor } from './actor.js';
import { ApiKeysService, isApiKey } from './api-keys.service.js';
import { TokensService } from './tokens.service.js';
import type { UserRole } from '@neomoov/domain';

function bearer(req: Request): string | null {
  const header = req.header('authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token.trim() : null;
}

function setRateHeaders(res: Response, limit: number, remaining: number, resetIn: number) {
  res.setHeader('X-RateLimit-Limit', String(limit));
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  res.setHeader('X-RateLimit-Reset', String(resetIn));
}

/** Limite par adresse IP, avant toute authentification (protège la base et les fournisseurs). */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly rateLimit: RateLimitService,
    private readonly settings: SettingsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const { ip } = requestContext(req);
    if (!ip) return true;
    const limit = await this.settings.number('ratelimit.per_ip_per_minute', 300);
    const result = await this.rateLimit.hit(`ip:${ip}`, limit, 60);
    setRateHeaders(res, limit, result.remaining, result.resetIn);
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.resetIn));
      throw new AppError('RATE_LIMITED', 'Trop de requêtes, réessayez dans quelques instants', 429, { retryAfter: result.resetIn });
    }
    return true;
  }
}

/** Authentifie l'acteur (jeton d'accès ou clé d'API), applique la politique de la route et la limite par utilisateur. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly apiKeys: ApiKeysService,
    private readonly rateLimit: RateLimitService,
    private readonly settings: SettingsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets) === true;

    const token = bearer(req);
    if (token) {
      try {
        req.actor = await this.resolve(token);
      } catch (error) {
        if (!isPublic) throw error;
      }
    }
    if (isPublic) return true;

    const actor = req.actor;
    if (!actor) throw AppError.unauthorized('UNAUTHENTICATED', 'Jeton d\'accès requis');

    if (actor.kind === 'user') {
      const limit = await this.settings.number('ratelimit.per_user_per_minute', 600);
      const result = await this.rateLimit.hit(`user:${actor.userId}`, limit, 60);
      setRateHeaders(res, limit, result.remaining, result.resetIn);
      if (!result.allowed) {
        res.setHeader('Retry-After', String(result.resetIn));
        throw new AppError('RATE_LIMITED', 'Trop de requêtes, réessayez dans quelques instants', 429, { retryAfter: result.resetIn });
      }
    }

    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, targets) ?? [];
    const scopes = this.reflector.getAllAndOverride<string[]>(SCOPES_KEY, targets) ?? [];
    const authenticated = this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_KEY, targets) === true;

    if (actor.kind === 'service') {
      if (!scopes.length) throw AppError.forbidden('SERVICE_ACCOUNT_NOT_ALLOWED', 'Cette route n\'est pas ouverte aux comptes de service');
      if (!ApiKeysService.hasScope(actor, scopes)) throw AppError.forbidden('INSUFFICIENT_SCOPE', 'Portée insuffisante pour cette clé', { required: scopes });
      return true;
    }
    if (roles.length) {
      if (!AuthGuard.roleAllowed(actor, roles)) throw AppError.forbidden('FORBIDDEN_ROLE', 'Votre rôle ne permet pas cette action', { required: roles });
      return true;
    }
    if (authenticated) return true;
    if (scopes.length) throw AppError.forbidden('SERVICE_ACCOUNT_ONLY', 'Cette route est réservée aux comptes de service');
    throw AppError.forbidden('NO_POLICY', 'Route sans politique d\'accès (refus par défaut)');
  }

  /** Un rôle admis suffit ; `admin` est admis partout où un rôle du personnel l'est. */
  static roleAllowed(actor: UserActor, roles: readonly UserRole[]): boolean {
    if (actor.roles.some((r) => roles.includes(r))) return true;
    return actor.roles.includes('admin') && roles.some(isStaffRole);
  }

  private async resolve(token: string): Promise<Actor> {
    if (isApiKey(token)) return this.apiKeys.authenticate(token);
    const claims = await this.tokens.verifyAccessToken(token);
    return { kind: 'user', userId: claims.userId, sessionId: claims.sessionId, primaryRole: claims.primaryRole, roles: claims.roles, amr: claims.amr };
  }
}

/** La ressource visée appartient à l'utilisateur (le personnel voit tout) ; 404 si elle n'existe pas. */
@Injectable()
export class OwnershipGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DB) private readonly database: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const owns = this.reflector.getAllAndOverride<OwnsOptions | undefined>(OWNS_KEY, [context.getHandler(), context.getClass()]);
    if (!owns) return true;
    const req = context.switchToHttp().getRequest<Request>();
    const actor = req.actor;
    if (!actor || actor.kind !== 'user') throw AppError.forbidden('SERVICE_ACCOUNT_NOT_ALLOWED', 'Cette route est réservée aux utilisateurs');
    if (hasStaffRole(actor.roles)) return true;
    const raw = req.params[owns.param ?? 'id'];
    const id = typeof raw === 'string' ? raw : null;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw AppError.notFound('NOT_FOUND', 'Ressource introuvable');
    const owners = await this.ownersOf(owns.entity, id);
    if (owners === null) throw AppError.notFound('NOT_FOUND', 'Ressource introuvable');
    if (!owners.includes(actor.userId)) throw AppError.forbidden('NOT_OWNER', 'Cette ressource appartient à un autre utilisateur');
    return true;
  }

  private async ownersOf(entity: OwnsOptions['entity'], id: string): Promise<string[] | null> {
    const db = this.database.db;
    switch (entity) {
      case 'user':
        return [id];
      case 'device': {
        const [row] = await db.select({ userId: schema.devices.userId }).from(schema.devices).where(eq(schema.devices.id, id)).limit(1);
        return row ? [row.userId] : null;
      }
      case 'dataRequest': {
        const [row] = await db.select({ userId: schema.dataRequests.userId }).from(schema.dataRequests).where(eq(schema.dataRequests.id, id)).limit(1);
        return row ? [row.userId] : null;
      }
      case 'driverProfile': {
        const [row] = await db.select({ userId: schema.drivers.userId }).from(schema.drivers).where(eq(schema.drivers.id, id)).limit(1);
        return row ? [row.userId] : null;
      }
      case 'ride': {
        const [row] = await db
          .select({ clientUserId: schema.clients.userId, driverUserId: schema.drivers.userId })
          .from(schema.rides)
          .leftJoin(schema.clients, eq(schema.clients.id, schema.rides.clientId))
          .leftJoin(schema.drivers, eq(schema.drivers.id, schema.rides.driverId))
          .where(eq(schema.rides.id, id))
          .limit(1);
        return row ? [row.clientUserId, row.driverUserId].filter((v): v is string => Boolean(v)) : null;
      }
      case 'quote': {
        const [row] = await db
          .select({ clientUserId: schema.clients.userId, createdByUserId: schema.quotes.createdByUserId })
          .from(schema.quotes)
          .leftJoin(schema.clients, eq(schema.clients.id, schema.quotes.clientId))
          .where(eq(schema.quotes.id, id))
          .limit(1);
        return row ? [row.clientUserId, row.createdByUserId].filter((v): v is string => Boolean(v)) : null;
      }
    }
  }
}
