import { Module } from '@nestjs/common';
import { AdminRetentionController } from './retention.controller.js';
import { RetentionJobsService } from './retention-jobs.service.js';
import { RetentionService } from './retention.service.js';

/** Durées de conservation (Loi 25, prompt 14) : purges et anonymisations journalisées, après sauvegarde vérifiée. */
@Module({
  controllers: [AdminRetentionController],
  providers: [RetentionService, RetentionJobsService],
  exports: [RetentionService, RetentionJobsService],
})
export class RetentionModule {}
