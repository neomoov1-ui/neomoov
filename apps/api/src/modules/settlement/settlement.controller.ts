/**
 * Règlement hebdomadaire (prompt 09, tâche 4). My Hub : génération ou aperçu, détail, émission, règlement, ajustement
 * motivé, soldes (finances et administration en écriture, tout le personnel en lecture). Chauffeur : PDF de ses relevés
 * émis (la liste et le détail sont servis par l'espace chauffeur).
 */
import { schema } from '@neomoov/db';
import {
  adminBalanceSchema, adminStatementDetailSchema, statementAdjustSchema, statementGenerateSchema, statementGenerationSchema, uuid,
} from '@neomoov/domain';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { and, eq, ne } from 'drizzle-orm';
import type { Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { ApiErrors, ZodBody, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { DB, type Database } from '../../infra/db.module.js';
import { CurrentUser, NoAudit, Roles, STAFF_FINANCE_ROLES, STAFF_READ_ROLES, type UserActor } from '../auth/actor.js';
import { SettlementJobsService } from './settlement-jobs.service.js';
import { SettlementPayoutsService } from './settlement-payouts.service.js';
import { StatementsService } from './statements.service.js';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
export class AdminSettlementController {
  constructor(
    private readonly statements: StatementsService,
    private readonly payouts: SettlementPayoutsService,
    private readonly jobs: SettlementJobsService,
    @Inject(DB) private readonly database: Database,
  ) {}

  @Post('statements/generate')
  @Roles(...STAFF_FINANCE_ROLES)
  @HttpCode(200)
  @ApiOperation({ summary: 'Génère les brouillons de relevés d\'une semaine (lundi donné, sinon la dernière écoulée), ou leur aperçu sans rien enregistrer' })
  @ZodBody(statementGenerateSchema)
  @ZodResponse(200, statementGenerationSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  generate(@Body(zodPipe(statementGenerateSchema)) body: z.infer<typeof statementGenerateSchema>) {
    return this.statements.generate(body);
  }

  @Get('statements/:id')
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'Détail d\'un relevé : lignes, totaux, état du règlement' })
  @ZodResponse(200, adminStatementDetailSchema)
  @ApiErrors(401, 403, 404, 429)
  detail(@Param('id', zodPipe(uuid)) id: string) {
    return this.statements.detail(id);
  }

  @Post('statements/:id/issue')
  @Roles(...STAFF_FINANCE_ROLES)
  @HttpCode(200)
  @ApiOperation({ summary: 'Émet le brouillon : relevé immuable, packs marqués facturés, PDF et courriel au chauffeur' })
  @ZodResponse(200, adminStatementDetailSchema)
  @ApiErrors(401, 403, 404, 409, 429)
  issue(@Param('id', zodPipe(uuid)) id: string) {
    return this.statements.issue(id);
  }

  @Post('statements/:id/pay')
  @Roles(...STAFF_FINANCE_ROLES)
  @HttpCode(200)
  @ApiOperation({ summary: 'Règle un relevé émis ou en échec : versement Connect (net positif) ou prélèvement (net négatif), idempotent' })
  @ZodResponse(200, adminStatementDetailSchema)
  @ApiErrors(401, 403, 404, 409, 429)
  pay(@Param('id', zodPipe(uuid)) id: string) {
    return this.payouts.settle(id);
  }

  @Post('statements/:id/adjust')
  @Roles(...STAFF_FINANCE_ROLES)
  @HttpCode(200)
  @ApiOperation({ summary: 'Ajustement motivé (crédit ou débit) sur un brouillon ; un relevé émis se corrige sur le suivant' })
  @ZodBody(statementAdjustSchema)
  @ZodResponse(200, adminStatementDetailSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  adjust(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(statementAdjustSchema)) body: z.infer<typeof statementAdjustSchema>) {
    return this.statements.adjust(id, body);
  }

  @Get('statements/:id/pdf')
  @Roles(...STAFF_READ_ROLES)
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'PDF d\'un relevé émis (produit par la file `settlements`)' })
  @ApiErrors(401, 403, 404, 409, 429)
  async pdf(@Param('id', zodPipe(uuid)) id: string, @Res({ passthrough: true }) res: Response) {
    const [row] = await this.database.db.select({ pdfKey: schema.weeklyStatements.pdfKey }).from(schema.weeklyStatements).where(eq(schema.weeklyStatements.id, id)).limit(1);
    if (!row) throw AppError.notFound('STATEMENT_NOT_FOUND', 'Relevé introuvable');
    return sendPdf(res, await this.jobs.pdfOf(row.pdfKey), id);
  }

  @Get('balances')
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'Soldes des chauffeurs : relevés non réglés, impayés, suspensions pour solde' })
  @ZodResponse(200, z.array(adminBalanceSchema))
  @ApiErrors(401, 403, 429)
  balances() {
    return this.payouts.balances();
  }
}

@ApiTags('driver')
@ApiBearerAuth()
@Roles('driver')
@Controller('driver/statements')
export class DriverStatementPdfController {
  constructor(
    private readonly jobs: SettlementJobsService,
    @Inject(DB) private readonly database: Database,
  ) {}

  @Get(':id/pdf')
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'PDF d\'un de mes relevés émis' })
  @ApiErrors(401, 403, 404, 409, 429)
  async pdf(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor, @Res({ passthrough: true }) res: Response) {
    const [row] = await this.database.db
      .select({ pdfKey: schema.weeklyStatements.pdfKey })
      .from(schema.weeklyStatements)
      .innerJoin(schema.drivers, eq(schema.drivers.id, schema.weeklyStatements.driverId))
      .where(and(eq(schema.weeklyStatements.id, id), eq(schema.drivers.userId, user.userId), ne(schema.weeklyStatements.status, 'draft')))
      .limit(1);
    if (!row) throw AppError.notFound('STATEMENT_NOT_FOUND', 'Relevé introuvable');
    return sendPdf(res, await this.jobs.pdfOf(row.pdfKey), id);
  }
}

function sendPdf(res: Response, pdf: Buffer | null, id: string): StreamableFile {
  if (!pdf) throw AppError.conflict('STATEMENT_PDF_NOT_READY', 'Le PDF du relevé est en préparation, réessayez dans un instant');
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', `inline; filename="releve-${id}.pdf"`);
  res.setHeader('cache-control', 'private, no-store');
  return new StreamableFile(pdf);
}
