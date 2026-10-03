/**
 * Neomoov Booster (phase 1, agent G). Côté chauffeur (`driver.app`) : vérification sommaire (photos, analyse,
 * corrections, confirmation et archive, rapports et PDF), rapport de performance (saisie, captures, lecture, confirmation,
 * récapitulatifs), réglages des alertes et test du son. Côté dispatch (`admin/booster/...`, permission des documents des
 * chauffeurs) : listes et détails, photos et PDF (contenu : permission sensible des documents), chauffeurs en ligne sans
 * rapport du jour, exports CSV.
 */
import {
  adminInspectionListQuerySchema, adminInspectionSchema, adminPerformanceListQuerySchema, adminPerformanceLogSchema, adminPerformanceRecapQuerySchema, alertTestSchema, boosterAnalyseQuerySchema, boosterDownloadQuerySchema, type BoosterAnalyseQuery,
  driverAlertSettingsUpdateSchema, driverAlertSettingsViewSchema, inspectionConfirmSchema, inspectionCreateFieldsSchema, inspectionDownloadSchema, inspectionListQuerySchema,
  inspectionPhotosFieldsSchema, inspectionUpdateSchema, missingInspectionSchema, pageOf, performanceListQuerySchema, performanceLogInputSchema, performanceLogSchema,
  performanceRecapQuerySchema, performanceRecapSchema, uuid, vehicleInspectionSchema,
} from '@neomoov/domain';
import { Body, Controller, Get, Header, HttpCode, Param, Patch, Post, Put, Query, Res, StreamableFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { ApiErrors, ZodBody, ZodQuery, ZodResponse, zodToOpenApi } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { Audit, Can, CurrentUser, NoAudit, type UserActor } from '../auth/actor.js';
import { AlertsService } from './alerts.service.js';
import type { UploadedImage } from './booster-images.js';
import { InspectionsService } from './inspections.service.js';
import { PerformanceService } from './performance.service.js';

/** Limite de multer au-dessus du réglage (10 Mo par image) : le service renvoie une erreur lisible au-delà du réglage. */
const MULTER_LIMIT_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 12;
const photoIndex = z.coerce.number().int().min(0).max(MAX_FILES - 1);
const exportQuerySchema = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), driverId: uuid.optional() });

/** Corps multipart dans l'OpenAPI : champs texte du schéma et fichiers du champ nommé. */
const MultipartBody = (fields: z.ZodObject, field: string) => ApiBody({ schema: { type: 'object', required: [field], properties: { ...(zodToOpenApi(fields).properties ?? {}), [field]: { type: 'array', items: { type: 'string', format: 'binary' } } } } });

function stream(res: Response, file: { body: Buffer; contentType: string }, filename?: string): StreamableFile {
  res.setHeader('content-type', file.contentType);
  res.setHeader('cache-control', 'private, no-store');
  if (filename) res.setHeader('content-disposition', `attachment; filename="${filename}"`);
  return new StreamableFile(file.body);
}

@ApiTags('driver')
@ApiBearerAuth()
@Can('driver.app')
@Controller('driver/booster')
export class DriverBoosterController {
  constructor(
    private readonly inspections: InspectionsService,
    private readonly performance: PerformanceService,
    private readonly alerts: AlertsService,
  ) {}

  // --- Vérification sommaire ----------------------------------------------------------------------------------------

  @Post('inspections')
  @HttpCode(201)
  @Audit('booster.inspection_created', 'vehicle_inspections')
  @UseInterceptors(FilesInterceptor('photos', MAX_FILES, { limits: { fileSize: MULTER_LIMIT_BYTES, files: MAX_FILES } }))
  @ApiConsumes('multipart/form-data')
  @MultipartBody(inspectionCreateFieldsSchema, 'photos')
  @ApiOperation({ summary: 'Ouvre un rapport de vérification sommaire avec ses premières photos (JPEG, PNG ou WEBP, 10 Mo chacune) ; plaque et nom repris du véhicule courant et du compte' })
  @ZodResponse(201, vehicleInspectionSchema)
  @ApiErrors(400, 401, 403, 404, 413, 415, 422, 429, 503)
  createInspection(@Body(zodPipe(inspectionCreateFieldsSchema)) body: z.infer<typeof inspectionCreateFieldsSchema>, @UploadedFiles() files: UploadedImage[] | undefined, @CurrentUser() user: UserActor) {
    return this.inspections.create(user.userId, body, files ?? []);
  }

