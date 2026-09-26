/**
 * My Hub (prompt 12, section 7.2 groupe Admin) : tableau de bord, courses, chauffeurs, documents, véhicules, clients,
 * incidents, paramètres, personnel, demandes de droits, prospects, catalogue, tarifs et zones, rapports. Les agents IA
 * et la file d'approbation sont servis par le module des agents (étape 13), sous les mêmes chemins.
 * Lecture : tout le personnel ; écriture : administrateur et opérateur ; réglages et personnel : administrateur.
 * Chaque action est journalisée avec l'acteur (intercepteur d'audit et entrées explicites des services).
 */
import {
  adminCancelRideSchema, adminClientSchema, adminDashboardSchema, adminDataRequestSchema, adminDocumentSchema,
  adminDriverDetailSchema, adminDriverListItemSchema, adminIncidentSchema, adminInvoiceSchema, adminLeadSchema, adminListQuerySchema, adminPromotionSchema,
  adminReportSchema, adminRideListItemSchema, adminRideListQuerySchema, adminSettingSchema, adminStaffSchema, adminStatementSchema, adminVehicleSchema,
  cancellationResultSchema, documentReviewSchema, driverProgramsSchema, driverSuspendSchema, incidentDecisionSchema, leadStatusSchema, packSchema, pageOf,
  pricingRuleInputSchema, pricingRuleSchema, reportQuerySchema, sanctionInputSchema, settingUpdateSchema, staffNoteInputSchema, staffNoteSchema, uuid,
  vehicleReviewSchema, zoneUpdateSchema,
} from '@neomoov/domain';
import { Body, Controller, Get, Header, HttpCode, Param, Patch, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { ApiErrors, ZodBody, ZodQuery, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { CurrentUser, NoAudit, Roles, STAFF_READ_ROLES, STAFF_WRITE_ROLES, type UserActor } from '../auth/actor.js';
import { RidesService } from '../rides/rides.service.js';
import { AdminDirectoryService } from './admin-directory.service.js';
import { AdminDriversService } from './admin-drivers.service.js';
import { AdminOverviewService } from './admin-overview.service.js';

type ListQuery = z.infer<typeof adminListQuerySchema>;
const zoneCode = z.string().regex(/^[a-z0-9_-]{1,40}$/);
const settingKey = z.string().regex(/^[a-z0-9_.]{2,80}$/);
const geometrySchema = z.object({ id: uuid, code: z.string(), name: z.string(), type: z.string(), active: z.boolean(), geometry: z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))) }) });

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
export class AdminOverviewController {
  constructor(
    private readonly overview: AdminOverviewService,
    private readonly rides: RidesService,
  ) {}

