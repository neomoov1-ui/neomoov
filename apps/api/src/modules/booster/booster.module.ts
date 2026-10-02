import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { DriversModule } from '../drivers/drivers.module.js';
import { RidesModule } from '../rides/rides.module.js';
import { AlertsService } from './alerts.service.js';
import { BoosterAnalysisService } from './booster-analysis.service.js';
import { BoosterJobsService } from './booster-jobs.service.js';
import { AdminBoosterController, DriverBoosterController } from './booster.controller.js';
import { InspectionsService } from './inspections.service.js';
import { PerformanceService } from './performance.service.js';

/**
 * Neomoov Booster (phase 1, agent G) : vérification sommaire par caméra (analyse des photos par le socle des agents,
 * confirmation par le chauffeur, PDF archivé chez le dispatch), rapport de performance (saisie ou captures d'écran),
 * alertes de la journée (file `booster`, portée par le worker avec Redis). Module chargé par l'API et par le worker.
 */
@Module({
  imports: [RidesModule, DriversModule, AgentsModule, AuditModule],
  controllers: [DriverBoosterController, AdminBoosterController],
  providers: [BoosterAnalysisService, InspectionsService, PerformanceService, AlertsService, BoosterJobsService],
  exports: [InspectionsService, PerformanceService, AlertsService, BoosterJobsService],
})
export class BoosterModule {}
