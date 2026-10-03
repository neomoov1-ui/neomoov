/**
 * Étape 23 (amendement v1.2, section 6) : module Flotte, routes d'organisation `/v1/org/:organizationId/...` (garde
 * `OrgScopeGuard`, permissions du rôle dans l'organisation, transaction restreinte par `OrgScopeInterceptor` : une ligne
 * d'une autre organisation donne 404, jamais 403) et acceptation d'une invitation de chauffeur par la personne invitée.
 * Uniquement les courses Neomoov (décision D1) : aucune lecture ni action sur une autre plateforme.
 * Finalisation du 3 octobre 2026 : annulation d'une course, suspension et réactivation d'un chauffeur, critères Pilote de
 * la flotte ; les routes d'écriture sur une course, un devis ou un lieu déclarent leur objet (conditions des rôles).
 */
import {
  adminAssignSchema, adminCancelRideSchema, adminCreateRideSchema, adminDriverDetailSchema, adminListQuerySchema, adminReassignSchema, cancellationResultSchema, driverAttachmentSchema,
  driverInvitationAcceptSchema, driverInvitationCreatedSchema, driverSuspendSchema, fleetPilotSettingsSchema,
  driverInvitationCreateSchema, fleetDocumentSchema, fleetDriverSchema, fleetLiveSchema, fleetSettingsSchema, fleetSettingsUpdateSchema, fleetVehicleSchema, localDateString,
  maintenanceCreateSchema, orgDocumentReviewSchema, organizationStatementSchema, orgStatementDetailSchema, orgVehicleCreateSchema, orgVehicleUpdateSchema, ownerDashboardSchema,
  pageOf, payoutAccountSchema, payoutOnboardingSchema, quoteRequestSchema, quotesResponseSchema, revenueShareRuleCreateSchema, revenueShareRuleEndSchema, revenueShareRuleSchema,
  rideSchema, statementSettleOfflineSchema, uuid, vehicleAssignSchema, vehicleMaintenanceViewSchema, weeklyReportQuerySchema, weeklyReportSchema,
} from '@neomoov/domain';
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { ApiErrors, ZodBody, ZodQuery, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { Authenticated, Can, CurrentOrgScope, CurrentUser, OrgScoped, ReqCtx, type OrgScope, type RequestContext, type UserActor } from '../auth/actor.js';
import { ActsOnPlace, ActsOnQuote, ActsOnRide } from '../organizations/org-request-gates.js';
import { OrganizationStatementsService } from '../settlement/organization-statements.service.js';
import { FleetDispatchService } from './fleet-dispatch.service.js';
import { FleetDriversService } from './fleet-drivers.service.js';
import { FleetFinanceService } from './fleet-finance.service.js';
import { FleetVehiclesService } from './fleet-vehicles.service.js';

type ListQuery = z.infer<typeof adminListQuerySchema>;
const expiringQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(180).default(30) });
const expiringDocumentSchema = z.object({ documentId: uuid, driverId: uuid, type: z.string(), expiresOn: localDateString });

@ApiTags('org')
@ApiBearerAuth()
@OrgScoped()
@Controller('org/:organizationId')
export class FleetController {
  constructor(
    private readonly drivers: FleetDriversService,
    private readonly vehicles: FleetVehiclesService,
    private readonly dispatch: FleetDispatchService,
    private readonly finance: FleetFinanceService,
    private readonly organizationStatements: OrganizationStatementsService,
  ) {}

  // --- Chauffeurs rattachés ---

  @Get('drivers')
  @Can('drivers.read')
  @ApiOperation({ summary: 'Chauffeurs de l\'organisation et de ses descendantes, avec documents, prochaine échéance, véhicule courant et prochaine inspection' })
  @ZodQuery(adminListQuerySchema)
  @ZodResponse(200, pageOf(fleetDriverSchema))
  @ApiErrors(400, 401, 403, 404, 429)
  listDrivers(@Query(zodPipe(adminListQuerySchema)) query: ListQuery) {
    return this.drivers.list(query);
  }

