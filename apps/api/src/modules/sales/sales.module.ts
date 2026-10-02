import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { CrmModule } from '../crm/crm.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { RidesModule } from '../rides/rides.module.js';
import { FollowupsService } from './followups.service.js';
import { OutboundCallsService } from './outbound-calls.service.js';
import { ProspectingAgent } from './prospecting.agent.js';
import { ProspectsService } from './prospects.service.js';
import { SalesAdminController } from './sales.controller.js';
import { SalesJobsService } from './sales-jobs.service.js';
import { SalesToolsService } from './sales-tools.service.js';

/**
 * Direction commerciale automatisée (phase 1 « Neomoov entreprise autonome », 2 octobre 2026) : prospects B2B, agent de
 * prospection, appels sortants (Vapi), relances, exécution des demandes (devis, compte entreprise), outils enregistrés
 * dans le socle des agents, file `sales`, routes « Ventes » de My Hub.
 */
@Module({
  imports: [AgentsModule, OrganizationsModule, CrmModule, RidesModule, AuditModule],
  controllers: [SalesAdminController],
  providers: [ProspectsService, FollowupsService, OutboundCallsService, SalesToolsService, ProspectingAgent, SalesJobsService],
  exports: [ProspectsService, FollowupsService, OutboundCallsService, SalesToolsService, ProspectingAgent, SalesJobsService],
})
export class SalesModule {}
