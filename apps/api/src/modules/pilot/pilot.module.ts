import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module.js';
import { RidesModule } from '../rides/rides.module.js';
import { AdminPilotController, DriverPilotController } from './pilot.controller.js';
import { PilotService } from './pilot.service.js';

/**
 * Neomoov Pilote (étape 24) : acceptation automatique des courses Neomoov selon les critères du chauffeur. Le service
 * s'inscrit au crochet de la répartition (`PilotHook`) : le module est chargé par l'API et par le worker, qui porte la
 * répartition quand Redis est présent.
 */
@Module({
  imports: [RidesModule, PricingModule],
  controllers: [DriverPilotController, AdminPilotController],
  providers: [PilotService],
  exports: [PilotService],
})
export class PilotModule {}
