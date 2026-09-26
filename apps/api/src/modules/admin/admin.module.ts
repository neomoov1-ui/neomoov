import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module.js';
import { RidesModule } from '../rides/rides.module.js';
import { AdminDirectoryController, AdminDriversController, AdminOverviewController } from './admin.controller.js';
import { AdminDirectoryService } from './admin-directory.service.js';
import { AdminDriversService } from './admin-drivers.service.js';
import { AdminOverviewService } from './admin-overview.service.js';

/** My Hub (prompt 12) : endpoints d'administration qui manquaient aux étapes précédentes. */
@Module({
  imports: [RidesModule, PricingModule],
  controllers: [AdminOverviewController, AdminDriversController, AdminDirectoryController],
  providers: [AdminOverviewService, AdminDriversService, AdminDirectoryService],
})
export class AdminModule {}
