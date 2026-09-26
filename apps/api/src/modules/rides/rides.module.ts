import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { AdminRidesController } from './admin-rides.controller.js';
import { ApproachNotifierService } from './approach-notifier.service.js';
import { CancellationWatchService } from './cancellation-watch.service.js';
import { RideContextService } from './ride-context.service.js';
import { DispatchService } from './dispatch.service.js';
import { DriverController } from './driver.controller.js';
import { NotificationsOutbox } from './notifications-outbox.js';
import { PackLifecycleService } from './pack-lifecycle.service.js';
import { PresenceService } from './presence.service.js';
import { AdminGateway, ClientGateway, DriverGateway } from './realtime.gateways.js';
import { RealtimeService } from './realtime.service.js';
import { PublicRidesController, QuoteVehiclesController, RidesController } from './rides.controller.js';
import { RidesService } from './rides.service.js';
import { SafetyHoldService } from './safety-hold.service.js';
import { ScheduledService } from './scheduled.service.js';
import { StuckRidesService } from './stuck-rides.service.js';
import { SocketAuthService } from './socket-auth.service.js';

/** Courses, présence, réservation planifiée et temps réel (étape 5), répartition automatique et négociation (étape 6). */
@Module({
  imports: [PricingModule, PaymentsModule],
  controllers: [RidesController, QuoteVehiclesController, PublicRidesController, DriverController, AdminRidesController],
  providers: [NotificationsOutbox, RideContextService, CancellationWatchService, SafetyHoldService, PackLifecycleService, ApproachNotifierService, StuckRidesService, PresenceService, RidesService, ScheduledService, DispatchService, SocketAuthService, RealtimeService, ClientGateway, DriverGateway, AdminGateway],
  exports: [NotificationsOutbox, SafetyHoldService, PackLifecycleService, StuckRidesService, PresenceService, RidesService, ScheduledService, DispatchService, RealtimeService],
})
export class RidesModule {}