  @Get('dashboard')
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'Tableau de bord : compteurs, flotte en ligne, alertes, planifiées non confirmées, revenus du jour' })
  @ZodResponse(200, adminDashboardSchema)
  @ApiErrors(401, 403, 429)
  dashboard() {
    return this.overview.dashboard();
  }

  @Get('rides')
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'Courses : ouvertes par urgence (répartition), planifiées à venir ou récentes ; recherche par numéro, adresse, nom, téléphone' })
  @ZodQuery(adminRideListQuerySchema)
  @ZodResponse(200, pageOf(adminRideListItemSchema))
  @ApiErrors(400, 401, 403, 429)
  listRides(@Query(zodPipe(adminRideListQuerySchema)) query: z.infer<typeof adminRideListQuerySchema>) {
    return this.overview.rides(query);
  }

  @Get('rides/:id/summary')
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'En-tête d\'une course pour My Hub : numéro public, client (téléphone masqué), chauffeur, prix' })
  @ZodResponse(200, adminRideListItemSchema)
  @ApiErrors(401, 403, 404, 429)
  rideSummary(@Param('id', zodPipe(uuid)) id: string) {
    return this.overview.rideSummary(id);
  }

  @Post('rides/:id/cancel')
  @Roles(...STAFF_WRITE_ROLES)
  @HttpCode(200)
  @ApiOperation({ summary: 'Annulation par l\'opérateur (au nom du client) ; frais d\'annulation seulement si demandé' })
  @ZodBody(adminCancelRideSchema)
  @ZodResponse(200, cancellationResultSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  cancelRide(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(adminCancelRideSchema)) body: z.infer<typeof adminCancelRideSchema>, @CurrentUser() user: UserActor) {
    return this.rides.cancelByOperator(id, user, body);
  }

  @Get('reports')
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'Rapport d\'une période (jours de Montréal) : volumes, revenus, taux d\'annulation et d\'absence de chauffeur, note' })
  @ZodQuery(reportQuerySchema)
  @ZodResponse(200, adminReportSchema)
  @ApiErrors(400, 401, 403, 429)
  report(@Query(zodPipe(reportQuerySchema)) query: z.infer<typeof reportQuerySchema>) {
    return this.overview.report(query.from, query.to);
  }

  @Get('reports.csv')
  @Roles(...STAFF_READ_ROLES)
  @Header('content-type', 'text/csv; charset=utf-8')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Export CSV du rapport quotidien' })
  @ZodQuery(reportQuerySchema)
  @ApiErrors(400, 401, 403, 429)
  async reportCsv(@Query(zodPipe(reportQuerySchema)) query: z.infer<typeof reportQuerySchema>, @Res({ passthrough: true }) res: Response) {
    res.setHeader('content-disposition', `attachment; filename="neomoov-rapport-${query.from}-${query.to}.csv"`);
    return this.overview.reportCsv(query.from, query.to);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
export class AdminDriversController {
  constructor(private readonly drivers: AdminDriversService) {}

  @Get('drivers')
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'Chauffeurs : dossiers à traiter d\'abord ; filtre par statut, recherche par nom, téléphone, numéro' })
  @ZodQuery(adminListQuerySchema)
  @ZodResponse(200, pageOf(adminDriverListItemSchema))
  @ApiErrors(400, 401, 403, 429)
  list(@Query(zodPipe(adminListQuerySchema)) query: ListQuery) {
    return this.drivers.list(query);
  }

  @Get('drivers/:id')
  @Roles(...STAFF_READ_ROLES)
  @ApiOperation({ summary: 'Fiche complète : identité (masquée), véhicules, documents, notes, sanctions, statistiques' })
  @ZodResponse(200, adminDriverDetailSchema)
  @ApiErrors(401, 403, 404, 429)
  detail(@Param('id', zodPipe(uuid)) id: string) {
    return this.drivers.detail(id);
  }

  @Post('drivers/:id/activate')
  @Roles(...STAFF_WRITE_ROLES)
  @HttpCode(200)
  @ApiOperation({ summary: 'Valide le dossier : le chauffeur est actif' })
  @ZodResponse(200, adminDriverDetailSchema)
  @ApiErrors(401, 403, 404, 409, 429)
  activate(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor) {
    return this.drivers.activate(id, user);
  }

  @Post('drivers/:id/suspend')
  @Roles(...STAFF_WRITE_ROLES)
  @HttpCode(200)
  @ApiOperation({ summary: 'Suspend le chauffeur (motif obligatoire) : hors ligne immédiatement' })
  @ZodBody(driverSuspendSchema)
  @ZodResponse(200, adminDriverDetailSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  suspend(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(driverSuspendSchema)) body: z.infer<typeof driverSuspendSchema>, @CurrentUser() user: UserActor) {
    return this.drivers.suspend(id, body.reason, user);
  }

  @Post('drivers/:id/reactivate')
  @Roles(...STAFF_WRITE_ROLES)
  @HttpCode(200)
  @ApiOperation({ summary: 'Réactive le chauffeur : fin des suspensions en cours (décision humaine)' })
  @ZodResponse(200, adminDriverDetailSchema)
  @ApiErrors(401, 403, 404, 429)
  reactivate(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor) {
    return this.drivers.reactivate(id, user);
  }

  @Post('drivers/:id/programs')
  @Roles(...STAFF_WRITE_ROLES)
  @HttpCode(200)
  @ApiOperation({ summary: 'Programmes du chauffeur : locataire R-LuxeEV (pack Découverte offert)' })
  @ZodBody(driverProgramsSchema)
  @ZodResponse(200, adminDriverDetailSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  programs(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(driverProgramsSchema)) body: z.infer<typeof driverProgramsSchema>, @CurrentUser() user: UserActor) {
    return this.drivers.setPrograms(id, body, user);
  }

  @Post('drivers/:id/sanctions')
  @Roles(...STAFF_WRITE_ROLES)
  @HttpCode(200)
  @ApiOperation({ summary: 'Sanction graduée (avertissement, restriction, suspension), motivée' })
  @ZodBody(sanctionInputSchema)
  @ZodResponse(200, adminDriverDetailSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  sanction(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(sanctionInputSchema)) body: z.infer<typeof sanctionInputSchema>, @CurrentUser() user: UserActor) {
    return this.drivers.addSanction(id, body, user);
  }

  @Post('drivers/:id/notes')
  @Roles(...STAFF_WRITE_ROLES)
  @HttpCode(201)
  @ApiOperation({ summary: 'Note interne sur le chauffeur (jamais visible de lui)' })
  @ZodBody(staffNoteInputSchema)
  @ZodResponse(201, staffNoteSchema)
  @ApiErrors(400, 401, 403, 429)
  note(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(staffNoteInputSchema)) body: z.infer<typeof staffNoteInputSchema>, @CurrentUser() user: UserActor) {
    return this.drivers.addNote('driver', id, body.body, user);
  }

  @Get('documents')
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'File de revue des documents (en attente par défaut, les plus anciens d\'abord)' })
  @ZodQuery(adminListQuerySchema)
  @ZodResponse(200, pageOf(adminDocumentSchema))
  @ApiErrors(400, 401, 403, 429)
  documents(@Query(zodPipe(adminListQuerySchema)) query: ListQuery) {
    return this.drivers.documents(query);
  }

  @Get('documents/:id/content')
  @Roles(...STAFF_WRITE_ROLES)
  @ApiProduces('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
  @ApiOperation({ summary: 'Fichier du document pour la visionneuse (stockage privé, consultation journalisée)' })
  @ApiErrors(401, 403, 404, 429)
  async documentContent(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor, @Res({ passthrough: true }) res: Response) {
    const file = await this.drivers.documentContent(id, user);
    res.setHeader('content-type', file.contentType);
    res.setHeader('cache-control', 'private, no-store');
    return new StreamableFile(file.body);
  }

  @Post('documents/:id/review')
  @Roles(...STAFF_WRITE_ROLES)
  @HttpCode(200)
  @ApiOperation({ summary: 'Revue humaine : approbation (échéance lue sur le document) ou refus motivé' })
  @ZodBody(documentReviewSchema)
  @ZodResponse(200, adminDocumentSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  review(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(documentReviewSchema)) body: z.infer<typeof documentReviewSchema>, @CurrentUser() user: UserActor) {
    return this.drivers.reviewDocument(id, body, user);
  }

  @Get('vehicles')
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'Véhicules : à inspecter d\'abord ; recherche par plaque, modèle, numéro de chauffeur' })
  @ZodQuery(adminListQuerySchema)
  @ZodResponse(200, pageOf(adminVehicleSchema))
  @ApiErrors(400, 401, 403, 429)
  vehicles(@Query(zodPipe(adminListQuerySchema)) query: ListQuery) {
    return this.drivers.vehicles(query);
  }

  @Post('vehicles/:id/review')
  @Roles(...STAFF_WRITE_ROLES)
  @HttpCode(200)
  @ApiOperation({ summary: 'Inspection du véhicule : actif (prochaine échéance), non conforme ou retiré' })
  @ZodBody(vehicleReviewSchema)
  @ZodResponse(200, adminVehicleSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  reviewVehicle(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(vehicleReviewSchema)) body: z.infer<typeof vehicleReviewSchema>, @CurrentUser() user: UserActor) {
    return this.drivers.reviewVehicle(id, body, user);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
export class AdminDirectoryController {
  constructor(
    private readonly directory: AdminDirectoryService,
    private readonly drivers: AdminDriversService,
  ) {}

  @Get('clients')
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'Clients (coordonnées masquées), recherche par nom, téléphone, courriel' })
  @ZodQuery(adminListQuerySchema)
  @ZodResponse(200, pageOf(adminClientSchema))
  @ApiErrors(400, 401, 403, 429)
  clients(@Query(zodPipe(adminListQuerySchema)) query: ListQuery) {
    return this.directory.clients(query);
  }

  @Post('clients/:id/notes')
  @Roles(...STAFF_WRITE_ROLES)
  @HttpCode(201)
  @ApiOperation({ summary: 'Note interne sur le client' })
  @ZodBody(staffNoteInputSchema)
  @ZodResponse(201, staffNoteSchema)
  @ApiErrors(400, 401, 403, 429)
  clientNote(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(staffNoteInputSchema)) body: z.infer<typeof staffNoteInputSchema>, @CurrentUser() user: UserActor) {
    return this.drivers.addNote('client', id, body.body, user);
  }

  @Get('incidents')
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'Incidents (ouverts d\'abord, par gravité) ; `status=privacy` : registre des incidents de confidentialité' })
  @ZodQuery(adminListQuerySchema)
  @ZodResponse(200, pageOf(adminIncidentSchema))
  @ApiErrors(400, 401, 403, 429)
  incidents(@Query(zodPipe(adminListQuerySchema)) query: ListQuery) {
    return this.directory.incidents(query);
  }

  @Post('incidents/:id/decide')
  @Roles(...STAFF_WRITE_ROLES)
  @HttpCode(200)
  @ApiOperation({ summary: 'Décision sur un incident : instruction, décision motivée, clôture' })
  @ZodBody(incidentDecisionSchema)
  @ZodResponse(200, adminIncidentSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  decideIncident(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(incidentDecisionSchema)) body: z.infer<typeof incidentDecisionSchema>, @CurrentUser() user: UserActor) {
    return this.directory.decideIncident(id, body, user);
  }

  @Get('settings')
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'Réglages d\'exploitation (valeurs, descriptions)' })
  @ZodResponse(200, z.array(adminSettingSchema))
  @ApiErrors(401, 403, 429)
  settings(@Query('q') q?: string) {
    return this.directory.settingsList(q?.slice(0, 80));
  }

  @Patch('settings/:key')
  @Roles('admin')
  @ApiOperation({ summary: 'Modifie un réglage (même type de valeur) ; effectif au plus une minute plus tard' })
  @ZodBody(settingUpdateSchema)
  @ZodResponse(200, adminSettingSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  updateSetting(@Param('key', zodPipe(settingKey)) key: string, @Body(zodPipe(settingUpdateSchema)) body: z.infer<typeof settingUpdateSchema>, @CurrentUser() user: UserActor) {
    return this.directory.updateSetting(key, body.value, user);
  }

  @Get('staff')
  @Roles('admin')
  @ApiOperation({ summary: 'Personnel : rôles, second facteur inscrit' })
  @ZodResponse(200, z.array(adminStaffSchema))
  @ApiErrors(401, 403, 429)
  staff() {
    return this.directory.staff();
  }

  @Get('data-requests')
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'Demandes de droits (Loi 25) : échéance à 30 jours, en retard signalées' })
  @ZodQuery(adminListQuerySchema)
  @ZodResponse(200, pageOf(adminDataRequestSchema))
  @ApiErrors(400, 401, 403, 429)
  dataRequests(@Query(zodPipe(adminListQuerySchema)) query: ListQuery) {
    return this.directory.dataRequests(query);
  }

  @Get('leads')
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'Prospects reçus du web et de WordPress (préinscriptions de chauffeurs, entreprises, partenaires)' })
  @ZodQuery(adminListQuerySchema)
  @ZodResponse(200, pageOf(adminLeadSchema))
  @ApiErrors(400, 401, 403, 429)
  leads(@Query(zodPipe(adminListQuerySchema)) query: ListQuery) {
    return this.directory.leads(query);
  }

  @Patch('leads/:id')
  @Roles(...STAFF_WRITE_ROLES)
  @ApiOperation({ summary: 'Suivi d\'un prospect : contacté, converti, écarté' })
  @ZodBody(leadStatusSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  leadStatus(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(leadStatusSchema)) body: z.infer<typeof leadStatusSchema>) {
    return this.directory.setLeadStatus(id, body.status);
  }

  @Get('packs')
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'Catalogue des packs' })
  @ZodResponse(200, z.array(packSchema))
  @ApiErrors(401, 403, 429)
  packs() {
    return this.directory.packs();
  }

  @Get('promotions')
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'Promotions (budget consommé, validité)' })
  @ZodResponse(200, z.array(adminPromotionSchema))
  @ApiErrors(401, 403, 429)
  promotions() {
    return this.directory.promotions();
  }

  @Get('invoices')
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'Factures et état de transmission au SEV' })
  @ZodQuery(adminListQuerySchema)
  @ZodResponse(200, pageOf(adminInvoiceSchema))
  @ApiErrors(400, 401, 403, 429)
  invoices(@Query(zodPipe(adminListQuerySchema)) query: ListQuery) {
    return this.directory.invoices(query);
  }

  @Get('statements')
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'Relevés hebdomadaires de tous les chauffeurs (génération : étape 9)' })
  @ZodQuery(adminListQuerySchema)
  @ZodResponse(200, pageOf(adminStatementSchema))
  @ApiErrors(400, 401, 403, 429)
  statements(@Query(zodPipe(adminListQuerySchema)) query: ListQuery) {
    return this.directory.statements(query);
  }

  @Get('tariffs')
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'Grilles tarifaires par catégorie, avec leurs dates d\'entrée en vigueur (historique compris)' })
  @ZodResponse(200, z.array(pricingRuleSchema))
  @ApiErrors(401, 403, 429)
  tariffs() {
    return this.directory.pricingRules();
  }

  @Post('tariffs')
  @Roles(...STAFF_WRITE_ROLES)
  @HttpCode(201)
  @ApiOperation({ summary: 'Nouvelle grille d\'une catégorie avec sa date d\'entrée en vigueur (jamais passée)' })
  @ZodBody(pricingRuleInputSchema)
  @ZodResponse(201, pricingRuleSchema)
  @ApiErrors(400, 401, 403, 429)
  addTariff(@Body(zodPipe(pricingRuleInputSchema)) body: z.infer<typeof pricingRuleInputSchema>) {
    return this.directory.addPricingRule(body);
  }

  @Get('zones')
  @Roles(...STAFF_READ_ROLES)
  @NoAudit()
  @ApiOperation({ summary: 'Zones avec leur polygone (éditeur sur carte)' })
  @ZodResponse(200, z.array(geometrySchema))
  @ApiErrors(401, 403, 429)
  zones() {
    return this.directory.zoneGeometries();
  }

  @Put('zones/:code')
  @Roles(...STAFF_WRITE_ROLES)
  @ApiOperation({ summary: 'Modifie le polygone d\'une zone : fermé, sans auto-intersection, dans les bornes (validé avant enregistrement)' })
  @ZodBody(zoneUpdateSchema)
  @ZodResponse(200, geometrySchema)
  @ApiErrors(400, 401, 403, 404, 429)
  updateZone(@Param('code', zodPipe(zoneCode)) code: string, @Body(zodPipe(zoneUpdateSchema)) body: z.infer<typeof zoneUpdateSchema>) {
    return this.directory.updateZone(code, body);
  }
}
