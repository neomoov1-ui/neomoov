import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { RidesModule } from '../rides/rides.module.js';
import { SettlementModule } from '../settlement/settlement.module.js';
import { UsersModule } from '../users/users.module.js';
import { FleetDispatchService } from './fleet-dispatch.service.js';
import { FleetDriversService } from './fleet-drivers.service.js';
import { FleetFinanceService } from './fleet-finance.service.js';
import { FleetJobsService } from './fleet-jobs.service.js';
import { FleetVehiclesService } from './fleet-vehicles.service.js';
import { DriverInvitationsController, FleetController } from './fleet.controller.js';

/**
 * Module Flotte (étape 23, amendement v1.2 section 6) : chauffeurs rattachés, véhicules et entretien, carte en direct et
 * répartition interne, réseau Neomoov, partage des revenus, relevés et versements de l'organisation, rapports. Les routes
 * passent par la barrière des organisations (étape 20) ; la ligne de partage et les relevés d'organisation sont produits
 * par le module de règlement.
 */
@Module({
  imports: [AdminModule, OrganizationsModule, PricingModule, RidesModule, SettlementModule, UsersModule],
  controllers: [FleetController, DriverInvitationsController],
  providers: [FleetDriversService, FleetVehiclesService, FleetDispatchService, FleetFinanceService, FleetJobsService],
  exports: [FleetDispatchService, FleetJobsService],
})
export class FleetModule {}
