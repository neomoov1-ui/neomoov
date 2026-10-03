import { Module, forwardRef } from '@nestjs/common';
import { ComplianceModule } from '../compliance/compliance.module.js';
import { CrmModule } from '../crm/crm.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { RidesModule } from '../rides/rides.module.js';
import { AdminIncidentsController } from './admin-incidents.controller.js';
import { AdminIncidentsService } from './admin-incidents.service.js';
import { AdminMetricsController, InternalMetricsController } from './admin-metrics.controller.js';
import { AdminMetricsService } from './admin-metrics.service.js';
import { AdminQueuesController } from './admin-queues.controller.js';
import { AdminDirectoryController, AdminDriversController, AdminOverviewController } from './admin.controller.js';
import { AdminDirectoryService } from './admin-directory.service.js';
import { AdminDriversService } from './admin-drivers.service.js';
import { AdminOverviewService } from './admin-overview.service.js';

/** My Hub (prompt 12) : endpoints d'administration qui manquaient aux étapes précédentes. */
@Module({
  // CRM (étape 25) : lecture de l'état de synchronisation d'une fiche, sans écriture.
  imports: [forwardRef(() => RidesModule), PricingModule, forwardRef(() => ComplianceModule), CrmModule],
  controllers: [AdminOverviewController, AdminDriversController, AdminDirectoryController, AdminIncidentsController, AdminQueuesController, AdminMetricsController, InternalMetricsController],
  providers: [AdminOverviewService, AdminDriversService, AdminDirectoryService, AdminIncidentsService, AdminMetricsService],
  // Étape 20 : les routes d'organisation réutilisent les services de My Hub sous une transaction restreinte.
  exports: [AdminOverviewService, AdminDriversService, AdminDirectoryService],
})
export class AdminModule {}
