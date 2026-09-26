/**
 * Métriques d'exploitation (prompt 15, tâche 6) : `GET /v1/admin/metrics` pour My Hub (tout le personnel, lecture) et
 * `GET /v1/internal/metrics` au format Prometheus pour la surveillance externe (clé de service à portée `metrics:read`).
 */
import { adminMetricsSchema } from '@neomoov/domain';
import { Controller, Get, Header } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { ApiErrors, ZodResponse } from '../../common/openapi.js';
import { NoAudit, Roles, Scopes, STAFF_READ_ROLES } from '../auth/actor.js';
import { AdminMetricsService } from './admin-metrics.service.js';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/metrics')
export class AdminMetricsController {
  constructor(private readonly metrics: AdminMetricsService) {}

  @Get()
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'Métriques : courses par état, temps d\'attribution, latences de l\'API, files, échecs de paiement, erreurs des fournisseurs' })
  @ZodResponse(200, adminMetricsSchema)
  @ApiErrors(401, 403, 429)
  get() {
    return this.metrics.metrics();
  }
}

@ApiTags('internal')
@ApiBearerAuth()
@Controller('internal/metrics')
export class InternalMetricsController {
  constructor(private readonly metrics: AdminMetricsService) {}

  @Get()
  @Scopes('metrics:read')
  @NoAudit()
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  @Header('cache-control', 'no-store')
  @ApiProduces('text/plain')
  @ApiOperation({ summary: 'Métriques au format d\'exposition Prometheus (clé de service à portée metrics:read)' })
  @ApiOkResponse({ description: 'Texte au format Prometheus 0.0.4', content: { 'text/plain': { schema: { type: 'string' } } } })
  @ApiErrors(401, 403, 429)
  prometheus() {
    return this.metrics.prometheus();
  }
}
