/**
 * Gardes globales, exécutées dans cet ordre sur chaque route : limitation de débit par adresse IP, authentification et
 * politique (rôles, portées, limite par utilisateur), propriété de la ressource, puis, sur les routes d'organisation
 * (étape 20, enregistrée par le module des organisations), adhésion et permissions dans l'organisation. Politique par
 * défaut : refus.
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
import { AuditService } from '../audit/audit.service.js';
import { OrgScopeService } from '../organizations/org-scope.service.js';
import { SupportAccessService, type ActiveSupportAccess } from '../organizations/support-access.service.js';
import { AUTHENTICATED_KEY, CAN_KEY, ORG_SCOPED_KEY, OWNS_KEY, PUBLIC_KEY, ROLES_KEY, SCOPES_KEY, isStaffRole, hasStaffRole, requestContext, type Actor, type OrgScopedOptions, type OwnsOptions, type UserActor } from './actor.js';
import { AccessService } from './access.service.js';
import { ApiKeysService, isApiKey } from './api-keys.service.js';
import { TokensService } from './tokens.service.js';
import { hasAnyPermission, type Permission, type UserRole } from '@neomoov/domain';

const UUID = /^[0-9a-f-]{36}$/i;

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

/** Webhooks des fournisseurs (Stripe, Square, Twilio, Meta, Vapi…), signés et vérifiés par chaque route. */
const WEBHOOK_PATH = /^\/v1\/webhooks\//;

/**
 * Limite par adresse IP, avant toute authentification (protège la base et les fournisseurs). Revue du 2 octobre 2026
 * (sécurité 18) : les webhooks arrivent de quelques adresses partagées, parfois en rafale ; ils ont leur propre compteur
 * et leur propre plafond (`ratelimit.webhooks_per_ip_per_minute`), pour ne pas être refusés avec le trafic ordinaire de
 * la même adresse, ni le bloquer.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly rateLimit: RateLimitService,
    private readonly settings: SettingsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Les gardes HTTP ne s'appliquent pas aux messages Socket.IO (authentifiés à la connexion, dans les passerelles).
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const { ip } = requestContext(req);
    if (!ip) return true;
    const webhook = WEBHOOK_PATH.test(req.path ?? '');
    const limit = webhook ? await this.settings.number('ratelimit.webhooks_per_ip_per_minute', 1_200) : await this.settings.number('ratelimit.per_ip_per_minute', 300);
    const result = await this.rateLimit.hit(`${webhook ? 'webhook-ip' : 'ip'}:${ip}`, limit, 60);
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
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
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

    const can = this.reflector.getAllAndOverride<Permission[]>(CAN_KEY, targets) ?? [];
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, targets) ?? [];
    const scopes = this.reflector.getAllAndOverride<string[]>(SCOPES_KEY, targets) ?? [];
    const authenticated = this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_KEY, targets) === true;

    if (actor.kind === 'service') {
      if (!scopes.length) throw AppError.forbidden('SERVICE_ACCOUNT_NOT_ALLOWED', 'Cette route n\'est pas ouverte aux comptes de service');
      if (!ApiKeysService.hasScope(actor, scopes)) throw AppError.forbidden('INSUFFICIENT_SCOPE', 'Portée insuffisante pour cette clé', { required: scopes });
      return true;
    }
    if (can.length) {
      // Route d'organisation (étape 20) : l'utilisateur est authentifié ; OrgScopeGuard décide avec ses permissions dans l'organisation.
      if (this.reflector.getAllAndOverride<OrgScopedOptions | undefined>(ORG_SCOPED_KEY, targets)) return true;
      // Code d'erreur inchangé pour les applications déjà publiées ; la permission manquante est donnée en détail.
      if (!hasAnyPermission(await this.access.platformPermissions(actor), can)) throw AppError.forbidden('FORBIDDEN_ROLE', 'Votre rôle ne permet pas cette action', { required: can });
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

/** Méthodes de lecture : le personnel y voit toute ressource ; en écriture, il est traité comme tout utilisateur. */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * La ressource visée appartient à l'utilisateur ; 404 si elle n'existe pas. Le personnel voit tout en lecture ; en
 * écriture (revue du 2 octobre 2026, sécurité 1), il ne contourne la propriété que sur une route qui le déclare
 * (`staffMayWrite`, toujours avec sa permission `@Can`) : annuler, partager, écrire ou déclencher un SOS dans la course
 * d'un autre passe par les routes d'administration et leurs permissions (`rides.cancel`, `rides.messages.write`…).
 */
