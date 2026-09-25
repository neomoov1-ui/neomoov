/** Consultation du journal d'audit par le personnel de My Hub (section 8 : audit de toute action administrative). */
import { schema } from '@neomoov/db';
import { isoDate, uuid } from '@neomoov/domain';
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { ApiErrors, ZodQuery, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { DB, type Database } from '../../infra/db.module.js';
import { Roles, STAFF_READ_ROLES } from '../auth/actor.js';

/** Curseur opaque : `<instant ISO>_<identifiant>` de la dernière entrée de la page précédente. */
const cursorSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z_[0-9a-f-]{36}$/, 'Curseur invalide');

const auditQuerySchema = z.object({
  entity: z.string().trim().max(60).optional(),
  entityId: uuid.optional(),
  actorUserId: uuid.optional(),
  action: z.string().trim().max(80).optional(),
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

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/audit')
export class AuditController {
  constructor(@Inject(DB) private readonly database: Database) {}

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
}
