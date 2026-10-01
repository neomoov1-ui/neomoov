/**
 * Étape 21 (amendement v1.2, section 3.2, « se connecter en tant que ») : accès temporaire du support de la plateforme
 * à une organisation cliente. Le personnel qui détient `support.access` demande un accès (motif, durée) ; les
 * propriétaires de l'organisation en sont avisés par texto ; un membre qui détient `members.manage` l'approuve, le refuse
 * ou le révoque depuis My Hub. Pendant l'accès en cours, la garde des routes d'organisation laisse passer ce membre du
 * personnel avec ses permissions de la plateforme limitées à celles d'une organisation cliente, et journalise chaque
 * requête dans le journal de l'organisation (motif compris). Une demande sans réponse et un accès échu sont expirés.
 */
import { schema } from '@neomoov/db';
import {
  supportAccessPermissions, supportGrantActive, supportGrantStatus, supportGrantTransition, OWNER_ROLE_CODE,
  type Permission, type SupportAccessAction, type SupportAccessGrantView, type SupportAccessRequest, type SupportAccessStatus,
} from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, like, lte, or, sql, type SQL } from 'drizzle-orm';
import { AppError } from '../../common/app-error.js';
import { afterScopeCommit, orgScopeStorage } from '../../common/org-scope.context.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AccessService } from '../auth/access.service.js';
import type { OrgScope, UserActor } from '../auth/actor.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';

type GrantRow = typeof schema.supportAccessGrants.$inferSelect;

const PAST: Record<SupportAccessAction, string> = { approve: 'approved', deny: 'denied', revoke: 'revoked' };

export interface ActiveSupportAccess {
  grantId: string;
  reason: string;
  endsAt: string;
  /** Chemin de l'organisation visée (le sous-arbre de la transaction restreinte). */
  path: string;
  permissions: Set<Permission>;
}

@Injectable()
export class SupportAccessService {
  constructor(
    @Inject(DB) private readonly database: Database,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly outbox: NotificationsOutbox,
  ) {}

  private get db() {
    return this.database.db;
  }

  private async requestTtlMs(): Promise<number> {
    return (await this.settings.number('support.request_ttl_hours', 24)) * 3_600_000;
  }

  /** Statut effectif enregistré : accès échus et demandes restées sans réponse passent à « expiré » (lignes visibles seulement). */
  private async expireDue(now: Date): Promise<void> {
    const ttl = await this.requestTtlMs();
    const g = schema.supportAccessGrants;
    await this.db
      .update(g)
      .set({ status: 'expired' })
      .where(or(and(eq(g.status, 'approved'), lte(g.endsAt, now)), and(eq(g.status, 'requested'), lte(g.createdAt, new Date(now.getTime() - ttl)))));
  }

  /** Vues : nom de l'organisation et du demandeur. Les noms du personnel sont lus par le pool de la plateforme (hors politique). */
  private async views(rows: GrantRow[], now: Date): Promise<SupportAccessGrantView[]> {
    if (!rows.length) return [];
    const ttl = await this.requestTtlMs();
    const orgIds = [...new Set(rows.map((r) => r.organizationId))];
    const userIds = [...new Set(rows.map((r) => r.requestedByUserId))];
    const orgs = await this.db.select({ id: schema.organizations.id, name: schema.organizations.name }).from(schema.organizations).where(inArray(schema.organizations.id, orgIds));
    const users = await orgScopeStorage.exit(async () =>
      this.database.db.select({ id: schema.users.id, firstName: schema.users.firstName, lastName: schema.users.lastName }).from(schema.users).where(inArray(schema.users.id, userIds)),
    );
    return rows.map((r) => {
      const user = users.find((u) => u.id === r.requestedByUserId);
      const state = { status: r.status as SupportAccessStatus, createdAt: r.createdAt, startsAt: r.startsAt, endsAt: r.endsAt };
      return {
        id: r.id, organizationId: r.organizationId, organizationName: orgs.find((o) => o.id === r.organizationId)?.name ?? '', requestedByUserId: r.requestedByUserId,
        requestedByName: [user?.firstName, user?.lastName].filter(Boolean).join(' ') || null, reason: r.reason, durationMinutes: r.durationMinutes,
        status: supportGrantStatus(state, now, ttl), approvedByUserId: r.approvedByUserId, startsAt: r.startsAt?.toISOString() ?? null, endsAt: r.endsAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(), active: supportGrantActive(state, now),
      };
    });
  }

