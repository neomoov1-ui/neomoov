/**
 * Facturation certifiée (section 7.2) : facture d'une course et son PDF (client, chauffeur de la course, personnel),
 * vérification publique par le code QR (sans jeton ni clé d'API, comme le suivi partagé), état des transmissions au
 * SEV et reprise (My Hub). Aucun montant n'est calculé ici : tout vient de `InvoicingService` et du domaine.
 */
import {
  invoicePdfQuerySchema, invoiceVerificationSchema, invoiceVerificationTokenSchema, rideInvoiceSchema, sevRetryResultSchema, sevStatusReportSchema, uuid,
} from '@neomoov/domain';
import { Controller, Get, HttpCode, Param, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { z } from 'zod';
import { ApiErrors, ZodQuery, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { Audit, Authenticated, NoAudit, Owns, Public, Roles, STAFF_READ_ROLES } from '../auth/actor.js';
import { InvoiceJobsService } from './invoice-jobs.service.js';
import { InvoicingService } from './invoicing.service.js';
import { SevService } from './sev.service.js';

function sendPdf(res: Response, file: { body: Buffer; filename: string }): StreamableFile {
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', `inline; filename="${file.filename}"`);
  res.setHeader('cache-control', 'private, no-store');
  return new StreamableFile(file.body);
}

@ApiTags('invoices')
@ApiBearerAuth()
@Authenticated()
@Controller('rides')
export class RideInvoicesController {
  constructor(private readonly invoicing: InvoicingService) {}

  @Get(':id/invoice')
  @Owns('ride')
  @ApiOperation({ summary: 'Facture certifiée de la course (course terminée, frais d\'annulation ou de non-présentation) et ses notes de crédit ; 404 tant qu\'elle n\'est pas émise' })
  @ZodResponse(200, rideInvoiceSchema)
  @ApiErrors(401, 403, 404, 429)
  invoice(@Param('id', zodPipe(uuid)) id: string) {
    return this.invoicing.rideInvoice(id);
  }

  @Get(':id/invoice/pdf')
  @Owns('ride')
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'PDF de la facture de la course, ou d\'une de ses notes de crédit (`documentId`) ; 409 tant que le PDF est en préparation' })
  @ZodQuery(invoicePdfQuerySchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  async pdf(@Param('id', zodPipe(uuid)) id: string, @Query(zodPipe(invoicePdfQuerySchema)) query: z.infer<typeof invoicePdfQuerySchema>, @Res({ passthrough: true }) res: Response) {
    return sendPdf(res, await this.invoicing.pdfOfRide(id, query.documentId));
  }
}

@ApiTags('public')
@Controller('public')
export class PublicInvoicesController {
  constructor(private readonly invoicing: InvoicingService) {}

  @Get('invoices/verify/:token')
  @Public()
  @ApiOperation({ summary: 'Vérification publique d\'une facture par son code QR (jeton signé) : numéro, date, fournisseur, total, état SEV' })
  @ZodResponse(200, invoiceVerificationSchema)
  @ApiErrors(400, 404, 429)
  verify(@Param('token', zodPipe(invoiceVerificationTokenSchema)) token: string) {
    return this.invoicing.verify(token);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
export class AdminSevController {
  constructor(
    private readonly invoicing: InvoicingService,
    private readonly sev: SevService,
    private readonly jobs: InvoiceJobsService,
  ) {}

  @Get('sev/status')
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'Transmissions au SEV : factures par état, dernières erreurs, santé de l\'adaptateur' })
  @ZodResponse(200, sevStatusReportSchema)
  @ApiErrors(401, 403, 429)
  status() {
    return this.sev.statusReport();
  }

  @Post('sev/retry/:invoiceId')
  @Roles('admin', 'operator', 'finance')
  @HttpCode(200)
  @Audit('admin.sev_retry', 'invoices', 'invoiceId')
  @ApiOperation({ summary: 'Reprend la transmission d\'une facture en attente ou en erreur (par la file `invoicing`) ; 409 si elle est déjà accusée ou en cours' })
  @ZodResponse(200, sevRetryResultSchema)
  @ApiErrors(401, 403, 404, 409, 429)
  retry(@Param('invoiceId', zodPipe(uuid)) invoiceId: string) {
    return this.jobs.retry(invoiceId);
  }

  @Get('invoices/:id/pdf')
  @Roles(...STAFF_READ_ROLES)
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'PDF d\'une facture ou d\'une note de crédit pour My Hub ; 409 tant que le PDF est en préparation' })
  @ApiErrors(401, 403, 404, 409, 429)
  async pdf(@Param('id', zodPipe(uuid)) id: string, @Res({ passthrough: true }) res: Response) {
    return sendPdf(res, await this.invoicing.pdfById(id));
  }
}