  @Post('drivers/invitations')
  @Can('drivers.invite')
  @HttpCode(201)
  @ApiOperation({ summary: 'Invite un chauffeur par texto (lien à usage unique, jamais montré à la personne qui invite) ; à l\'acceptation, il est rattaché à l\'organisation' })
  @ZodBody(driverInvitationCreateSchema)
  @ZodResponse(201, driverInvitationCreatedSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  inviteDriver(@Body(zodPipe(driverInvitationCreateSchema)) body: z.infer<typeof driverInvitationCreateSchema>, @CurrentUser() user: UserActor, @CurrentOrgScope() scope: OrgScope) {
    return this.drivers.invite(scope, body, user);
  }

  @Get('compliance/expiring')
  @Can('compliance.read', 'documents.read')
  @ApiOperation({ summary: 'Échéances de conformité : documents approuvés des chauffeurs de l\'organisation qui expirent dans les prochains jours (relances automatiques par la passe de conformité)' })
  @ZodQuery(expiringQuerySchema)
  @ZodResponse(200, z.array(expiringDocumentSchema))
  @ApiErrors(400, 401, 403, 404, 429)
  expiring(@Query(zodPipe(expiringQuerySchema)) query: z.infer<typeof expiringQuerySchema>) {
    return this.drivers.expiringDocuments(query.days);
  }

  @Get('drivers/:id/documents')
  @Can('documents.read')
  @ApiOperation({ summary: 'Documents d\'un chauffeur de l\'organisation, avec la revue de l\'organisation (404 hors de son sous-arbre)' })
  @ZodResponse(200, z.array(fleetDocumentSchema))
  @ApiErrors(401, 403, 404, 429)
  driverDocuments(@Param('id', zodPipe(uuid)) id: string) {
    return this.drivers.documents(id);
  }

  @Post('documents/:id/review')
  @Can('documents.review')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revue d\'un document en attente par l\'organisation : refus (motif) définitif, approbation recommandée (l\'approbation finale reste à la plateforme)' })
  @ZodBody(orgDocumentReviewSchema)
  @ZodResponse(200, fleetDocumentSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  reviewDocument(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(orgDocumentReviewSchema)) body: z.infer<typeof orgDocumentReviewSchema>, @CurrentUser() user: UserActor) {
    return this.drivers.reviewDocument(id, body, user);
  }

  // --- Véhicules et entretien ---

  @Post('vehicles')
  @Can('vehicles.manage')
  @HttpCode(201)
  @ApiOperation({ summary: 'Ajoute un véhicule de l\'organisation, tenu par un de ses chauffeurs (catégorie déduite, en attente de l\'inspection de la plateforme)' })
  @ZodBody(orgVehicleCreateSchema)
  @ZodResponse(201, fleetVehicleSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  createVehicle(@Body(zodPipe(orgVehicleCreateSchema)) body: z.infer<typeof orgVehicleCreateSchema>, @CurrentUser() user: UserActor) {
    return this.vehicles.create(body, user);
  }

  @Patch('vehicles/:id')
  @Can('vehicles.manage')
  @ApiOperation({ summary: 'Modifie un véhicule de l\'organisation (couleur, plaque, kilométrage, équipement, propriétaire) ou le retire du service' })
  @ZodBody(orgVehicleUpdateSchema)
  @ZodResponse(200, fleetVehicleSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  updateVehicle(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(orgVehicleUpdateSchema)) body: z.infer<typeof orgVehicleUpdateSchema>, @CurrentUser() user: UserActor) {
    return this.vehicles.update(id, body, user);
  }

  @Post('vehicles/:id/assign')
  @Can('vehicles.assign')
  @HttpCode(200)
  @ApiOperation({ summary: 'Affecte un véhicule à un chauffeur de l\'organisation (refusé s\'il est en service avec un autre chauffeur)' })
  @ZodBody(vehicleAssignSchema)
  @ZodResponse(200, fleetVehicleSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  assignVehicle(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(vehicleAssignSchema)) body: z.infer<typeof vehicleAssignSchema>, @CurrentUser() user: UserActor) {
    return this.vehicles.assign(id, body, user);
  }

  @Get('vehicles/:id/maintenance')
  @Can('vehicles.read')
  @ApiOperation({ summary: 'Inspections et entretien d\'un véhicule, avec les échéances (en retard, proches, à jour)' })
  @ZodResponse(200, vehicleMaintenanceViewSchema)
  @ApiErrors(401, 403, 404, 429)
  maintenance(@Param('id', zodPipe(uuid)) id: string, @ReqCtx() ctx: RequestContext) {
    return this.vehicles.maintenance(id, new Date(), ctx.language);
  }

  @Post('vehicles/:id/maintenance')
  @Can('vehicles.maintenance.manage')
  @HttpCode(201)
  @ApiOperation({ summary: 'Enregistre une inspection ou un entretien (date, kilométrage, type, coût, prochaine échéance)' })
  @ZodBody(maintenanceCreateSchema)
  @ZodResponse(201, vehicleMaintenanceViewSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  addMaintenance(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(maintenanceCreateSchema)) body: z.infer<typeof maintenanceCreateSchema>, @CurrentUser() user: UserActor) {
    return this.vehicles.addMaintenance(id, body, user);
  }

  // --- Carte en direct, courses reçues, répartition interne, réseau ---

  @Get('live')
  @Can('drivers.read', 'rides.read')
  @ApiOperation({ summary: 'Carte en direct : chauffeurs de l\'organisation en ligne (position, état, véhicule) et ses courses en cours' })
  @ZodResponse(200, fleetLiveSchema)
  @ApiErrors(401, 403, 404, 429)
  live() {
    return this.dispatch.live();
  }

  @Post('quotes')
  @Can('rides.create')
  @ActsOnPlace('origin')
  @HttpCode(201)
  @ApiOperation({ summary: 'Devis saisi par le répartiteur de l\'organisation (mêmes règles que l\'application) ; il appartient à l\'organisation' })
  @ZodBody(quoteRequestSchema)
  @ZodResponse(201, quotesResponseSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  quote(@Body(zodPipe(quoteRequestSchema)) body: z.infer<typeof quoteRequestSchema>, @CurrentUser() user: UserActor, @ReqCtx() ctx: RequestContext) {
    return this.dispatch.quote(body, user, ctx.language);
  }

  @Post('rides')
  @Can('rides.create')
  @ActsOnQuote('quoteId')
  @HttpCode(201)
  @ApiOperation({ summary: 'Course reçue par l\'organisation, saisie par son répartiteur à partir d\'un devis de l\'organisation (compte client rattaché ou fiche minimale)' })
  @ZodBody(adminCreateRideSchema)
  @ZodResponse(201, rideSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  createRide(@Body(zodPipe(adminCreateRideSchema)) body: z.infer<typeof adminCreateRideSchema>, @CurrentUser() user: UserActor) {
    return this.dispatch.createRide(body, user);
  }

  @Post('rides/:id/assign')
  @Can('rides.assign')
  @ActsOnRide('id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Répartition interne : attribue une course de l\'organisation à l\'un de ses chauffeurs (garantie modèle vérifiée ; un chauffeur d\'une autre organisation est introuvable)' })
  @ZodBody(adminAssignSchema)
  @ZodResponse(200, rideSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  assignRide(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(adminAssignSchema)) body: z.infer<typeof adminAssignSchema>, @CurrentUser() user: UserActor) {
    return this.dispatch.assign(id, body, user);
  }

  @Post('rides/:id/reassign')
  @Can('rides.reassign')
  @ActsOnRide('id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Réattribution : chauffeur retiré sans sanction, nouvelle recherche prioritaire parmi les chauffeurs de l\'organisation' })
  @ZodBody(adminReassignSchema)
  @ZodResponse(200, rideSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  reassignRide(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(adminReassignSchema)) body: z.infer<typeof adminReassignSchema>, @CurrentUser() user: UserActor) {
    return this.dispatch.reassign(id, body, user);
  }

  @Post('rides/:id/cancel')
  @Can('rides.cancel')
  @ActsOnRide('id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Annule une course de l\'organisation au nom du client (frais d\'annulation seulement si demandé) ; 404 hors de son sous-arbre' })
  @ZodBody(adminCancelRideSchema)
  @ZodResponse(200, cancellationResultSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  cancelRide(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(adminCancelRideSchema)) body: z.infer<typeof adminCancelRideSchema>, @CurrentUser() user: UserActor) {
    return this.dispatch.cancel(id, body, user);
  }

  // --- Suspension des chauffeurs ---

  @Post('drivers/:id/suspend')
  @Can('drivers.suspend')
  @HttpCode(200)
  @ApiOperation({ summary: 'Suspend un chauffeur de l\'organisation (motif obligatoire) : hors ligne immédiatement, plus aucune offre ; 404 hors de son sous-arbre' })
  @ZodBody(driverSuspendSchema)
  @ZodResponse(200, adminDriverDetailSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  suspendDriver(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(driverSuspendSchema)) body: z.infer<typeof driverSuspendSchema>, @CurrentUser() user: UserActor) {
    return this.drivers.suspend(id, body.reason, user);
  }

  @Post('drivers/:id/reactivate')
  @Can('drivers.activate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Réactive un chauffeur suspendu par l\'organisation ; 409 `SUSPENDED_BY_PLATFORM` si une suspension de la plateforme (conformité, qualité, sécurité, solde) reste en cours' })
  @ZodResponse(200, adminDriverDetailSchema)
  @ApiErrors(401, 403, 404, 409, 429)
  reactivateDriver(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor) {
    return this.drivers.reactivate(id, user);
  }

  // --- Critères Pilote de la flotte ---

  @Get('fleet/pilot')
  @Can('drivers.read', 'drivers.programs.manage')
  @ApiOperation({ summary: 'Critères Neomoov Pilote de la flotte : `off`, `default` (pour les chauffeurs qui n\'en ont réglé aucun) ou `minimum` (en plus des leurs) ; l\'ordre des offres ne change jamais' })
  @ZodResponse(200, fleetPilotSettingsSchema)
  @ApiErrors(401, 403, 404, 429)
  pilotSettings(@CurrentOrgScope() scope: OrgScope) {
    return this.dispatch.pilotSettings(scope.organizationId);
  }

  @Put('fleet/pilot')
  @Can('drivers.programs.manage')
  @ApiOperation({ summary: 'Règle les critères Neomoov Pilote de la flotte (zones connues seulement) ; ils ne décident que l\'acceptation automatique de ses chauffeurs' })
  @ZodBody(fleetPilotSettingsSchema)
  @ZodResponse(200, fleetPilotSettingsSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  updatePilotSettings(@Body(zodPipe(fleetPilotSettingsSchema)) body: z.infer<typeof fleetPilotSettingsSchema>, @CurrentOrgScope() scope: OrgScope) {
    return this.dispatch.updatePilotSettings(scope.organizationId, body);
  }

  @Get('fleet/settings')
  @Can('rides.read', 'dispatch.network.share')
  @ApiOperation({ summary: 'Mode réseau de l\'organisation (`isolated` par défaut, ou `neomoov_network`) et délai avant partage au réseau Neomoov' })
  @ZodResponse(200, fleetSettingsSchema)
  @ApiErrors(401, 403, 404, 429)
  settings(@CurrentOrgScope() scope: OrgScope) {
    return this.dispatch.settings(scope.organizationId);
  }

  @Patch('fleet/settings')
  @Can('dispatch.network.share')
  @ApiOperation({ summary: 'Règle le mode réseau : en `neomoov_network`, une course non pourvue après le délai repart au réseau Neomoov avec le strict nécessaire' })
  @ZodBody(fleetSettingsUpdateSchema)
  @ZodResponse(200, fleetSettingsSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  updateSettings(@Body(zodPipe(fleetSettingsUpdateSchema)) body: z.infer<typeof fleetSettingsUpdateSchema>, @CurrentOrgScope() scope: OrgScope) {
    return this.dispatch.updateSettings(scope.organizationId, body);
  }

  // --- Partage des revenus ---

  @Get('revenue-share-rules')
  @Can('statements.read', 'revenue_share.manage')
  @ApiOperation({ summary: 'Règles de partage des revenus de l\'organisation (loyer par semaine ou pourcentage du tarif chauffeur)' })
  @ZodResponse(200, z.array(revenueShareRuleSchema))
  @ApiErrors(401, 403, 404, 429)
  rules() {
    return this.finance.rules();
  }

  @Post('revenue-share-rules')
  @Can('revenue_share.manage')
  @HttpCode(201)
  @ApiOperation({ summary: 'Nouvelle règle de partage, par défaut ou pour un chauffeur, avec dates d\'effet (la règle du chauffeur l\'emporte sur celle de l\'organisation)' })
  @ZodBody(revenueShareRuleCreateSchema)
  @ZodResponse(201, revenueShareRuleSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  createRule(@Body(zodPipe(revenueShareRuleCreateSchema)) body: z.infer<typeof revenueShareRuleCreateSchema>, @CurrentUser() user: UserActor, @CurrentOrgScope() scope: OrgScope) {
    return this.finance.createRule(scope, body, user);
  }

  @Post('revenue-share-rules/:id/end')
  @Can('revenue_share.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Fin d\'une règle de partage (dernier jour inclus)' })
  @ZodBody(revenueShareRuleEndSchema)
  @ZodResponse(200, revenueShareRuleSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  endRule(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(revenueShareRuleEndSchema)) body: z.infer<typeof revenueShareRuleEndSchema>) {
    return this.finance.endRule(id, body.effectiveTo);
  }

  // --- Relevés et versements ---

  @Get('statements/:id')
  @Can('statements.read')
  @ApiOperation({ summary: 'Relevé hebdomadaire d\'un chauffeur de l\'organisation, avec ses lignes et la part de l\'organisation' })
  @ZodResponse(200, orgStatementDetailSchema)
  @ApiErrors(401, 403, 404, 429)
  statement(@Param('id', zodPipe(uuid)) id: string) {
    return this.finance.statement(id);
  }

  @Get('statements/:id/pdf')
  @Can('statements.read')
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'PDF du relevé d\'un chauffeur de l\'organisation (409 tant qu\'il est en préparation)' })
  @ApiErrors(401, 403, 404, 409, 429)
  async statementPdf(@Param('id', zodPipe(uuid)) id: string, @Res({ passthrough: true }) res: Response) {
    const pdf = await this.finance.statementPdf(id);
    if (!pdf) throw AppError.conflict('STATEMENT_PDF_NOT_READY', 'Le PDF du relevé est en préparation, réessayez dans un instant');
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `inline; filename="releve-${id}.pdf"`);
    res.setHeader('cache-control', 'private, no-store');
    return new StreamableFile(pdf);
  }

  @Get('organization-statements')
  @Can('statements.read')
  @ApiOperation({ summary: 'Relevés de l\'organisation : sa part de chaque semaine, chauffeur par chauffeur, et son règlement (Connect ou hors plateforme)' })
  @ZodResponse(200, z.array(organizationStatementSchema))
  @ApiErrors(401, 403, 404, 429)
  listOrganizationStatements() {
    return this.organizationStatements.list();
  }

  @Get('organization-statements/:id')
  @Can('statements.read')
  @ApiOperation({ summary: 'Un relevé de l\'organisation (404 pour celui d\'une autre organisation)' })
  @ZodResponse(200, organizationStatementSchema)
  @ApiErrors(401, 403, 404, 429)
  organizationStatement(@Param('id', zodPipe(uuid)) id: string) {
    return this.organizationStatements.detail(id);
  }

  @Post('organization-statements/:id/settle-offline')
  @Can('payouts.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Règlement constaté hors plateforme (virement, Interac) quand Stripe Connect n\'est pas en service ; rejoué avec la même référence, sans effet' })
  @ZodBody(statementSettleOfflineSchema)
  @ZodResponse(200, organizationStatementSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  settleOffline(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(statementSettleOfflineSchema)) body: z.infer<typeof statementSettleOfflineSchema>, @CurrentUser() user: UserActor) {
    return this.organizationStatements.settleOffline(id, body, user);
  }

  @Get('payouts/export.csv')
  @Can('statements.read')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Export des virements de l\'organisation (CSV, séparateur « ; ») : un relevé par ligne, pour le rapprochement' })
  @ApiErrors(401, 403, 404, 429)
  async exportPayouts(@Res({ passthrough: true }) res: Response) {
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="versements-organisation.csv"');
    return this.organizationStatements.exportCsv();
  }

  @Get('payout-account')
  @Can('statements.read', 'payouts.manage')
  @ApiOperation({ summary: 'Compte de versement de l\'organisation : Stripe Connect en service, ou règlement hors plateforme' })
  @ZodResponse(200, payoutAccountSchema)
  @ApiErrors(401, 403, 404, 429)
  payoutAccount(@CurrentOrgScope() scope: OrgScope) {
    return this.finance.payoutAccount(scope.organizationId);
  }

  @Post('payout-account/onboarding')
  @Can('payouts.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Lien d\'ouverture du compte Stripe Connect de l\'organisation (créé au premier appel ; simulé tant que Stripe n\'est pas branché)' })
  @ZodResponse(200, payoutOnboardingSchema)
  @ApiErrors(401, 403, 404, 429)
  payoutOnboarding(@CurrentUser() user: UserActor, @CurrentOrgScope() scope: OrgScope) {
    return this.finance.payoutOnboarding(scope.organizationId, user);
  }

  // --- Rapports ---

  @Get('reports/weekly')
  @Can('reports.read')
  @ApiOperation({ summary: 'Rapport de la semaine : courses Neomoov, revenus et part de l\'organisation, par chauffeur et par véhicule' })
  @ZodQuery(weeklyReportQuerySchema)
  @ZodResponse(200, weeklyReportSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  weeklyReport(@Query(zodPipe(weeklyReportQuerySchema)) query: z.infer<typeof weeklyReportQuerySchema>, @CurrentOrgScope() scope: OrgScope) {
    return this.finance.weeklyReport(scope, query.periodStart);
  }

  @Get('owner/vehicles')
  @Can('vehicles.owner.read')
  @ApiOperation({ summary: 'Tableau de bord du propriétaire de véhicule : ses véhicules, leurs courses et revenus de la semaine, leurs échéances' })
  @ZodQuery(weeklyReportQuerySchema)
  @ZodResponse(200, ownerDashboardSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  ownerDashboard(@Query(zodPipe(weeklyReportQuerySchema)) query: z.infer<typeof weeklyReportQuerySchema>, @CurrentUser() user: UserActor, @CurrentOrgScope() scope: OrgScope) {
    return this.finance.ownerDashboard(scope, user, query.periodStart);
  }
}

/** Acceptation d'une invitation de chauffeur par la personne invitée (téléphone de l'invitation), depuis l'application. */
@ApiTags('driver')
@ApiBearerAuth()
@Authenticated()
@Controller('driver-invitations')
export class DriverInvitationsController {
  constructor(private readonly drivers: FleetDriversService) {}

  @Post('accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Accepte une invitation de chauffeur : profil chauffeur créé ou repris, rattaché à l\'organisation (l\'ancienne est quittée, ses relevés en brouillon émis)' })
  @ZodBody(driverInvitationAcceptSchema)
  @ZodResponse(200, driverAttachmentSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  accept(@Body(zodPipe(driverInvitationAcceptSchema)) body: z.infer<typeof driverInvitationAcceptSchema>, @CurrentUser() user: UserActor) {
    return this.drivers.accept(body.token, user);
  }
}
