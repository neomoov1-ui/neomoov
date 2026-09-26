/**
 * My Hub, chauffeurs (prompt 12) : liste, fiche complète, visionneuse et revue des documents, revue des véhicules,
 * activation, suspension et réactivation, notes internes, sanctions. Données sensibles masquées (téléphone, taxes,
 * numéros de documents). Chaque décision est journalisée avec l'acteur.
 */
import { schema } from '@neomoov/db';
import {
  maskDocumentNumber, maskEmail, maskPhone, maskTaxNumber, type AdminDocument, type AdminDriverDetail, type AdminDriverListItem, type AdminListQuery,
  type AdminVehicle, type DocumentStatus, type DocumentType, type Page, type VehicleCategory, type VehicleStatus,
} from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { STORAGE_PROVIDER, type StorageProvider } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { DomainEventsService } from '../../common/domain-events.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AuditService } from '../audit/audit.service.js';
import type { UserActor } from '../auth/actor.js';
import { PresenceService } from '../rides/presence.service.js';

type DriverRow = typeof schema.drivers.$inferSelect;

const like = (q: string) => `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

@Injectable()
export class AdminDriversService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly audit: AuditService,
    private readonly presence: PresenceService,
    private readonly events: DomainEventsService,
  ) {}

  private get db() {
    return this.database.db;
  }

  private async requireDriver(id: string): Promise<DriverRow> {
    const [row] = await this.db.select().from(schema.drivers).where(eq(schema.drivers.id, id)).limit(1);
    if (!row) throw AppError.notFound('DRIVER_NOT_FOUND', 'Chauffeur introuvable');
    return row;
  }

  // Chauffeurs ------------------------------------------------------------------------------------------------------

  async list(query: AdminListQuery): Promise<Page<AdminDriverListItem>> {
    const conditions: SQL[] = [];
    if (query.status) conditions.push(eq(schema.drivers.status, query.status as DriverRow['status']));
    if (query.q) {
      const q = like(query.q);
      conditions.push(or(ilike(schema.users.firstName, q), ilike(schema.users.lastName, q), ilike(schema.users.phone, q), ilike(schema.drivers.publicNumber, q))!);
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const pending = sql<number>`(SELECT count(*)::int FROM driver_documents dd WHERE dd.driver_id = ${schema.drivers.id} AND dd.status = 'pending')`;
    const [rows, [total]] = await Promise.all([
      this.db
        .select({ driver: schema.drivers, firstName: schema.users.firstName, lastName: schema.users.lastName, phone: schema.users.phone, pending })
        .from(schema.drivers)
        .innerJoin(schema.users, eq(schema.users.id, schema.drivers.userId))
        .where(where)
        // Les dossiers à traiter d'abord : documents en attente, puis candidatures, puis les plus récents.
        .orderBy(desc(pending), sql`${schema.drivers.status} = 'pending' DESC`, desc(schema.drivers.createdAt))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ n: count() }).from(schema.drivers).innerJoin(schema.users, eq(schema.users.id, schema.drivers.userId)).where(where),
    ]);
    return { items: rows.map((r) => this.listItem(r.driver, r, r.pending)), total: total?.n ?? 0, page: query.page, pageSize: query.pageSize };
  }

  private listItem(d: DriverRow, user: { firstName: string | null; lastName: string | null; phone: string }, documentsPending: number): AdminDriverListItem {
    return {
      id: d.id, userId: d.userId, publicNumber: d.publicNumber, status: d.status, firstName: user.firstName, lastName: user.lastName, phone: maskPhone(user.phone),
      qualification: d.qualification, rating: Number(d.ratingAverage), ratingCount: d.ratingCount, rideCount: d.rideCount, isOnline: d.isOnline,
      documentsPending: Number(documentsPending), trainingCertified: d.trainingCertifiedAt !== null, createdAt: d.createdAt.toISOString(),
    };
  }

  async detail(id: string): Promise<AdminDriverDetail> {
    const driver = await this.requireDriver(id);
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [[user], vehicles, documents, notes, sanctions, [completed], [cancellations], [incidents]] = await Promise.all([
      this.db.select().from(schema.users).where(eq(schema.users.id, driver.userId)).limit(1),
      this.vehiclesOf([driver.id]),
      this.documentsOf([driver.id]),
      this.db
        .select({ id: schema.staffNotes.id, body: schema.staffNotes.body, createdAt: schema.staffNotes.createdAt, first: schema.users.firstName, last: schema.users.lastName })
        .from(schema.staffNotes)
        .leftJoin(schema.users, eq(schema.users.id, schema.staffNotes.authorUserId))
        .where(and(eq(schema.staffNotes.entityType, 'driver'), eq(schema.staffNotes.entityId, driver.id)))
        .orderBy(desc(schema.staffNotes.createdAt))
        .limit(100),
      this.db.select().from(schema.sanctions).where(eq(schema.sanctions.driverId, driver.id)).orderBy(desc(schema.sanctions.startsAt)).limit(50),
      this.db.select({ n: count() }).from(schema.rides).where(and(eq(schema.rides.driverId, driver.id), inArray(schema.rides.state, ['completed', 'rated']))),
      this.db.select({ n: count() }).from(schema.rideEvents).where(and(eq(schema.rideEvents.actorUserId, driver.userId), eq(schema.rideEvents.type, 'driver_cancels'), sql`${schema.rideEvents.occurredAt} >= ${since.toISOString()}`)),
      this.db.select({ n: count() }).from(schema.incidents).innerJoin(schema.rides, eq(schema.rides.id, schema.incidents.rideId)).where(eq(schema.rides.driverId, driver.id)),
    ]);
    const pending = documents.filter((d) => d.status === 'pending').length;
    const base = this.listItem(driver, { firstName: user?.firstName ?? null, lastName: user?.lastName ?? null, phone: user?.phone ?? '' }, pending);
    return {
      driver: {
        ...base,
        email: maskEmail(user?.email),
        gstNumber: maskTaxNumber(driver.gstNumber),
        qstNumber: maskTaxNumber(driver.qstNumber),
        spokenLanguages: Array.isArray(driver.spokenLanguages) ? driver.spokenLanguages.filter((l): l is string => typeof l === 'string') : [],
        experienceYears: driver.experienceYears,
        paymentModes: { cash: driver.acceptsCash, interac: driver.acceptsInterac, terminal: driver.acceptsTerminal },
        payout: { linked: Boolean(driver.stripeConnectAccountId), onboarded: driver.stripeConnectOnboarded },
        activatedAt: driver.activatedAt?.toISOString() ?? null,
      },
      vehicles,
      documents,
      notes: notes.map((n) => ({ id: n.id, body: n.body, authorName: [n.first, n.last].filter(Boolean).join(' ') || null, createdAt: n.createdAt.toISOString() })),
      sanctions: sanctions.map((s) => ({ id: s.id, driverId: s.driverId, type: s.type, reason: s.reason, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt?.toISOString() ?? null, decidedByUserId: s.decidedByUserId })),
      stats: { completedRides: completed?.n ?? 0, cancellations30d: cancellations?.n ?? 0, incidents: incidents?.n ?? 0 },
    };
  }

  /** Activation après validation du dossier : le chauffeur peut passer en ligne (s'il remplit les autres prérequis). */
  async activate(id: string, actor: UserActor) {
    const driver = await this.requireDriver(id);
    if (driver.status === 'offboarded') throw AppError.conflict('DRIVER_OFFBOARDED', 'Ce chauffeur a quitté le service');
    await this.db.update(schema.drivers).set({ status: 'active', activatedAt: driver.activatedAt ?? new Date() }).where(eq(schema.drivers.id, id));
    this.audit.record({ action: 'admin.driver_activated', entity: 'drivers', entityId: id, before: { status: driver.status }, after: { status: 'active' } });
    return this.detail(id);
  }

  /** Suspension (sanction en vigueur) : le chauffeur passe hors ligne immédiatement et ne reçoit plus d'offres. */
  async suspend(id: string, reason: string, actor: UserActor) {
    const driver = await this.requireDriver(id);
    await this.db.transaction(async (tx) => {
      await tx.update(schema.drivers).set({ status: 'suspended' }).where(eq(schema.drivers.id, id));
      await tx.insert(schema.sanctions).values({ driverId: id, type: 'suspension', reason, startsAt: new Date(), decidedByUserId: actor.userId });
    });
    await this.presence.setStatus(driver.userId, { status: 'offline' }).catch(() => undefined);
    this.events.emit('driver.presence', { driverId: id, status: 'offline', category: null });
    this.audit.record({ action: 'admin.driver_suspended', entity: 'drivers', entityId: id, before: { status: driver.status }, after: { status: 'suspended', reason } });
    return this.detail(id);
  }

  /** Réactivation : fin des suspensions en cours, retour au statut actif (décision humaine, 5.11). */
  async reactivate(id: string, actor: UserActor) {
    const driver = await this.requireDriver(id);
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx.update(schema.sanctions).set({ endsAt: now }).where(and(eq(schema.sanctions.driverId, id), eq(schema.sanctions.type, 'suspension'), or(isNull(schema.sanctions.endsAt), sql`${schema.sanctions.endsAt} > now()`)));
      await tx.update(schema.drivers).set({ status: 'active', activatedAt: driver.activatedAt ?? now }).where(eq(schema.drivers.id, id));
    });
    this.audit.record({ action: 'admin.driver_reactivated', entity: 'drivers', entityId: id, before: { status: driver.status }, after: { status: 'active' } });
    return this.detail(id);
  }

  async addSanction(id: string, input: { type: 'warning' | 'restriction' | 'suspension'; reason: string; endsAt?: string | undefined }, actor: UserActor) {
    if (input.type === 'suspension') return this.suspend(id, input.reason, actor);
    const driver = await this.requireDriver(id);
    await this.db.insert(schema.sanctions).values({ driverId: id, type: input.type, reason: input.reason, startsAt: new Date(), endsAt: input.endsAt ? new Date(input.endsAt) : null, decidedByUserId: actor.userId });
    if (input.type === 'restriction' && driver.status === 'active') await this.db.update(schema.drivers).set({ status: 'restricted' }).where(eq(schema.drivers.id, id));
    this.audit.record({ action: `admin.driver_${input.type}`, entity: 'drivers', entityId: id, after: { reason: input.reason } });
    return this.detail(id);
  }

  async addNote(entityType: 'driver' | 'client' | 'ride' | 'vehicle', entityId: string, body: string, actor: UserActor) {
    const [row] = await this.db.insert(schema.staffNotes).values({ entityType, entityId, authorUserId: actor.userId, body }).returning();
    this.audit.record({ action: 'admin.note_added', entity: entityType, entityId });
    return { id: row!.id, body: row!.body, authorName: null, createdAt: row!.createdAt.toISOString() };
  }

  // Documents -------------------------------------------------------------------------------------------------------

  private async documentsOf(driverIds: string[] | null, status?: DocumentStatus, page?: { limit: number; offset: number }): Promise<AdminDocument[]> {
    const conditions: SQL[] = [];
    // La file de revue ignore les chauffeurs sortis du service ; leur fiche garde tous leurs documents.
    if (driverIds) conditions.push(inArray(schema.driverDocuments.driverId, driverIds));
    else conditions.push(ne(schema.drivers.status, 'offboarded'));
    if (status) conditions.push(eq(schema.driverDocuments.status, status));
    const rows = await this.db
      .select({ doc: schema.driverDocuments, publicNumber: schema.drivers.publicNumber, first: schema.users.firstName, last: schema.users.lastName })
      .from(schema.driverDocuments)
      .innerJoin(schema.drivers, eq(schema.drivers.id, schema.driverDocuments.driverId))
      .innerJoin(schema.users, eq(schema.users.id, schema.drivers.userId))
      .where(conditions.length ? and(...conditions) : undefined)
      // La file de revue : les plus anciens d'abord ; la fiche d'un chauffeur : les plus récents d'abord.
      .orderBy(status === 'pending' ? schema.driverDocuments.createdAt : desc(schema.driverDocuments.createdAt))
      .limit(page?.limit ?? 500)
      .offset(page?.offset ?? 0);
    return rows.map(({ doc, publicNumber, first, last }) => ({
      id: doc.id, driverId: doc.driverId, driverName: [first, last].filter(Boolean).join(' ') || null, driverPublicNumber: publicNumber, type: doc.type as DocumentType,
      status: doc.status, number: maskDocumentNumber(doc.number), issuedOn: doc.issuedOn, expiresOn: doc.expiresOn, rejectionReason: doc.rejectionReason,
      uploadedAt: doc.createdAt.toISOString(), verifiedAt: doc.verifiedAt?.toISOString() ?? null,
    }));
  }

  async documents(query: AdminListQuery): Promise<Page<AdminDocument>> {
    const status = (query.status ?? 'pending') as DocumentStatus;
    const [items, [total]] = await Promise.all([
      this.documentsOf(null, status, { limit: query.pageSize, offset: (query.page - 1) * query.pageSize }),
      this.db
        .select({ n: count() })
        .from(schema.driverDocuments)
        .innerJoin(schema.drivers, eq(schema.drivers.id, schema.driverDocuments.driverId))
        .where(and(eq(schema.driverDocuments.status, status), ne(schema.drivers.status, 'offboarded'))),
    ]);
    return { items, total: total?.n ?? 0, page: query.page, pageSize: query.pageSize };
  }

  /** Fichier du document (visionneuse) : lu depuis le stockage privé, jamais exposé par un lien public. */
  async documentContent(id: string, actor: UserActor): Promise<{ body: Buffer; contentType: string }> {
    const [doc] = await this.db.select({ fileKey: schema.driverDocuments.fileKey, driverId: schema.driverDocuments.driverId }).from(schema.driverDocuments).where(eq(schema.driverDocuments.id, id)).limit(1);
    if (!doc) throw AppError.notFound('DOCUMENT_NOT_FOUND', 'Document introuvable');
    const object = await this.storage.getObject(doc.fileKey);
    if (!object) throw AppError.notFound('DOCUMENT_FILE_NOT_FOUND', 'Fichier du document introuvable dans le stockage');
    this.audit.record({ action: 'admin.document_viewed', entity: 'driver_documents', entityId: id });
    return object;
  }

  /** Revue humaine d'un document (5.12) : approbation (avec l'échéance lue sur le document) ou refus motivé. */
  async reviewDocument(id: string, input: { decision: 'approved' | 'rejected'; reason?: string | undefined; expiresOn?: string | undefined; number?: string | undefined }, actor: UserActor): Promise<AdminDocument> {
    const [doc] = await this.db.select().from(schema.driverDocuments).where(eq(schema.driverDocuments.id, id)).limit(1);
    if (!doc) throw AppError.notFound('DOCUMENT_NOT_FOUND', 'Document introuvable');
    await this.db
      .update(schema.driverDocuments)
      .set({
        status: input.decision, verifiedByUserId: actor.userId, verifiedAt: new Date(), rejectionReason: input.decision === 'rejected' ? input.reason ?? null : null,
        ...(input.expiresOn ? { expiresOn: input.expiresOn } : {}), ...(input.number ? { number: input.number } : {}),
      })
      .where(eq(schema.driverDocuments.id, id));
    this.audit.record({ action: `admin.document_${input.decision}`, entity: 'driver_documents', entityId: id, before: { status: doc.status }, after: { status: input.decision, reason: input.reason ?? null } });
    const [view] = (await this.documentsOf([doc.driverId])).filter((d) => d.id === id);
    return view!;
  }

  // Véhicules -------------------------------------------------------------------------------------------------------

  private async vehiclesOf(driverIds: string[] | null, status?: VehicleStatus, page?: { limit: number; offset: number }, q?: string): Promise<AdminVehicle[]> {
    const conditions: SQL[] = [];
    if (driverIds) conditions.push(inArray(schema.vehicles.driverId, driverIds));
    if (status) conditions.push(eq(schema.vehicles.status, status));
    if (q) conditions.push(or(ilike(schema.vehicles.plate, like(q)), ilike(schema.vehicles.model, like(q)), ilike(schema.drivers.publicNumber, like(q)))!);
    const rows = await this.db
      .select({ vehicle: schema.vehicles, publicNumber: schema.drivers.publicNumber, first: schema.users.firstName, last: schema.users.lastName })
      .from(schema.vehicles)
      .innerJoin(schema.drivers, eq(schema.drivers.id, schema.vehicles.driverId))
      .innerJoin(schema.users, eq(schema.users.id, schema.drivers.userId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(sql`${schema.vehicles.status} = 'pending' DESC`, desc(schema.vehicles.createdAt))
      .limit(page?.limit ?? 100)
      .offset(page?.offset ?? 0);
    return rows.map(({ vehicle: v, publicNumber, first, last }) => ({
      id: v.id, driverId: v.driverId, driverName: [first, last].filter(Boolean).join(' ') || null, driverPublicNumber: publicNumber, category: v.category as VehicleCategory,
      make: v.make, model: v.model, year: v.year, colour: v.colour, plate: v.plate, seats: v.seats, status: v.status, nextInspectionDueOn: v.nextInspectionDueOn, createdAt: v.createdAt.toISOString(),
    }));
  }

  async vehicles(query: AdminListQuery): Promise<Page<AdminVehicle>> {
    const status = query.status as VehicleStatus | undefined;
    const [items, [total]] = await Promise.all([
      this.vehiclesOf(null, status, { limit: query.pageSize, offset: (query.page - 1) * query.pageSize }, query.q),
      this.db.select({ n: count() }).from(schema.vehicles).where(status ? eq(schema.vehicles.status, status) : undefined),
    ]);
    return { items, total: total?.n ?? 0, page: query.page, pageSize: query.pageSize };
  }

  /** Inspection du véhicule : actif (avec la prochaine échéance), non conforme ou retiré. */
  async reviewVehicle(id: string, input: { status: VehicleStatus; nextInspectionDueOn?: string | undefined }, actor: UserActor): Promise<AdminVehicle> {
    const [vehicle] = await this.db.select().from(schema.vehicles).where(eq(schema.vehicles.id, id)).limit(1);
    if (!vehicle) throw AppError.notFound('VEHICLE_NOT_FOUND', 'Véhicule introuvable');
    await this.db
      .update(schema.vehicles)
      .set({ status: input.status, ...(input.status === 'active' ? { lastInspectionOn: new Date().toISOString().slice(0, 10) } : {}), ...(input.nextInspectionDueOn ? { nextInspectionDueOn: input.nextInspectionDueOn } : {}) })
      .where(eq(schema.vehicles.id, id));
    this.audit.record({ action: 'admin.vehicle_reviewed', entity: 'vehicles', entityId: id, before: { status: vehicle.status }, after: { status: input.status } });
    const [view] = (await this.vehiclesOf([vehicle.driverId])).filter((v) => v.id === id);
    return view!;
  }
}
