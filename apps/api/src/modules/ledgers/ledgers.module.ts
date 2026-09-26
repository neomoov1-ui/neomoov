import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module.js';
import { GeolocationExportService } from './geolocation-export.service.js';
import { LedgerExportsService } from './ledger-exports.service.js';
import { LedgerJobsService } from './ledger-jobs.service.js';
import { AdminLedgersController, DriverLedgersController } from './ledgers.controller.js';
import { LedgersService } from './ledgers.service.js';

/**
 * Registres de la redevance et des taxes, exports comptables (CSV, rapport de synthèse PDF) et export mensuel de
 * géolocalisation (prompt 09, tâches 7 et 8). Réagit à `ride.completed` par la file `exports`, sans dépendance vers les
 * courses ni les paiements.
 */
@Module({
  imports: [PricingModule],
  controllers: [AdminLedgersController, DriverLedgersController],
  providers: [LedgersService, LedgerExportsService, GeolocationExportService, LedgerJobsService],
  exports: [LedgersService, LedgerExportsService, GeolocationExportService, LedgerJobsService],
})
export class LedgersModule {}
