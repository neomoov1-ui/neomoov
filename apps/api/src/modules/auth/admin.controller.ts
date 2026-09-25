/** Administration des comptes du personnel et des clés de service (rôle admin), et vérification d'une clé par un compte de service. */
import { apiKeyCreateSchema, apiKeyCreatedSchema, apiKeyViewSchema, meSchema, staffCreateSchema, staffPasswordSchema, uuid } from '@neomoov/domain';
import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiErrors, ZodBody, ZodResponse } from '../../common/openapi.js';
import { zodPipe } from '../../common/zod-validation.pipe.js';
import { AuditService } from '../audit/audit.service.js';
import { UsersService } from '../users/users.service.js';
import { Audit, CurrentActor, CurrentUser, Roles, Scopes, type Actor, type UserActor } from './actor.js';
import { ApiKeysService } from './api-keys.service.js';
import { StaffAuthService } from './staff-auth.service.js';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/staff')
export class AdminStaffController {
  constructor(
    private readonly staff: StaffAuthService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @Roles('admin')
  @HttpCode(201)
  @ApiOperation({ summary: 'Crée un membre du personnel (rôles admin, operator, finance, readonly) avec un mot de passe initial' })
  @ZodBody(staffCreateSchema)
  @ZodResponse(201, meSchema)
  @ApiErrors(400, 401, 403, 409, 429)
  async create(@Body(zodPipe(staffCreateSchema)) body: z.infer<typeof staffCreateSchema>, @CurrentUser() actor: UserActor) {
    const user = await this.staff.createStaff(body);
    this.audit.record({ action: 'admin.staff_created', entity: 'users', entityId: user.id, after: { email: user.email, roles: body.roles, by: actor.userId } });
    return this.users.meViewOf(user);
  }

  @Post(':id/password')
  @Roles('admin')
  @HttpCode(204)
  @Audit('admin.staff_password_set', 'users')
  @ApiOperation({ summary: 'Remplace le mot de passe d\'un membre du personnel et révoque ses sessions' })
  @ZodBody(staffPasswordSchema)
  @ApiErrors(400, 401, 403, 404, 429)
  async setPassword(@Param('id', zodPipe(uuid)) id: string, @Body(zodPipe(staffPasswordSchema)) body: z.infer<typeof staffPasswordSchema>) {
    await this.staff.setPassword(id, body.password);
  }

  @Post(':id/mfa/reset')
  @Roles('admin')
  @HttpCode(204)
  @Audit('admin.staff_mfa_reset', 'users')
  @ApiOperation({ summary: 'Réinitialise le second facteur (téléphone perdu) : la prochaine connexion refait l\'inscription' })
  @ApiErrors(401, 403, 404, 429)
  async resetMfa(@Param('id', zodPipe(uuid)) id: string) {
    await this.staff.resetMfa(id);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/api-keys')
export class AdminApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  @Roles('admin')
  @ApiOperation({ summary: 'Clés de service (comptes de service des agents et intégrations)' })
  @ZodResponse(200, z.array(apiKeyViewSchema))
  @ApiErrors(401, 403, 429)
  list() {
    return this.apiKeys.list();
  }

  @Post()
  @Roles('admin')
  @HttpCode(201)
  @Audit('admin.api_key_created', 'api_keys')
  @ApiOperation({ summary: 'Crée une clé de service à portée limitée ; le secret n\'est affiché qu\'une fois' })
  @ZodBody(apiKeyCreateSchema)
  @ZodResponse(201, apiKeyCreatedSchema)
  @ApiErrors(400, 401, 403, 429)
  create(@Body(zodPipe(apiKeyCreateSchema)) body: z.infer<typeof apiKeyCreateSchema>, @CurrentUser() actor: UserActor) {
    return this.apiKeys.create(body, actor.userId);
  }

  @Delete(':id')
  @Roles('admin')
  @HttpCode(204)
  @Audit('admin.api_key_revoked', 'api_keys')
  @ApiOperation({ summary: 'Révoque une clé de service' })
  @ApiErrors(401, 403, 404, 429)
  async revoke(@Param('id', zodPipe(uuid)) id: string) {
    await this.apiKeys.revoke(id);
  }
}

const whoamiSchema = z.object({
  kind: z.literal('service'),
  apiKeyId: uuid,
  name: z.string(),
  scopes: z.array(z.string()),
  agentCode: z.string().nullable(),
});

@ApiTags('internal')
@ApiBearerAuth()
@Controller('internal/service')
export class ServiceController {
  @Get('whoami')
  @Scopes('*')
  @ApiOperation({ summary: 'Identité du compte de service qui présente la clé (vérification d\'une intégration)' })
  @ZodResponse(200, whoamiSchema)
  @ApiErrors(401, 403, 429)
  whoami(@CurrentActor() actor: Actor | undefined) {
    return actor;
  }
}
