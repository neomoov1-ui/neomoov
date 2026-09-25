import { Module } from '@nestjs/common';
import { PrivacyJobsService } from './privacy-jobs.service.js';

/** Tâches de confidentialité : importé par l'API (mode mémoire) et par le worker (Redis). */
@Module({ providers: [PrivacyJobsService], exports: [PrivacyJobsService] })
export class PrivacyModule {}
