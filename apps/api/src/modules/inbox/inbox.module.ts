import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module.js';
import { RidesModule } from '../rides/rides.module.js';
import { InboundEmailService } from './inbound-email.service.js';
import { InboxJobsService } from './inbox-jobs.service.js';
import { InboxAdminController, InboxWebhooksController } from './inbox.controller.js';
import { MissedCallsService } from './missed-calls.service.js';
import { SocialInboxService } from './social-inbox.service.js';

/**
 * Boîte de réception unifiée (phase 1 « entreprise autonome », 2 octobre 2026) : courriels de contact@ (relais Brevo,
 * lecture IMAP), messages et commentaires des réseaux Meta (webhook, rattrapage), relais humain des autres réseaux,
 * appels manqués du centre vocal, écran Boîte de réception de My Hub.
 */
@Module({
  imports: [AgentsModule, RidesModule],
  controllers: [InboxWebhooksController, InboxAdminController],
  providers: [InboundEmailService, SocialInboxService, MissedCallsService, InboxJobsService],
  exports: [InboundEmailService, SocialInboxService, MissedCallsService, InboxJobsService],
})
export class InboxModule {}
