import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/actor.js';
import { HealthService } from './health.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'État de l\'API, de la base de données, de Redis et des files' })
  @ApiOkResponse({ description: 'Rapport de santé ; 503 si la base est injoignable' })
  async get(@Res({ passthrough: true }) res: Response) {
    const report = await this.health.report();
    if (report.checks.database.status !== 'ok') res.status(503);
    return report;
  }
}
