import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { RidesModule } from '../rides/rides.module.js';
import { ContentAgent } from './content.agent.js';
import { ContentService } from './content.service.js';
import { EditorialLinesService } from './editorial.js';
import { MarketingJobsService } from './marketing-jobs.service.js';
import { MarketingController } from './marketing.controller.js';
import { PublicationsController } from './publications.controller.js';
import { PublicationsService } from './publications.service.js';
import { PublishingService } from './publishing.service.js';
import { SeoAgent } from './seo.agent.js';
import { SeoService } from './seo.service.js';
import { PublicSocialLinksController, SocialAccountsController, SocialOAuthController } from './social-accounts.controller.js';
import { SocialAccountsService } from './social-accounts.service.js';
import { VisualsService } from './visuals.service.js';

/**
 * Direction marketing automatisée (phase 1 « entreprise autonome », 2 octobre 2026) : agents `content` (calendrier
 * hebdomadaire), `publishing` (diffusion, mesures, commentaires) et `seo` (plan de référencement), connecteurs des
 * espaces, file `marketing`, écran My Hub « Marketing ». Réseaux sociaux (3 octobre 2026) : comptes des dix espaces
 * connectés dans My Hub (`SocialAccountsService`, registre `SOCIAL_CREDENTIALS` fourni par `AdaptersModule`), liens publics ;
 * publication multiréseau (composer, lot importé, relais manuel).
 */
@Module({
  imports: [AgentsModule, AuditModule, RidesModule],
  controllers: [MarketingController, SocialAccountsController, SocialOAuthController, PublicSocialLinksController, PublicationsController],
  providers: [EditorialLinesService, VisualsService, ContentService, ContentAgent, PublishingService, SeoService, SeoAgent, MarketingJobsService, SocialAccountsService, PublicationsService],
  exports: [ContentService, ContentAgent, PublishingService, SeoService, SeoAgent, MarketingJobsService, SocialAccountsService, PublicationsService],
})
export class MarketingModule {}
