/**
 * Conformité (prompt 14, tâche 1) : échéances dans My Hub (dépassées d'abord), inspection trimestrielle enregistrée par
 * l'exploitation, passe manuelle ; échéances du chauffeur dans son application (avec la marche à suivre).
 */
import { schema } from '@neomoov/db';
import { uuid } from '@neomoov/domain';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { ApiErrors, ZodBody, ZodQuery, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { DB, type Database } from '../../infra/db.module.js';
import { CurrentUser, NoAudit, Roles, STAFF_READ_ROLES, STAFF_WRITE_ROLES, type UserActor } from '../auth/actor.js';
import { ComplianceService } from './compliance.service.js';

const localDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const complianceCheckSchema = z.object({
  id: uuid,
  entityType: z.enum(['driver', 'vehicle']),
  entityId: uuid,
  type: z.string(),
  label: z.string(),
  dueOn: localDay,
  status: z.enum(['pending', 'overdue']),
  remindersSent: z.number().int().min(0),
  suspendedAt: z.string().nullable(),
});
const listQuerySchema = z.object({ status: z.enum(['pending', 'overdue']).optional(), driverId: uuid.optional() });
export const inspectionInputSchema = z.object({
  inspectedOn: localDay,
  passed: z.boolean(),
  odometerKm: z.number().int().min(0).max(2_000_000).optional(),
  notes: z.string().trim().max(1000).optional(),
});
const runReportSchema = z.object({ synced: z.number().int(), reminders: z.number().int(), suspended: z.number().int(), lifted: z.number().int() });

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/compliance')
export class AdminComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @Get()
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'Échéances de conformité des chauffeurs et des véhicules, dépassées d\'abord' })
  @ZodQuery(listQuerySchema)
  @ZodResponse(200, z.array(complianceCheckSchema))
  @ApiErrors(400, 401, 403, 429)
  list(@Query(zodPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>) {
    return this.compliance.list(query);
  }

  @Post('run')
  @Roles('admin')
  @HttpCode(200)
  @ApiOperation({ summary: 'Passe de conformité immédiate (rappels, suspensions, levées), normalement quotidienne' })
  @ZodResponse(200, runReportSchema)
  @ApiErrors(401, 403, 429)
  run() {
    return this.compliance.run();
  }

  @Post('vehicles/:id/inspections')
  @Roles(...STAFF_WRITE_ROLES)
  @HttpCode(200)
  @ApiOperation({ summary: 'Inspection trimestrielle de Neomoov : réussie (prochaine dans 3 mois) ou échouée (véhicule non conforme)' })
  @ZodBody(inspectionInputSchema)
  @ZodResponse(200, z.object({ vehicleId: uuid, status: z.string(), nextInspectionDueOn: localDay.nullable() }))
  @ApiErrors(400, 401, 403, 404, 429)
  inspection(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(inspectionInputSchema)) body: z.infer<typeof inspectionInputSchema>) {
    return this.compliance.recordInspection(id, body);
  }
}

@ApiTags('driver')
@ApiBearerAuth()
@Roles('driver')
@Controller('driver/compliance')
export class DriverComplianceController {
  constructor(
    private readonly compliance: ComplianceService,
    @Inject(DB) private readonly database: Database,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Mes échéances (documents, vérification mécanique, inspection trimestrielle), dépassées d\'abord' })
  @ZodResponse(200, z.array(complianceCheckSchema))
  @ApiErrors(401, 403, 429)
  async mine(@CurrentUser() user: UserActor) {
    const [driver] = await this.database.db.select({ id: schema.drivers.id }).from(schema.drivers).where(eq(schema.drivers.userId, user.userId)).limit(1);
    if (!driver) throw AppError.forbidden('DRIVER_PROFILE_REQUIRED', 'Profil chauffeur requis');
    return this.compliance.list({ driverId: driver.id });
  }
}
