/**
 * My Hub, étape 19 : organisations et sous-organisations, catalogue des permissions, rôles personnalisés, membres et
 * invitations ; acceptation d'une invitation par la personne invitée.
 */
import {
  invitationAcceptSchema, invitationCreatedSchema, invitationCreateSchema, membershipUpdateSchema, membershipViewSchema, organizationCreateSchema,
  organizationSchema, permissionViewSchema, roleCreateSchema, roleListQuerySchema, rolePermissionsUpdateSchema, roleViewSchema, uuid,
} from '@neomoov/domain';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiErrors, ZodBody, ZodQuery, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { Authenticated, Can, CurrentUser, type UserActor } from '../auth/actor.js';
import { OrganizationsService } from './organizations.service.js';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
export class AdminOrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Get('organizations')
  @Can('organizations.read')
  @ApiOperation({ summary: 'Arbre des organisations (la plateforme est la racine)' })
  @ZodResponse(200, z.array(organizationSchema))
  @ApiErrors(401, 403, 429)
  list() {
    return this.orgs.list();
  }

  @Post('organizations')
  @Can('organizations.manage')
  @HttpCode(201)
  @ApiOperation({ summary: 'Crée une sous-organisation sous un parent' })
  @ZodBody(organizationCreateSchema)
  @ZodResponse(201, organizationSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  create(@Body(zodPipe(organizationCreateSchema)) body: z.infer<typeof organizationCreateSchema>, @CurrentUser() user: UserActor) {
    return this.orgs.create(body, user);
  }

  @Get('permissions')
  @Can('roles.read')
  @ApiOperation({ summary: 'Catalogue des permissions (module, sensible, réservée à la plateforme)' })
  @ZodResponse(200, z.array(permissionViewSchema))
  @ApiErrors(401, 403, 429)
  permissions() {
    return this.orgs.permissions();
  }

  @Get('roles')
  @Can('roles.read')
  @ApiOperation({ summary: 'Rôles système et rôles personnalisés d\'une organisation, avec leurs permissions' })
  @ZodQuery(roleListQuerySchema)
  @ZodResponse(200, z.array(roleViewSchema))
  @ApiErrors(400, 401, 403, 429)
  roles(@Query(zodPipe(roleListQuerySchema)) query: z.infer<typeof roleListQuerySchema>) {
    return this.orgs.roles(query.organizationId);
  }

  @Post('roles')
  @Can('roles.manage')
  @HttpCode(201)
  @ApiOperation({ summary: 'Crée un rôle personnalisé ; seulement des permissions que vous détenez (pas d\'escalade)' })
  @ZodBody(roleCreateSchema)
  @ZodResponse(201, roleViewSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  createRole(@Body(zodPipe(roleCreateSchema)) body: z.infer<typeof roleCreateSchema>, @CurrentUser() user: UserActor) {
    return this.orgs.createRole(body, user);
  }

  @Put('roles/:id/permissions')
  @Can('roles.manage')
  @ApiOperation({ summary: 'Remplace les permissions d\'un rôle personnalisé (un rôle système ne se modifie pas)' })
  @ZodBody(rolePermissionsUpdateSchema)
  @ZodResponse(200, roleViewSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  updateRole(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(rolePermissionsUpdateSchema)) body: z.infer<typeof rolePermissionsUpdateSchema>, @CurrentUser() user: UserActor) {
    return this.orgs.updateRolePermissions(id, body.permissions, user);
  }

  @Get('organizations/:id/members')
  @Can('members.read')
  @ApiOperation({ summary: 'Membres d\'une organisation, avec leur rôle et leur portée' })
  @ZodResponse(200, z.array(membershipViewSchema))
  @ApiErrors(401, 403, 404, 429)
  members(@Param('id', zodPipe(uuid)) id: string) {
    return this.orgs.members(id);
  }

  @Post('organizations/:id/invitations')
  @Can('members.invite')
  @HttpCode(201)
  @ApiOperation({ summary: 'Invitation par courriel ou texto, à usage unique ; le lien part par le canal choisi, le jeton n\'est jamais rendu (sauf réglage de développement)' })
  @ZodBody(invitationCreateSchema)
  @ZodResponse(201, invitationCreatedSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  invite(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(invitationCreateSchema)) body: z.infer<typeof invitationCreateSchema>, @CurrentUser() user: UserActor) {
    return this.orgs.invite(id, body, user);
  }

  @Patch('memberships/:id')
  @Can('members.manage')
  @ApiOperation({ summary: 'Change le rôle d\'un membre ou le suspend' })
  @ZodBody(membershipUpdateSchema)
  @ZodResponse(200, membershipViewSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  updateMembership(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(membershipUpdateSchema)) body: z.infer<typeof membershipUpdateSchema>, @CurrentUser() user: UserActor) {
    return this.orgs.updateMembership(id, body, user);
  }

  @Delete('memberships/:id')
  @Can('members.manage')
  @HttpCode(204)
  @ApiOperation({ summary: 'Retire un membre de l\'organisation' })
  @ApiErrors(401, 403, 404, 429)
  async removeMembership(@Param('id', zodPipe(uuid)) id: string) {
    await this.orgs.removeMembership(id);
  }
}

@ApiTags('me')
@ApiBearerAuth()
@Authenticated()
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Post('accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Accepte une invitation adressée à mon téléphone ou à mon courriel' })
  @ZodBody(invitationAcceptSchema)
  @ZodResponse(200, membershipViewSchema)
  @ApiErrors(400, 401, 403, 404, 409, 429)
  accept(@Body(zodPipe(invitationAcceptSchema)) body: z.infer<typeof invitationAcceptSchema>, @CurrentUser() user: UserActor) {
    return this.orgs.accept(body.token, user);
  }
}
