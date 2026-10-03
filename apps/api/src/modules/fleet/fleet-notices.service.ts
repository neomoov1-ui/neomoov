/**
 * Finalisation du 3 octobre 2026 (étape 23, « avis au gestionnaire de flotte ») : chaque jour, à
 * `fleet.manager_notice_hour` (7 h, heure de Montréal), chaque organisation cliente qui a des chauffeurs reçoit, si
 * quelque chose arrive à échéance dans `fleet.manager_notice_days` jours (14), un relevé : documents des chauffeurs,
 * vérifications et inspections des véhicules (échéances de conformité en attente ou dépassées) et entretiens proches ou
 * en retard (registre de la flotte). Destinataires : gestionnaires de flotte, propriétaires et administrateurs de
 * l'organisation (texto sans courriel). Les relances au chauffeur restent celles de la passe de conformité. Un relevé
 * par organisation et par jour au plus (marqueur au journal d'audit, rejouable entre processus) ;
 * `fleet.manager_notices` à faux les coupe.
 */
import { schema } from '@neomoov/db';
import { localDate } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AuditService } from '../audit/audit.service.js';
import { OrgScopeService } from '../organizations/org-scope.service.js';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';
import { FleetVehiclesService } from './fleet-vehicles.service.js';

export const FLEET_NOTICE_ACTION = 'fleet.manager_notice_sent';
/** Rôles système qui reçoivent le relevé des échéances de la flotte. */
const RECIPIENT_ROLES = ['fleet_manager', 'org_owner', 'org_admin'];

export interface FleetDigest {
  documents: number;
  inspections: number;
  overdue: number;
  maintenance: number;
}

@Injectable()
export class FleetNoticesService {
  /** Jour local de la dernière passe faite par ce processus (la base départage les processus). */
  private lastRunDay: string | null = null;

  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly settings: SettingsService,
    private readonly orgScope: OrgScopeService,
    private readonly audit: AuditService,
    private readonly outbox: NotificationsOutbox,
    private readonly vehicles: FleetVehiclesService,
  ) {}

  /** Appelée chaque minute par la file `fleet` : ne fait la passe qu'une fois par jour, à l'heure réglée. */
  async maybeRun(now: Date): Promise<number> {
    if ((await this.settings.get<unknown>('fleet.manager_notices', true)) === false) return 0;
    const timeZone = await this.settings.string('service.time_zone', 'America/Toronto');
    const local = localDate(now, timeZone);
    const hour = Number(new Intl.DateTimeFormat('en-CA', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now));
    if (hour < (await this.settings.number('fleet.manager_notice_hour', 7)) || this.lastRunDay === local.date) return 0;
    this.lastRunDay = local.date;
    return this.run(now);
  }

  /** Passe complète : un relevé par organisation cliente qui a des chauffeurs et quelque chose à échéance. */
  async run(now: Date): Promise<number> {
    const timeZone = await this.settings.string('service.time_zone', 'America/Toronto');
    const today = localDate(now, timeZone).date;
    const days = await this.settings.number('fleet.manager_notice_days', 14);
    let sent = 0;
    for (const organizationId of await this.orgScope.clientOrganizationsOfDrivers()) {
      try {
        if (await this.alreadySent(organizationId, today)) continue;
        const digest = await this.orgScope.runFor(organizationId, () => this.digest(today, days));
        if (!digest.documents && !digest.inspections && !digest.maintenance) continue;
        if (await this.notify(organizationId, today, days, digest)) sent += 1;
      } catch (error) {
        this.logger.error({ err: error, organizationId }, 'Relevé des échéances de la flotte non envoyé');
      }
    }
    return sent;
  }

  /** Échéances de l'organisation et de ses descendantes (transaction restreinte : ses chauffeurs et véhicules seulement). */
  async digest(today: string, days: number): Promise<FleetDigest> {
    const until = new Date(Date.parse(`${today}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
    const [checks] = await this.database.db.execute<{ documents: number; inspections: number; overdue: number }>(sql`
      SELECT count(*) FILTER (WHERE type LIKE 'document:%')::int AS documents,
             count(*) FILTER (WHERE type NOT LIKE 'document:%')::int AS inspections,
             count(*) FILTER (WHERE status = 'overdue' OR due_on < ${today}::date)::int AS overdue
      FROM compliance_checks
      WHERE status IN ('pending', 'overdue') AND due_on <= ${until}::date`);
    const fleet = await this.database.db.select({ id: schema.vehicles.id, odometerKm: schema.vehicles.odometerKm }).from(schema.vehicles).where(inArray(schema.vehicles.status, ['active', 'non_compliant', 'pending']));
    const due = await this.vehicles.dueOf(fleet.map((v) => v.id), today, new Map(fleet.map((v) => [v.id, v.odometerKm])));
    const maintenance = [...due.values()].reduce((n, items) => n + items.filter((d) => d.status !== 'ok').length, 0);
    return { documents: Number(checks?.documents ?? 0), inspections: Number(checks?.inspections ?? 0), overdue: Number(checks?.overdue ?? 0), maintenance };
  }

  private async alreadySent(organizationId: string, today: string): Promise<boolean> {
    const [row] = await this.database.db
      .select({ id: schema.auditLog.id })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, FLEET_NOTICE_ACTION), eq(schema.auditLog.organizationId, organizationId), sql`${schema.auditLog.after} ->> 'day' = ${today}`))
      .limit(1);
    return Boolean(row);
  }

  private async notify(organizationId: string, today: string, days: number, digest: FleetDigest): Promise<boolean> {
    const recipients = await this.database.db
      .selectDistinct({ userId: schema.users.id, email: schema.users.email, language: schema.users.language })
      .from(schema.memberships)
      .innerJoin(schema.roles, eq(schema.roles.id, schema.memberships.roleId))
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(and(eq(schema.memberships.organizationId, organizationId), eq(schema.memberships.status, 'active'), isNull(schema.roles.organizationId), inArray(schema.roles.code, RECIPIENT_ROLES)));
    const [organization] = await this.database.db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, organizationId)).limit(1);
    await this.audit.recordSystem({ action: FLEET_NOTICE_ACTION, entity: 'organizations', entityId: organizationId, organizationId, after: { day: today, ...digest, recipients: recipients.length } }, 'fleet');
    if (!recipients.length) return false;
    await this.outbox.queue(recipients.map((r) => ({
      recipientUserId: r.userId, channel: r.email ? ('email' as const) : ('sms' as const), template: 'fleet.compliance_digest', language: r.language === 'en' ? ('en' as const) : ('fr' as const),
      organizationId, data: { organizationName: organization?.name ?? '', days, ...digest },
    })));
    return true;
  }
}
