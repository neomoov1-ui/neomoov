import { Module } from '@nestjs/common';
import { ComplianceModule } from '../compliance/compliance.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { RidesModule } from '../rides/rides.module.js';
import { AdminQueuesController } from './admin-queues.controller.js';
import { AdminDirectoryController, AdminDriversController, AdminOverviewController } from './admin.controller.js';
import { AdminDirectoryService } from './admin-directory.service.js';
import { AdminDriversService } from './admin-drivers.service.js';
import { AdminOverviewService } from './admin-overview.service.js';

/** My Hub (prompt 12) : endpoints d'administration qui manquaient aux étapes précédentes. */
@Module({
  imports: [RidesModule, PricingModule, ComplianceModule],
  controllers: [AdminOverviewController, AdminDriversController, AdminDirectoryController, AdminQueuesController],
  providers: [AdminOverviewService, AdminDriversService, AdminDirectoryService],
  exports: [AdminOverviewService],
})
export class AdminModule {}
