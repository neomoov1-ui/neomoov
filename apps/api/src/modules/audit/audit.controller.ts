/** Consultation du journal d'audit par le personnel de My Hub (section 8 : audit de toute action administrative). */
import { schema } from '@neomoov/db';
import { isoDate, uuid } from '@neomoov/domain';
import { Controller, Get, Inject, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { and, desc, eq, gte, lt, or, type SQL } from 'drizzle-orm';
import type { Response } from 'express';
import { z } from 'zod';
import { ApiErrors, ZodQuery, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { DB, type Database } from '../../infra/db.module.js';
import { CurrentUser, ReqCtx, Roles, STAFF_READ_ROLES, type RequestContext, type UserActor } from '../auth/actor.js';
import { AuditService } from './audit.service.js';

/** Curseur opaque : `<instant ISO>_<identifiant>` de la dernière entrée de la page précédente. */
const cursorSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z_[0-9a-f-]{36}$/, 'Curseur invalide');

const auditQuerySchema = z.object({
  entity: z.string().trim().max(60).optional(),
  entityId: uuid.optional(),
  actorUserId: uuid.optional(),
  action: z.string().trim().max(80).optional(),
  /** Actions d'un agent IA (code de l'agent). */
  actorAgentCode: z.string().trim().max(40).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  /** Page suivante : valeur `nextCursor` de la page précédente. */
  cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const auditEntrySchema = z.object({
  id: uuid,
  actorUserId: uuid.nullable(),
  actorAgentCode: z.string().nullable(),
  action: z.string(),
  entity: z.string(),
  entityId: uuid.nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  ipAddress: z.string().nullable(),
  correlationId: z.string().nullable(),
  occurredAt: isoDate,
});

const auditPageSchema = z.object({ items: z.array(auditEntrySchema), nextCursor: z.string().nullable() });

const exportQuerySchema = auditQuerySchema.omit({ cursor: true, limit: true });
const EXPORT_MAX_ROWS = 50_000;

function periodConditions(query: { entity?: string | undefined; actorAgentCode?: string | undefined; from?: string | undefined; to?: string | undefined }): SQL[] {
  const conditions: SQL[] = [];
  if (query.actorAgentCode) conditions.push(eq(schema.auditLog.actorAgentCode, query.actorAgentCode));
  if (query.from) conditions.push(gte(schema.auditLog.occurredAt, new Date(query.from)));
  if (query.to) conditions.push(lt(schema.auditLog.occurredAt, new Date(query.to)));
  return conditions;
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/audit')
export class AuditController {
  constructor(
    @Inject(DB) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Roles(...STAFF_READ_ROLES)
  @ApiOperation({ summary: 'Journal d\'audit, du plus récent au plus ancien, par curseur (instant et identifiant)' })
  @ZodQuery(auditQuerySchema)
  @ZodResponse(200, auditPageSchema)
  @ApiErrors(401, 403, 429)
  async list(@Query(zodPipe(auditQuerySchema)) query: z.infer<typeof auditQuerySchema>) {
    const conditions: SQL[] = [];
    if (query.entity) conditions.push(eq(schema.auditLog.entity, query.entity));
    if (query.entityId) conditions.push(eq(schema.auditLog.entityId, query.entityId));
    if (query.actorUserId) conditions.push(eq(schema.auditLog.actorUserId, query.actorUserId));
    if (query.action) conditions.push(eq(schema.auditLog.action, query.action));
    conditions.push(...periodConditions(query));
    if (query.cursor) {
      // Plusieurs entrées partagent souvent le même instant (un INSERT par requête) : le curseur porte aussi l'identifiant.
      const [at, id] = query.cursor.split('_') as [string, string];
      const instant = new Date(at);
      conditions.push(or(lt(schema.auditLog.occurredAt, instant), and(eq(schema.auditLog.occurredAt, instant), lt(schema.auditLog.id, id)))!);
    }
    const rows = await this.database.db
      .select()
      .from(schema.auditLog)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(schema.auditLog.occurredAt), desc(schema.auditLog.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => ({ ...r, occurredAt: r.occurredAt.toISOString() })),
      nextCursor: rows.length > query.limit && last ? `${last.occurredAt.toISOString()}_${last.id}` : null,
    };
  }

  /**
   * Export CSV (point-virgule) du journal filtré, 50 000 lignes au plus, pour un contrôle ou une demande d'autorité.
   * L'export lui-même est journalisé (filtres et nombre de lignes), après la lecture : il ne figure pas dans son propre fichier.
   */
  @Get('export')
  @Roles('admin')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Export CSV du journal d\'audit filtré (période, entité, action, acteur, agent), administrateur' })
  @ZodQuery(exportQuerySchema)
  @ApiErrors(400, 401, 403, 429)
  async export(@Query(zodPipe(exportQuerySchema)) query: z.infer<typeof exportQuerySchema>, @CurrentUser() actor: UserActor, @ReqCtx() ctx: RequestContext, @Res({ passthrough: true }) res: Response) {
    const conditions: SQL[] = [...periodConditions(query)];
    if (query.entity) conditions.push(eq(schema.auditLog.entity, query.entity));
    if (query.entityId) conditions.push(eq(schema.auditLog.entityId, query.entityId));
    if (query.actorUserId) conditions.push(eq(schema.auditLog.actorUserId, query.actorUserId));
    if (query.action) conditions.push(eq(schema.auditLog.action, query.action));
    const rows = await this.database.db
      .select()
      .from(schema.auditLog)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(schema.auditLog.occurredAt), desc(schema.auditLog.id))
      .limit(EXPORT_MAX_ROWS);
    await this.audit.write([{ action: 'admin.audit_exported', entity: 'audit_log', entityId: null, after: { filters: query, rows: rows.length } }], { actor, ip: ctx.ip, correlationId: ctx.correlationId });
    const header = ['occurred_at', 'action', 'entity', 'entity_id', 'actor_user_id', 'actor_agent_code', 'ip_address', 'correlation_id', 'before', 'after'];
    const lines = rows.map((r) => [r.occurredAt.toISOString(), r.action, r.entity, r.entityId, r.actorUserId, r.actorAgentCode, r.ipAddress, r.correlationId, r.before, r.after].map(csvCell).join(';'));
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="journal-audit.csv"');
    return [header.join(';'), ...lines].join('\n') + '\n';
  }
}
