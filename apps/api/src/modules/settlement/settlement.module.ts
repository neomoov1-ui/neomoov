import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { RidesModule } from '../rides/rides.module.js';
import { AdminSettlementController, DriverStatementPdfController } from './settlement.controller.js';
import { SettlementJobsService } from './settlement-jobs.service.js';
import { SettlementPayoutsService } from './settlement-payouts.service.js';
import { StatementsService } from './statements.service.js';
import { FleetShareService } from './fleet-share.service.js';
import { OrganizationStatementsService } from './organization-statements.service.js';

/** Règlement hebdomadaire (prompt 09) : relevés, versements et prélèvements, soldes, PDF. */
@Module({
  imports: [RidesModule, PaymentsModule, OrganizationsModule],
  controllers: [AdminSettlementController, DriverStatementPdfController],
  providers: [StatementsService, SettlementPayoutsService, SettlementJobsService, FleetShareService, OrganizationStatementsService],
  exports: [StatementsService, SettlementPayoutsService, SettlementJobsService, OrganizationStatementsService],
})
export class SettlementModule {}
