/**
 * Étape 19 (amendement v1.2) : organisations en arbre, rôles personnalisés, adhésions et invitations. Pas d'escalade :
 * un rôle personnalisé ou une invitation ne porte que des permissions que détient celui qui l'écrit, et jamais une
 * permission réservée à la plateforme pour une organisation cliente. Chaque écriture est journalisée ; tout changement
 * d'adhésion vide le cache des droits de la personne. Étape 20 : appelé aussi par les routes d'organisation, sous une
 * transaction restreinte (les lignes hors du sous-arbre sont invisibles : 404) et avec les permissions détenues dans
 * l'organisation de la route (`scope`) plutôt que sur la plateforme. Étape 21 : le lien d'invitation part par texto ou
 * courriel après la validation (jeton jamais rendu, sauf réglage de développement) ; le dernier propriétaire actif ne peut
 * être suspendu, retiré ou changé de rôle (409 `LAST_OWNER`) sans transfert de propriété journalisé ; une organisation
 * crée ses sous-organisations dans son sous-arbre ; catalogue des permissions vu de l'organisation.
 */
import { schema } from '@neomoov/db';
import {
  childPath, FORMER_OWNER_ROLE_CODE, isPermission, ORGANIZATION_PERMISSIONS, OWNER_ROLE_CODE, PERMISSION_CODES, PERMISSION_MODULES, PERMISSIONS, refusedGrants, removesLastOwner,
  type InvitationCreate, type InvitationCreated, type InvitationView, type MembershipUpdate, type MembershipView, type MyOrganization, type OrganizationCreate,
  type OrganizationHome, type OrganizationView, type OrgOrganizationCreate, type OrgPermissionView, type OwnershipTransfer, type RoleCreate, type RoleView,
} from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, like, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../common/app-error.js';
import { randomToken, sha256Hex } from '../../common/crypto.js';
import { DomainEventsService } from '../../common/domain-events.js';
import { afterScopeCommit, orgScopeStorage } from '../../common/org-scope.context.js';
import { APP_ENV, invitationTokenInResponse, type AppEnv } from '../../config/env.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AccessService } from '../auth/access.service.js';
import type { OrgScope, UserActor } from '../auth/actor.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';

type OrgRow = typeof schema.organizations.$inferSelect;

function uniqueViolation(error: unknown): string | null {
  const e = error as { code?: string; constraint_name?: string; cause?: { code?: string; constraint_name?: string } };
  return (e?.code ?? e?.cause?.code) === '23505' ? (e?.constraint_name ?? e?.cause?.constraint_name ?? '23505') : null;
}

const orgView = (o: OrgRow): OrganizationView => ({
  id: o.id, code: o.code, name: o.name, type: o.type as OrganizationView['type'], parentId: o.parentId, path: o.path,
  status: o.status as OrganizationView['status'], planCode: o.planCode,
});

