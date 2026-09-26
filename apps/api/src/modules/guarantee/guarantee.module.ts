import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module.js';
import { RidesModule } from '../rides/rides.module.js';
import { GuaranteeController } from './guarantee.controller.js';
import { GuaranteeService } from './guarantee.service.js';

/** Garantie modèle (prompt 08, tâche 6) : remboursement par le module des paiements, journal et avis par celui des courses. */
@Module({
  imports: [RidesModule, PaymentsModule],
  controllers: [GuaranteeController],
  providers: [GuaranteeService],
})
export class GuaranteeModule {}
