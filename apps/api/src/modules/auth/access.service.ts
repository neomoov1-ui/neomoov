/**
 * Droits d'un utilisateur (étapes 19 et 20, amendement v1.2). Sur les routes de la plateforme (`platformPermissions`) :
 * permissions de ses anciens rôles (correspondance transitoire) et de ses adhésions actives à l'organisation racine. Dans
 * une organisation cible (`permissionsIn`, routes `/v1/org/:organizationId`) : union des rôles de ses adhésions actives
 * qui couvrent la cible (l'organisation elle-même, ou un ancêtre avec la portée « sous-arbre »), limitée aux modules
 * activés de la cible ; les anciens rôles du personnel n'y donnent rien. Mise en cache 30 secondes par utilisateur (et par
 * cible) ; tout changement d'adhésion ou de rôle appelle `invalidate`. Une permission sensible tenue par une adhésion
 * exige une session à double authentification (`amr` contient `mfa`). Finalisation du 3 octobre 2026 : dans une
 * organisation, chaque permission garde ses tenues (`grantsIn`) avec leurs conditions (`role_permissions.conditions` :
 * lecture seule, montant maximal, zones), jugées par la garde des routes d'organisation ; une condition illisible
 * n'accorde rien.
 */
import { schema } from '@neomoov/db';
import {
  effectivePermissions, inScope, isPermission, parseRoleConditions, PERMISSIONS, type EffectiveMembership, type MembershipScope, type Permission, type RoleConditions,
} from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { currentOrgScope, organizationIdOfPath, type OrgScopeContext } from '../../common/org-scope.context.js';
import { DB, type Database } from '../../infra/db.module.js';
import type { UserActor } from './actor.js';

const TTL_MS = 30_000;

/** Permissions d'un utilisateur dans une organisation, et leurs tenues (une par rôle ; `null` : sans condition). */
export interface OrgGrants {
  permissions: Set<Permission>;
  grants: Map<Permission, Array<RoleConditions | null>>;
}

@Injectable()
export class AccessService {
  private readonly cache = new Map<string, { at: number; permissions: Set<Permission>; grants?: Map<Permission, Array<RoleConditions | null>> }>();
  /** Utilisateurs dont les droits ont changé dans une transaction restreinte (`null` : tous), revidés après sa validation. */
  private readonly afterCommit = new WeakMap<OrgScopeContext, Set<string | null>>();

  constructor(@Inject(DB) private readonly database: Database) {}

  /**
   * Permissions sur les routes de la plateforme : anciens rôles et adhésions actives à l'organisation racine. Étape 21 :
   * une permission sensible de la plateforme exige la double authentification du personnel (mot de passe et TOTP) ; le
   * second facteur d'un membre d'organisation (code SMS et TOTP) ne l'ouvre pas.
   */
  async platformPermissions(actor: UserActor, now = new Date()): Promise<Set<Permission>> {
    const mfa = actor.amr.includes('mfa') && actor.amr.includes('pwd');
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
    return (await this.grantsIn(actor, targetPath, now)).permissions;
  }

  /**
   * Comme `permissionsIn`, avec les tenues de chaque permission : une entrée par adhésion qui la donne, ses conditions
   * (`null` sans condition). Une tenue dont la condition est illisible est ignorée (refus par défaut).
   */
  async grantsIn(actor: UserActor, targetPath: string, now = new Date()): Promise<OrgGrants> {
    const mfa = actor.amr.includes('mfa');
    const key = `${actor.userId}:org:${targetPath}:${mfa ? 'mfa' : ''}`;
    const hit = this.cache.get(key);
    if (hit?.grants && now.getTime() - hit.at < TTL_MS) return { permissions: hit.permissions, grants: hit.grants };
    const [rows, features] = await Promise.all([
      this.database.db
        .select({
          membershipId: schema.memberships.id, status: schema.memberships.status, expiresAt: schema.memberships.expiresAt, scope: schema.memberships.scope,
          path: schema.organizations.path, permission: schema.rolePermissions.permissionCode, conditions: schema.rolePermissions.conditions,
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
    // Mêmes règles que `effectivePermissions` (adhésion active et non expirée, modules de la cible), tenue par tenue.
    const grants = new Map<Permission, Array<RoleConditions | null>>();
    for (const r of rows) {
      if (!inScope(targetPath, r.path, r.scope as MembershipScope)) continue;
      if (r.status !== 'active' || (r.expiresAt && r.expiresAt <= now) || !isPermission(r.permission)) continue;
      if (!mfa && PERMISSIONS[r.permission].sensitive) continue;
      if (modules && !modules.includes(PERMISSIONS[r.permission].module)) continue;
      const parsed = parseRoleConditions(r.conditions);
      if (!parsed.ok) continue;
      const held = grants.get(r.permission) ?? [];
      held.push(parsed.conditions);
      grants.set(r.permission, held);
    }
    const permissions = new Set(grants.keys());
    this.cache.set(key, { at: now.getTime(), permissions, grants });
    return { permissions, grants };
  }

  /**
   * Étape 21 : permissions sensibles que les rôles de l'utilisateur lui donnent dans l'organisation cible mais qui
   * n'agissent qu'après la double authentification (vide si la session l'a déjà). My Hub propose alors l'inscription ou
   * la vérification du second facteur.
   */
  async mfaPermissionsIn(actor: UserActor, targetPath: string, now = new Date()): Promise<Permission[]> {
    if (actor.amr.includes('mfa')) return [];
    const [current, withMfa] = await Promise.all([this.permissionsIn(actor, targetPath, now), this.permissionsIn({ ...actor, amr: [...actor.amr, 'mfa'] }, targetPath, now)]);
    return [...withMfa].filter((code) => !current.has(code)).sort();
  }

  /** Modules actifs d'une organisation (`organization_features`) ; `null` : aucune restriction. */
  async modulesOf(organizationId: string): Promise<string[] | null> {
    const features = await this.database.db
      .select({ module: schema.organizationFeatures.module, enabled: schema.organizationFeatures.enabled })
      .from(schema.organizationFeatures)
      .where(eq(schema.organizationFeatures.organizationId, organizationId));
    return features.length ? features.filter((f) => f.enabled).map((f) => f.module) : null;
  }

  /**
   * Oublie les droits en cache (d'un utilisateur, ou de tous). Dans une transaction restreinte (route d'organisation), le
   * changement n'est visible des autres connexions qu'à la validation : une requête concurrente pourrait remettre en
   * cache l'état d'avant pour 30 secondes ; `afterScopedCommit` vide donc le cache une seconde fois après la validation.
   */
  invalidate(userId?: string): void {
    this.forget(userId);
    const scope = currentOrgScope();
    if (!scope) return;
    const users = this.afterCommit.get(scope) ?? new Set<string | null>();
    users.add(userId ?? null);
    this.afterCommit.set(scope, users);
  }

  /** Après la validation (ou l'annulation) d'une transaction restreinte : vide de nouveau le cache des utilisateurs touchés. */
  afterScopedCommit(scope: OrgScopeContext): void {
    const users = this.afterCommit.get(scope);
    if (!users) return;
    this.afterCommit.delete(scope);
    for (const userId of users) this.forget(userId ?? undefined);
  }

  private forget(userId?: string): void {
    if (!userId) return this.cache.clear();
    for (const key of this.cache.keys()) if (key.startsWith(`${userId}:`)) this.cache.delete(key);
  }
}
