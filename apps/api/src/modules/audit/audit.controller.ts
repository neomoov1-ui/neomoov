/** Consultation du journal d'audit par le personnel de My Hub (section 8 : audit de toute action administrative). */
import { schema } from '@neomoov/db';
import { Controller, Get, Inject, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { and, desc } from 'drizzle-orm';
import type { Response } from 'express';
import type { z } from 'zod';
import { ApiErrors, ZodQuery, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { DB, type Database } from '../../infra/db.module.js';
import { Can, CurrentUser, ReqCtx, type RequestContext, type UserActor } from '../auth/actor.js';
import { auditConditions, auditPageSchema, auditQuerySchema, AuditService } from './audit.service.js';

export { auditEntrySchema } from './audit.service.js';

const exportQuerySchema = auditQuerySchema.omit({ cursor: true, limit: true });
const EXPORT_MAX_ROWS = 50_000;

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
  @Can('audit.read')
  @ApiOperation({ summary: 'Journal d\'audit, du plus récent au plus ancien, par curseur (instant et identifiant)' })
  @ZodQuery(auditQuerySchema)
  @ZodResponse(200, auditPageSchema)
  @ApiErrors(401, 403, 429)
  list(@Query(zodPipe(auditQuerySchema)) query: z.infer<typeof auditQuerySchema>) {
    return this.audit.list(query);
  }

  /**
   * Export CSV (point-virgule) du journal filtré, 50 000 lignes au plus, pour un contrôle ou une demande d'autorité.
   * L'export lui-même est journalisé (filtres et nombre de lignes), après la lecture : il ne figure pas dans son propre fichier.
   */
  @Get('export')
  @Can('audit.export')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Export CSV du journal d\'audit filtré (période, entité, action, acteur, agent), administrateur' })
  @ZodQuery(exportQuerySchema)
  @ApiErrors(400, 401, 403, 429)
  async export(@Query(zodPipe(exportQuerySchema)) query: z.infer<typeof exportQuerySchema>, @CurrentUser() actor: UserActor, @ReqCtx() ctx: RequestContext, @Res({ passthrough: true }) res: Response) {
    const conditions = auditConditions(query);
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
