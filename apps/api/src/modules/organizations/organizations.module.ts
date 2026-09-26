import { Module } from '@nestjs/common';
import { AdminOrganizationsController, InvitationsController } from './organizations.controller.js';
import { OrgScopeService } from './org-scope.service.js';
import { OrganizationsService } from './organizations.service.js';

/** Étape 19 : organisations en arbre, rôles personnalisés, membres et invitations (droits par AccessService, module global d'identité). */
@Module({
  controllers: [AdminOrganizationsController, InvitationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
