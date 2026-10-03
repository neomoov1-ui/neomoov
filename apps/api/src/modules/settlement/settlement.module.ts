import { Module } from '@nestjs/common';
import { OrgScopeModule } from '../organizations/org-scope.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { RidesModule } from '../rides/rides.module.js';
import { AdminSettlementController, DriverStatementPdfController } from './settlement.controller.js';
import { SettlementJobsService } from './settlement-jobs.service.js';
import { SettlementPayoutsService } from './settlement-payouts.service.js';
import { StatementsService } from './statements.service.js';
import { FleetShareService } from './fleet-share.service.js';
import { OrganizationStatementsService } from './organization-statements.service.js';
import { PlatformFeesService } from './platform-fees.service.js';

/** Règlement hebdomadaire (prompt 09) : relevés, versements et prélèvements, soldes, PDF. */
@Module({
  imports: [RidesModule, PaymentsModule, OrgScopeModule],
  controllers: [AdminSettlementController, DriverStatementPdfController],
  providers: [StatementsService, SettlementPayoutsService, SettlementJobsService, FleetShareService, OrganizationStatementsService, PlatformFeesService],
  exports: [StatementsService, SettlementPayoutsService, SettlementJobsService, OrganizationStatementsService],
})
export class SettlementModule {}
