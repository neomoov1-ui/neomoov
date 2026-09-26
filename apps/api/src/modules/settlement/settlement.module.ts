import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module.js';
import { RidesModule } from '../rides/rides.module.js';
import { AdminSettlementController, DriverStatementPdfController } from './settlement.controller.js';
import { SettlementJobsService } from './settlement-jobs.service.js';
import { SettlementPayoutsService } from './settlement-payouts.service.js';
import { StatementsService } from './statements.service.js';

/** Règlement hebdomadaire (prompt 09) : relevés, versements et prélèvements, soldes, PDF. */
@Module({
  imports: [RidesModule, PaymentsModule],
  controllers: [AdminSettlementController, DriverStatementPdfController],
  providers: [StatementsService, SettlementPayoutsService, SettlementJobsService],
  exports: [StatementsService, SettlementPayoutsService, SettlementJobsService],
})
export class SettlementModule {}
