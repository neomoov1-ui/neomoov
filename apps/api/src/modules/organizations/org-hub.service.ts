/**
 * Étape 21 : tableau de bord de My Hub côté organisation cliente. Toutes les lectures passent par la transaction
 * restreinte de la route (politiques d'isolation) : seules les lignes de l'organisation et de ses descendantes comptent.
 * Jour de Montréal (réglage `service.time_zone`).
 */
import { schema } from '@neomoov/db';
import { localDate, type OrgOverview, type RideState } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, gte, inArray, like, sql } from 'drizzle-orm';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import type { OrgScope } from '../auth/actor.js';

const ACTIVE: RideState[] = ['requested', 'offering', 'assigned', 'en_route', 'arrived', 'in_progress'];

@Injectable()
export class OrgHubService {
  constructor(
    @Inject(DB) private readonly database: Database,
    private readonly settings: SettingsService,
  ) {}

  /** Courses du jour, chauffeurs en ligne, relevés à venir, sous-organisations et membres du sous-arbre. */
  async overview(scope: OrgScope, now = new Date()): Promise<OrgOverview> {
    const db = this.database.db;
    const tz = await this.settings.string('service.time_zone', 'America/Toronto');
    const start = sql`(${localDate(now, tz).date}::date::timestamp AT TIME ZONE ${tz})`;
    const completedAt = sql`(${schema.rides.stateTimestamps}->>'completed')::timestamptz`;
    // Une seule connexion (la transaction restreinte) : les requêtes passent l'une après l'autre.
    const [ridesToday] = await db.select({ n: count() }).from(schema.rides).where(sql`${schema.rides.createdAt} >= ${start}`);
    const [ridesActive] = await db.select({ n: count() }).from(schema.rides).where(inArray(schema.rides.state, ACTIVE));
    const [completed] = await db
      .select({ n: count(), revenue: sql<number>`COALESCE(sum(${schema.rides.finalPriceCents}), 0)::int` })
      .from(schema.rides)
      .where(and(inArray(schema.rides.state, ['completed', 'rated']), sql`${completedAt} >= ${start}`));
    const [scheduled] = await db.select({ n: count() }).from(schema.rides).where(and(eq(schema.rides.type, 'scheduled'), inArray(schema.rides.state, ['requested', 'offering', 'assigned']), gte(schema.rides.requestedAt, now)));
    const [driversActive] = await db.select({ n: count() }).from(schema.drivers).where(eq(schema.drivers.status, 'active'));
    const presence = await db.select({ available: schema.driverPresence.isAvailable, n: count() }).from(schema.driverPresence).groupBy(schema.driverPresence.isAvailable);
    const [statements] = await db
      .select({ n: count(), net: sql<number>`COALESCE(sum(${schema.weeklyStatements.netCents}), 0)::int` })
      .from(schema.weeklyStatements)
      .where(inArray(schema.weeklyStatements.status, ['draft', 'issued']));
    const [orgs] = await db.select({ n: count() }).from(schema.organizations).where(like(schema.organizations.path, `${scope.path}%`));
    const [members] = await db.select({ n: count() }).from(schema.memberships).where(eq(schema.memberships.status, 'active'));
    return {
      ridesToday: ridesToday?.n ?? 0,
      ridesActive: ridesActive?.n ?? 0,
      completedToday: completed?.n ?? 0,
      revenueTodayCents: Number(completed?.revenue ?? 0),
      scheduledUpcoming: scheduled?.n ?? 0,
      driversActive: driversActive?.n ?? 0,
      driversOnline: presence.find((p) => p.available)?.n ?? 0,
      driversPaused: presence.find((p) => !p.available)?.n ?? 0,
      statementsPending: { count: statements?.n ?? 0, netCents: Number(statements?.net ?? 0) },
      subOrganizations: Math.max(0, (orgs?.n ?? 1) - 1),
      members: members?.n ?? 0,
      generatedAt: now.toISOString(),
    };
  }
}
