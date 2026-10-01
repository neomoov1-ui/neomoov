import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { CrmJobsService } from './crm-jobs.service.js';
import { CrmSyncService } from './crm-sync.service.js';

/** CRM (étape 25) : synchronisation asynchrone des prospects, comptes d'affaires et organisations, avec consentement. */
@Module({ imports: [AuditModule], providers: [CrmSyncService, CrmJobsService], exports: [CrmSyncService, CrmJobsService] })
export class CrmModule {}
