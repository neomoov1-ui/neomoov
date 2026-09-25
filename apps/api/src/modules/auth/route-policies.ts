/**
 * Inventaire des routes et de leur politique d'accès, à partir des métadonnées NestJS. Sert au contrôle de démarrage
 * (toute route déclare une politique, sinon l'API refuse de démarrer) et au test d'autorisation qui parcourt chaque
 * endpoint (prompt 03 : « un rôle non autorisé reçoit 403 »).
 */
import type { INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import type { UserRole } from '@neomoov/domain';
import { AUTHENTICATED_KEY, OWNS_KEY, PUBLIC_KEY, ROLES_KEY, SCOPES_KEY, type OwnsOptions } from './actor.js';

export interface RoutePolicy {
  method: string;
  /** Chemin complet avec le préfixe global, par exemple `/v1/auth/otp/request`. */
  path: string;
  controller: string;
  handler: string;
  public: boolean;
  authenticated: boolean;
  roles: UserRole[];
  scopes: string[];
  owns: OwnsOptions | null;
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
          policies.push({
            method: RequestMethod[method] ?? String(method),
            path: joinPath(globalPrefix, base, p),
            controller: metatype.name,
            handler: name,
            public: reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets) === true,
            authenticated: reflector.getAllAndOverride<boolean>(AUTHENTICATED_KEY, targets) === true,
            roles: reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, targets) ?? [],
            scopes: reflector.getAllAndOverride<string[]>(SCOPES_KEY, targets) ?? [],
            owns: reflector.getAllAndOverride<OwnsOptions | undefined>(OWNS_KEY, targets) ?? null,
          });
        }
      }
    }
  }
  return policies.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

/** Refus par défaut : une route sans `@Public`, `@Authenticated`, `@Roles` ni `@Scopes` empêche le démarrage. */
export function assertRoutePolicies(app: INestApplication): RoutePolicy[] {
  const policies = listRoutePolicies(app);
  const missing = policies.filter((p) => !p.public && !p.authenticated && !p.roles.length && !p.scopes.length);
  if (missing.length) {
    const list = missing.map((p) => `${p.method} ${p.path} (${p.controller}.${p.handler})`).join(', ');
    throw new Error(`Routes sans politique d'accès (refus par défaut) : ${list}`);
  }
  return policies;
}
