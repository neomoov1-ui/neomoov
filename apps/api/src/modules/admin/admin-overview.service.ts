/**
 * My Hub, supervision (prompt 12) : tableau de bord agrégé (compteurs, flotte, alertes, planifiées non confirmées),
 * liste des courses triée par pertinence pour la répartition, rapports (indicateurs du document de référence 11.7) et
 * courbes quotidiennes. Heures et jours de Montréal.
 */
import { schema } from '@neomoov/db';
import { localDate, maskPhone, type AdminDashboard, type AdminReport, type AdminRideListItem, type Page, type PaymentMethod, type RideState, type RideType, type VehicleCategory } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';

const ACTIVE: RideState[] = ['requested', 'offering', 'assigned', 'en_route', 'arrived', 'in_progress'];
const like = (q: string) => `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
const pct = (part: number, whole: number) => (whole ? Math.round((part * 1000) / whole) / 10 : 0);

@Injectable()
export class AdminOverviewService {
  constructor(
    @Inject(DB) private readonly database: Database,
    private readonly settings: SettingsService,
  ) {}

  private get db() {
    return this.database.db;
  }

  private async timeZone(): Promise<string> {
    return this.settings.string('service.time_zone', 'America/Toronto');
  }

  /** Début du jour local (heure de Montréal) d'une date AAAA-MM-JJ, comme expression SQL. */
  private dayStart(date: string, tz: string) {
    return sql`(${date}::date::timestamp AT TIME ZONE ${tz})`;
  }

  async dashboard(): Promise<AdminDashboard> {
    const tz = await this.timeZone();
    const today = localDate(new Date(), tz).date;
    const start = this.dayStart(today, tz);
    const now = new Date();
    const completedAt = sql`(${schema.rides.stateTimestamps}->>'completed')::timestamptz`;
    const [[ridesToday], [ridesActive], [ridesSearching], [scheduledUpcoming], [driversPending], [documentsPending], [incidentsOpen], [approvalsPending], [completed], presence, alerts, unconfirmed] = await Promise.all([
      this.db.select({ n: count() }).from(schema.rides).where(sql`${schema.rides.createdAt} >= ${start}`),
      this.db.select({ n: count() }).from(schema.rides).where(inArray(schema.rides.state, ['assigned', 'en_route', 'arrived', 'in_progress'])),
      this.db.select({ n: count() }).from(schema.rides).where(and(inArray(schema.rides.state, ['requested', 'offering']), sql`(${schema.rides.requestedAt} IS NULL OR ${schema.rides.requestedAt} > now() - interval '1 hour')`)),
      this.db.select({ n: count() }).from(schema.rides).where(and(eq(schema.rides.type, 'scheduled'), inArray(schema.rides.state, ['requested', 'offering', 'assigned']), gte(schema.rides.requestedAt, now))),
      this.db.select({ n: count() }).from(schema.drivers).where(eq(schema.drivers.status, 'pending')),
      this.db.select({ n: count() }).from(schema.driverDocuments).where(eq(schema.driverDocuments.status, 'pending')),
      this.db.select({ n: count() }).from(schema.incidents).where(inArray(schema.incidents.status, ['open', 'investigating'])),
      this.db.select({ n: count() }).from(schema.approvals).where(eq(schema.approvals.decision, 'pending')),
      this.db
        .select({ n: count(), revenue: sql<number>`COALESCE(sum(${schema.rides.finalPriceCents}), 0)::int` })
        .from(schema.rides)
        .where(and(inArray(schema.rides.state, ['completed', 'rated']), sql`${completedAt} >= ${start}`)),
      this.db.execute<{ driver_id: string; public_number: string; first_name: string | null; is_available: boolean; category: VehicleCategory | null; lat: number; lng: number; current_ride_id: string | null; updated_at: string }>(sql`
        SELECT p.driver_id, d.public_number, u.first_name, p.is_available, p.category, ST_Y(p.position::geometry) AS lat, ST_X(p.position::geometry) AS lng, p.current_ride_id, p.updated_at
        FROM driver_presence p JOIN drivers d ON d.id = p.driver_id JOIN users u ON u.id = d.user_id
        ORDER BY p.updated_at DESC LIMIT 2000`),
      this.db.select().from(schema.incidents).where(inArray(schema.incidents.status, ['open', 'investigating'])).orderBy(sql`CASE ${schema.incidents.severity} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`, desc(schema.incidents.createdAt)).limit(20),
      this.db
        .select({ rideId: schema.rides.id, publicNumber: schema.rides.publicNumber, requestedAt: schema.rides.requestedAt, first: schema.users.firstName, last: schema.users.lastName })
        .from(schema.scheduledAssignments)
        .innerJoin(schema.rides, eq(schema.rides.id, schema.scheduledAssignments.rideId))
        .innerJoin(schema.drivers, eq(schema.drivers.id, schema.scheduledAssignments.driverId))
        .innerJoin(schema.users, eq(schema.users.id, schema.drivers.userId))
        .where(and(isNull(schema.scheduledAssignments.confirmedAt), isNull(schema.scheduledAssignments.declinedAt), gte(schema.rides.requestedAt, now), inArray(schema.rides.state, ['requested', 'offering', 'assigned'])))
        .orderBy(schema.rides.requestedAt)
        .limit(20),
    ]);
    const fleet = [...presence].map((p) => ({
      driverId: p.driver_id, publicNumber: p.public_number, firstName: p.first_name, status: p.is_available ? ('online' as const) : ('paused' as const), category: p.category,
      coordinates: { lat: Number(p.lat), lng: Number(p.lng) }, currentRideId: p.current_ride_id, updatedAt: new Date(p.updated_at).toISOString(),
    }));
    return {
      counts: {
        ridesToday: ridesToday?.n ?? 0, ridesActive: ridesActive?.n ?? 0, ridesSearching: ridesSearching?.n ?? 0, scheduledUpcoming: scheduledUpcoming?.n ?? 0, scheduledUnconfirmed: unconfirmed.length,
        driversOnline: fleet.filter((f) => f.status === 'online').length, driversPaused: fleet.filter((f) => f.status === 'paused').length, driversPending: driversPending?.n ?? 0,
        documentsPending: documentsPending?.n ?? 0, incidentsOpen: incidentsOpen?.n ?? 0, approvalsPending: approvalsPending?.n ?? 0,
      },
      completedToday: completed?.n ?? 0,
      revenueTodayCents: completed?.revenue ?? 0,
      alerts: alerts.map((a) => ({ incidentId: a.id, rideId: a.rideId, type: a.type, severity: a.severity, status: a.status, description: a.description, createdAt: a.createdAt.toISOString() })),
      unconfirmed: unconfirmed.map((u) => ({ rideId: u.rideId, publicNumber: u.publicNumber, requestedAt: u.requestedAt!.toISOString(), driverName: [u.first, u.last].filter(Boolean).join(' ') || null })),
      fleet,
      generatedAt: now.toISOString(),
    };
  }

  /**
   * Courses pour la répartition : `active` (ouvertes, les plus urgentes d'abord : sans chauffeur, puis par heure de prise
   * en charge), `scheduled` (planifiées à venir), `recent` (toutes, les plus récentes d'abord). Recherche par numéro,
   * adresse, nom ou téléphone.
   */
  async rides(query: { page: number; pageSize: number; q?: string | undefined; state?: RideState | undefined; view: 'active' | 'scheduled' | 'recent' }): Promise<Page<AdminRideListItem>> {
    const clientUser = sql.raw('cu');
    const driverUser = sql.raw('du');
    const conditions: SQL[] = [];
    if (query.state) conditions.push(eq(schema.rides.state, query.state));
    else if (query.view === 'active') conditions.push(inArray(schema.rides.state, ACTIVE));
    if (query.view === 'scheduled') conditions.push(and(eq(schema.rides.type, 'scheduled'), gte(schema.rides.requestedAt, new Date()))!);
    if (query.q) {
      const q = like(query.q);
      conditions.push(or(ilike(schema.rides.publicNumber, q), ilike(schema.rides.originAddress, q), ilike(schema.rides.destinationAddress, q), ilike(schema.rides.guestName, q), ilike(schema.rides.guestPhone, q), sql`${clientUser}.phone ILIKE ${q}`, sql`${clientUser}.first_name ILIKE ${q}`, sql`${clientUser}.last_name ILIKE ${q}`)!);
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const order = query.view === 'recent'
      ? [desc(schema.rides.createdAt)]
      : [sql`${schema.rides.driverId} IS NOT NULL`, sql`${schema.rides.requestedAt} ASC NULLS FIRST`];
    const from = sql`rides LEFT JOIN clients c ON c.id = rides.client_id LEFT JOIN users ${clientUser} ON ${clientUser}.id = c.user_id LEFT JOIN drivers d ON d.id = rides.driver_id LEFT JOIN users ${driverUser} ON ${driverUser}.id = d.user_id`;
    const whereSql = where ? sql`WHERE ${where}` : sql``;
    const [rows, [total]] = await Promise.all([
      this.db.execute<{
        id: string; public_number: string; state: RideState; type: RideType; reserved_category: VehicleCategory; requested_at: string | null; origin_address: string; destination_address: string;
        guest_name: string | null; guest_phone: string | null; client_first: string | null; client_last: string | null; client_phone: string | null; driver_first: string | null; driver_last: string | null;
        driver_number: string | null; quoted_total_cents: number; final_price_cents: number | null; payment_method: PaymentMethod; created_at: string;
      }>(sql`
        SELECT rides.id, rides.public_number, rides.state, rides.type, rides.reserved_category, rides.requested_at, rides.origin_address, rides.destination_address, rides.guest_name, rides.guest_phone,
          ${clientUser}.first_name AS client_first, ${clientUser}.last_name AS client_last, ${clientUser}.phone AS client_phone, ${driverUser}.first_name AS driver_first, ${driverUser}.last_name AS driver_last,
          d.public_number AS driver_number, rides.quoted_total_cents, rides.final_price_cents, rides.payment_method, rides.created_at
        FROM ${from} ${whereSql}
        ORDER BY ${sql.join(order, sql`, `)}
        LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`),
      this.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM ${from} ${whereSql}`),
    ]);
    return {
      items: [...rows].map((r) => ({
        id: r.id, publicNumber: r.public_number, state: r.state, type: r.type, category: r.reserved_category, requestedAt: r.requested_at ? new Date(r.requested_at).toISOString() : null,
        origin: r.origin_address, destination: r.destination_address,
        clientName: [r.client_first, r.client_last].filter(Boolean).join(' ') || r.guest_name || null, clientPhone: maskPhone(r.client_phone ?? r.guest_phone),
        driverName: [r.driver_first, r.driver_last].filter(Boolean).join(' ') || null, driverPublicNumber: r.driver_number,
        quotedTotalCents: Number(r.quoted_total_cents), finalPriceCents: r.final_price_cents === null ? null : Number(r.final_price_cents), paymentMethod: r.payment_method, createdAt: new Date(r.created_at).toISOString(),
      })),
      total: Number(total?.n ?? 0),
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Rapport d'une période (dates locales incluses) : volumes, revenus, taux d'annulation et d'absence de chauffeur, note. */
  async report(from: string, to: string): Promise<AdminReport> {
    const tz = await this.timeZone();
    const start = this.dayStart(from, tz);
    const end = sql`((${to}::date + 1)::timestamp AT TIME ZONE ${tz})`;
    const completedAt = sql`(${schema.rides.stateTimestamps}->>'completed')::timestamptz`;
    const inPeriod = (column: SQL) => and(sql`${column} >= ${start}`, sql`${column} < ${end}`);
    const [[requested], [completed], [cancelled], [noDriver], [noShow], [rating], [newClients], [newDrivers], [activeDrivers], daily] = await Promise.all([
      this.db.select({ n: count() }).from(schema.rides).where(inPeriod(sql`${schema.rides.createdAt}`)),
      this.db.select({ n: count(), revenue: sql<number>`COALESCE(sum(${schema.rides.finalPriceCents}), 0)::int`, tips: sql<number>`COALESCE(sum(${schema.rides.tipCents}), 0)::int` }).from(schema.rides).where(and(inArray(schema.rides.state, ['completed', 'rated', 'disputed']), inPeriod(completedAt))),
      this.db.select({ n: count() }).from(schema.rides).where(and(inArray(schema.rides.state, ['cancelled_by_client', 'cancelled_by_driver']), inPeriod(sql`${schema.rides.updatedAt}`))),
      this.db.select({ n: count() }).from(schema.rides).where(and(eq(schema.rides.state, 'no_driver'), inPeriod(sql`${schema.rides.updatedAt}`))),
      this.db.select({ n: count() }).from(schema.rides).where(and(eq(schema.rides.state, 'no_show'), inPeriod(sql`${schema.rides.updatedAt}`))),
      this.db.select({ avg: sql<number | null>`avg(${schema.rideRatings.score})::float` }).from(schema.rideRatings).where(and(eq(schema.rideRatings.authorKind, 'client'), inPeriod(sql`${schema.rideRatings.createdAt}`))),
      this.db.select({ n: count() }).from(schema.clients).where(inPeriod(sql`${schema.clients.createdAt}`)),
      this.db.select({ n: count() }).from(schema.drivers).where(inPeriod(sql`${schema.drivers.createdAt}`)),
      this.db.select({ n: sql<number>`count(DISTINCT ${schema.rides.driverId})::int` }).from(schema.rides).where(and(inArray(schema.rides.state, ['completed', 'rated']), inPeriod(completedAt))),
      this.db.execute<{ day: string; requested: number; completed: number; cancelled: number; revenue: number }>(sql`
        SELECT to_char(day, 'YYYY-MM-DD') AS day,
          (SELECT count(*)::int FROM rides r WHERE r.created_at >= (day::timestamp AT TIME ZONE ${tz}) AND r.created_at < ((day + interval '1 day')::timestamp AT TIME ZONE ${tz})) AS requested,
          (SELECT count(*)::int FROM rides r WHERE r.state IN ('completed', 'rated', 'disputed') AND (r.state_timestamps->>'completed')::timestamptz >= (day::timestamp AT TIME ZONE ${tz}) AND (r.state_timestamps->>'completed')::timestamptz < ((day + interval '1 day')::timestamp AT TIME ZONE ${tz})) AS completed,
          (SELECT count(*)::int FROM rides r WHERE r.state IN ('cancelled_by_client', 'cancelled_by_driver') AND r.updated_at >= (day::timestamp AT TIME ZONE ${tz}) AND r.updated_at < ((day + interval '1 day')::timestamp AT TIME ZONE ${tz})) AS cancelled,
          (SELECT COALESCE(sum(r.final_price_cents), 0)::int FROM rides r WHERE r.state IN ('completed', 'rated', 'disputed') AND (r.state_timestamps->>'completed')::timestamptz >= (day::timestamp AT TIME ZONE ${tz}) AND (r.state_timestamps->>'completed')::timestamptz < ((day + interval '1 day')::timestamp AT TIME ZONE ${tz})) AS revenue
        FROM generate_series(${from}::date, ${to}::date, interval '1 day') AS day ORDER BY day`),
    ]);
    const requestedN = requested?.n ?? 0;
    return {
      from, to,
      totals: {
        ridesRequested: requestedN, ridesCompleted: completed?.n ?? 0, ridesCancelled: cancelled?.n ?? 0, noDriver: noDriver?.n ?? 0, noShow: noShow?.n ?? 0,
        revenueCents: completed?.revenue ?? 0, tipsCents: completed?.tips ?? 0, averageRating: rating?.avg === null || rating?.avg === undefined ? null : Math.round(rating.avg * 100) / 100,
        newClients: newClients?.n ?? 0, newDrivers: newDrivers?.n ?? 0, activeDrivers: activeDrivers?.n ?? 0,
        cancellationRatePct: pct(cancelled?.n ?? 0, requestedN), noDriverRatePct: pct(noDriver?.n ?? 0, requestedN),
      },
      daily: [...daily].map((d) => ({ date: d.day, requested: Number(d.requested), completed: Number(d.completed), cancelled: Number(d.cancelled), revenueCents: Number(d.revenue) })),
    };
  }

  /** Export CSV du rapport quotidien (séparateur point-virgule, attendu par Excel en français). */
  async reportCsv(from: string, to: string): Promise<string> {
    const report = await this.report(from, to);
    const lines = ['date;demandées;terminées;annulées;revenus_cents', ...report.daily.map((d) => `${d.date};${d.requested};${d.completed};${d.cancelled};${d.revenueCents}`)];
    return `${lines.join('\r\n')}\r\n`;
  }
}

