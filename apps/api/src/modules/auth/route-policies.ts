/**
 * Inventaire des routes et de leur politique d'accès, à partir des métadonnées NestJS. Sert au contrôle de démarrage
 * (toute route déclare une politique, sinon l'API refuse de démarrer) et au test d'autorisation qui parcourt chaque
 * endpoint (prompt 03 : « un rôle non autorisé reçoit 403 »).
 */
import type { INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { LEGACY_ROLE_PERMISSIONS, type UserRole } from '@neomoov/domain';
import { AUTHENTICATED_KEY, CAN_KEY, ORG_SCOPED_KEY, OWNS_KEY, PUBLIC_KEY, ROLES_KEY, SCOPES_KEY, type OrgScopedOptions, type OwnsOptions } from './actor.js';

/** Anciens rôles, dans l'ordre d'affichage : ceux dont la correspondance contient une des permissions de la route. */
const LEGACY_ORDER: UserRole[] = ['admin', 'operator', 'finance', 'readonly', 'agent', 'driver'];
function legacyRolesFor(permissions: readonly string[]): UserRole[] {
  return LEGACY_ORDER.filter((role) => (LEGACY_ROLE_PERMISSIONS[role] ?? []).some((code) => permissions.includes(code)));
}

export interface RoutePolicy {
  method: string;
  /** Chemin complet avec le préfixe global, par exemple `/v1/auth/otp/request`. */
  path: string;
  controller: string;
  handler: string;
  public: boolean;
  authenticated: boolean;
  /** Permissions exigées (`@Can`), une seule suffit. */
  permissions: string[];
  /** Rôles admis : ceux de `@Roles`, ou les anciens rôles qui portent une des permissions de `@Can` ; aucun sur une route d'organisation. */
  roles: UserRole[];
  scopes: string[];
  owns: OwnsOptions | null;
  /** Route d'organisation (étape 20, `@OrgScoped`) : permissions évaluées dans l'organisation visée, jamais par les anciens rôles. */
  orgScoped: boolean;
}

function joinPath(...parts: Array<string | undefined>): string {
  const joined = parts
    .filter((p): p is string => typeof p === 'string')
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
  return `/${joined}`;
}

export function listRoutePolicies(app: INestApplication, globalPrefix = 'v1'): RoutePolicy[] {
  const discovery = app.get(DiscoveryService);
  const reflector = app.get(Reflector);
  const scanner = new MetadataScanner();
  const policies: RoutePolicy[] = [];
  for (const wrapper of discovery.getControllers()) {
    const { instance, metatype } = wrapper;
    if (!instance || !metatype) continue;
    const controllerPath = Reflect.getMetadata(PATH_METADATA, metatype) as string | string[] | undefined;
    const prototype = Object.getPrototypeOf(instance) as Record<string, unknown>;
    for (const name of scanner.getAllMethodNames(prototype)) {
      const handler = prototype[name] as ((...args: unknown[]) => unknown) | undefined;
      if (typeof handler !== 'function') continue;
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (path === undefined || method === undefined) continue;
      const targets = [handler, metatype];
      const basePaths = Array.isArray(controllerPath) ? controllerPath : [controllerPath];
      const paths = Array.isArray(path) ? path : [path];
      for (const base of basePaths) {
        for (const p of paths) {
          const permissions = reflector.getAllAndOverride<string[]>(CAN_KEY, targets) ?? [];
          const orgScoped = reflector.getAllAndOverride<OrgScopedOptions | undefined>(ORG_SCOPED_KEY, targets) !== undefined;
          policies.push({
            method: RequestMethod[method] ?? String(method),
            path: joinPath(globalPrefix, base, p),
            controller: metatype.name,
            handler: name,
            public: reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets) === true,
            authenticated: reflector.getAllAndOverride<boolean>(AUTHENTICATED_KEY, targets) === true,
            permissions,
            roles: orgScoped ? [] : permissions.length ? legacyRolesFor(permissions) : (reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, targets) ?? []),
            scopes: reflector.getAllAndOverride<string[]>(SCOPES_KEY, targets) ?? [],
            owns: reflector.getAllAndOverride<OwnsOptions | undefined>(OWNS_KEY, targets) ?? null,
            orgScoped,
          });
        }
      }
    }
  }
  return policies.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

const routeList = (routes: RoutePolicy[]) => routes.map((p) => `${p.method} ${p.path} (${p.controller}.${p.handler})`).join(', ');

/**
 * Refus par défaut : une route sans `@Public`, `@Authenticated`, `@Can`, `@Roles` ni `@Scopes` empêche le démarrage ; de
 * même une route d'organisation (`@OrgScoped`, ou tout chemin sous `/v1/org/`) sans `@Can` (étape 20).
 */
export function assertRoutePolicies(app: INestApplication, globalPrefix = 'v1'): RoutePolicy[] {
  const policies = listRoutePolicies(app, globalPrefix);
  const missing = policies.filter((p) => !p.public && !p.authenticated && !p.permissions.length && !p.roles.length && !p.scopes.length);
  if (missing.length) throw new Error(`Routes sans politique d'accès (refus par défaut) : ${routeList(missing)}`);
  const orgPrefix = `/${globalPrefix}/org/`;
  const unscoped = policies.filter((p) => (p.orgScoped && !p.permissions.length) || (p.path.startsWith(orgPrefix) && !p.orgScoped));
  if (unscoped.length) throw new Error(`Routes d'organisation sans @OrgScoped ou sans @Can (refus par défaut) : ${routeList(unscoped)}`);
  // Revue du 2 octobre 2026 (sécurité 1) : une route @Owns ouverte en écriture au personnel exige sa permission.
  const staffWrites = policies.filter((p) => p.owns?.staffMayWrite && !p.permissions.length);
  if (staffWrites.length) throw new Error(`Routes @Owns ouvertes en écriture au personnel sans permission @Can : ${routeList(staffWrites)}`);
  return policies;
}
