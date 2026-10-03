/**
 * Étape 21 : routes d'organisation ajoutées pour My Hub côté organisation cliente (tableau de bord, sous-organisations,
 * catalogue des permissions, invitations, transfert de propriété, accès du support), toutes `@OrgScoped` et `@Can`,
 * exécutées dans la transaction restreinte au sous-arbre de l'organisation (une ligne d'une autre organisation : 404).
 * Plateforme : demande, liste et fin d'un accès temporaire du support (`support.access`, sensible).
 */
import {
  invitationViewSchema, membershipViewSchema, orgOrganizationCreateSchema, orgOverviewSchema, orgPermissionViewSchema, organizationSchema, ownershipTransferSchema,
  supportAccessGrantSchema, supportAccessListQuerySchema, supportAccessRequestSchema, uuid, type SupportAccessAction,
} from '@neomoov/domain';
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiErrors, ZodBody, ZodQuery, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { Can, CurrentOrgScope, CurrentUser, OrgScoped, type OrgScope, type UserActor } from '../auth/actor.js';
import { OrgHubService } from './org-hub.service.js';
import { OrgWriteExempt } from './org-request-gates.js';
import { OrganizationsService } from './organizations.service.js';
import { SupportAccessService } from './support-access.service.js';

const orgSupportQuerySchema = supportAccessListQuerySchema.pick({ status: true });

@ApiTags('org')
@ApiBearerAuth()
@OrgScoped()
@Controller('org/:organizationId')
export class OrgHubController {
  constructor(
    private readonly hub: OrgHubService,
    private readonly orgs: OrganizationsService,
    private readonly support: SupportAccessService,
  ) {}

  @Get('overview')
  @Can('dashboard.read', 'rides.read', 'drivers.read', 'statements.read')
  @ApiOperation({ summary: 'Tableau de bord de l\'organisation et de ses descendantes : courses du jour, chauffeurs en ligne, relevés à venir' })
  @ZodResponse(200, orgOverviewSchema)
  @ApiErrors(401, 403, 404, 429)
  overview(@CurrentOrgScope() scope: OrgScope) {
    return this.hub.overview(scope);
  }

  // --- Sous-organisations ---

  @Get('organizations')
  @Can('organizations.read', 'organizations.manage')
  @ApiOperation({ summary: 'L\'organisation et ses sous-organisations, dans l\'ordre de l\'arbre' })
  @ZodResponse(200, z.array(organizationSchema))
  @ApiErrors(401, 403, 404, 429)
  organizations(@CurrentOrgScope() scope: OrgScope) {
    return this.orgs.subtree(scope);
  }