  // --- Plateforme ---

  /** Demande d'accès par le personnel (`support.access`) : motif et durée ; les propriétaires de l'organisation sont avisés. */
  async request(organizationId: string, input: SupportAccessRequest, actor: UserActor, now = new Date()): Promise<SupportAccessGrantView> {
    const [org] = await this.db.select().from(schema.organizations).where(eq(schema.organizations.id, organizationId)).limit(1);
    if (!org) throw AppError.notFound('ORGANIZATION_NOT_FOUND', 'Organisation introuvable');
    if (org.parentId === null) throw new AppError('SUPPORT_ACCESS_NOT_NEEDED', 'La plateforme n\'a pas besoin d\'un accès du support', 400);
    const [row] = await this.db.insert(schema.supportAccessGrants).values({ organizationId: org.id, requestedByUserId: actor.userId, reason: input.reason, durationMinutes: input.durationMinutes }).returning();
    this.audit.record({ action: 'support_access.requested', entity: 'support_access_grants', entityId: row!.id, organizationId: org.id, after: { reason: input.reason, durationMinutes: input.durationMinutes } });
    const owners = await this.db
      .select({ userId: schema.memberships.userId })
      .from(schema.memberships)
      .innerJoin(schema.roles, eq(schema.roles.id, schema.memberships.roleId))
      .where(and(eq(schema.memberships.organizationId, org.id), eq(schema.memberships.status, 'active'), eq(schema.roles.code, OWNER_ROLE_CODE), isNull(schema.roles.organizationId)));
    await afterScopeCommit(() => this.outbox.queue(owners.map((o) => ({
      recipientUserId: o.userId, channel: 'sms' as const, template: 'organization.support_access_requested', organizationId: org.id,
      data: { organizationName: org.name, reason: input.reason, durationMinutes: input.durationMinutes, grantId: row!.id },
    }))));
    return (await this.views([row!], now))[0]!;
  }

