import { Module } from '@nestjs/common';
import { OrgScopeModule } from '../organizations/org-scope.module.js';
import { RidesModule } from '../rides/rides.module.js';
import { AdminComplianceController, DriverComplianceController } from './compliance.controller.js';
import { ComplianceJobsService } from './compliance-jobs.service.js';
import { ComplianceService } from './compliance.service.js';

/** Conformité des chauffeurs et des véhicules (prompt 14) : échéances, rappels, suspensions et réactivations automatiques. */
@Module({
  imports: [RidesModule, OrgScopeModule],
  controllers: [AdminComplianceController, DriverComplianceController],
  providers: [ComplianceService, ComplianceJobsService],
  exports: [ComplianceService, ComplianceJobsService],
})
export class ComplianceModule {}
