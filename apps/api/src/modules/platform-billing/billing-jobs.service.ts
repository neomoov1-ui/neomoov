/**
 * File `billing` (étape 25) : une passe par heure ; le cycle de la facturation de la plateforme ne tourne qu'à l'heure
 * `billing.run_hour` (5 h, heure de Montréal, quand peu de courses sont en cours), donc une fois par jour : fins d'essai,
 * renouvellements (factures de la période suivante, véhicules actifs comptés), factures non transmises au fournisseur,
 * retards et rappels (+3, +7, +14 jours), lecture seule (+30) et suspension (+45, jamais pendant une course : reportée
 * au lendemain), réactivation. Chaque étape est rejouable et une erreur ne bloque pas les suivantes. Avec Redis, le
 * worker porte la file ; sans Redis, l'API (hors tests, qui appellent `run(now)` directement).
 */
import { localTimeParts, type BillingRunReport } from '@neomoov/domain';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Logger } from 'pino';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { QueueService } from '../../infra/queue.module.js';
import { PlatformBillingService } from './platform-billing.service.js';

const HOUR_MS = 3_600_000;

@Injectable()
export class BillingJobsService implements OnModuleInit {
  private registered = false;

  constructor(
    private readonly billing: PlatformBillingService,
    private readonly queues: QueueService,
    private readonly settings: SettingsService,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  onModuleInit() {
    if (this.env.NODE_ENV === 'test') return;
    if (this.queues.mode === 'memory') this.register({ everyMs: HOUR_MS });
  }

  /** Enregistre le traitement de la file (API sans Redis, worker avec Redis) ; `everyMs` planifie la passe horaire. */
  register(options: { everyMs?: number } = {}): void {
    if (this.registered) return;
    this.registered = true;
    this.queues.process('billing', async () => {
      await this.tick(new Date());
    }, { concurrency: 1, ...(options.everyMs ? { everyMs: options.everyMs, jobName: 'tick' } : {}) });
  }

  /** Passe horaire : le cycle seulement à l'heure `billing.run_hour` (heure de Montréal) ; `null` aux autres heures. */
  async tick(now: Date): Promise<BillingRunReport | null> {
    const runHour = await this.settings.number('billing.run_hour', 5);
    if (localTimeParts(now, this.env.TIMEZONE).hour !== runHour) return null;
    const report = await this.run(now);
    if (Object.values(report).some((n) => n > 0)) this.logger.info(report, 'facturation de la plateforme');
    return report;
  }

  /** Cycle complet à `now` (exploitation : `POST /v1/admin/billing/run` ; tests : horloge simulée, aucune attente réelle). */
  async run(now = new Date()): Promise<BillingRunReport> {
    const report: BillingRunReport = { trialsEnded: 0, renewed: 0, invoicesIssued: 0, pushed: 0, pastDue: 0, reminders: 0, readOnly: 0, suspended: 0, postponed: 0, reactivated: 0, errors: 0 };
    const attempt = async (what: string, id: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (error) {
        report.errors += 1;
        this.logger.error({ err: error, step: what, id }, 'Facturation de la plateforme : étape en échec (reprise à la passe suivante)');
      }
    };
    for (const id of await this.billing.endedTrials(now)) {
      await attempt('trial', id, async () => {
        if (await this.billing.endTrial(id, now)) {
          report.trialsEnded += 1;
          report.invoicesIssued += 1;
        }
      });
    }
    for (const id of await this.billing.dueRenewals(now)) {
      await attempt('renewal', id, async () => {
        const issued = await this.billing.renew(id, now);
        if (issued) {
          report.renewed += 1;
          report.invoicesIssued += issued;
        }
      });
    }
    for (const id of await this.billing.unpushedInvoices()) {
      await attempt('push', id, async () => {
        if (await this.billing.pushInvoiceById(id, now)) report.pushed += 1;
      });
    }
    let settings: Awaited<ReturnType<PlatformBillingService['dunningSettings']>>;
    try {
      settings = await this.billing.dunningSettings();
    } catch (error) {
      // Réglages incohérents : aucune relance ni suspension au mauvais jour ; l'erreur est visible.
      report.errors += 1;
      this.logger.error({ err: error }, 'Réglages billing.* invalides : relances et suspensions suspendues');
      return report;
    }
    for (const id of await this.billing.unpaidInvoices()) {
      await attempt('dunning', id, async () => {
        const outcome = await this.billing.dunInvoice(id, now, settings);
        if (outcome.pastDue) report.pastDue += 1;
        if (outcome.reminded) report.reminders += 1;
      });
    }
    for (const id of await this.billing.dunnedSubscriptions()) {
      await attempt('status', id, async () => {
        const transition = await this.billing.applyStatus(id, now);
        if (transition.escalated && transition.status === 'read_only') report.readOnly += 1;
        if (transition.escalated && transition.status === 'suspended') report.suspended += 1;
        if (transition.postponed) report.postponed += 1;
        if (transition.reactivated) report.reactivated += 1;
      });
    }
    return report;
  }
}
