import { Module } from '@nestjs/common';
import { CreditsModule } from '../credits/credits.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { RidesModule } from '../rides/rides.module.js';
import { GuaranteeController } from './guarantee.controller.js';
import { GuaranteeService } from './guarantee.service.js';
import { PunctualityService } from './punctuality.service.js';

/**
 * Garantie modèle (prompt 08, tâche 6) : remboursement par le module des paiements, journal et avis par celui des courses.
 * Garantie de ponctualité (D10) : crédit au client selon le retard du chauffeur à la prise en charge.
 */
@Module({
  imports: [RidesModule, PaymentsModule, CreditsModule],
  controllers: [GuaranteeController],
  providers: [GuaranteeService, PunctualityService],
  exports: [PunctualityService],
})
export class GuaranteeModule {}
