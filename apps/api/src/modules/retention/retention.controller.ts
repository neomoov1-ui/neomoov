/**
 * Conservation (Loi 25) dans My Hub : historique des tâches de purge, confirmation de la sauvegarde vérifiée qui les
 * autorise, lancement manuel. Administrateur seulement pour les écritures.
 */
import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiErrors, ZodBody, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { NoAudit, Roles, STAFF_READ_ROLES } from '../auth/actor.js';
import { RetentionService } from './retention.service.js';

const jobSchema = z.object({ id: z.string().uuid(), type: z.string(), executedAt: z.string(), rowsProcessed: z.number().int(), details: z.record(z.string(), z.unknown()) });
const backupSchema = z.object({
  /** Instant de la sauvegarde vérifiée (restauration testée ou point de restauration confirmé) ; absent : maintenant. */
  verifiedAt: z.string().datetime({ offset: true }).optional(),
  note: z.string().trim().min(3).max(200),
});

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/retention')
export class AdminRetentionController {
  constructor(private readonly retention: RetentionService) {}

  @Get('jobs')
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'Tâches de conservation exécutées (purges, anonymisations, blocages faute de sauvegarde vérifiée)' })
  @ZodResponse(200, z.array(jobSchema))
  @ApiErrors(401, 403, 429)
  jobs() {
    return this.retention.recentJobs();
  }

  @Post('backup-verified')
  @Roles('admin')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirme une sauvegarde vérifiée : les purges sont permises pendant 26 heures' })
  @ZodBody(backupSchema)
  @ZodResponse(200, z.object({ verifiedAt: z.string() }))
  @ApiErrors(400, 401, 403, 429)
  async backup(@Body(zodPipe(backupSchema)) body: z.infer<typeof backupSchema>) {
    const verifiedAt = body.verifiedAt ? new Date(body.verifiedAt) : new Date();
    await this.retention.confirmBackup(verifiedAt, body.note);
    return { verifiedAt: verifiedAt.toISOString() };
  }

  @Post('run')
  @Roles('admin')
  @HttpCode(200)
  @ApiOperation({ summary: 'Lance les tâches de conservation maintenant (normalement chaque nuit à 3 h)' })
  @ZodResponse(200, z.array(z.object({ type: z.string(), rowsProcessed: z.number().int(), details: z.record(z.string(), z.unknown()) })))
  @ApiErrors(401, 403, 429)
  run() {
    return this.retention.run();
  }
}
