/**
 * Routes d'organisation (étape 20, amendement v1.2 section 4) : un membre d'une organisation cliente (compagnie, flotte,
 * entreprise) travaille sur les données de son organisation et de ses descendantes, avec les permissions de son rôle dans
 * cette organisation (`OrgScopeGuard`), dans une transaction restreinte par les politiques de sécurité au niveau des
 * lignes (`OrgScopeInterceptor`). Les services de My Hub et des organisations sont réutilisés tels quels : sous la
 * transaction, ils ne voient que les lignes du sous-arbre. Le personnel de la plateforme passe par `/admin`, jamais par
 * ici : ses anciens rôles n'y donnent rien.
 */
import {
  adminDriverDetailSchema, adminListQuerySchema, adminRideListItemSchema, adminRideListQuerySchema, adminStatementSchema,
  adminVehicleSchema, invitationCreatedSchema, invitationCreateSchema, membershipUpdateSchema, membershipViewSchema, myOrganizationSchema, ORGANIZATION_PERMISSIONS,
  organizationHomeSchema, orgRoleCreateSchema, pageOf, rideSchema, rolePermissionsUpdateSchema, roleViewSchema, uuid,
} from '@neomoov/domain';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiErrors, ZodBody, ZodQuery, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { AdminDirectoryService } from '../admin/admin-directory.service.js';
import { AdminDriversService } from '../admin/admin-drivers.service.js';
import { AdminOverviewService } from '../admin/admin-overview.service.js';
import { auditPageSchema, auditQuerySchema, AuditService } from '../audit/audit.service.js';
import { Authenticated, Can, CurrentOrgScope, CurrentUser, OrgScoped, ReqCtx, type OrgScope, type RequestContext, type UserActor } from '../auth/actor.js';
import { RidesService } from '../rides/rides.service.js';
import { OrgWriteExempt } from './org-request-gates.js';
import { OrganizationsService } from './organizations.service.js';

type ListQuery = z.infer<typeof adminListQuerySchema>;

@ApiTags('org')
@ApiBearerAuth()
@OrgScoped()
@Controller('org/:organizationId')
export class OrgController {
  constructor(
    private readonly orgs: OrganizationsService,
    private readonly drivers: AdminDriversService,
    private readonly overview: AdminOverviewService,
    private readonly directory: AdminDirectoryService,
    private readonly rides: RidesService,
    private readonly audit: AuditService,
  ) {}

  // --- Fiche ---

  @Get()
  @Can(...ORGANIZATION_PERMISSIONS)
  @ApiOperation({ summary: 'Fiche de l\'organisation, permissions effectives de l\'appelant et modules actifs (tout membre qui détient au moins une permission)' })
  @ZodResponse(200, organizationHomeSchema)
  @ApiErrors(401, 403, 404, 429)
  home(@CurrentOrgScope() scope: OrgScope, @CurrentUser() user: UserActor) {
    return this.orgs.home(scope, user);
  }

  // --- Chauffeurs et véhicules ---

  // `GET drivers` : servie par le module Flotte (étape 23), enrichie des documents, échéances et véhicule courant.

  @Get('drivers/:id')
  @Can('drivers.read')
  @ApiOperation({ summary: 'Fiche d\'un chauffeur de l\'organisation (404 hors de son sous-arbre)' })
  @ZodResponse(200, adminDriverDetailSchema)
  @ApiErrors(401, 403, 404, 429)
  driver(@Param('id', zodPipe(uuid)) id: string) {
    return this.drivers.detail(id);
  }

  @Get('vehicles')
  @Can('vehicles.read')
  @ApiOperation({ summary: 'Véhicules de l\'organisation et de ses descendantes' })
  @ZodQuery(adminListQuerySchema)
  @ZodResponse(200, pageOf(adminVehicleSchema))
  @ApiErrors(400, 401, 403, 404, 429)
  vehicles(@Query(zodPipe(adminListQuerySchema)) query: ListQuery) {
    return this.drivers.vehicles(query);
  }

  // --- Courses ---

  @Get('rides')
  @Can('rides.read')
  @ApiOperation({ summary: 'Courses de l\'organisation : ouvertes par urgence, planifiées à venir ou récentes ; mêmes filtres et pagination que My Hub' })
  @ZodQuery(adminRideListQuerySchema)
  @ZodResponse(200, pageOf(adminRideListItemSchema))
  @ApiErrors(400, 401, 403, 404, 429)
  listRides(@Query(zodPipe(adminRideListQuerySchema)) query: z.infer<typeof adminRideListQuerySchema>) {
    return this.overview.rides(query);
  }

  @Get('rides/:id')
  @Can('rides.read')
  @ApiOperation({ summary: 'Une course de l\'organisation, vue My Hub (404 hors de son sous-arbre)' })
  @ZodResponse(200, rideSchema)
  @ApiErrors(401, 403, 404, 429)
  ride(@Param('id', zodPipe(uuid)) id: string) {
    return this.rides.viewById(id);
  }

  // --- Relevés ---

  @Get('statements')
  @Can('statements.read')
  @ApiOperation({ summary: 'Relevés hebdomadaires des chauffeurs de l\'organisation' })
  @ZodQuery(adminListQuerySchema)
  @ZodResponse(200, pageOf(adminStatementSchema))
  @ApiErrors(400, 401, 403, 404, 429)
  statements(@Query(zodPipe(adminListQuerySchema)) query: ListQuery) {
    return this.directory.statements(query);
  }