@Injectable()
export class OwnershipGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DB) private readonly database: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const owns = this.reflector.getAllAndOverride<OwnsOptions | undefined>(OWNS_KEY, [context.getHandler(), context.getClass()]);
    if (!owns) return true;
    const req = context.switchToHttp().getRequest<Request>();
    const actor = req.actor;
    if (!actor || actor.kind !== 'user') throw AppError.forbidden('SERVICE_ACCOUNT_NOT_ALLOWED', 'Cette route est réservée aux utilisateurs');
    if (hasStaffRole(actor.roles) && (READ_METHODS.has(req.method) || owns.staffMayWrite === true)) return true;
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

/**
 * Routes d'organisation (étape 20, amendement v1.2 section 4) : compte utilisateur seulement ; l'organisation vient du
 * paramètre de route (ou de l'en-tête `X-Organization-Id`) ; une adhésion active doit la couvrir (`OrgScopeService.scopeFor`) ;
 * `@Can` est vérifié avec les permissions de l'appelant dans cette organisation (jamais ses anciens rôles) ; puis
 * `req.orgScope` est posé pour l'intercepteur (transaction restreinte) et les contrôleurs.
 * Étape 21 : seule exception à l'adhésion, l'accès temporaire du support (`support_access_grants`), approuvé par
 * l'organisation et en cours, pour un membre du personnel qui détient `support.access` ; chaque requête ainsi admise est
 * journalisée dans le journal de l'organisation avec le motif. Une permission refusée faute de double authentification
 * porte `mfaRequired` dans le détail (My Hub propose alors le second facteur).
 */
@Injectable()
export class OrgScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly orgScope: OrgScopeService,
    private readonly access: AccessService,
    private readonly support: SupportAccessService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    const options = this.reflector.getAllAndOverride<OrgScopedOptions | undefined>(ORG_SCOPED_KEY, targets);
    if (!options) return true;
    const req = context.switchToHttp().getRequest<Request>();
    const actor = req.actor;
    if (!actor) throw AppError.unauthorized('UNAUTHENTICATED', 'Jeton d\'accès requis');
    if (actor.kind !== 'user') throw AppError.forbidden('SERVICE_ACCOUNT_NOT_ALLOWED', 'Les routes d\'organisation sont réservées aux utilisateurs');
    const organizationId = OrgScopeGuard.organizationIdOf(req, options);
    if (!organizationId) throw new AppError('ORGANIZATION_REQUIRED', 'Organisation requise (paramètre de route ou en-tête X-Organization-Id)', 400);
    if (!UUID.test(organizationId)) throw AppError.notFound('ORGANIZATION_NOT_FOUND', 'Organisation introuvable');
    let scope: { path: string; organizationId: string };
    let support: ActiveSupportAccess | null = null;
    try {
      scope = await this.orgScope.scopeFor(actor.userId, organizationId);
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'NOT_A_MEMBER') throw error;
      support = await this.support.activeFor(actor, organizationId);
      if (!support) throw error;
      scope = { path: support.path, organizationId };
    }
    const can = this.reflector.getAllAndOverride<Permission[]>(CAN_KEY, targets) ?? [];
    if (!can.length) throw AppError.forbidden('NO_POLICY', 'Route d\'organisation sans permission (refus par défaut)');
    const permissions = support ? support.permissions : await this.access.permissionsIn(actor, scope.path);
    // Même code d'erreur que la plateforme ; la permission manquante est donnée en détail.
    if (!hasAnyPermission(permissions, can)) {
      const mfaRequired = !support && (await this.access.mfaPermissionsIn(actor, scope.path)).some((code) => can.includes(code));
      throw AppError.forbidden('FORBIDDEN_ROLE', 'Votre rôle ne permet pas cette action', { required: can, ...(mfaRequired ? { mfaRequired: true } : {}) });
    }
    req.orgScope = { organizationId: scope.organizationId, path: scope.path, permissions, ...(support ? { support: { grantId: support.grantId, reason: support.reason, endsAt: support.endsAt } } : {}) };
    if (support) {
      const ctx = requestContext(req);
      const route = (req.route as { path?: string } | undefined)?.path ?? req.path;
      await this.audit.write(
        [{ action: 'support_access.used', entity: 'support_access_grants', entityId: support.grantId, after: { reason: support.reason, method: req.method, route, endsAt: support.endsAt } }],
        { actor, ip: ctx.ip, correlationId: ctx.correlationId, organizationId: scope.organizationId },
      );
    }
    return true;
  }

  /** Identifiant d'organisation de la requête : le paramètre de route, sinon l'en-tête. */
  static organizationIdOf(req: Request, options: OrgScopedOptions): string | null {
    const fromParam = req.params[options.param];
    if (typeof fromParam === 'string' && fromParam) return fromParam;
    const fromHeader = req.header(options.header)?.trim();
    return fromHeader || null;
  }
}
