/**
 * Droits d'un utilisateur (étape 19, amendement v1.2) : permissions de ses anciens rôles (correspondance transitoire) et
 * de ses adhésions actives. Sur les routes de la plateforme, seules comptent les adhésions à la racine : l'isolation des
 * données par organisation arrive à l'étape 20, d'ici là un membre d'une organisation cliente n'y a aucun droit. Mise en
 * cache 30 secondes par utilisateur ; tout changement d'adhésion ou de rôle appelle `invalidate`.
 */
import { schema } from '@neomoov/db';
import { effectivePermissions, type EffectiveMembership, type Permission } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DB, type Database } from '../../infra/db.module.js';
import type { UserActor } from './actor.js';

const TTL_MS = 30_000;

@Injectable()
export class AccessService {
  private readonly cache = new Map<string, { at: number; permissions: Set<Permission> }>();

  constructor(@Inject(DB) private readonly database: Database) {}

  /** Permissions sur les routes de la plateforme : anciens rôles et adhésions actives à l'organisation racine. */
  async platformPermissions(actor: UserActor, now = new Date()): Promise<Set<Permission>> {
    const key = `${actor.userId}:${[...actor.roles].sort().join(',')}`;
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
      const m = byMembership.get(r.membershipId) ?? { permissions: [], status: r.status as 'active' | 'suspended', expiresAt: r.expiresAt, modules: null };
      m.permissions.push(r.permission);
      byMembership.set(r.membershipId, m);
    }
    const permissions = effectivePermissions(actor.roles, [...byMembership.values()], now);
    this.cache.set(key, { at: now.getTime(), permissions });
    return permissions;
  }

  /** Oublie les droits en cache (d'un utilisateur, ou de tous). */
  invalidate(userId?: string): void {
    if (!userId) return this.cache.clear();
    for (const key of this.cache.keys()) if (key.startsWith(`${userId}:`)) this.cache.delete(key);
  }
}
