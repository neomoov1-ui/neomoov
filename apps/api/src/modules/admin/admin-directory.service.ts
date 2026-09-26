/**
 * My Hub, annuaire et réglages (prompt 12) : clients, incidents et décisions, paramètres, personnel, demandes de
 * droits, prospects, catalogue (packs, promotions, factures, relevés), tarifs datés et
 * polygones de zones (validés avant tout enregistrement). Données sensibles masquées ; décisions journalisées.
 */
import { schema } from '@neomoov/db';
import {
  localDate, maskEmail, maskPhone, validateRing, type AdminClient, type AdminIncident, type AdminListQuery, type Page, type UserRole, type VehicleCategory,
} from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import { AppError } from '../../common/app-error.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AuditService } from '../audit/audit.service.js';
import type { UserActor } from '../auth/actor.js';
import { DEFAULT_CITY, PricingRulesService } from '../pricing/pricing-rules.service.js';
import { ZonesService } from '../pricing/zones.service.js';

const like = (q: string) => `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
const pageArgs = (q: AdminListQuery) => ({ limit: q.pageSize, offset: (q.page - 1) * q.pageSize });

@Injectable()
export class AdminDirectoryService {
  constructor(
    @Inject(DB) private readonly database: Database,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly rules: PricingRulesService,
    private readonly zones: ZonesService,
  ) {}

  private get db() {
    return this.database.db;
  }

  // Clients ---------------------------------------------------------------------------------------------------------

  async clients(query: AdminListQuery): Promise<Page<AdminClient>> {
    const conditions: SQL[] = [sql`${schema.users.deletedAt} IS NULL`];
    if (query.status) conditions.push(eq(schema.clients.status, query.status));
    if (query.q) conditions.push(or(ilike(schema.users.firstName, like(query.q)), ilike(schema.users.lastName, like(query.q)), ilike(schema.users.phone, like(query.q)), ilike(schema.users.email, like(query.q)))!);
    const where = and(...conditions);
    const { limit, offset } = pageArgs(query);
    const [rows, [total]] = await Promise.all([
      this.db
        .select({ client: schema.clients, user: { firstName: schema.users.firstName, lastName: schema.users.lastName, phone: schema.users.phone, email: schema.users.email } })
        .from(schema.clients)
        .innerJoin(schema.users, eq(schema.users.id, schema.clients.userId))
        .where(where)
        .orderBy(desc(schema.clients.createdAt))
        .limit(limit)
        .offset(offset),
      this.db.select({ n: count() }).from(schema.clients).innerJoin(schema.users, eq(schema.users.id, schema.clients.userId)).where(where),
    ]);
    return {
      items: rows.map(({ client, user }) => ({
        id: client.id, userId: client.userId, firstName: user.firstName, lastName: user.lastName, phone: maskPhone(user.phone), email: maskEmail(user.email),
        rideCount: client.rideCount, status: client.status, createdAt: client.createdAt.toISOString(),
      })),
      total: total?.n ?? 0, page: query.page, pageSize: query.pageSize,
    };
  }

  // Incidents et approbations -----------------------------------------------------------------------------------------

  async incidents(query: AdminListQuery): Promise<Page<AdminIncident>> {
    const conditions: SQL[] = [];
    if (query.status === 'privacy') conditions.push(isNotNull(schema.incidents.privacyBreach));
    else if (query.status === 'open') conditions.push(inArray(schema.incidents.status, ['open', 'investigating']));
    else if (query.status) conditions.push(eq(schema.incidents.status, query.status as AdminIncident['status']));
    const where = conditions.length ? and(...conditions) : undefined;
    const { limit, offset } = pageArgs(query);
    const [rows, [total]] = await Promise.all([
      this.db
        .select({ incident: schema.incidents, publicNumber: schema.rides.publicNumber })
        .from(schema.incidents)
        .leftJoin(schema.rides, eq(schema.rides.id, schema.incidents.rideId))
        .where(where)
        .orderBy(sql`CASE ${schema.incidents.status} WHEN 'open' THEN 0 WHEN 'investigating' THEN 1 ELSE 2 END`, sql`CASE ${schema.incidents.severity} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`, desc(schema.incidents.createdAt))
        .limit(limit)
        .offset(offset),
      this.db.select({ n: count() }).from(schema.incidents).where(where),
    ]);
    return { items: rows.map(({ incident, publicNumber }) => this.incidentView(incident, publicNumber)), total: total?.n ?? 0, page: query.page, pageSize: query.pageSize };
  }

  private incidentView(i: typeof schema.incidents.$inferSelect, publicNumber: string | null): AdminIncident {
    return {
      id: i.id, rideId: i.rideId, ridePublicNumber: publicNumber, type: i.type, severity: i.severity, status: i.status, reportedByKind: i.reportedByKind, description: i.description,
      decision: i.decision, decidedAt: i.decidedAt?.toISOString() ?? null, privacyBreach: i.privacyBreach !== null, createdAt: i.createdAt.toISOString(),
    };
  }

  /** Décision humaine sur un incident (5.11) : instruction, décision motivée, clôture. */
  async decideIncident(id: string, input: { status: 'investigating' | 'decided' | 'closed'; decision?: string | undefined }, actor: UserActor): Promise<AdminIncident> {
    const [incident] = await this.db.select().from(schema.incidents).where(eq(schema.incidents.id, id)).limit(1);
    if (!incident) throw AppError.notFound('INCIDENT_NOT_FOUND', 'Incident introuvable');
    if (input.status !== 'investigating' && !input.decision && !incident.decision) throw new AppError('DECISION_REQUIRED', 'Une décision motivée est requise', 400);
    const decided = input.status !== 'investigating';
    const [row] = await this.db
      .update(schema.incidents)
      .set({ status: input.status, ...(input.decision ? { decision: input.decision } : {}), ...(decided ? { decidedByUserId: actor.userId, decidedAt: new Date() } : {}) })
      .where(eq(schema.incidents.id, id))
      .returning();
    this.audit.record({ action: `admin.incident_${input.status}`, entity: 'incidents', entityId: id, before: { status: incident.status }, after: { status: input.status, decision: input.decision ?? null } });
    const [ride] = row!.rideId ? await this.db.select({ publicNumber: schema.rides.publicNumber }).from(schema.rides).where(eq(schema.rides.id, row!.rideId)).limit(1) : [];
    return this.incidentView(row!, ride?.publicNumber ?? null);
  }

  // Paramètres ------------------------------------------------------------------------------------------------------

  async settingsList(q?: string) {
    const rows = await this.db
      .select()
      .from(schema.settings)
      .where(and(eq(schema.settings.scope, 'global'), q ? or(ilike(schema.settings.key, like(q)), ilike(schema.settings.description, like(q))) : undefined))
      .orderBy(schema.settings.key);
    return rows.map((r) => ({ key: r.key, value: r.value, description: r.description, updatedAt: r.updatedAt?.toISOString() ?? null }));
  }

  /** Modification d'un réglage (admin) : même type de valeur que l'actuelle ; effective au plus une minute plus tard. */
  async updateSetting(key: string, value: unknown, actor: UserActor) {
    const [current] = await this.db.select().from(schema.settings).where(and(eq(schema.settings.key, key), eq(schema.settings.scope, 'global'))).limit(1);
    if (!current) throw AppError.notFound('SETTING_NOT_FOUND', 'Réglage introuvable');
    const kind = (v: unknown) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
    if (kind(current.value) !== kind(value)) throw new AppError('SETTING_TYPE_MISMATCH', 'Le type de la valeur ne correspond pas au réglage', 400, { expected: kind(current.value), received: kind(value) });
    await this.db.update(schema.settings).set({ value: value as object, updatedBy: actor.userId }).where(and(eq(schema.settings.key, key), eq(schema.settings.scope, 'global')));
    this.settings.invalidate();
    this.audit.record({ action: 'admin.setting_updated', entity: 'settings', entityId: null, before: { key, value: current.value }, after: { key, value } });
    return (await this.settingsList()).find((s) => s.key === key)!;
  }

  // Personnel, droits, prospects ------------------------------------------------------------------------------------

  async staff() {
    const rows = await this.db.execute<{ id: string; email: string | null; first_name: string | null; last_name: string | null; status: string; created_at: string; roles: UserRole[]; mfa: boolean }>(sql`
      SELECT u.id, u.email, u.first_name, u.last_name, u.status, u.created_at,
        array_agg(DISTINCT r.role) AS roles, (c.totp_enabled_at IS NOT NULL) AS mfa
      FROM users u JOIN user_roles r ON r.user_id = u.id LEFT JOIN staff_credentials c ON c.user_id = u.id
      WHERE r.role IN ('admin', 'operator', 'finance', 'readonly') AND u.deleted_at IS NULL
      GROUP BY u.id, c.totp_enabled_at ORDER BY u.created_at DESC LIMIT 500`);
    return [...rows].map((r) => ({ id: r.id, email: maskEmail(r.email), firstName: r.first_name, lastName: r.last_name, roles: r.roles, mfaEnrolled: Boolean(r.mfa), status: r.status, createdAt: new Date(r.created_at).toISOString() }));
  }

  async dataRequests(query: AdminListQuery) {
    const today = localDate(new Date(), await this.settings.string('service.time_zone', 'America/Toronto')).date;
    const where = query.status === 'open' ? sql`${schema.dataRequests.processedAt} IS NULL` : undefined;
    const { limit, offset } = pageArgs(query);
    const [rows, [total]] = await Promise.all([
      this.db.select().from(schema.dataRequests).where(where).orderBy(schema.dataRequests.dueOn).limit(limit).offset(offset),
      this.db.select({ n: count() }).from(schema.dataRequests).where(where),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id, userId: r.userId, type: r.type, status: r.processedAt ? ('done' as const) : r.dueOn < today ? ('overdue' as const) : ('open' as const),
        receivedAt: r.receivedAt.toISOString(), dueOn: r.dueOn, processedAt: r.processedAt?.toISOString() ?? null, outcome: r.outcome,
      })),
      total: total?.n ?? 0, page: query.page, pageSize: query.pageSize,
    };
  }

  async leads(query: AdminListQuery) {
    const conditions: SQL[] = [];
    if (query.status) conditions.push(eq(schema.leads.status, query.status));
    if (query.q) conditions.push(or(ilike(schema.leads.firstName, like(query.q)), ilike(schema.leads.lastName, like(query.q)), ilike(schema.leads.city, like(query.q)))!);
    const where = conditions.length ? and(...conditions) : undefined;
    const { limit, offset } = pageArgs(query);
    const [rows, [total]] = await Promise.all([
      this.db.select().from(schema.leads).where(where).orderBy(desc(schema.leads.createdAt)).limit(limit).offset(offset),
      this.db.select({ n: count() }).from(schema.leads).where(where),
    ]);
    return {
      items: rows.map((l) => ({
        id: l.id, kind: l.kind as 'driver' | 'business' | 'partner', firstName: l.firstName, lastName: l.lastName, phone: maskPhone(l.phone), email: maskEmail(l.email), city: l.city,
        message: l.message, source: l.source, status: l.status as 'new' | 'contacted' | 'converted' | 'discarded', createdAt: l.createdAt.toISOString(),
      })),
      total: total?.n ?? 0, page: query.page, pageSize: query.pageSize,
    };
  }

  async setLeadStatus(id: string, status: 'new' | 'contacted' | 'converted' | 'discarded') {
    const [row] = await this.db.update(schema.leads).set({ status }).where(eq(schema.leads.id, id)).returning({ id: schema.leads.id });
    if (!row) throw AppError.notFound('LEAD_NOT_FOUND', 'Prospect introuvable');
    this.audit.record({ action: 'admin.lead_status', entity: 'leads', entityId: id, after: { status } });
    return (await this.leads({ page: 1, pageSize: 100 })).items.find((l) => l.id === id) ?? null;
  }

  // Catalogue et comptabilité (lecture) -------------------------------------------------------------------------------

  async packs() {
    return this.db.select().from(schema.packs).orderBy(schema.packs.sortOrder);
  }

  async promotions() {
    const rows = await this.db.select().from(schema.promotions).orderBy(desc(schema.promotions.validFrom)).limit(200);
    return rows.map((p) => ({ id: p.id, code: p.code, name: p.name, type: p.type, value: p.value, active: p.active, spentCents: p.spentCents, budgetCents: p.budgetCents, validFrom: p.validFrom.toISOString(), validTo: p.validTo?.toISOString() ?? null }));
  }

  async invoices(query: AdminListQuery) {
    const where = query.status ? eq(schema.invoices.sevStatus, query.status as typeof schema.invoices.$inferSelect['sevStatus']) : undefined;
    const { limit, offset } = pageArgs(query);
    const [rows, [total]] = await Promise.all([
      this.db.select().from(schema.invoices).where(where).orderBy(desc(schema.invoices.issuedAt)).limit(limit).offset(offset),
      this.db.select({ n: count() }).from(schema.invoices).where(where),
    ]);
    return {
      items: rows.map((i) => ({ id: i.id, number: i.number, rideId: i.rideId, supplierName: i.supplierName, totalCents: i.totalCents, paymentMethod: i.paymentMethod, sevStatus: i.sevStatus, sevTransactionId: i.sevTransactionId, issuedAt: i.issuedAt.toISOString() })),
      total: total?.n ?? 0, page: query.page, pageSize: query.pageSize,
    };
  }

  async statements(query: AdminListQuery) {
    const where = query.status ? eq(schema.weeklyStatements.status, query.status as typeof schema.weeklyStatements.$inferSelect['status']) : undefined;
    const { limit, offset } = pageArgs(query);
    const [rows, [total]] = await Promise.all([
      this.db
        .select({ s: schema.weeklyStatements, publicNumber: schema.drivers.publicNumber, first: schema.users.firstName, last: schema.users.lastName })
        .from(schema.weeklyStatements)
        .innerJoin(schema.drivers, eq(schema.drivers.id, schema.weeklyStatements.driverId))
        .innerJoin(schema.users, eq(schema.users.id, schema.drivers.userId))
        .where(where)
        .orderBy(desc(schema.weeklyStatements.periodStart))
        .limit(limit)
        .offset(offset),
      this.db.select({ n: count() }).from(schema.weeklyStatements).where(where),
    ]);
    return {
      items: rows.map(({ s, publicNumber, first, last }) => ({
        id: s.id, driverId: s.driverId, driverPublicNumber: publicNumber, driverName: [first, last].filter(Boolean).join(' ') || null, periodStart: s.periodStart, periodEnd: s.periodEnd,
        status: s.status, creditsCents: s.creditsCents, debitsCents: s.debitsCents, netCents: s.netCents, issuedAt: s.issuedAt?.toISOString() ?? null,
      })),
      total: total?.n ?? 0, page: query.page, pageSize: query.pageSize,
    };
  }

  // Tarifs et zones ---------------------------------------------------------------------------------------------------

  async pricingRules() {
    const rows = await this.db.select().from(schema.pricingRules).where(eq(schema.pricingRules.cityCode, DEFAULT_CITY)).orderBy(schema.pricingRules.category, desc(schema.pricingRules.validFrom));
    return rows.map((r) => ({
      id: r.id, cityCode: r.cityCode, category: r.category as VehicleCategory, baseCents: r.baseCents, perKmCents: r.perKmCents, perMinuteCents: r.perMinuteCents, minimumCents: r.minimumCents,
      validFrom: r.validFrom, validTo: r.validTo, createdAt: r.createdAt.toISOString(),
    }));
  }

  /**
   * Nouvelle grille d'une catégorie avec sa date d'entrée en vigueur : la ligne la plus récente déjà en vigueur fait foi
   * (étape 4) ; les devis en cours gardent leur prix, les caches sont vidés.
   */
  async addPricingRule(input: { category: VehicleCategory; baseCents: number; perKmCents: number; perMinuteCents: number; minimumCents: number; validFrom: string }) {
    const today = localDate(new Date(), await this.settings.string('service.time_zone', 'America/Toronto')).date;
    if (input.validFrom < today) throw new AppError('VALID_FROM_IN_PAST', 'La date d\'entrée en vigueur ne peut pas être passée', 400, { today });
    const [row] = await this.db.insert(schema.pricingRules).values({ cityCode: DEFAULT_CITY, ...input }).returning();
    this.rules.invalidate();
    this.audit.record({ action: 'admin.pricing_rule_added', entity: 'pricing_rules', entityId: row!.id, after: input });
    return (await this.pricingRules()).find((r) => r.id === row!.id)!;
  }

  async zoneGeometries() {
    const rows = await this.db.execute<{ id: string; code: string; name: string; type: string; active: boolean; geometry: string }>(sql`
      SELECT id, code, name, type, active, ST_AsGeoJSON(geometry) AS geometry FROM zones WHERE city_code = ${DEFAULT_CITY} ORDER BY type, code`);
    return [...rows].map((z) => ({ id: z.id, code: z.code, name: z.name, type: z.type, active: z.active, geometry: JSON.parse(z.geometry) as { type: 'Polygon'; coordinates: [number, number][][] } }));
  }

  /** Polygone d'une zone : fermé, sans auto-intersection, dans les bornes (validation du domaine) avant enregistrement. */
  async updateZone(code: string, input: { name?: string | undefined; geometry: { type: 'Polygon'; coordinates: [number, number][][] } }) {
    const ring = input.geometry.coordinates[0]!;
    const check = validateRing(ring);
    if (!check.valid) throw new AppError('INVALID_POLYGON', 'Polygone invalide', 400, { reason: check.reason, segments: check.segments ?? null });
    const [zone] = await this.db.select({ id: schema.zones.id }).from(schema.zones).where(and(eq(schema.zones.cityCode, DEFAULT_CITY), eq(schema.zones.code, code))).limit(1);
    if (!zone) throw AppError.notFound('ZONE_NOT_FOUND', 'Zone introuvable');
    await this.db.update(schema.zones).set({ geometry: input.geometry, ...(input.name ? { name: input.name } : {}) }).where(eq(schema.zones.id, zone.id));
    this.zones.invalidate();
    this.rules.invalidate();
    this.audit.record({ action: 'admin.zone_updated', entity: 'zones', entityId: zone.id, after: { code, points: ring.length } });
    return (await this.zoneGeometries()).find((z) => z.code === code)!;
  }
}
