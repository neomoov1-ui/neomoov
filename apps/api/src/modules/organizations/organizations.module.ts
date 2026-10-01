import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AdminModule } from '../admin/admin.module.js';
import { OrgScopeGuard } from '../auth/guards.js';
import { RidesModule } from '../rides/rides.module.js';
import { MeOrganizationsController, OrgController } from './org.controller.js';
import { OrgScopeInterceptor } from './org-scope.interceptor.js';
import { AdminOrganizationsController, InvitationsController } from './organizations.controller.js';
import { OrgScopeModule } from './org-scope.module.js';
import { OrganizationsService } from './organizations.service.js';

/**
 * Étape 19 : organisations en arbre, rôles personnalisés, membres et invitations (droits par AccessService, module global
 * d'identité). Étape 20 : routes d'organisation `/v1/org/:organizationId`, garde d'adhésion et de permissions dans
 * l'organisation (après les gardes du module d'identité, dans l'ordre d'enregistrement) et intercepteur qui exécute le
 * gestionnaire dans une transaction restreinte au sous-arbre de l'organisation.
 */
@Module({
  imports: [AdminModule, RidesModule, OrgScopeModule],
  controllers: [AdminOrganizationsController, InvitationsController, OrgController, MeOrganizationsController],
  providers: [OrganizationsService, { provide: APP_GUARD, useClass: OrgScopeGuard }, { provide: APP_INTERCEPTOR, useClass: OrgScopeInterceptor }],
  exports: [OrganizationsService, OrgScopeModule],
})
export class OrganizationsModule {}
