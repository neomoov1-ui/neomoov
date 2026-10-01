/**
 * Étape 23 (module Flotte) : chauffeurs rattachés à une organisation. Invitation par texto (jeton à usage unique, seule
 * son empreinte est gardée, jamais montré à la personne qui invite) ; à l'acceptation, le profil chauffeur existant ou
 * nouveau reçoit l'organisation (un chauffeur appartient à une seule organisation à la fois : changer, c'est quitter
 * l'ancienne, avec ses relevés en brouillon émis et ses règles de partage closes). Liste enrichie de la conformité,
 * revue des documents par l'organisation (une recommandation : l'approbation finale reste à la plateforme).
 */
import { schema } from '@neomoov/db';
import type { AdminListQuery, DriverInvitationCreate, FleetDocument, FleetDriver, Page } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { SMS_PROVIDER, type SmsProvider } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { randomToken, sha256Hex } from '../../common/crypto.js';
import { APP_LOGGER } from '../../common/logger.js';
import { afterOrgScopeCommit } from '../../common/org-scope.context.js';
import { SettingsService } from '../../common/settings.service.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AdminDriversService } from '../admin/admin-drivers.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AccessService } from '../auth/access.service.js';
import type { OrgScope, UserActor } from '../auth/actor.js';
import { OrgScopeService } from '../organizations/org-scope.service.js';
import { StatementsService } from '../settlement/statements.service.js';
import { renderNotification } from '../notifications/templates.js';
import { UsersService } from '../users/users.service.js';

/** Préfixe des jetons d'invitation de chauffeur : la page d'accueil choisit la bonne route d'acceptation. */
export const DRIVER_INVITATION_PREFIX = 'drv_';

