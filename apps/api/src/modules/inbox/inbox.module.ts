import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module.js';
import { RidesModule } from '../rides/rides.module.js';
import { SalesModule } from '../sales/sales.module.js';
import { InboundEmailService } from './inbound-email.service.js';
import { InboxJobsService } from './inbox-jobs.service.js';
import { InboxAdminController, InboxWebhooksController } from './inbox.controller.js';
import { MissedCallsService } from './missed-calls.service.js';
import { SocialInboxService } from './social-inbox.service.js';
import { TidioInboxService } from './tidio-inbox.service.js';

/**
 * Boîte de réception unifiée (phase 1 « entreprise autonome », 2 octobre 2026) : courriels de contact@ (relais Brevo,
 * lecture IMAP), messages et commentaires des réseaux Meta (webhook, rattrapage), relais humain des autres réseaux,
 * appels manqués du centre vocal, écran Boîte de réception de My Hub. Finalisation du 3 octobre 2026 : discussion du site
 * (Tidio), réponses des prospects de la direction commerciale (retrait, réponse), rappels persistants des appels manqués.
 */
@Module({
  imports: [AgentsModule, RidesModule, SalesModule],
  controllers: [InboxWebhooksController, InboxAdminController],
  providers: [InboundEmailService, SocialInboxService, MissedCallsService, InboxJobsService, TidioInboxService],
  exports: [InboundEmailService, SocialInboxService, MissedCallsService, InboxJobsService, TidioInboxService],
})
export class InboxModule {}