  /** Accès du support, tous ou filtrés (statut effectif, organisation), du plus récent au plus ancien. */
  async listForPlatform(query: { status?: SupportAccessStatus | undefined; organizationId?: string | undefined }, now = new Date()): Promise<SupportAccessGrantView[]> {
    await this.expireDue(now);
    const conditions: SQL[] = [];
    if (query.status) conditions.push(eq(schema.supportAccessGrants.status, query.status));
    if (query.organizationId) conditions.push(eq(schema.supportAccessGrants.organizationId, query.organizationId));
    const rows = await this.db.select().from(schema.supportAccessGrants).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(schema.supportAccessGrants.createdAt)).limit(200);
    return this.views(rows, now);
  }

  /** Fin anticipée par le membre du personnel qui a demandé l'accès (demande retirée ou accès terminé). */
  async end(grantId: string, actor: UserActor, now = new Date()): Promise<SupportAccessGrantView> {
    const [grant] = await this.db.select().from(schema.supportAccessGrants).where(eq(schema.supportAccessGrants.id, grantId)).limit(1);
    if (!grant) throw AppError.notFound('SUPPORT_GRANT_NOT_FOUND', 'Accès du support introuvable');
    if (grant.requestedByUserId !== actor.userId) throw AppError.forbidden('SUPPORT_GRANT_NOT_YOURS', 'Seul le membre du personnel qui a demandé cet accès peut y mettre fin');
    return this.apply(grant, 'revoke', actor, now, 'support_access.ended');
  }

  // --- Organisation ---

  /** Accès du support à l'organisation de la route et à ses descendantes. */
  async listForOrganization(scope: OrgScope, query: { status?: SupportAccessStatus | undefined }, now = new Date()): Promise<SupportAccessGrantView[]> {
    await this.expireDue(now);
    const subtree = this.db.select({ id: schema.organizations.id }).from(schema.organizations).where(like(schema.organizations.path, `${scope.path}%`));
    const conditions: SQL[] = [inArray(schema.supportAccessGrants.organizationId, subtree)];
    if (query.status) conditions.push(eq(schema.supportAccessGrants.status, query.status));
    const rows = await this.db.select().from(schema.supportAccessGrants).where(and(...conditions)).orderBy(desc(schema.supportAccessGrants.createdAt)).limit(200);
    return this.views(rows, now);
  }

  /**
   * Décision de l'organisation (approuver, refuser, révoquer). Jamais par le support lui-même (accès en cours ou demandeur
   * membre de l'organisation) ; une demande d'une autre organisation est introuvable (404).
   */
  async decide(scope: OrgScope, grantId: string, action: SupportAccessAction, actor: UserActor, now = new Date()): Promise<SupportAccessGrantView> {
    if (scope.support) throw AppError.forbidden('SUPPORT_ACCESS_FORBIDDEN', 'Le support ne décide pas de ses propres accès');
    const [grant] = await this.db.select().from(schema.supportAccessGrants).where(eq(schema.supportAccessGrants.id, grantId)).for('update').limit(1);
    if (!grant) throw AppError.notFound('SUPPORT_GRANT_NOT_FOUND', 'Accès du support introuvable');
    if (grant.requestedByUserId === actor.userId) throw AppError.forbidden('SUPPORT_ACCESS_FORBIDDEN', 'Le support ne décide pas de ses propres accès');
    return this.apply(grant, action, actor, now, `support_access.${PAST[action]}`);
  }

  private async apply(grant: GrantRow, action: SupportAccessAction, actor: UserActor, now: Date, auditAction: string): Promise<SupportAccessGrantView> {
    const state = { status: grant.status as SupportAccessStatus, createdAt: grant.createdAt, startsAt: grant.startsAt, endsAt: grant.endsAt };
    const current = supportGrantStatus(state, now, await this.requestTtlMs());
    const next = supportGrantTransition(current, action);
    if (!next) throw AppError.conflict('SUPPORT_GRANT_CLOSED', 'Cet accès est déjà tranché, expiré ou révoqué', { status: current });
    const set: Partial<GrantRow> = { status: next };
    if (next === 'approved') Object.assign(set, { approvedByUserId: actor.userId, startsAt: now, endsAt: new Date(now.getTime() + grant.durationMinutes * 60_000) });
    if (next === 'revoked' && current === 'approved') set.endsAt = now;
    const [row] = await this.db.update(schema.supportAccessGrants).set(set).where(eq(schema.supportAccessGrants.id, grant.id)).returning();
    this.audit.record({
      action: auditAction, entity: 'support_access_grants', entityId: grant.id, organizationId: grant.organizationId,
      before: { status: current }, after: { status: next, startsAt: row!.startsAt?.toISOString() ?? null, endsAt: row!.endsAt?.toISOString() ?? null, reason: grant.reason },
    });
    return (await this.views([row!], now))[0]!;
  }

  // --- Garde des routes d'organisation ---

  /**
   * Accès du support en cours qui couvre l'organisation visée (accordé sur elle ou sur un ancêtre) pour ce membre du
   * personnel, s'il détient `support.access` (session du personnel à double authentification) ; sinon `null`.
   * Permissions : les siennes sur la plateforme, limitées à celles d'une organisation cliente et à ses modules.
   */
  async activeFor(actor: UserActor, organizationId: string, now = new Date()): Promise<ActiveSupportAccess | null> {
    const platform = await this.access.platformPermissions(actor, now);
    if (!platform.has('support.access')) return null;
    const [target] = await this.db.select({ path: schema.organizations.path }).from(schema.organizations).where(eq(schema.organizations.id, organizationId)).limit(1);
    if (!target) return null;
    const g = schema.supportAccessGrants;
    const [grant] = await this.db
      .select({ id: g.id, reason: g.reason, endsAt: g.endsAt })
      .from(g)
      .innerJoin(schema.organizations, eq(schema.organizations.id, g.organizationId))
      .where(and(eq(g.requestedByUserId, actor.userId), eq(g.status, 'approved'), lte(g.startsAt, now), gt(g.endsAt, now), sql`${target.path} LIKE ${schema.organizations.path} || '%'`))
      .orderBy(desc(g.endsAt))
      .limit(1);
    if (!grant?.endsAt) return null;
    return { grantId: grant.id, reason: grant.reason, endsAt: grant.endsAt.toISOString(), path: target.path, permissions: supportAccessPermissions(platform, await this.access.modulesOf(organizationId)) };
  }
}