  @Post('organizations')
  @Can('organizations.manage')
  @HttpCode(201)
  @ApiOperation({ summary: 'Crée une sous-organisation sous l\'organisation (ou sous une de ses descendantes) ; modules du parent repris' })
  @ZodBody(orgOrganizationCreateSchema)
  @ZodResponse(201, organizationSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  createOrganization(@Body(zodPipe(orgOrganizationCreateSchema)) body: z.infer<typeof orgOrganizationCreateSchema>, @CurrentOrgScope() scope: OrgScope, @CurrentUser() user: UserActor) {
    return this.orgs.createSubOrganization(scope, body, user);
  }

  // --- Rôles : catalogue ---

  @Get('permissions')
  @Can('roles.read', 'roles.manage')
  @ApiOperation({ summary: 'Catalogue des permissions qu\'une organisation cliente peut détenir (sensibles signalées) et celles que vous détenez ici' })
  @ZodResponse(200, z.array(orgPermissionViewSchema))
  @ApiErrors(401, 403, 404, 429)
  permissions(@CurrentOrgScope() scope: OrgScope) {
    return this.orgs.orgPermissions(scope);
  }

  // --- Invitations et propriété ---

  @Get('invitations')
  @Can('members.read', 'members.invite')
  @ApiOperation({ summary: 'Invitations de l\'organisation (en attente, acceptées, expirées, révoquées), sans jeton' })
  @ZodResponse(200, z.array(invitationViewSchema))
  @ApiErrors(401, 403, 404, 429)
  invitations(@CurrentOrgScope() scope: OrgScope) {
    return this.orgs.invitations(scope.organizationId);
  }

  @Delete('invitations/:invitationId')
  @Can('members.invite')
  @OrgWriteExempt()
  @HttpCode(204)
  @ApiOperation({ summary: 'Révoque une invitation en attente de l\'organisation' })
  @ApiErrors(401, 403, 404, 409, 429)
  async revokeInvitation(@Param('invitationId', zodPipe(uuid)) invitationId: string, @CurrentOrgScope() scope: OrgScope) {
    await this.orgs.revokeInvitation(scope.organizationId, invitationId);
  }

  @Post('ownership/transfer')
  @Can('members.manage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Transfère la propriété du compte à un membre actif de l\'organisation (réservé à un propriétaire) ; l\'ancien propriétaire devient administrateur' })
  @ZodBody(ownershipTransferSchema)
  @ZodResponse(200, membershipViewSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  transferOwnership(@Body(zodPipe(ownershipTransferSchema)) body: z.infer<typeof ownershipTransferSchema>, @CurrentOrgScope() scope: OrgScope, @CurrentUser() user: UserActor) {
    return this.orgs.transferOwnership(scope, body, user);
  }

  // --- Accès du support ---

  @Get('support-access')
  @Can('audit.read', 'members.manage')
  @ApiOperation({ summary: 'Accès temporaires du support de la plateforme à l\'organisation et à ses descendantes (demandés, en cours, passés)' })
  @ZodQuery(orgSupportQuerySchema)
  @ZodResponse(200, z.array(supportAccessGrantSchema))
  @ApiErrors(400, 401, 403, 404, 429)
  supportAccess(@Query(zodPipe(orgSupportQuerySchema)) query: z.infer<typeof orgSupportQuerySchema>, @CurrentOrgScope() scope: OrgScope) {
    return this.support.listForOrganization(scope, query);
  }

  @Post('support-access/:grantId/approve')
  @Can('members.manage')
  @OrgWriteExempt()
  @HttpCode(200)
  @ApiOperation({ summary: 'Approuve une demande d\'accès du support : l\'accès court dès maintenant pour la durée demandée' })
  @ZodResponse(200, supportAccessGrantSchema)
  @ApiErrors(401, 403, 404, 409, 429)
  approve(@Param('grantId', zodPipe(uuid)) grantId: string, @CurrentOrgScope() scope: OrgScope, @CurrentUser() user: UserActor) {
    return this.decide(scope, grantId, 'approve', user);
  }

  @Post('support-access/:grantId/deny')
  @Can('members.manage')
  @OrgWriteExempt()
  @HttpCode(200)
  @ApiOperation({ summary: 'Refuse une demande d\'accès du support' })
  @ZodResponse(200, supportAccessGrantSchema)
  @ApiErrors(401, 403, 404, 409, 429)
  deny(@Param('grantId', zodPipe(uuid)) grantId: string, @CurrentOrgScope() scope: OrgScope, @CurrentUser() user: UserActor) {
    return this.decide(scope, grantId, 'deny', user);
  }

  @Post('support-access/:grantId/revoke')
  @Can('members.manage')
  @OrgWriteExempt()
  @HttpCode(200)
  @ApiOperation({ summary: 'Révoque une demande ou un accès du support en cours, avec effet immédiat' })
  @ZodResponse(200, supportAccessGrantSchema)
  @ApiErrors(401, 403, 404, 409, 429)
  revoke(@Param('grantId', zodPipe(uuid)) grantId: string, @CurrentOrgScope() scope: OrgScope, @CurrentUser() user: UserActor) {
    return this.decide(scope, grantId, 'revoke', user);
  }

  private decide(scope: OrgScope, grantId: string, action: SupportAccessAction, user: UserActor) {
    return this.support.decide(scope, grantId, action, user);
  }
}

/** Plateforme : accès temporaire du support à une organisation cliente (« se connecter en tant que »). */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
export class AdminSupportAccessController {
  constructor(private readonly support: SupportAccessService) {}

  @Post('organizations/:id/support-access')
  @Can('support.access')
  @HttpCode(201)
  @ApiOperation({ summary: 'Demande un accès temporaire à une organisation cliente (motif, durée) ; ses propriétaires sont avisés et décident' })
  @ZodBody(supportAccessRequestSchema)
  @ZodResponse(201, supportAccessGrantSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  request(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(supportAccessRequestSchema)) body: z.infer<typeof supportAccessRequestSchema>, @CurrentUser() user: UserActor) {
    return this.support.request(id, body, user);
  }

  @Get('support-access')
  @Can('support.access')
  @ApiOperation({ summary: 'Accès du support (statut effectif), filtrés par statut ou par organisation' })
  @ZodQuery(supportAccessListQuerySchema)
  @ZodResponse(200, z.array(supportAccessGrantSchema))
  @ApiErrors(400, 401, 403, 429)
  list(@Query(zodPipe(supportAccessListQuerySchema)) query: z.infer<typeof supportAccessListQuerySchema>) {
    return this.support.listForPlatform(query);
  }

  @Post('support-access/:id/end')
  @Can('support.access')
  @HttpCode(200)
  @ApiOperation({ summary: 'Met fin à son propre accès (ou retire sa demande) avant l\'échéance' })
  @ZodResponse(200, supportAccessGrantSchema)
  @ApiErrors(401, 403, 404, 409, 429)
  end(@Param('id', zodPipe(uuid)) id: string, @CurrentUser() user: UserActor) {
    return this.support.end(id, user);
  }
}
