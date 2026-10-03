/**
 * File `compliance` : une passe toutes les 15 minutes, qui ne travaille qu'une fois par jour (heure de Montréal) peu
 * après minuit : un document échu la veille suspend donc le chauffeur à minuit. Avec Redis, le worker porte la file ;
 * sans Redis, l'API (hors tests, qui appellent la passe directement avec une horloge simulée). Étape 20 : un lot par
 * organisation cliente qui a des chauffeurs, sous son contexte, puis la plateforme sans contexte. Revue du 2 octobre
 * 2026 (constat 18) : la journée faite est gardée en base (`claimDailyRun`), pas en mémoire : un redémarrage du worker
 * ne refait pas la passe, et deux processus ne la font jamais ensemble ; une passe en échec est reprise au battement
 * suivant.
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Logger } from 'pino';
import { claimDailyRun, completeDailyRun, releaseDailyRun } from '../../common/daily-run.js';
import { APP_LOGGER } from '../../common/logger.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { DB, type Database } from '../../infra/db.module.js';
import { QueueService } from '../../infra/queue.module.js';
import { OrgScopeService } from '../organizations/org-scope.service.js';
import { ComplianceService, type ComplianceRunReport } from './compliance.service.js';

@Injectable()
export class ComplianceJobsService implements OnModuleInit {
  private registered = false;

  constructor(
    private readonly compliance: ComplianceService,
    private readonly queues: QueueService,
    private readonly scope: OrgScopeService,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    @Inject(DB) private readonly database: Database,
  ) {}

  onModuleInit() {
    if (this.queues.mode === 'memory' && this.env.NODE_ENV !== 'test') this.register({ everyMs: 900_000 });
  }

  register(options: { everyMs?: number } = {}): void {
    if (this.registered) return;
    this.registered = true;
    this.queues.process('compliance', async () => this.tick(new Date()), { concurrency: 1, ...(options.everyMs ? { everyMs: options.everyMs, jobName: 'tick' } : {}) });
  }

  /**
   * Une passe par jour civil, réservée en base ; rejouer la même journée ne renverrait de toute façon pas les rappels
   * (compteur par échéance). Vrai si ce processus a fait la passe.
   */
  async tick(now: Date): Promise<boolean> {
    const today = await this.compliance.today(now);
    if (!(await claimDailyRun(this.database, 'compliance', today, now))) return false;
    try {
      const report = await this.runGrouped(now);
      await completeDailyRun(this.database, 'compliance', today, new Date());
      this.logger.info(report, 'conformité : passe quotidienne');
      return true;
    } catch (error) {
      await releaseDailyRun(this.database, 'compliance', today).catch(() => undefined);
      throw error;
    }
  }

  /** Passe complète par lots d'organisation (sans la garde du jour civil : pour les tests et une reprise manuelle). */
  async runGrouped(now: Date): Promise<ComplianceRunReport> {
    const reports = await this.scope.runGrouped(await this.scope.clientOrganizationsOfDrivers(), () => this.compliance.run(now), 'conformité');
    return reports.reduce<ComplianceRunReport>(
      (sum, r) => ({ synced: sum.synced + r.synced, reminders: sum.reminders + r.reminders, suspended: sum.suspended + r.suspended, lifted: sum.lifted + r.lifted }),
      { synced: 0, reminders: 0, suspended: 0, lifted: 0 },
    );
  }
}
