import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { CreditsModule } from '../credits/credits.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { RidesModule } from '../rides/rides.module.js';
import { AgentApprovalsService } from './agent-approvals.service.js';
import { AgentJobsService } from './agent-jobs.service.js';
import { AgentRunnerService } from './agent-runner.service.js';
import { AgentToolsService } from './agent-tools.service.js';
import { AgentsAdminController, InternalAgentsController } from './agents.controller.js';
import { AgentsService } from './agents.service.js';
import { AccountingAgent, AnalyticsAgent, RecruitmentAgent } from './back-office.agents.js';
import { ConversationsService } from './conversations.service.js';
import { CustomerRelationsAgent } from './customer-relations.agent.js';
import { SupportController } from './support.controller.js';

/**
 * Agents IA (prompt 13, tâches 4 à 9) : exécuteur journalisé, outils internes, file d'approbation, conversations de
 * l'assistance, agents relation client, recrutement, comptabilité et analyse, déclencheurs (file `agents`).
 */
@Module({
  imports: [RidesModule, PaymentsModule, CreditsModule, AdminModule],
  controllers: [AgentsAdminController, InternalAgentsController, SupportController],
  providers: [AgentRunnerService, AgentToolsService, AgentApprovalsService, ConversationsService, CustomerRelationsAgent, RecruitmentAgent, AccountingAgent, AnalyticsAgent, AgentsService, AgentJobsService],
  exports: [AgentRunnerService, AgentToolsService, AgentApprovalsService, ConversationsService, CustomerRelationsAgent, RecruitmentAgent, AccountingAgent, AnalyticsAgent, AgentJobsService],
})
export class AgentsModule {}
