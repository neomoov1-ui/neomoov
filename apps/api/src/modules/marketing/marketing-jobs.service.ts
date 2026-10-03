/**
 * File `marketing` (phase 1 « entreprise autonome ») : passe toutes les cinq minutes (heure de Montréal) qui lance le
 * calendrier de contenu le vendredi (`marketing.content_day`, `marketing.content_hour`), le plan de référencement le
 * lundi (`seo.weekday`, `seo.hour`), publie les contenus programmés à leur créneau, mesure à J+1 et J+7, relit les
 * commentaires, mesure les tâches de référencement appliquées et, une fois par heure, contrôle les autorisations des
 * réseaux à jeton OAuth (alerte au personnel avant l'échéance) ; tâches ponctuelles `media` (visuel ou vidéo d'un
 * contenu approuvé). Avec Redis, le worker porte la file ; sans Redis, l'API. En test, rien n'est automatique.
 */
import { localClock, type AgentRunView } from '@neomoov/domain';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Logger } from 'pino';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { QueueService } from '../../infra/queue.module.js';
import { ContentAgent } from './content.agent.js';
import { PublishingService, type CommentsPassReport, type PublishPassReport } from './publishing.service.js';
import { SeoAgent } from './seo.agent.js';
import { SeoService } from './seo.service.js';

type MarketingJob = { kind: 'media'; itemId: string } | { kind: 'publish'; itemId: string } | { at?: string };

export interface MarketingTickReport {
  content: AgentRunView | null;
  seo: AgentRunView | null;
  publishing: PublishPassReport;
  measured: number;
  comments: CommentsPassReport;
  seoMeasured: number;
  /** Alertes envoyées sur les autorisations des réseaux (jeton à refaire bientôt, ou en échec). */
  credentialAlerts: number;
}

@Injectable()
export class MarketingJobsService implements OnModuleInit {
  private registered = false;
  /** Dernier contrôle des autorisations des réseaux (une fois par heure au plus : l'introspection LinkedIn est un appel). */
  private credentialsCheckedAt = 0;

  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly queues: QueueService,
    private readonly settings: SettingsService,
    private readonly content: ContentAgent,
    private readonly seo: SeoAgent,
    private readonly seoService: SeoService,
    private readonly publishing: PublishingService,
  ) {}

  onModuleInit() {
    if (this.env.NODE_ENV === 'test') return;
    if (this.queues.mode === 'memory') this.register({ everyMs: 300_000 });
  }

  /** Enregistre le traitement de la file (API sans Redis, worker avec Redis) ; `everyMs` planifie la passe. */
  register(options: { everyMs?: number } = {}): void {
    if (this.registered) return;
    this.registered = true;
    this.queues.process('marketing', async (job) => this.run(job.data as MarketingJob), { concurrency: 1, ...(options.everyMs ? { everyMs: options.everyMs, jobName: 'tick' } : {}) });
  }

  async run(job: MarketingJob): Promise<void> {
    if ('kind' in job && job.kind === 'media') {
      await this.publishing.prepareMedia(job.itemId);
      return;
    }
    if ('kind' in job && job.kind === 'publish') {
      await this.publishing.publishItem(job.itemId);
      return;
    }
    const report = await this.tick(new Date());
    if (report.content || report.seo || report.publishing.published || report.publishing.failed || report.measured || report.comments.replied || report.comments.escalated || report.comments.forwarded || report.credentialAlerts) this.logger.info(report, 'passe marketing');
  }

  /** Une passe complète ; chaque étape protège les autres (une erreur est journalisée, jamais propagée). */
  async tick(now = new Date()): Promise<MarketingTickReport> {
    const report: MarketingTickReport = { content: null, seo: null, publishing: { published: 0, retried: 0, failed: 0 }, measured: 0, comments: { checked: 0, replied: 0, forwarded: 0, escalated: 0 }, seoMeasured: 0, credentialAlerts: 0 };
    const guard = async (label: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (error) {
        this.logger.error({ err: error, step: label }, 'Étape de la passe marketing en échec');
      }
    };
    await guard('content', async () => { report.content = await this.contentDue(now); });
    await guard('seo', async () => { report.seo = await this.seoDue(now); });
    await guard('publish', async () => { report.publishing = await this.publishing.publishDue(now); });
    await guard('measure', async () => { report.measured = await this.publishing.measureDue(now); });
    await guard('comments', async () => { report.comments = await this.publishing.commentsPass(now); });
    await guard('seo-measure', async () => { report.seoMeasured = await this.seoService.measureDue(now); });
    if (now.getTime() - this.credentialsCheckedAt >= 3_600_000) {
      this.credentialsCheckedAt = now.getTime();
      await guard('credentials', async () => { report.credentialAlerts = await this.publishing.credentialsPass(now); });
    }
    return report;
  }

  /** Calendrier de la semaine suivante dès le jour et l'heure réglés (une seule exécution par semaine, référence `content:<lundi>`). */
  async contentDue(now: Date): Promise<AgentRunView | null> {
    const [tz, day, hour] = await Promise.all([this.settings.string('service.time_zone', 'America/Toronto'), this.settings.number('marketing.content_day', 5), this.settings.number('marketing.content_hour', 9)]);
    const clock = localClock(now, tz);
    const weekday = clock.weekday === 0 ? 7 : clock.weekday;
    if (weekday !== day || clock.hour < hour) return null;
    const result = await this.content.planWeek({ now });
    return result.replayed ? null : result.run;
  }

  async seoDue(now: Date): Promise<AgentRunView | null> {
    const [tz, day, hour] = await Promise.all([this.settings.string('service.time_zone', 'America/Toronto'), this.settings.number('seo.weekday', 1), this.settings.number('seo.hour', 6)]);
    const clock = localClock(now, tz);
    const weekday = clock.weekday === 0 ? 7 : clock.weekday;
    if (weekday !== day || clock.hour < hour) return null;
    const result = await this.seo.planWeek({ now });
    return result.replayed ? null : result.run;
  }
}
