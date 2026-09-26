/**
 * Files de tâches dans My Hub (prompt 15, tâche 5) : état de chaque file (en attente, en cours, en échec), tâches en
 * échec avec leur motif, relance manuelle d'une tâche ou de toutes (idempotente : chaque tâche porte sa clé).
 */
import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiErrors, ZodBody, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { QUEUE_NAMES, QueueService, type QueueName } from '../../infra/queue.module.js';
import { NoAudit, Roles, STAFF_READ_ROLES, STAFF_WRITE_ROLES } from '../auth/actor.js';

const queueName = z.enum(QUEUE_NAMES);
const statsSchema = z.object({ mode: z.enum(['redis', 'memory']), queues: z.array(z.object({ name: z.string(), waiting: z.number().int(), active: z.number().int(), failed: z.number().int(), dropped: z.number().int().optional() })) });
const failedSchema = z.array(z.object({ id: z.string(), name: z.string(), failedReason: z.string().nullable(), attempts: z.number().int(), failedAt: z.string().nullable() }));
const retrySchema = z.object({ jobId: z.string().trim().min(1).max(200).optional() });

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/queues')
export class AdminQueuesController {
  constructor(private readonly queues: QueueService) {}

  @Get()
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'État des files de tâches (en attente, en cours, en échec ; perdues en mode mémoire)' })
  @ZodResponse(200, statsSchema)
  @ApiErrors(401, 403, 429)
  async stats() {
    return { mode: this.queues.mode, queues: await this.queues.stats() };
  }

  @Get(':name/failed')
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'Tâches en échec d\'une file, avec leur motif (les 50 plus récentes)' })
  @ZodResponse(200, failedSchema)
  @ApiErrors(400, 401, 403, 429)
  failed(@Param('name', zodPipe(queueName)) name: QueueName) {
    return this.queues.failedJobs(name);
  }

  @Post(':name/retry')
  @Roles(...STAFF_WRITE_ROLES)
  @HttpCode(200)
  @ApiOperation({ summary: 'Relance une tâche en échec, ou toutes celles de la file' })
  @ZodBody(retrySchema)
  @ZodResponse(200, z.object({ retried: z.number().int().min(0) }))
  @ApiErrors(400, 401, 403, 429)
  async retry(@Param('name', zodPipe(queueName)) name: QueueName, @Body(zodPipe(retrySchema)) body: z.infer<typeof retrySchema>) {
    return { retried: await this.queues.retryFailed(name, body.jobId) };
  }
}
