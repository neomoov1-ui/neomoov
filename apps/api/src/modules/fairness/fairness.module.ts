import { Module } from '@nestjs/common';
import { RidesModule } from '../rides/rides.module.js';
import { AdminFairnessController, DriverFairnessController } from './fairness.controller.js';
import { FairnessService } from './fairness.service.js';

/** Charte d'équité chauffeurs (D7) : réponse et appel, décision humaine, exclusion d'une note, alertes de délai. */
@Module({
  imports: [RidesModule],
  controllers: [DriverFairnessController, AdminFairnessController],
  providers: [FairnessService],
  exports: [FairnessService],
})
export class FairnessModule {}