  @Post('inspections/:id/photos')
  @HttpCode(200)
  @Audit('booster.inspection_photos_added', 'vehicle_inspections', 'id')
  @UseInterceptors(FilesInterceptor('photos', MAX_FILES, { limits: { fileSize: MULTER_LIMIT_BYTES, files: MAX_FILES } }))
  @ApiConsumes('multipart/form-data')
  @MultipartBody(inspectionPhotosFieldsSchema, 'photos')
  @ApiOperation({ summary: 'Ajoute des photos à un rapport non archivé (reprise d\'une étape du parcours guidé)' })
  @ZodResponse(200, vehicleInspectionSchema)
  @ApiErrors(400, 401, 403, 404, 409, 413, 415, 422, 429)
  addPhotos(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(inspectionPhotosFieldsSchema)) body: z.infer<typeof inspectionPhotosFieldsSchema>, @UploadedFiles() files: UploadedImage[] | undefined, @CurrentUser() user: UserActor) {
    return this.inspections.addPhotos(user.userId, id, body, files ?? []);
  }

  @Post('inspections/:id/analyse')
  @HttpCode(200)
  @Audit('booster.inspection_analysed', 'vehicle_inspections', 'id')
  @ApiOperation({ summary: 'Analyse des photos par le modèle (aide à la saisie : odomètre, énergie, plaque, voyants, défauts, éléments visibles) ; le chauffeur confirme ou corrige ensuite. `async=true` (ou réglage booster.analysis_async) : réponse immédiate, état `pending` jusqu\'au résultat, à relire par GET' })
  @ZodQuery(boosterAnalyseQuerySchema)
  @ZodResponse(200, vehicleInspectionSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  analyseInspection(@Param('id', zodPipe(uuid)) id: string, @Query(zodPipe(boosterAnalyseQuerySchema)) query: BoosterAnalyseQuery, @CurrentUser() user: UserActor) {
    return this.inspections.analyse(user.userId, id, query.async ? { async: query.async === 'true' } : {});
  }

  @Patch('inspections/:id')
  @Audit('booster.inspection_updated', 'vehicle_inspections', 'id')
  @ApiOperation({ summary: 'Corrections du chauffeur (lectures, éléments de l\'article 65, zones de carrosserie, notes) avant l\'archivage' })
  @ZodBody(inspectionUpdateSchema)
  @ZodResponse(200, vehicleInspectionSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  updateInspection(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(inspectionUpdateSchema)) body: z.infer<typeof inspectionUpdateSchema>, @CurrentUser() user: UserActor) {
    return this.inspections.update(user.userId, id, body);
  }

  @Post('inspections/:id/confirm')
  @HttpCode(200)
  @Audit('booster.inspection_confirmed', 'vehicle_inspections', 'id')
  @ApiOperation({ summary: 'Confirme et archive le rapport (attestation que tous les éléments de l\'article 65 ont été vérifiés) : PDF produit, rapport rangé chez le dispatch ; une défectuosité majeure est signalée au personnel' })
  @ZodBody(inspectionConfirmSchema)
  @ZodResponse(200, vehicleInspectionSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  confirmInspection(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(inspectionConfirmSchema)) body: z.infer<typeof inspectionConfirmSchema>, @CurrentUser() user: UserActor) {
    return this.inspections.confirm(user.userId, id, body);
  }

  @Get('inspections')
  @NoAudit()
  @ApiOperation({ summary: 'Mes rapports de vérification sommaire, les plus récents d\'abord' })
  @ZodQuery(inspectionListQuerySchema)
  @ZodResponse(200, pageOf(vehicleInspectionSchema))
  @ApiErrors(400, 401, 403, 429)
  listInspections(@Query(zodPipe(inspectionListQuerySchema)) query: z.infer<typeof inspectionListQuerySchema>, @CurrentUser() user: UserActor) {
    return this.inspections.list(user.userId, query);
  }

  @Get('inspections/:id')
  @NoAudit()
  @ApiOperation({ summary: 'Un de mes rapports de vérification sommaire' })
  @ZodResponse(200, vehicleInspectionSchema)
  @ApiErrors(401, 403, 404, 429)
  getInspection(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor) {
    return this.inspections.get(user.userId, id);
  }

  @Get('inspections/:id/photos/:index')
  @NoAudit()
  @ApiProduces('image/jpeg', 'image/png', 'image/webp')
  @ApiOperation({ summary: 'Une photo du rapport (stockage privé)' })
  @ApiErrors(401, 403, 404, 429)
  async inspectionPhoto(@Param('id', zodPipe(uuid)) id: string, @Param('index', zodPipe(photoIndex)) index: number, @CurrentUser() user: UserActor, @Res({ passthrough: true }) res: Response) {
    return stream(res, await this.inspections.photo(user.userId, id, index));
  }

  @Get('inspections/:id/pdf')
  @NoAudit()
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'PDF du rapport archivé' })
  @ApiErrors(401, 403, 404, 409, 429)
  async inspectionPdf(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor, @Res({ passthrough: true }) res: Response) {
    return stream(res, await this.inspections.pdf(user.userId, id), `verification-sommaire-${id.slice(0, 8)}.pdf`);
  }

  @Get('inspections/:id/jpeg')
  @NoAudit()
  @ApiProduces('image/jpeg')
  @ApiOperation({ summary: 'Copie JPEG du rapport archivé (pages empilées, pour le partage)' })
  @ApiErrors(401, 403, 404, 409, 429, 503)
  async inspectionJpeg(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor, @Res({ passthrough: true }) res: Response) {
    return stream(res, await this.inspections.jpeg(user.userId, id), `verification-sommaire-${id.slice(0, 8)}.jpg`);
  }

  @Get('inspections/:id/download')
  @NoAudit()
  @ApiOperation({ summary: 'Lien signé de courte durée vers le rapport archivé : PDF, ou sa copie JPEG (`?format=jpeg`)' })
  @ZodQuery(boosterDownloadQuerySchema)
  @ZodResponse(200, inspectionDownloadSchema)
  @ApiErrors(401, 403, 404, 409, 429, 503)
  inspectionDownload(@Param('id', zodPipe(uuid)) id: string, @Query(zodPipe(boosterDownloadQuerySchema)) query: z.infer<typeof boosterDownloadQuerySchema>, @CurrentUser() user: UserActor) {
    return this.inspections.download(user.userId, id, query.format);
  }

  // --- Rapport de performance ----------------------------------------------------------------------------------------

  @Post('performance')
  @HttpCode(201)
  @Audit('booster.performance_created', 'performance_logs')
  @ApiOperation({ summary: 'Ouvre un rapport de performance (session du jour par défaut) avec les valeurs déjà connues' })
  @ZodBody(performanceLogInputSchema)
  @ZodResponse(201, performanceLogSchema)
  @ApiErrors(400, 401, 403, 429, 503)
  createPerformance(@Body(zodPipe(performanceLogInputSchema)) body: z.infer<typeof performanceLogInputSchema>, @CurrentUser() user: UserActor) {
    return this.performance.create(user.userId, body);
  }

  @Patch('performance/:id')
  @Audit('booster.performance_updated', 'performance_logs', 'id')
  @ApiOperation({ summary: 'Modifie un rapport de performance non confirmé' })
  @ZodBody(performanceLogInputSchema)
  @ZodResponse(200, performanceLogSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  updatePerformance(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(performanceLogInputSchema)) body: z.infer<typeof performanceLogInputSchema>, @CurrentUser() user: UserActor) {
    return this.performance.update(user.userId, id, body);
  }

  @Post('performance/:id/screenshots')
  @HttpCode(200)
  @Audit('booster.performance_screenshots_added', 'performance_logs', 'id')
  @UseInterceptors(FilesInterceptor('screenshots', 6, { limits: { fileSize: MULTER_LIMIT_BYTES, files: 6 } }))
  @ApiConsumes('multipart/form-data')
  @MultipartBody(z.object({}), 'screenshots')
  @ApiOperation({ summary: 'Ajoute des captures d\'écran (applications de travail) à un rapport non confirmé' })
  @ZodResponse(200, performanceLogSchema)
  @ApiErrors(400, 401, 403, 404, 409, 413, 415, 422, 429)
  addScreenshots(@Param('id', zodPipe(uuid)) id: string, @UploadedFiles() files: UploadedImage[] | undefined, @CurrentUser() user: UserActor) {
    return this.performance.addScreenshots(user.userId, id, files ?? []);
  }

  @Post('performance/:id/analyse')
  @HttpCode(200)
  @Audit('booster.performance_analysed', 'performance_logs', 'id')
  @ApiOperation({ summary: 'Lecture des captures par le modèle : montants, courses, temps en ligne, heures (aide à la saisie, à confirmer). `async=true` (ou réglage booster.analysis_async) : réponse immédiate, état `pending` jusqu\'au résultat, à relire par GET' })
  @ZodQuery(boosterAnalyseQuerySchema)
  @ZodResponse(200, performanceLogSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  analysePerformance(@Param('id', zodPipe(uuid)) id: string, @Query(zodPipe(boosterAnalyseQuerySchema)) query: BoosterAnalyseQuery, @CurrentUser() user: UserActor) {
    return this.performance.analyse(user.userId, id, query.async ? { async: query.async === 'true' } : {});
  }

  @Post('performance/:id/confirm')
  @HttpCode(200)
  @Audit('booster.performance_confirmed', 'performance_logs', 'id')
  @ApiOperation({ summary: 'Confirme le rapport de performance (dernières corrections comprises) : figé, PDF produit' })
  @ZodBody(performanceLogInputSchema)
  @ZodResponse(200, performanceLogSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  confirmPerformance(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(performanceLogInputSchema)) body: z.infer<typeof performanceLogInputSchema>, @CurrentUser() user: UserActor) {
    return this.performance.confirm(user.userId, id, body);
  }

  @Get('performance')
  @NoAudit()
  @ApiOperation({ summary: 'Mes rapports de performance, les plus récents d\'abord' })
  @ZodQuery(performanceListQuerySchema)
  @ZodResponse(200, pageOf(performanceLogSchema))
  @ApiErrors(400, 401, 403, 429)
  listPerformance(@Query(zodPipe(performanceListQuerySchema)) query: z.infer<typeof performanceListQuerySchema>, @CurrentUser() user: UserActor) {
    return this.performance.list(user.userId, query);
  }

  @Get('performance/recap')
  @NoAudit()
  @ApiOperation({ summary: 'Récapitulatif hebdomadaire ou mensuel de mes sessions confirmées (totaux, solde, par heure, par km)' })
  @ZodQuery(performanceRecapQuerySchema)
  @ZodResponse(200, performanceRecapSchema)
  @ApiErrors(400, 401, 403, 429)
  performanceRecap(@Query(zodPipe(performanceRecapQuerySchema)) query: z.infer<typeof performanceRecapQuerySchema>, @CurrentUser() user: UserActor) {
    return this.performance.recap(user.userId, query);
  }

  @Get('performance/:id')
  @NoAudit()
  @ApiOperation({ summary: 'Un de mes rapports de performance' })
  @ZodResponse(200, performanceLogSchema)
  @ApiErrors(401, 403, 404, 429)
  getPerformance(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor) {
    return this.performance.get(user.userId, id);
  }

  @Get('performance/:id/screenshots/:index')
  @NoAudit()
  @ApiProduces('image/jpeg', 'image/png', 'image/webp')
  @ApiOperation({ summary: 'Une capture du rapport (stockage privé)' })
  @ApiErrors(401, 403, 404, 429)
  async performanceScreenshot(@Param('id', zodPipe(uuid)) id: string, @Param('index', zodPipe(photoIndex)) index: number, @CurrentUser() user: UserActor, @Res({ passthrough: true }) res: Response) {
    return stream(res, await this.performance.screenshot(user.userId, id, index));
  }

  @Get('performance/:id/pdf')
  @NoAudit()
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'PDF du rapport de performance confirmé' })
  @ApiErrors(401, 403, 404, 409, 429)
  async performancePdf(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor, @Res({ passthrough: true }) res: Response) {
    return stream(res, await this.performance.pdf(user.userId, id), `performance-${id.slice(0, 8)}.pdf`);
  }

  @Get('performance/:id/jpeg')
  @NoAudit()
  @ApiProduces('image/jpeg')
  @ApiOperation({ summary: 'Copie JPEG du rapport de performance confirmé (pages empilées, pour le partage)' })
  @ApiErrors(401, 403, 404, 409, 429, 503)
  async performanceJpeg(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor, @Res({ passthrough: true }) res: Response) {
    return stream(res, await this.performance.jpeg(user.userId, id), `performance-${id.slice(0, 8)}.jpg`);
  }

  @Get('performance/:id/download')
  @NoAudit()
  @ApiOperation({ summary: 'Lien signé de courte durée vers le rapport confirmé : PDF, ou sa copie JPEG (`?format=jpeg`)' })
  @ZodQuery(boosterDownloadQuerySchema)
  @ZodResponse(200, inspectionDownloadSchema)
  @ApiErrors(401, 403, 404, 409, 429, 503)
  performanceDownload(@Param('id', zodPipe(uuid)) id: string, @Query(zodPipe(boosterDownloadQuerySchema)) query: z.infer<typeof boosterDownloadQuerySchema>, @CurrentUser() user: UserActor) {
    return this.performance.download(user.userId, id, query.format);
  }

  // --- Alertes ---------------------------------------------------------------------------------------------------------

  @Get('alerts')
  @NoAudit()
  @ApiOperation({ summary: 'Mes alertes Booster : heures habituelles, rappels, son et couleur par type, périodes et zones de gain de la plateforme' })
  @ZodResponse(200, driverAlertSettingsViewSchema)
  @ApiErrors(401, 403, 429)
  alertSettings(@CurrentUser() user: UserActor) {
    return this.alerts.get(user.userId);
  }

  @Put('alerts')
  @Audit('booster.alerts_updated', 'driver_alert_settings')
  @ApiOperation({ summary: 'Modifie mes alertes Booster (fusion : un champ absent reste tel quel)' })
  @ZodBody(driverAlertSettingsUpdateSchema)
  @ZodResponse(200, driverAlertSettingsViewSchema)
  @ApiErrors(400, 401, 403, 429)
  updateAlerts(@Body(zodPipe(driverAlertSettingsUpdateSchema)) body: z.infer<typeof driverAlertSettingsUpdateSchema>, @CurrentUser() user: UserActor) {
    return this.alerts.update(user.userId, body);
  }

  @Post('alerts/test')
  @HttpCode(200)
  @NoAudit()
  @ApiOperation({ summary: 'Envoie immédiatement une notification de test du type choisi (son et couleur réglés)' })
  @ZodBody(alertTestSchema)
  @ZodResponse(200, z.object({ queued: z.literal(true) }))
  @ApiErrors(400, 401, 403, 429)
  testAlert(@Body(zodPipe(alertTestSchema)) body: z.infer<typeof alertTestSchema>, @CurrentUser() user: UserActor) {
    return this.alerts.test(user.userId, body.type);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/booster')
export class AdminBoosterController {
  constructor(
    private readonly inspections: InspectionsService,
    private readonly performance: PerformanceService,
  ) {}

  @Get('inspections')
  @Can('documents.read')
  @NoAudit()
  @ApiOperation({ summary: 'Rapports de vérification sommaire par chauffeur et par jour (filtre : gravité majeure seulement)' })
  @ZodQuery(adminInspectionListQuerySchema)
  @ZodResponse(200, pageOf(adminInspectionSchema))
  @ApiErrors(400, 401, 403, 429)
  listInspections(@Query(zodPipe(adminInspectionListQuerySchema)) query: z.infer<typeof adminInspectionListQuerySchema>) {
    return this.inspections.adminList(query);
  }

  @Get('inspections/missing-today')
  @Can('documents.read')
  @NoAudit()
  @ApiOperation({ summary: 'Chauffeurs en ligne sans rapport de vérification sommaire archivé aujourd\'hui' })
  @ZodResponse(200, z.array(missingInspectionSchema))
  @ApiErrors(401, 403, 429)
  missingToday() {
    return this.inspections.missingToday();
  }

  @Get('inspections/export.csv')
  @Can('documents.read')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="verifications-sommaires.csv"')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Export CSV (séparateur « ; ») des rapports archivés d\'une période' })
  @ZodQuery(exportQuerySchema)
  @ApiErrors(400, 401, 403, 429)
  exportInspections(@Query(zodPipe(exportQuerySchema)) query: z.infer<typeof exportQuerySchema>) {
    return this.inspections.exportCsv(query);
  }

  @Get('inspections/:id')
  @Can('documents.read')
  @NoAudit()
  @ApiOperation({ summary: 'Détail d\'un rapport de vérification sommaire (permis masqué)' })
  @ZodResponse(200, adminInspectionSchema)
  @ApiErrors(401, 403, 404, 429)
  getInspection(@Param('id', zodPipe(uuid)) id: string) {
    return this.inspections.adminGet(id);
  }

  @Get('inspections/:id/photos/:index')
  @Can('documents.content.read')
  @Audit('booster.inspection_photo_viewed', 'vehicle_inspections', 'id')
  @ApiProduces('image/jpeg', 'image/png', 'image/webp')
  @ApiOperation({ summary: 'Une photo du rapport (stockage privé, consultation journalisée)' })
  @ApiErrors(401, 403, 404, 429)
  async inspectionPhoto(@Param('id', zodPipe(uuid)) id: string, @Param('index', zodPipe(photoIndex)) index: number, @Res({ passthrough: true }) res: Response) {
    return stream(res, await this.inspections.adminPhoto(id, index));
  }

  @Get('inspections/:id/pdf')
  @Can('documents.content.read')
  @Audit('booster.inspection_pdf_viewed', 'vehicle_inspections', 'id')
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'PDF du rapport archivé (consultation journalisée)' })
  @ApiErrors(401, 403, 404, 409, 429)
  async inspectionPdf(@Param('id', zodPipe(uuid)) id: string, @Res({ passthrough: true }) res: Response) {
    return stream(res, await this.inspections.adminPdf(id), `verification-sommaire-${id.slice(0, 8)}.pdf`);
  }

  @Get('inspections/:id/jpeg')
  @Can('documents.content.read')
  @Audit('booster.inspection_jpeg_viewed', 'vehicle_inspections', 'id')
  @ApiProduces('image/jpeg')
  @ApiOperation({ summary: 'Copie JPEG du rapport archivé (consultation journalisée)' })
  @ApiErrors(401, 403, 404, 409, 429, 503)
  async inspectionJpeg(@Param('id', zodPipe(uuid)) id: string, @Res({ passthrough: true }) res: Response) {
    return stream(res, await this.inspections.adminJpeg(id), `verification-sommaire-${id.slice(0, 8)}.jpg`);
  }

  @Get('performance')
  @Can('documents.read')
  @NoAudit()
  @ApiOperation({ summary: 'Rapports de performance des chauffeurs (filtre par chauffeur et par période)' })
  @ZodQuery(adminPerformanceListQuerySchema)
  @ZodResponse(200, pageOf(adminPerformanceLogSchema))
  @ApiErrors(400, 401, 403, 429)
  listPerformance(@Query(zodPipe(adminPerformanceListQuerySchema)) query: z.infer<typeof adminPerformanceListQuerySchema>) {
    return this.performance.adminList(query);
  }

  @Get('performance/recap')
  @Can('documents.read')
  @NoAudit()
  @ApiOperation({ summary: 'Récapitulatif hebdomadaire ou mensuel d\'un chauffeur (sessions confirmées)' })
  @ZodQuery(adminPerformanceRecapQuerySchema)
  @ZodResponse(200, performanceRecapSchema)
  @ApiErrors(400, 401, 403, 429)
  performanceRecap(@Query(zodPipe(adminPerformanceRecapQuerySchema)) query: z.infer<typeof adminPerformanceRecapQuerySchema>) {
    return this.performance.adminRecap(query);
  }

  @Get('performance/export.csv')
  @Can('documents.read')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="rapports-performance.csv"')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Export CSV (séparateur « ; ») des rapports de performance confirmés d\'une période' })
  @ZodQuery(exportQuerySchema)
  @ApiErrors(400, 401, 403, 429)
  exportPerformance(@Query(zodPipe(exportQuerySchema)) query: z.infer<typeof exportQuerySchema>) {
    return this.performance.exportCsv(query);
  }

  @Get('performance/:id')
  @Can('documents.read')
  @NoAudit()
  @ApiOperation({ summary: 'Détail d\'un rapport de performance' })
  @ZodResponse(200, adminPerformanceLogSchema)
  @ApiErrors(401, 403, 404, 429)
  getPerformance(@Param('id', zodPipe(uuid)) id: string) {
    return this.performance.adminGet(id);
  }

  @Get('performance/:id/pdf')
  @Can('documents.content.read')
  @Audit('booster.performance_pdf_viewed', 'performance_logs', 'id')
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'PDF du rapport de performance confirmé (consultation journalisée)' })
  @ApiErrors(401, 403, 404, 409, 429)
  async performancePdf(@Param('id', zodPipe(uuid)) id: string, @Res({ passthrough: true }) res: Response) {
    return stream(res, await this.performance.adminPdf(id), `performance-${id.slice(0, 8)}.pdf`);
  }

  @Get('performance/:id/jpeg')
  @Can('documents.content.read')
  @Audit('booster.performance_jpeg_viewed', 'performance_logs', 'id')
  @ApiProduces('image/jpeg')
  @ApiOperation({ summary: 'Copie JPEG du rapport de performance confirmé (consultation journalisée)' })
  @ApiErrors(401, 403, 404, 409, 429, 503)
  async performanceJpeg(@Param('id', zodPipe(uuid)) id: string, @Res({ passthrough: true }) res: Response) {
    return stream(res, await this.performance.adminJpeg(id), `performance-${id.slice(0, 8)}.jpg`);
  }
}

