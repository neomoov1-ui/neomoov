import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module.js';
import { AdminRidesController } from './admin-rides.controller.js';
import { DriverController } from './driver.controller.js';
import { NotificationsOutbox } from './notifications-outbox.js';
import { PresenceService } from './presence.service.js';
import { AdminGateway, ClientGateway, DriverGateway } from './realtime.gateways.js';
import { RealtimeService } from './realtime.service.js';
import { PublicRidesController, RidesController } from './rides.controller.js';
import { RidesService } from './rides.service.js';
import { ScheduledService } from './scheduled.service.js';
import { SocketAuthService } from './socket-auth.service.js';

/** Courses, présence, réservation planifiée et temps réel (étape 5). */
@Module({
  imports: [PricingModule],
  controllers: [RidesController, PublicRidesController, DriverController, AdminRidesController],
  providers: [NotificationsOutbox, PresenceService, RidesService, ScheduledService, SocketAuthService, RealtimeService, ClientGateway, DriverGateway, AdminGateway],
  exports: [NotificationsOutbox, PresenceService, RidesService, ScheduledService, RealtimeService],
})
export class RidesModule {}