@Injectable()
export class OrganizationsService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly events: DomainEventsService,
    private readonly outbox: NotificationsOutbox,
  ) {}

  private get db() {
    return this.database.db;
  }

  private async organization(id: string): Promise<OrgRow> {
    const [org] = await this.db.select().from(schema.organizations).where(eq(schema.organizations.id, id)).limit(1);
    if (!org) throw AppError.notFound('ORGANIZATION_NOT_FOUND', 'Organisation introuvable');
    return org;
  }

  /**
   * Droits de celui qui écrit (dans l'organisation de la route, sinon sur la plateforme), et refus de toute permission
   * qu'il n'a pas (ou réservée à la plateforme pour un client).
   */
  private async assertGrantable(actor: UserActor, permissions: readonly string[], org: OrgRow, scope?: OrgScope): Promise<void> {
    const held = scope ? scope.permissions : await this.access.platformPermissions(actor);
    const refused = refusedGrants(held, permissions, org.parentId !== null);
    if (refused.length) throw AppError.forbidden('PERMISSION_ESCALATION', 'Vous ne pouvez accorder que des permissions que vous détenez', { refused });
  }

  // --- Organisations ---

  async list(): Promise<OrganizationView[]> {
    return (await this.db.select().from(schema.organizations).orderBy(asc(schema.organizations.path))).map(orgView);
  }

  /**
   * Fiche d'une organisation pour un membre (étape 20) : vue, permissions effectives de l'appelant, modules actifs. Étape
   * 21 : double authentification de la session, permissions sensibles qu'elle débloquerait (calculées hors de la
   * transaction restreinte, qui cacherait les adhésions des ancêtres), accès du support en cours.
   */
  async home(scope: OrgScope, actor?: UserActor): Promise<OrganizationHome> {
    const org = await this.organization(scope.organizationId);
    const features = await this.db
      .select({ module: schema.organizationFeatures.module, enabled: schema.organizationFeatures.enabled })
      .from(schema.organizationFeatures)
      .where(eq(schema.organizationFeatures.organizationId, org.id));
    const modulesRestricted = features.length > 0;
    return {
      organization: orgView(org),
      permissions: [...scope.permissions].sort(),
      modules: modulesRestricted ? features.filter((f) => f.enabled).map((f) => f.module).sort() : [...PERMISSION_MODULES],
      modulesRestricted,
      mfa: actor?.amr.includes('mfa') ?? false,
      mfaPermissions: actor && !scope.support ? await orgScopeStorage.exit(async () => this.access.mfaPermissionsIn(actor, scope.path)) : [],
      supportAccess: scope.support ?? null,
    };
  }

  /** Adhésions actives et non expirées de l'utilisateur, avec l'organisation et le rôle (sélecteur d'organisation, étape 20). */
  async myOrganizations(userId: string, now = new Date()): Promise<MyOrganization[]> {
    const rows = await this.db
      .select({ m: schema.memberships, org: schema.organizations, roleCode: schema.roles.code, roleName: schema.roles.name })
      .from(schema.memberships)
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.organizationId))
      .innerJoin(schema.roles, eq(schema.roles.id, schema.memberships.roleId))
      .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.status, 'active')))
      .orderBy(asc(schema.organizations.path), asc(schema.memberships.createdAt));
    return rows
      .filter((r) => !r.m.expiresAt || r.m.expiresAt > now)
      .map((r) => ({
        membershipId: r.m.id, organizationId: r.org.id, code: r.org.code, name: r.org.name, type: r.org.type as MyOrganization['type'], path: r.org.path,
        organizationStatus: r.org.status as MyOrganization['organizationStatus'], roleId: r.m.roleId, roleCode: r.roleCode, roleName: r.roleName,
        scope: r.m.scope as MyOrganization['scope'], status: r.m.status as MyOrganization['status'], expiresAt: r.m.expiresAt?.toISOString() ?? null,
      }));
  }

  async create(input: OrganizationCreate, actor: UserActor): Promise<OrganizationView> {
    const parent = await this.organization(input.parentId);
    const id = randomUUID();
    try {
      const [row] = await this.db.insert(schema.organizations).values({ id, code: input.code, name: input.name, type: input.type, parentId: parent.id, path: childPath(parent.path, id) }).returning();
      this.audit.record({ action: 'organization.created', entity: 'organizations', entityId: id, after: { code: input.code, type: input.type, parentId: parent.id, by: actor.userId } });
      // CRM (étape 25) : entreprise et transaction « Ventes B2B », de façon asynchrone.
      this.events.emit('organization.created', { organizationId: id, parentId: parent.id, type: input.type });
      return orgView(row!);
    } catch (error) {
      if (uniqueViolation(error) === 'organizations_code_unique') throw AppError.conflict('ORGANIZATION_CODE_TAKEN', 'Ce code d\'organisation est déjà pris');
      throw error;
    }
  }

  // --- Permissions et rôles ---

  permissions() {
    return PERMISSION_CODES.map((code) => ({ code, ...PERMISSIONS[code] })).map(({ code, module, description, sensitive, platformOnly }) => ({ code, module, description, sensitive, platformOnly }));
  }

  async roles(organizationId?: string): Promise<RoleView[]> {
    const rows = await this.db
      .select()
      .from(schema.roles)
      .where(organizationId ? or(isNull(schema.roles.organizationId), eq(schema.roles.organizationId, organizationId)) : isNull(schema.roles.organizationId))
      .orderBy(asc(schema.roles.level), asc(schema.roles.code));
    if (!rows.length) return [];
    const links = await this.db.select().from(schema.rolePermissions).where(inArray(schema.rolePermissions.roleId, rows.map((r) => r.id)));
    return rows.map((r) => ({
      id: r.id, organizationId: r.organizationId, code: r.code, name: r.name, level: r.level, system: r.organizationId === null,
      permissions: links.filter((l) => l.roleId === r.id).map((l) => l.permissionCode).sort(),
    }));
  }

  private async role(id: string): Promise<RoleView> {
    const [row] = await this.db.select().from(schema.roles).where(eq(schema.roles.id, id)).limit(1);
    if (!row) throw AppError.notFound('ROLE_NOT_FOUND', 'Rôle introuvable');
    const links = await this.db.select({ code: schema.rolePermissions.permissionCode }).from(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, id));
    return { id: row.id, organizationId: row.organizationId, code: row.code, name: row.name, level: row.level, system: row.organizationId === null, permissions: links.map((l) => l.code).sort() };
  }

  async createRole(input: RoleCreate, actor: UserActor, scope?: OrgScope): Promise<RoleView> {
    // Route d'organisation : le rôle appartient à l'organisation de la route, jamais à une autre.
    if (scope && input.organizationId !== scope.organizationId) throw AppError.notFound('ORGANIZATION_NOT_FOUND', 'Organisation introuvable');
    const org = await this.organization(input.organizationId);
    const permissions = [...new Set(input.permissions)];
    await this.assertGrantable(actor, permissions, org, scope);
    try {
      const id = await this.db.transaction(async (tx) => {
        const [row] = await tx.insert(schema.roles).values({ organizationId: org.id, code: input.code, name: input.name, level: input.level, createdByUserId: actor.userId }).returning({ id: schema.roles.id });
        await tx.insert(schema.rolePermissions).values(permissions.map((permissionCode) => ({ roleId: row!.id, permissionCode })));
        return row!.id;
      });
      this.audit.record({ action: 'role.created', entity: 'roles', entityId: id, after: { organizationId: org.id, code: input.code, permissions } });
      return this.role(id);
    } catch (error) {
      if (uniqueViolation(error) === 'roles_org_code_unique') throw AppError.conflict('ROLE_CODE_TAKEN', 'Ce code de rôle existe déjà dans l\'organisation');
      throw error;
    }
  }

  async updateRolePermissions(roleId: string, permissions: string[], actor: UserActor, scope?: OrgScope): Promise<RoleView> {
    const role = await this.role(roleId);
    if (role.system) throw AppError.conflict('SYSTEM_ROLE_READ_ONLY', 'Un rôle système ne se modifie pas');
    // Route d'organisation : seulement un rôle personnalisé de cette organisation (ceux des descendantes passent par leur propre route).
    if (scope && role.organizationId !== scope.organizationId) throw AppError.notFound('ROLE_NOT_FOUND', 'Rôle introuvable');
    const org = await this.organization(role.organizationId!);
    const wanted = [...new Set(permissions)];
    await this.assertGrantable(actor, wanted, org, scope);
    await this.db.transaction(async (tx) => {
      await tx.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, roleId));
      await tx.insert(schema.rolePermissions).values(wanted.map((permissionCode) => ({ roleId, permissionCode })));
    });
    this.access.invalidate();
    this.audit.record({ action: 'role.permissions_updated', entity: 'roles', entityId: roleId, before: { permissions: role.permissions }, after: { permissions: wanted } });
    return this.role(roleId);
  }

  /** Rôle attribuable dans cette organisation : système, ou personnalisé de l'organisation. */
  private async roleFor(org: OrgRow, roleId: string): Promise<RoleView> {
    const role = await this.role(roleId);
    if (role.organizationId !== null && role.organizationId !== org.id) throw new AppError('ROLE_OF_ANOTHER_ORGANIZATION', 'Ce rôle appartient à une autre organisation', 400);
    return role;
  }

  // --- Adhésions ---

  async members(organizationId: string): Promise<MembershipView[]> {
    await this.organization(organizationId);
    const rows = await this.db
      .select({ m: schema.memberships, roleCode: schema.roles.code, roleName: schema.roles.name, firstName: schema.users.firstName, lastName: schema.users.lastName })
      .from(schema.memberships)
      .innerJoin(schema.roles, eq(schema.roles.id, schema.memberships.roleId))
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(eq(schema.memberships.organizationId, organizationId))
      .orderBy(asc(schema.memberships.createdAt));
    return rows.map((r) => ({
      id: r.m.id, userId: r.m.userId, name: [r.firstName, r.lastName].filter(Boolean).join(' ') || null, organizationId: r.m.organizationId, roleId: r.m.roleId,
      roleCode: r.roleCode, roleName: r.roleName, scope: r.m.scope as MembershipView['scope'], status: r.m.status as MembershipView['status'],
      expiresAt: r.m.expiresAt?.toISOString() ?? null, createdAt: r.m.createdAt.toISOString(),
    }));
  }

  private async membershipView(id: string): Promise<MembershipView> {
    const [m] = await this.db.select({ organizationId: schema.memberships.organizationId }).from(schema.memberships).where(eq(schema.memberships.id, id)).limit(1);
    if (!m) throw AppError.notFound('MEMBERSHIP_NOT_FOUND', 'Adhésion introuvable');
    return (await this.members(m.organizationId)).find((v) => v.id === id)!;
  }

  async updateMembership(id: string, input: MembershipUpdate, actor: UserActor, scope?: OrgScope): Promise<MembershipView> {
    const [m] = await this.db.select().from(schema.memberships).where(eq(schema.memberships.id, id)).limit(1);
    if (!m) throw AppError.notFound('MEMBERSHIP_NOT_FOUND', 'Adhésion introuvable');
    const org = await this.organization(m.organizationId);
    if (input.roleId) await this.assertGrantable(actor, (await this.roleFor(org, input.roleId)).permissions, org, scope);
    if ((input.status === 'suspended' && m.status === 'active') || (input.roleId && input.roleId !== m.roleId)) await this.assertNotLastOwner(m);
    await this.db.update(schema.memberships).set({ ...(input.status ? { status: input.status } : {}), ...(input.roleId ? { roleId: input.roleId } : {}) }).where(eq(schema.memberships.id, id));
    this.access.invalidate(m.userId);
    this.audit.record({ action: 'membership.updated', entity: 'memberships', entityId: id, before: { status: m.status, roleId: m.roleId }, after: input });
    return this.membershipView(id);
  }

  async removeMembership(id: string): Promise<void> {
    const [found] = await this.db.select().from(schema.memberships).where(eq(schema.memberships.id, id)).limit(1);
    if (!found) throw AppError.notFound('MEMBERSHIP_NOT_FOUND', 'Adhésion introuvable');
    await this.assertNotLastOwner(found);
    const [m] = await this.db.delete(schema.memberships).where(eq(schema.memberships.id, id)).returning();
    if (!m) throw AppError.notFound('MEMBERSHIP_NOT_FOUND', 'Adhésion introuvable');
    this.access.invalidate(m.userId);
    this.audit.record({ action: 'membership.removed', entity: 'memberships', entityId: id, before: { userId: m.userId, organizationId: m.organizationId, roleId: m.roleId } });
  }

  // --- Invitations ---

  /**
   * Invitation à usage unique ; seule l'empreinte du jeton est gardée. Étape 21 : le lien `<web>/rejoindre?token=...` part
   * par texto ou par courriel (gabarit `organization.invitation`, langue de la personne qui invite) après la validation ;
   * le jeton n'est rendu que si le réglage de développement le demande.
   */
  async invite(organizationId: string, input: InvitationCreate, actor: UserActor, scope?: OrgScope, now = new Date(), language: 'fr' | 'en' = 'fr'): Promise<InvitationCreated> {
    const org = await this.organization(organizationId);
    const role = await this.roleFor(org, input.roleId);
    await this.assertGrantable(actor, role.permissions, org, scope);
    const token = `inv_${randomToken(24)}`;
    const expiresAt = new Date(now.getTime() + input.expiresInDays * 86_400_000);
    const [row] = await this.db.insert(schema.invitations).values({
      organizationId: org.id, roleId: role.id, scope: input.scope, email: input.email ?? null, phone: input.phone ?? null, tokenHash: sha256Hex(token), expiresAt, invitedByUserId: actor.userId,
    }).returning({ id: schema.invitations.id });
    const channel = input.phone ? ('sms' as const) : ('email' as const);
    this.audit.record({ action: 'invitation.created', entity: 'invitations', entityId: row!.id, after: { organizationId: org.id, roleId: role.id, scope: input.scope, channel } });
    const url = `${this.env.WEB_BASE_URL.replace(/\/+$/, '')}/rejoindre?token=${encodeURIComponent(token)}`;
    await afterScopeCommit(() => this.outbox.queue({
      recipientAddress: input.phone ?? input.email ?? null, channel, template: 'organization.invitation', language, organizationId: org.id,
      data: { invitationId: row!.id, organizationName: org.name, roleName: role.name, url, expiresAt: expiresAt.toISOString() },
    }));
    return { id: row!.id, expiresAt: expiresAt.toISOString(), channel, ...(invitationTokenInResponse(this.env) ? { token } : {}) };
  }

  /** Invitations d'une organisation (jamais le jeton), les plus récentes d'abord. */
  async invitations(organizationId: string, now = new Date()): Promise<InvitationView[]> {
    await this.organization(organizationId);
    const rows = await this.db
      .select({ i: schema.invitations, roleName: schema.roles.name })
      .from(schema.invitations)
      .innerJoin(schema.roles, eq(schema.roles.id, schema.invitations.roleId))
      .where(eq(schema.invitations.organizationId, organizationId))
      .orderBy(desc(schema.invitations.createdAt))
      .limit(200);
    return rows.map(({ i, roleName }) => ({
      id: i.id, organizationId: i.organizationId, roleId: i.roleId, roleName, scope: i.scope as InvitationView['scope'], email: i.email, phone: i.phone,
      status: i.revokedAt ? 'revoked' : i.acceptedAt ? 'accepted' : i.expiresAt <= now ? 'expired' : 'pending',
      expiresAt: i.expiresAt.toISOString(), createdAt: i.createdAt.toISOString(),
    }));
  }

  /** Révoque une invitation encore en attente de l'organisation (404 ailleurs, 409 si elle a servi ou est déjà révoquée). */
  async revokeInvitation(organizationId: string, invitationId: string, now = new Date()): Promise<void> {
    const [inv] = await this.db.select().from(schema.invitations).where(and(eq(schema.invitations.id, invitationId), eq(schema.invitations.organizationId, organizationId))).limit(1);
    if (!inv) throw AppError.notFound('INVITATION_NOT_FOUND', 'Invitation introuvable');
    if (inv.acceptedAt || inv.revokedAt) throw AppError.conflict('INVITATION_CLOSED', 'Cette invitation a déjà servi ou est révoquée');
    await this.db.update(schema.invitations).set({ revokedAt: now }).where(eq(schema.invitations.id, inv.id));
    this.audit.record({ action: 'invitation.revoked', entity: 'invitations', entityId: inv.id, after: { organizationId } });
  }

  /** Acceptation par la personne invitée (même téléphone ou même courriel que l'invitation). */
  async accept(token: string, actor: UserActor, now = new Date()): Promise<MembershipView> {
    const { membershipId, organizationId } = await this.db.transaction(async (tx) => {
      const [inv] = await tx.select().from(schema.invitations).where(eq(schema.invitations.tokenHash, sha256Hex(token))).for('update').limit(1);
      if (!inv || inv.revokedAt) throw AppError.notFound('INVITATION_NOT_FOUND', 'Invitation introuvable');
      if (inv.acceptedAt) throw AppError.conflict('INVITATION_ALREADY_USED', 'Cette invitation a déjà servi');
      if (inv.expiresAt <= now) throw AppError.conflict('INVITATION_EXPIRED', 'Cette invitation a expiré');
      const [user] = await tx.select({ phone: schema.users.phone, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, actor.userId)).limit(1);
      const matches = (inv.phone && user?.phone === inv.phone) || (inv.email && user?.email?.toLowerCase() === inv.email);
      if (!matches) throw AppError.forbidden('INVITATION_NOT_FOR_YOU', 'Cette invitation est adressée à une autre personne');
      await tx.update(schema.invitations).set({ acceptedAt: now, acceptedByUserId: actor.userId }).where(eq(schema.invitations.id, inv.id));
      const [row] = await tx.insert(schema.memberships).values({ userId: actor.userId, organizationId: inv.organizationId, roleId: inv.roleId, scope: inv.scope, invitedByUserId: inv.invitedByUserId })
        .onConflictDoUpdate({ target: [schema.memberships.userId, schema.memberships.organizationId, schema.memberships.roleId], set: { status: 'active', scope: inv.scope } })
        .returning({ id: schema.memberships.id });
      return { membershipId: row!.id, organizationId: inv.organizationId };
    });
    this.access.invalidate(actor.userId);
    // Étape 21 : l'entrée appartient à l'organisation rejointe (visible dans son journal).
    this.audit.record({ action: 'invitation.accepted', entity: 'memberships', entityId: membershipId, organizationId, after: { userId: actor.userId } });
    return this.membershipView(membershipId);
  }

  // --- Étape 21 : propriété, sous-organisations, catalogue vu de l'organisation ---

  private async systemRoleId(code: string): Promise<string> {
    const [row] = await this.db.select({ id: schema.roles.id }).from(schema.roles).where(and(eq(schema.roles.code, code), isNull(schema.roles.organizationId))).limit(1);
    if (!row) throw new AppError('SYSTEM_ROLE_MISSING', `Rôle système ${code} absent (données de départ)`, 500);
    return row.id;
  }

  /** Propriétaires (adhésions au rôle système `org_owner`) d'une organisation. */
  private async owners(organizationId: string): Promise<Array<{ id: string; userId: string; status: string }>> {
    return this.db
      .select({ id: schema.memberships.id, userId: schema.memberships.userId, status: schema.memberships.status })
      .from(schema.memberships)
      .innerJoin(schema.roles, eq(schema.roles.id, schema.memberships.roleId))
      .where(and(eq(schema.memberships.organizationId, organizationId), eq(schema.roles.code, OWNER_ROLE_CODE), isNull(schema.roles.organizationId)));
  }

  /** Le dernier propriétaire actif ne se suspend, ne se retire ni ne change de rôle : transfert de propriété d'abord. */
  private async assertNotLastOwner(m: { id: string; organizationId: string }): Promise<void> {
    if (removesLastOwner(await this.owners(m.organizationId), m.id)) {
      throw AppError.conflict('LAST_OWNER', 'Dernier propriétaire du compte : transférez d\'abord la propriété à un autre membre');
    }
  }

  /**
   * Transfert de propriété (amendement : « le propriétaire ne peut être retiré sans transfert ») : réservé à un
   * propriétaire actif de l'organisation de la route ; le membre désigné (actif, de cette organisation) devient
   * propriétaire et l'ancien propriétaire devient administrateur. Journalisé.
   */
  async transferOwnership(scope: OrgScope, input: OwnershipTransfer, actor: UserActor): Promise<MembershipView> {
    const owners = await this.owners(scope.organizationId);
    const mine = owners.find((o) => o.userId === actor.userId && o.status === 'active');
    if (!mine) throw AppError.forbidden('OWNER_REQUIRED', 'Seul un propriétaire du compte peut en transférer la propriété');
    const [target] = await this.db.select().from(schema.memberships).where(and(eq(schema.memberships.id, input.membershipId), eq(schema.memberships.organizationId, scope.organizationId))).limit(1);
    if (!target) throw AppError.notFound('MEMBERSHIP_NOT_FOUND', 'Adhésion introuvable');
    if (target.status !== 'active') throw AppError.conflict('MEMBERSHIP_NOT_ACTIVE', 'Le nouveau propriétaire doit être un membre actif');
    if (owners.some((o) => o.userId === target.userId)) throw AppError.conflict('ALREADY_OWNER', 'Ce membre est déjà propriétaire du compte');
    const [ownerRoleId, adminRoleId] = await Promise.all([this.systemRoleId(OWNER_ROLE_CODE), this.systemRoleId(FORMER_OWNER_ROLE_CODE)]);
    await this.db.transaction(async (tx) => {
      // Le nouveau propriétaire garde une seule adhésion pour ce rôle (unicité utilisateur, organisation, rôle).
      await tx.update(schema.memberships).set({ roleId: ownerRoleId }).where(eq(schema.memberships.id, target.id));
      const [alreadyAdmin] = await tx.select({ id: schema.memberships.id }).from(schema.memberships)
        .where(and(eq(schema.memberships.userId, actor.userId), eq(schema.memberships.organizationId, scope.organizationId), eq(schema.memberships.roleId, adminRoleId))).limit(1);
      if (alreadyAdmin) await tx.delete(schema.memberships).where(eq(schema.memberships.id, mine.id));
      else await tx.update(schema.memberships).set({ roleId: adminRoleId }).where(eq(schema.memberships.id, mine.id));
    });
    this.access.invalidate(actor.userId);
    this.access.invalidate(target.userId);
    this.audit.record({
      action: 'organization.ownership_transferred', entity: 'memberships', entityId: target.id,
      before: { ownerUserId: actor.userId, ownerMembershipId: mine.id, roleId: target.roleId }, after: { ownerUserId: target.userId, formerOwnerRole: FORMER_OWNER_ROLE_CODE },
    });
    return this.membershipView(target.id);
  }

  /** Organisation de la route et ses descendantes, dans l'ordre de l'arbre. */
  async subtree(scope: OrgScope): Promise<OrganizationView[]> {
    return (await this.db.select().from(schema.organizations).where(like(schema.organizations.path, `${scope.path}%`)).orderBy(asc(schema.organizations.path))).map(orgView);
  }

  /**
   * Sous-organisation créée par une organisation cliente, sous l'organisation de la route ou une de ses descendantes
   * (introuvable ailleurs). La politique de la table ne permet pas l'insertion dans la transaction restreinte : la ligne
   * est écrite par le pool de la plateforme une fois le parent vérifié. Les modules de la formule du parent sont repris :
   * jamais plus que son parent.
   */
  async createSubOrganization(scope: OrgScope, input: OrgOrganizationCreate, actor: UserActor): Promise<OrganizationView> {
    const parent = await this.organization(input.parentId ?? scope.organizationId);
    if (!parent.path.startsWith(scope.path)) throw AppError.notFound('ORGANIZATION_NOT_FOUND', 'Organisation introuvable');
    const id = randomUUID();
    let row: OrgRow;
    try {
      row = await orgScopeStorage.exit(async () => {
        const [inserted] = await this.database.db.insert(schema.organizations).values({ id, code: input.code, name: input.name, type: input.type, parentId: parent.id, path: childPath(parent.path, id), status: parent.status === 'trial' ? 'trial' : 'active', planCode: parent.planCode }).returning();
        return inserted!;
      });
    } catch (error) {
      if (uniqueViolation(error) === 'organizations_code_unique') throw AppError.conflict('ORGANIZATION_CODE_TAKEN', 'Ce code d\'organisation est déjà pris');
      throw error;
    }
    const features = await this.db.select().from(schema.organizationFeatures).where(eq(schema.organizationFeatures.organizationId, parent.id));
    if (features.length) await this.db.insert(schema.organizationFeatures).values(features.map((f) => ({ organizationId: id, module: f.module, enabled: f.enabled, source: f.source, limits: f.limits })));
    this.audit.record({ action: 'organization.created', entity: 'organizations', entityId: id, organizationId: id, after: { code: input.code, type: input.type, parentId: parent.id, by: actor.userId } });
    return orgView(row);
  }

  /** Catalogue vu d'une organisation cliente : permissions qu'elle peut détenir, et celles que l'appelant détient ici. */
  orgPermissions(scope: OrgScope): OrgPermissionView[] {
    return ORGANIZATION_PERMISSIONS.map((code) => {
      const { module, description, sensitive, platformOnly } = PERMISSIONS[code];
      return { code, module, description, sensitive, platformOnly, held: scope.permissions.has(code) };
    });
  }

  /** Permissions sensibles d'une liste (pour l'avertissement de My Hub). */
  static sensitive(permissions: readonly string[]): string[] {
    return permissions.filter((code) => isPermission(code) && PERMISSIONS[code].sensitive);
  }
}
