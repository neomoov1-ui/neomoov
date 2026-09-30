/**
 * Droits d'un utilisateur (étapes 19 et 20, amendement v1.2). Sur les routes de la plateforme (`platformPermissions`) :
 * permissions de ses anciens rôles (correspondance transitoire) et de ses adhésions actives à l'organisation racine. Dans
 * une organisation cible (`permissionsIn`, routes `/v1/org/:organizationId`) : union des rôles de ses adhésions actives
 * qui couvrent la cible (l'organisation elle-même, ou un ancêtre avec la portée « sous-arbre »), limitée aux modules
 * activés de la cible ; les anciens rôles du personnel n'y donnent rien. Mise en cache 30 secondes par utilisateur (et par
 * cible) ; tout changement d'adhésion ou de rôle appelle `invalidate`. Une permission sensible tenue par une adhésion
 * exige une session à double authentification (`amr` contient `mfa`).
 */
import { schema } from '@neomoov/db';
import { effectivePermissions, inScope, isPermission, PERMISSIONS, type EffectiveMembership, type MembershipScope, type Permission } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { organizationIdOfPath } from '../../common/org-scope.context.js';
import { DB, type Database } from '../../infra/db.module.js';
import type { UserActor } from './actor.js';

const TTL_MS = 30_000;

@Injectable()
export class AccessService {
  private readonly cache = new Map<string, { at: number; permissions: Set<Permission> }>();

  constructor(@Inject(DB) private readonly database: Database) {}

  /** Permissions sur les routes de la plateforme : anciens rôles et adhésions actives à l'organisation racine. */
  async platformPermissions(actor: UserActor, now = new Date()): Promise<Set<Permission>> {
    const mfa = actor.amr.includes('mfa');
    const key = `${actor.userId}:${[...actor.roles].sort().join(',')}:${mfa ? 'mfa' : ''}`;
    const hit = this.cache.get(key);
    if (hit && now.getTime() - hit.at < TTL_MS) return hit.permissions;
    const rows = await this.database.db
      .select({ membershipId: schema.memberships.id, status: schema.memberships.status, expiresAt: schema.memberships.expiresAt, permission: schema.rolePermissions.permissionCode })
      .from(schema.memberships)
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.organizationId))
      .innerJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.memberships.roleId))
      .where(and(eq(schema.memberships.userId, actor.userId), isNull(schema.organizations.parentId)));
    const byMembership = new Map<string, EffectiveMembership & { permissions: string[] }>();
    for (const r of rows) {
      if (!mfa && isPermission(r.permission) && PERMISSIONS[r.permission].sensitive) continue;
      const m = byMembership.get(r.membershipId) ?? { permissions: [], status: r.status as 'active' | 'suspended', expiresAt: r.expiresAt, modules: null };
      m.permissions.push(r.permission);
      byMembership.set(r.membershipId, m);
    }
    const permissions = effectivePermissions(actor.roles, [...byMembership.values()], now);
    this.cache.set(key, { at: now.getTime(), permissions });
    return permissions;
  }

  /**
   * Permissions dans l'organisation cible (chemin matérialisé) : rôles des adhésions actives et non expirées qui couvrent
   * la cible, limités aux modules de la cible (`organization_features` : sans ligne, tout module est admis ; avec des
   * lignes, seuls les modules activés comptent) et à la règle des permissions sensibles. Jamais les anciens rôles.
   */
  async permissionsIn(actor: UserActor, targetPath: string, now = new Date()): Promise<Set<Permission>> {
    const mfa = actor.amr.includes('mfa');
    const key = `${actor.userId}:org:${targetPath}:${mfa ? 'mfa' : ''}`;
    const hit = this.cache.get(key);
    if (hit && now.getTime() - hit.at < TTL_MS) return hit.permissions;
    const [rows, features] = await Promise.all([
      this.database.db
        .select({
          membershipId: schema.memberships.id, status: schema.memberships.status, expiresAt: schema.memberships.expiresAt, scope: schema.memberships.scope,
          path: schema.organizations.path, permission: schema.rolePermissions.permissionCode,
        })
        .from(schema.memberships)
        .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.organizationId))
        .innerJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.memberships.roleId))
        .where(eq(schema.memberships.userId, actor.userId)),
      this.database.db
        .select({ module: schema.organizationFeatures.module, enabled: schema.organizationFeatures.enabled })
        .from(schema.organizationFeatures)
        .where(eq(schema.organizationFeatures.organizationId, organizationIdOfPath(targetPath))),
    ]);
    const modules = features.length ? features.filter((f) => f.enabled).map((f) => f.module) : null;
    const byMembership = new Map<string, EffectiveMembership & { permissions: string[] }>();
    for (const r of rows) {
      if (!inScope(targetPath, r.path, r.scope as MembershipScope)) continue;
      if (!mfa && isPermission(r.permission) && PERMISSIONS[r.permission].sensitive) continue;
      const m = byMembership.get(r.membershipId) ?? { permissions: [], status: r.status as 'active' | 'suspended', expiresAt: r.expiresAt, modules };
      m.permissions.push(r.permission);
      byMembership.set(r.membershipId, m);
    }
    const permissions = effectivePermissions([], [...byMembership.values()], now);
    this.cache.set(key, { at: now.getTime(), permissions });
    return permissions;
  }

  /** Oublie les droits en cache (d'un utilisateur, ou de tous). */
  invalidate(userId?: string): void {
    if (!userId) return this.cache.clear();
    for (const key of this.cache.keys()) if (key.startsWith(`${userId}:`)) this.cache.delete(key);
  }
}
