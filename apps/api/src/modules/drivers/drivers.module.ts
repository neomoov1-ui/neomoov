import { Module } from '@nestjs/common';
import { RidesModule } from '../rides/rides.module.js';
import { UsersModule } from '../users/users.module.js';
import { DriverActivityService } from './driver-activity.service.js';
import { DriverProfileService } from './driver-profile.service.js';
import { DriverTrainingService } from './driver-training.service.js';
import { DriverAccountController, DriverApplyController } from './drivers.controller.js';

/** Espace chauffeur (prompt 11) : candidature, dossier, formation, activité, fin de course. */
@Module({
  imports: [RidesModule, UsersModule],
  controllers: [DriverApplyController, DriverAccountController],
  providers: [DriverProfileService, DriverTrainingService, DriverActivityService],
  exports: [DriverProfileService],
})
export class DriversModule {}
