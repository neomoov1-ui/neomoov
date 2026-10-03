/**
 * Finalisation du 3 octobre 2026 (amendement v1.2, section 3.2 : « permission sensible : double authentification,
 * journalisée, alerte au propriétaire de l'organisation »). Après la réussite d'une requête d'organisation admise par une
 * permission sensible (`sensitivePermissionsUsed`), l'usage est inscrit au journal de l'organisation et les propriétaires
 * du compte (rôle `org_owner` de l'organisation ou d'un ancêtre client), sauf l'auteur, sont avisés par courriel (texto
 * sans courriel), par le module des avis. Une alerte par membre, par permission et par organisation au plus pendant
 * `organizations.sensitive_alert_cooldown_minutes` (60) ; `organizations.sensitive_use_alerts` à faux coupe les avis (le
 * journal reste tenu). Un échec n'annule jamais la requête déjà réussie.
 */
import { schema } from '@neomoov/db';
import { OWNER_ROLE_CODE, PERMISSIONS, type Permission } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { APP_LOGGER } from '../../common/logger.js';
import { withoutOrgScope } from '../../common/org-scope.context.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AuditService } from '../audit/audit.service.js';
import type { OrgScope, UserActor } from '../auth/actor.js';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';

export const SENSITIVE_USED_ACTION = 'organization.sensitive_permission_used';
export const SENSITIVE_ALERTED_ACTION = 'organization.sensitive_permission_alerted';

@Injectable()
export class SensitiveUseService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly outbox: NotificationsOutbox,
  ) {}

  /** Journal et alerte, hors de la transaction de la requête (déjà validée), par le pool de la plateforme. */
  async record(actor: UserActor, scope: OrgScope, permissions: Permission[], request: { method: string; route: string; ip: string | null; correlationId: string | null }, now = new Date()): Promise<void> {
    if (!permissions.length) return;
    try {
      await withoutOrgScope(() => this.recordNow(actor, scope, permissions, request, now));
    } catch (error) {
      this.logger.error({ err: error, organizationId: scope.organizationId, permissions }, 'Alerte de permission sensible non envoyée');
    }
  }

  private async recordNow(actor: UserActor, scope: OrgScope, permissions: Permission[], request: { method: string; route: string; ip: string | null; correlationId: string | null }, now: Date): Promise<void> {
    const context = { actor, ip: request.ip, correlationId: request.correlationId, organizationId: scope.organizationId };
    await this.audit.write([{ action: SENSITIVE_USED_ACTION, entity: 'organizations', entityId: scope.organizationId, after: { permissions, method: request.method, route: request.route } }], context);
    if ((await this.settings.get<unknown>('organizations.sensitive_use_alerts', true)) === false) return;
    const cooldownMinutes = await this.settings.number('organizations.sensitive_alert_cooldown_minutes', 60);
    const since = new Date(now.getTime() - cooldownMinutes * 60_000);
    const fresh: Permission[] = [];
    for (const code of permissions) {
      const [recent] = await this.database.db
        .select({ id: schema.auditLog.id })
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.action, SENSITIVE_ALERTED_ACTION), eq(schema.auditLog.actorUserId, actor.userId), eq(schema.auditLog.organizationId, scope.organizationId), sql`${schema.auditLog.occurredAt} > ${since.toISOString()}`, sql`(${schema.auditLog.after} -> 'permissions') @> ${JSON.stringify([code])}::jsonb`))
        .limit(1);
      if (!recent) fresh.push(code);
    }
    if (!fresh.length) return;
    const ancestors = scope.path.split('/').filter(Boolean);
    const owners = await this.database.db
      .select({ userId: schema.users.id, email: schema.users.email, language: schema.users.language })
      .from(schema.memberships)
      .innerJoin(schema.roles, eq(schema.roles.id, schema.memberships.roleId))
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.organizationId))
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(and(
        inArray(schema.memberships.organizationId, ancestors), sql`${schema.organizations.parentId} IS NOT NULL`, eq(schema.memberships.status, 'active'),
        eq(schema.roles.code, OWNER_ROLE_CODE), isNull(schema.roles.organizationId), ne(schema.memberships.userId, actor.userId),
      ));
    const recipients = [...new Map(owners.map((o) => [o.userId, o])).values()];
    const [[organization], [author]] = await Promise.all([
      this.database.db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, scope.organizationId)).limit(1),
      this.database.db.select({ firstName: schema.users.firstName, lastName: schema.users.lastName }).from(schema.users).where(eq(schema.users.id, actor.userId)).limit(1),
    ]);
    await this.outbox.queue(recipients.map((o) => ({
      recipientUserId: o.userId, channel: o.email ? ('email' as const) : ('sms' as const), template: 'organization.sensitive_permission_used', language: o.language === 'en' ? ('en' as const) : ('fr' as const),
      organizationId: scope.organizationId,
      data: {
        organizationName: organization?.name ?? '', actorName: [author?.firstName, author?.lastName].filter(Boolean).join(' ') || null, permissions: fresh,
        labels: fresh.map((code) => PERMISSIONS[code].description), at: now.toISOString(),
      },
    })));
    await this.audit.write([{ action: SENSITIVE_ALERTED_ACTION, entity: 'organizations', entityId: scope.organizationId, after: { permissions: fresh, recipients: recipients.length } }], context);
  }
}
