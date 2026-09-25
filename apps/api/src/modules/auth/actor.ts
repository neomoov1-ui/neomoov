/**
 * Acteur d'une requête (utilisateur authentifié ou compte de service) et décorateurs de politique d'accès.
 * Politique par défaut : refus. Chaque route déclare `@Public()`, `@Authenticated()`, `@Roles(...)` ou `@Scopes(...)`,
 * ce que `assertRoutePolicies` vérifie au démarrage (prompt 03, section 8 : autorisation par rôle et par ressource).
 */
import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import { STAFF_ROLES, type UserRole } from '@neomoov/domain';
import type { Request } from 'express';
import { AppError } from '../../common/app-error.js';

export interface UserActor {
  kind: 'user';
  userId: string;
  sessionId: string;
  primaryRole: UserRole;
  roles: UserRole[];
  /** Méthodes d'authentification du jeton : `otp`, `apple`, `google`, `pwd`, `mfa`. */
  amr: string[];
}

export interface ServiceActor {
  kind: 'service';
  apiKeyId: string;
  name: string;
  scopes: string[];
  agentCode: string | null;
}

export type Actor = UserActor | ServiceActor;

declare module 'express' {
  interface Request {
    actor?: Actor;
  }
}

export const PUBLIC_KEY = 'neomoov:public';
export const AUTHENTICATED_KEY = 'neomoov:authenticated';
export const ROLES_KEY = 'neomoov:roles';
export const SCOPES_KEY = 'neomoov:scopes';
export const OWNS_KEY = 'neomoov:owns';
export const AUDIT_KEY = 'neomoov:audit';

/** Route sans authentification (santé, demande de code SMS, connexion). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
/** Tout utilisateur authentifié, quel que soit son rôle (profil, appareils, consentements). */
export const Authenticated = () => SetMetadata(AUTHENTICATED_KEY, true);
/** Rôles admis. Un `admin` est admis sur toute route ouverte à un rôle du personnel. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
/** Portées admises pour les comptes de service (clés d'API) ; une route sans `@Scopes` leur est fermée. */
export const Scopes = (...scopes: string[]) => SetMetadata(SCOPES_KEY, scopes);

export type OwnedEntity = 'user' | 'device' | 'dataRequest' | 'driverProfile' | 'ride';
export interface OwnsOptions {
  entity: OwnedEntity;
  /** Paramètre de route qui porte l'identifiant (défaut : `id`). */
  param?: string;
}
/** La ressource identifiée par le paramètre doit appartenir à l'utilisateur ; le personnel voit tout. */
export const Owns = (entity: OwnedEntity, param = 'id') => SetMetadata(OWNS_KEY, { entity, param } satisfies OwnsOptions);

export interface AuditOptions {
  action: string;
  entity: string;
  /** Paramètre de route ou champ de la réponse qui porte l'identifiant de l'entité (défaut : `id`). */
  idFrom?: string;
}
/** Journalise la mutation dans `audit_log` avec ce nom d'action (l'intercepteur le fait aussi sans décorateur, avec `<méthode> <route>`). */
export const Audit = (action: string, entity: string, idFrom?: string) => SetMetadata(AUDIT_KEY, { action, entity, ...(idFrom ? { idFrom } : {}) } satisfies AuditOptions);

export const STAFF_READ_ROLES: UserRole[] = [...STAFF_ROLES];
export const STAFF_WRITE_ROLES: UserRole[] = ['admin', 'operator'];
export const STAFF_FINANCE_ROLES: UserRole[] = ['admin', 'finance'];

export function isStaffRole(role: UserRole): boolean {
  return (STAFF_ROLES as readonly string[]).includes(role);
}

export function hasStaffRole(roles: readonly UserRole[]): boolean {
  return roles.some(isStaffRole);
}

export function actorOf(req: Request): Actor | undefined {
  return req.actor;
}

/** Acteur courant (utilisateur ou service) ; `undefined` sur une route publique sans jeton. */
export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor | undefined => actorOf(ctx.switchToHttp().getRequest<Request>()));

/** Utilisateur courant ; refuse un compte de service. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): UserActor => {
  const actor = actorOf(ctx.switchToHttp().getRequest<Request>());
  if (!actor) throw AppError.unauthorized('UNAUTHENTICATED', 'Jeton d\'accès requis');
  if (actor.kind !== 'user') throw AppError.forbidden('SERVICE_ACCOUNT_NOT_ALLOWED', 'Cette route est réservée aux utilisateurs');
  return actor;
});

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
  language: 'fr' | 'en';
  correlationId: string | null;
}

/** Adresse IP, agent utilisateur et langue (en-tête Accept-Language, fr par défaut) de la requête. */
export function requestContext(req: Request): RequestContext {
  const accept = (req.header('accept-language') ?? '').toLowerCase();
  const language: 'fr' | 'en' = /^(en|en-)/.test(accept.split(',')[0]?.trim() ?? '') ? 'en' : 'fr';
  const ip = req.ip ?? req.socket?.remoteAddress ?? null;
  return {
    ip: ip ? ip.replace(/^::ffff:/, '') : null,
    userAgent: (req.header('user-agent') ?? '').slice(0, 300) || null,
    language,
    correlationId: (res(req)?.getHeader('x-correlation-id') as string | undefined) ?? null,
  };
}

function res(req: Request) {
  return req.res;
}

export const ReqCtx = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestContext => requestContext(ctx.switchToHttp().getRequest<Request>()));