function today(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

@Injectable()
export class FleetDriversService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly settings: SettingsService,
    private readonly drivers: AdminDriversService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly users: UsersService,
    private readonly statements: StatementsService,
    private readonly orgScope: OrgScopeService,
  ) {}

  private get db() {
    return this.database.db;
  }

  private async driverRoleId(): Promise<string> {
    const [role] = await this.db.select({ id: schema.roles.id }).from(schema.roles).where(and(eq(schema.roles.code, 'driver'), isNull(schema.roles.organizationId))).limit(1);
    if (!role) throw new AppError('DRIVER_ROLE_MISSING', 'Rôle système « chauffeur » absent du catalogue', 500);
    return role.id;
  }

  // --- Invitation (route d'organisation, transaction restreinte) ---

  async invite(scope: OrgScope, input: DriverInvitationCreate, actor: UserActor, now = new Date()): Promise<{ id: string; phone: string; expiresAt: string; sent: boolean }> {
    const [org] = await this.db.select({ id: schema.organizations.id, name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, scope.organizationId)).limit(1);
    if (!org) throw AppError.notFound('ORGANIZATION_NOT_FOUND', 'Organisation introuvable');
    const roleId = await this.driverRoleId();
    const token = `${DRIVER_INVITATION_PREFIX}${randomToken(24)}`;
    const expiresAt = new Date(now.getTime() + input.expiresInDays * 86_400_000);
    const [row] = await this.db
      .insert(schema.invitations)
      .values({ organizationId: org.id, roleId, scope: 'organization', phone: input.phone, tokenHash: sha256Hex(token), expiresAt, invitedByUserId: actor.userId })
      .returning({ id: schema.invitations.id });
    this.audit.record({ action: 'fleet.driver_invited', entity: 'invitations', entityId: row!.id, after: { organizationId: org.id, channel: 'sms', expiresAt: expiresAt.toISOString() } });
    // Le texto part après la validation : une invitation annulée n'envoie rien.
    const link = `${this.env.WEB_BASE_URL.replace(/\/+$/, '')}/chauffeurs/rejoindre?token=${encodeURIComponent(token)}`;
    const body = renderNotification('fleet.driver_invitation', { organizationName: org.name, firstName: input.firstName ?? null, link }, input.language).body;
    afterOrgScopeCommit(() => {
      this.sms.send({ to: input.phone, body, idempotencyKey: `driver-invitation-${row!.id}` }).catch((error: unknown) => this.logger.error({ err: error, invitationId: row!.id }, 'Texto d\'invitation de chauffeur non envoyé'));
    });
    return { id: row!.id, phone: input.phone, expiresAt: expiresAt.toISOString(), sent: true };
  }

  // --- Acceptation (route de l'utilisateur connecté, par la plateforme) ---

  /**
   * Acceptation par le chauffeur invité (même téléphone que l'invitation). Crée le profil chauffeur s'il n'existe pas
   * (candidat `pending` : les documents et l'approbation restent ceux de la plateforme), le rattache à l'organisation et
   * lui donne l'adhésion « chauffeur ». S'il appartenait à une autre organisation cliente : départ de l'ancienne (adhésion
   * retirée, règles de partage closes la veille, relevés en brouillon émis).
   */
  async accept(token: string, actor: UserActor, now = new Date()) {
    if (!token.startsWith(DRIVER_INVITATION_PREFIX)) throw AppError.notFound('INVITATION_NOT_FOUND', 'Invitation introuvable');
    const roleId = await this.driverRoleId();
    const rootId = await this.orgScope.rootOrganizationId();
    const timeZone = await this.settings.string('service.time_zone', 'America/Toronto');
    const day = today(timeZone, now);
    const result = await this.db.transaction(async (tx) => {
      const [inv] = await tx.select().from(schema.invitations).where(eq(schema.invitations.tokenHash, sha256Hex(token))).for('update').limit(1);
      if (!inv || inv.revokedAt || inv.roleId !== roleId) throw AppError.notFound('INVITATION_NOT_FOUND', 'Invitation introuvable');
      if (inv.acceptedAt) throw AppError.conflict('INVITATION_ALREADY_USED', 'Cette invitation a déjà servi');
      if (inv.expiresAt <= now) throw AppError.conflict('INVITATION_EXPIRED', 'Cette invitation a expiré');
      const [user] = await tx.select({ phone: schema.users.phone }).from(schema.users).where(eq(schema.users.id, actor.userId)).limit(1);
      if (!inv.phone || user?.phone !== inv.phone) throw AppError.forbidden('INVITATION_NOT_FOR_YOU', 'Cette invitation est adressée à une autre personne');
      const [org] = await tx.select({ id: schema.organizations.id, name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, inv.organizationId)).limit(1);
      if (!org) throw AppError.notFound('ORGANIZATION_NOT_FOUND', 'Organisation introuvable');

      let [driver] = await tx.select({ id: schema.drivers.id, organizationId: schema.drivers.organizationId, currentVehicleId: schema.drivers.currentVehicleId }).from(schema.drivers).where(eq(schema.drivers.userId, actor.userId)).limit(1).for('update');
      let created = false;
      if (!driver) {
        const [numberRow] = await tx.execute<{ n: string }>(sql`SELECT next_driver_public_number() AS n`);
        [driver] = await tx.insert(schema.drivers).values({ userId: actor.userId, publicNumber: numberRow!.n, status: 'pending', organizationId: org.id }).returning({ id: schema.drivers.id, organizationId: schema.drivers.organizationId, currentVehicleId: schema.drivers.currentVehicleId });
        await tx.insert(schema.driverBalances).values({ driverId: driver!.id }).onConflictDoNothing();
        created = true;
      }
      const previous = !created && driver!.organizationId && driver!.organizationId !== rootId && driver!.organizationId !== org.id ? driver!.organizationId : null;
      if (previous) {
        // Départ de l'ancienne organisation : plus d'adhésion « chauffeur », règles propres au chauffeur closes la veille.
        await tx.delete(schema.memberships).where(and(eq(schema.memberships.userId, actor.userId), eq(schema.memberships.organizationId, previous), eq(schema.memberships.roleId, roleId)));
        const yesterday = new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
        await tx.update(schema.revenueShareRules)
          .set({ effectiveTo: sql`GREATEST(${schema.revenueShareRules.effectiveFrom}, ${yesterday}::date)` })
          .where(and(eq(schema.revenueShareRules.organizationId, previous), eq(schema.revenueShareRules.driverId, driver!.id), or(isNull(schema.revenueShareRules.effectiveTo), gte(schema.revenueShareRules.effectiveTo, day))));
        // Véhicules de l'ancienne organisation : ils lui restent ; le chauffeur n'en garde pas un comme véhicule courant.
        const [current] = driver!.currentVehicleId
          ? await tx.select({ organizationId: schema.vehicles.organizationId }).from(schema.vehicles).where(eq(schema.vehicles.id, driver!.currentVehicleId)).limit(1)
          : [];
        if (current?.organizationId === previous) await tx.update(schema.drivers).set({ currentVehicleId: null }).where(eq(schema.drivers.id, driver!.id));
      }
      // Véhicules personnels (de la plateforme, ou dont il est propriétaire) : ils suivent le chauffeur.
      await tx.update(schema.vehicles)
        .set({ organizationId: org.id, ownerUserId: sql`COALESCE(${schema.vehicles.ownerUserId}, ${actor.userId}::uuid)` })
        .where(and(eq(schema.vehicles.driverId, driver!.id), or(isNull(schema.vehicles.organizationId), eq(schema.vehicles.organizationId, rootId), eq(schema.vehicles.ownerUserId, actor.userId))));
      await tx.update(schema.drivers).set({ organizationId: org.id }).where(eq(schema.drivers.id, driver!.id));
      await tx.insert(schema.memberships).values({ userId: actor.userId, organizationId: org.id, roleId, scope: 'organization', invitedByUserId: inv.invitedByUserId })
        .onConflictDoUpdate({ target: [schema.memberships.userId, schema.memberships.organizationId, schema.memberships.roleId], set: { status: 'active' } });
      await tx.update(schema.invitations).set({ acceptedAt: now, acceptedByUserId: actor.userId }).where(eq(schema.invitations.id, inv.id));
      return { driverId: driver!.id, organizationId: org.id, organizationName: org.name, created, previousOrganizationId: previous };
    });
    if (result.created) await this.users.grantRole(actor.userId, 'driver');
    // Relevés en brouillon de l'ancienne organisation : émis (clos) à son nom, avec les courses faites chez elle.
    let closedStatements = 0;
    if (result.previousOrganizationId) {
      const drafts = await this.db.select({ id: schema.weeklyStatements.id }).from(schema.weeklyStatements)
        .where(and(eq(schema.weeklyStatements.driverId, result.driverId), eq(schema.weeklyStatements.organizationId, result.previousOrganizationId), eq(schema.weeklyStatements.status, 'draft')));
      for (const draft of drafts) {
        await this.statements.issue(draft.id, now);
        closedStatements += 1;
      }
    }
    this.access.invalidate(actor.userId);
    this.audit.record({ action: 'fleet.driver_attached', entity: 'drivers', entityId: result.driverId, after: { organizationId: result.organizationId, previousOrganizationId: result.previousOrganizationId, created: result.created, closedStatements } });
    return { ...result, closedStatements };
  }

  // --- Liste enrichie et documents (transaction restreinte) ---

  /** Chauffeurs de l'organisation : fiche de My Hub, documents, prochaine échéance, véhicule courant et sa prochaine inspection. */
  async list(query: AdminListQuery, now = new Date()): Promise<Page<FleetDriver>> {
    const page = await this.drivers.list(query);
    const ids = page.items.map((d) => d.id);
    if (!ids.length) return { ...page, items: [] };
    const timeZone = await this.settings.string('service.time_zone', 'America/Toronto');
    const day = today(timeZone, now);
    const soon = new Date(Date.parse(`${day}T12:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
    const docs = await this.db.select({ driverId: schema.driverDocuments.driverId, status: schema.driverDocuments.status, expiresOn: schema.driverDocuments.expiresOn }).from(schema.driverDocuments).where(inArray(schema.driverDocuments.driverId, ids));
    const vehicles = await this.db
      .select({ driverId: schema.drivers.id, id: schema.vehicles.id, plate: schema.vehicles.plate, make: schema.vehicles.make, model: schema.vehicles.model, category: schema.vehicles.category, nextInspectionDueOn: schema.vehicles.nextInspectionDueOn })
      .from(schema.drivers)
      .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.drivers.currentVehicleId))
      .where(inArray(schema.drivers.id, ids));
    const items = page.items.map((d): FleetDriver => {
      const mine = docs.filter((x) => x.driverId === d.id);
      const approved = mine.filter((x) => x.status === 'approved');
      const upcoming = approved.map((x) => x.expiresOn).filter((x): x is string => Boolean(x) && x! >= day).sort();
      const vehicle = vehicles.find((v) => v.driverId === d.id);
      return {
        ...d,
        documents: {
          approved: approved.length, pending: mine.filter((x) => x.status === 'pending').length, rejected: mine.filter((x) => x.status === 'rejected').length,
          expired: mine.filter((x) => x.status === 'expired' || (x.status === 'approved' && x.expiresOn !== null && x.expiresOn < day)).length,
          expiringSoon: approved.filter((x) => x.expiresOn !== null && x.expiresOn >= day && x.expiresOn <= soon).length,
        },
        nextDocumentExpiryOn: upcoming[0] ?? null,
        nextInspectionDueOn: vehicle?.nextInspectionDueOn ?? null,
        currentVehicle: vehicle ? { id: vehicle.id, plate: vehicle.plate, make: vehicle.make, model: vehicle.model, category: vehicle.category } : null,
      };
    });
    return { ...page, items };
  }

  async documents(driverId: string): Promise<FleetDocument[]> {
    const [driver] = await this.db.select({ id: schema.drivers.id }).from(schema.drivers).where(eq(schema.drivers.id, driverId)).limit(1);
    if (!driver) throw AppError.notFound('DRIVER_NOT_FOUND', 'Chauffeur introuvable');
    const rows = await this.db.select().from(schema.driverDocuments).where(eq(schema.driverDocuments.driverId, driverId)).orderBy(asc(schema.driverDocuments.type), asc(schema.driverDocuments.createdAt));
    return rows.map((r) => this.documentView(r));
  }

  private documentView(r: typeof schema.driverDocuments.$inferSelect): FleetDocument {
    return {
      id: r.id, driverId: r.driverId, type: r.type, status: r.status, expiresOn: r.expiresOn, uploadedAt: r.createdAt.toISOString(),
      orgReview: r.orgReviewDecision && r.orgReviewedAt ? { decision: r.orgReviewDecision as 'approved' | 'rejected', note: r.orgReviewNote, at: r.orgReviewedAt.toISOString() } : null,
    };
  }

  /**
   * Revue d'un document par l'organisation : seulement un document en attente. Un refus est définitif (le chauffeur
   * téléverse à nouveau, rien de dangereux ne passe) ; une approbation reste une recommandation : le document reste « en
   * attente » de l'approbation finale de la plateforme (`compliance`, revue humaine de My Hub).
   */
  async reviewDocument(documentId: string, input: { decision: 'approved' | 'rejected'; note?: string | undefined }, actor: UserActor, now = new Date()): Promise<FleetDocument> {
    const [doc] = await this.db.select().from(schema.driverDocuments).where(eq(schema.driverDocuments.id, documentId)).limit(1);
    if (!doc) throw AppError.notFound('DOCUMENT_NOT_FOUND', 'Document introuvable');
    if (doc.status !== 'pending') throw AppError.conflict('DOCUMENT_ALREADY_REVIEWED', 'Ce document a déjà été revu par la plateforme', { status: doc.status });
    const [row] = await this.db
      .update(schema.driverDocuments)
      .set({
        orgReviewDecision: input.decision, orgReviewNote: input.note ?? null, orgReviewedByUserId: actor.userId, orgReviewedAt: now,
        ...(input.decision === 'rejected' ? { status: 'rejected' as const, rejectionReason: input.note ?? null, verifiedAt: now } : {}),
      })
      .where(and(eq(schema.driverDocuments.id, documentId), eq(schema.driverDocuments.status, 'pending')))
      .returning();
    if (!row) throw AppError.conflict('DOCUMENT_ALREADY_REVIEWED', 'Ce document a déjà été revu');
    this.audit.record({ action: 'fleet.document_reviewed', entity: 'driver_documents', entityId: documentId, after: { decision: input.decision, finalByPlatform: input.decision === 'approved' } });
    return this.documentView(row);
  }

  /** Échéances proches des chauffeurs de l'organisation (documents approuvés qui expirent dans `days` jours). */
  async expiringDocuments(days: number, now = new Date()): Promise<Array<{ documentId: string; driverId: string; type: string; expiresOn: string }>> {
    const timeZone = await this.settings.string('service.time_zone', 'America/Toronto');
    const day = today(timeZone, now);
    const until = new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
    const rows = await this.db.select({ id: schema.driverDocuments.id, driverId: schema.driverDocuments.driverId, type: schema.driverDocuments.type, expiresOn: schema.driverDocuments.expiresOn })
      .from(schema.driverDocuments)
      .where(and(eq(schema.driverDocuments.status, 'approved'), gte(schema.driverDocuments.expiresOn, day), lt(schema.driverDocuments.expiresOn, until)))
      .orderBy(asc(schema.driverDocuments.expiresOn));
    return rows.map((r) => ({ documentId: r.id, driverId: r.driverId, type: r.type, expiresOn: r.expiresOn! }));
  }
}