  // --- Membres et invitations ---

  @Get('members')
  @Can('members.read')
  @ApiOperation({ summary: 'Membres de l\'organisation, avec leur rôle et leur portée' })
  @ZodResponse(200, z.array(membershipViewSchema))
  @ApiErrors(401, 403, 404, 429)
  members(@CurrentOrgScope() scope: OrgScope) {
    return this.orgs.members(scope.organizationId);
  }

  @Post('invitations')
  @Can('members.invite')
  @HttpCode(201)
  @ApiOperation({ summary: 'Invitation dans l\'organisation (rôle système ou rôle personnalisé de l\'organisation, permissions que vous détenez ici) ; le lien part par texto ou courriel, le jeton n\'est jamais rendu (sauf réglage de développement)' })
  @ZodBody(invitationCreateSchema)
  @ZodResponse(201, invitationCreatedSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  invite(@Body(zodPipe(invitationCreateSchema)) body: z.infer<typeof invitationCreateSchema>, @CurrentUser() user: UserActor, @CurrentOrgScope() scope: OrgScope, @ReqCtx() ctx: RequestContext) {
    return this.orgs.invite(scope.organizationId, body, user, scope, new Date(), ctx.language);
  }

  @Patch('memberships/:id')
  @Can('members.manage')
  @OrgWriteExempt()
  @ApiOperation({ summary: 'Change le rôle d\'un membre de l\'organisation (ou d\'une descendante) ou le suspend ; 404 hors du sous-arbre' })
  @ZodBody(membershipUpdateSchema)
  @ZodResponse(200, membershipViewSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  updateMembership(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(membershipUpdateSchema)) body: z.infer<typeof membershipUpdateSchema>, @CurrentUser() user: UserActor, @CurrentOrgScope() scope: OrgScope) {
    return this.orgs.updateMembership(id, body, user, scope);
  }

  @Delete('memberships/:id')
  @Can('members.manage')
  @OrgWriteExempt()
  @HttpCode(204)
  @ApiOperation({ summary: 'Retire un membre de l\'organisation (ou d\'une descendante) ; 404 hors du sous-arbre' })
  @ApiErrors(401, 403, 404, 429)
  async removeMembership(@Param('id', zodPipe(uuid)) id: string) {
    await this.orgs.removeMembership(id);
  }

  // --- Rôles ---

  @Get('roles')
  @Can('roles.read')
  @ApiOperation({ summary: 'Rôles système et rôles personnalisés de l\'organisation, avec leurs permissions' })
  @ZodResponse(200, z.array(roleViewSchema))
  @ApiErrors(401, 403, 404, 429)
  roles(@CurrentOrgScope() scope: OrgScope) {
    return this.orgs.roles(scope.organizationId);
  }

  @Post('roles')
  @Can('roles.manage')
  @HttpCode(201)
  @ApiOperation({ summary: 'Crée un rôle personnalisé de l\'organisation ; seulement des permissions que vous détenez ici (pas d\'escalade)' })
  @ZodBody(orgRoleCreateSchema)
  @ZodResponse(201, roleViewSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  createRole(@Body(zodPipe(orgRoleCreateSchema)) body: z.infer<typeof orgRoleCreateSchema>, @CurrentUser() user: UserActor, @CurrentOrgScope() scope: OrgScope) {
    return this.orgs.createRole({ ...body, organizationId: scope.organizationId }, user, scope);
  }

  @Put('roles/:id/permissions')
  @Can('roles.manage')
  @ApiOperation({ summary: 'Remplace les permissions d\'un rôle personnalisé de l\'organisation (404 pour un rôle d\'une autre organisation, 409 pour un rôle système)' })
  @ZodBody(rolePermissionsUpdateSchema)
  @ZodResponse(200, roleViewSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  updateRole(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(rolePermissionsUpdateSchema)) body: z.infer<typeof rolePermissionsUpdateSchema>, @CurrentUser() user: UserActor, @CurrentOrgScope() scope: OrgScope) {
    return this.orgs.updateRolePermissions(id, body.permissions, user, scope, body.conditions);
  }

  // --- Journal ---

  @Get('audit')
  @Can('audit.read')
  @ApiOperation({ summary: 'Journal d\'audit de l\'organisation et de ses descendantes, du plus récent au plus ancien, par curseur' })
  @ZodQuery(auditQuerySchema)
  @ZodResponse(200, auditPageSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  auditLog(@Query(zodPipe(auditQuerySchema)) query: z.infer<typeof auditQuerySchema>, @CurrentOrgScope() scope: OrgScope) {
    return this.audit.list(query, scope.path);
  }
}

/** Sélecteur d'organisation de l'application unique : les adhésions actives de l'utilisateur connecté. */
@ApiTags('me')
@ApiBearerAuth()
@Authenticated()
@Controller('me')
export class MeOrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Get('organizations')
  @ApiOperation({ summary: 'Mes adhésions actives : organisation (identifiant, code, nom, type, chemin), rôle, portée, statut' })
  @ZodResponse(200, z.array(myOrganizationSchema))
  @ApiErrors(401, 429)
  organizations(@CurrentUser() user: UserActor) {
    return this.orgs.myOrganizations(user.userId);
  }
}
