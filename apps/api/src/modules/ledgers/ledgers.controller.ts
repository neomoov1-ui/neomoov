/**
 * Registres de la redevance et des taxes, exports comptables et export de géolocalisation (prompt 09, tâches 7 et 8 ;
 * section 7.2 : `/admin/ledgers/exports`). Personnel des finances et administrateurs seulement ; le chauffeur lit son
 * propre rapport trimestriel. Aucun calcul ici : tout passe par les services et `@neomoov/domain`.
 */
import {
  driverTaxReportQuerySchema, driverTaxReportSchema, geolocationExportRunResultSchema, geolocationExportRunSchema, geolocationExportSchema, LEDGER_TYPES,
  ledgerExportQuerySchema, ledgerMonthSchema, ledgerPeriodCode, ledgerSummarySchema, redevanceRemitResultSchema, redevanceRemitSchema, uuid,
  type LedgerType,
} from '@neomoov/domain';
import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { ApiErrors, ZodBody, ZodQuery, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { Audit, CurrentUser, NoAudit, Roles, STAFF_FINANCE_ROLES, type UserActor } from '../auth/actor.js';
import { GeolocationExportService } from './geolocation-export.service.js';
import { LedgerExportsService } from './ledger-exports.service.js';
import { LedgersService } from './ledgers.service.js';

const ledgerType = z.enum(LEDGER_TYPES);
const monthsQuerySchema = z.object({ period: ledgerPeriodCode.optional() });

@ApiTags('admin')
@ApiBearerAuth()
@Roles(...STAFF_FINANCE_ROLES)
@Controller('admin')
export class AdminLedgersController {
  constructor(
    private readonly ledgers: LedgersService,
    private readonly exports: LedgerExportsService,
    private readonly geolocation: GeolocationExportService,
  ) {}

  @Get('ledgers/exports')
  @NoAudit()
  @Header('content-type', 'text/csv; charset=utf-8')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Export CSV d\'un registre (redevance ou taxes) sur un mois AAAA-MM ou un trimestre AAAA-Tn : une ligne par course, total par mois et du trimestre (téléchargement journalisé)' })
  @ZodQuery(ledgerExportQuerySchema)
  @ApiErrors(400, 401, 403, 429)
  async exportCsv(@Query(zodPipe(ledgerExportQuerySchema)) query: z.infer<typeof ledgerExportQuerySchema>, @CurrentUser() user: UserActor, @Res({ passthrough: true }) res: Response) {
    const body = await this.exports.csv(query.type, query.period, user);
    res.setHeader('content-disposition', `attachment; filename="${this.exports.csvFileName(query.type, query.period)}"`);
    res.setHeader('cache-control', 'private, no-store');
    return body;
  }

  @Get('ledgers/months')
  @NoAudit()
  @ApiOperation({ summary: 'Mois des registres : redevance due, facturée et remise, taxes par nature (24 derniers mois, ou les mois d\'une période)' })
  @ZodQuery(monthsQuerySchema)
  @ZodResponse(200, z.array(ledgerMonthSchema))
  @ApiErrors(400, 401, 403, 429)
  months(@Query(zodPipe(monthsQuerySchema)) query: z.infer<typeof monthsQuerySchema>) {
    return this.ledgers.months(query.period);
  }

  @Post('ledgers/redevance/remit')
  @HttpCode(200)
  @ApiOperation({ summary: 'Marque la redevance d\'un mois terminé comme remise (lignes non encore remises), journalisé avec la référence' })
  @ZodBody(redevanceRemitSchema)
  @ZodResponse(200, redevanceRemitResultSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  remit(@Body(zodPipe(redevanceRemitSchema)) body: z.infer<typeof redevanceRemitSchema>) {
    return this.ledgers.remit(body);
  }

  @Post('ledgers/summaries')
  @HttpCode(202)
  @ApiOperation({ summary: 'Demande le rapport de synthèse PDF d\'un registre sur un mois ou un trimestre (produit par le worker, file `exports`)' })
  @ZodBody(ledgerExportQuerySchema)
  @ZodResponse(202, ledgerSummarySchema)
  @ApiErrors(400, 401, 403, 429)
  requestSummary(@Body(zodPipe(ledgerExportQuerySchema)) body: z.infer<typeof ledgerExportQuerySchema>, @CurrentUser() user: UserActor) {
    return this.exports.requestSummary(body.type, body.period, user);
  }

  @Get('ledgers/summaries/:type/:period')
  @NoAudit()
  @ApiOperation({ summary: 'État d\'un rapport de synthèse (en attente, prêt, en échec) et son chemin de téléchargement' })
  @ZodResponse(200, ledgerSummarySchema)
  @ApiErrors(400, 401, 403, 404, 429)
  async summary(@Param('type', zodPipe(ledgerType)) type: LedgerType, @Param('period', zodPipe(ledgerPeriodCode)) period: string) {
    const view = await this.exports.summaryStatus(type, period);
    if (!view) throw AppError.notFound('LEDGER_SUMMARY_NOT_FOUND', 'Aucun rapport demandé pour ce registre et cette période');
    return view;
  }

  @Get('ledgers/summaries/:type/:period/pdf')
  @NoAudit()
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'Rapport de synthèse PDF prêt (téléchargement journalisé)' })
  @ApiErrors(400, 401, 403, 404, 409, 429)
  async summaryPdf(@Param('type', zodPipe(ledgerType)) type: LedgerType, @Param('period', zodPipe(ledgerPeriodCode)) period: string, @CurrentUser() user: UserActor, @Res({ passthrough: true }) res: Response) {
    const body = await this.exports.summaryFile(type, period, user);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="neomoov-synthese-${type}-${period}.pdf"`);
    res.setHeader('cache-control', 'private, no-store');
    return new StreamableFile(body);
  }

  @Get('ledgers/drivers/:driverId/tax-report')
  @NoAudit()
  @ApiOperation({ summary: 'Rapport trimestriel d\'un chauffeur : TPS et TVQ sur ses tarifs, par mois (trimestre AAAA-Tn, en cours par défaut)' })
  @ZodQuery(driverTaxReportQuerySchema)
  @ZodResponse(200, driverTaxReportSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  driverTaxReport(@Param('driverId', zodPipe(uuid)) driverId: string, @Query(zodPipe(driverTaxReportQuerySchema)) query: z.infer<typeof driverTaxReportQuerySchema>) {
    return this.ledgers.driverTaxReport(driverId, query.quarter);
  }

  @Get('geolocation-exports')
  @NoAudit()
  @ApiOperation({ summary: 'Exports mensuels de géolocalisation (36 derniers), fichier archivé et état de transmission' })
  @ZodResponse(200, z.array(geolocationExportSchema))
  @ApiErrors(401, 403, 429)
  geolocationExports() {
    return this.geolocation.list();
  }

  @Post('geolocation-exports')
  @HttpCode(202)
  @Audit('geolocation.export_requested', 'geolocation_exports')
  @ApiOperation({ summary: 'Lancement manuel de l\'export de géolocalisation d\'un mois terminé (remplace le fichier du mois, l\'ancien reste archivé)' })
  @ZodBody(geolocationExportRunSchema)
  @ZodResponse(202, geolocationExportRunResultSchema)
  @ApiErrors(400, 401, 403, 409, 429)
  runGeolocationExport(@Body(zodPipe(geolocationExportRunSchema)) body: z.infer<typeof geolocationExportRunSchema>, @CurrentUser() user: UserActor) {
    return this.geolocation.requestRun(body.month, user);
  }

  @Get('geolocation-exports/:id/file')
  @NoAudit()
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Fichier CSV archivé d\'un export de géolocalisation (téléchargement journalisé)' })
  @ApiErrors(401, 403, 404, 429)
  async geolocationFile(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor, @Res({ passthrough: true }) res: Response) {
    const file = await this.geolocation.file(id, user);
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${file.fileName}"`);
    res.setHeader('cache-control', 'private, no-store');
    return new StreamableFile(file.body);
  }
}

@ApiTags('driver')
@ApiBearerAuth()
@Roles('driver')
@Controller('driver')
export class DriverLedgersController {
  constructor(private readonly ledgers: LedgersService) {}

  @Get('tax-report')
  @NoAudit()
  @ApiOperation({ summary: 'Mon rapport trimestriel pour mes déclarations : TPS et TVQ sur mes tarifs, par mois (trimestre AAAA-Tn, en cours par défaut)' })
  @ZodQuery(driverTaxReportQuerySchema)
  @ZodResponse(200, driverTaxReportSchema)
  @ApiErrors(400, 401, 403, 429)
  async taxReport(@Query(zodPipe(driverTaxReportQuerySchema)) query: z.infer<typeof driverTaxReportQuerySchema>, @CurrentUser() user: UserActor) {
    return this.ledgers.driverTaxReport(await this.ledgers.driverIdOfUser(user.userId), query.quarter);
  }
}
