/**
 * File `notifications` (prompt 13, tâche 2) : chaque notification mise en file (événement `notification.queued`) donne
 * une tâche d'envoi d'identifiant stable ; une passe toutes les 30 secondes reprend ce qui attend encore (événement
 * perdu, PDF attendu) et, tous les quarts d'heure, consulte les reçus push. Avec Redis, le worker porte la file ; sans
 * Redis, l'API. En test, rien n'est automatique : les tests appellent l'envoi directement.
 */
import { notificationRule } from '@neomoov/domain';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Logger } from 'pino';
import { DomainEventsService } from '../../common/domain-events.js';
import { APP_LOGGER } from '../../common/logger.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { QueueService } from '../../infra/queue.module.js';
import { NotificationDeliveryService } from './notification-delivery.service.js';

type NotificationJob = { kind: 'deliver'; id: string } | { kind: 'sweep' } | { kind: 'receipts' };

@Injectable()
export class NotificationJobsService implements OnModuleInit {
  private registered = false;
  private sweeps = 0;

  constructor(
    private readonly delivery: NotificationDeliveryService,
    private readonly queues: QueueService,
    private readonly events: DomainEventsService,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  onModuleInit() {
    if (this.env.NODE_ENV === 'test') return;
    if (this.queues.mode === 'memory') this.register({ everyMs: 30_000 });
    this.events.on('notification.queued', (p) => {
      p.ids.forEach((id, i) => {
        // Événements critiques (attribution, arrivée, SOS) avant les autres : priorité 1 chez BullMQ.
        const priority = notificationRule(p.templates[i] ?? '')?.critical ? 1 : 5;
        this.queues.add('notifications', 'deliver', { kind: 'deliver', id } satisfies NotificationJob, { jobId: `deliver:${id}`, priority }).catch((error: unknown) => this.logger.error({ err: error, notificationId: id }, 'Envoi de notification non mis en file'));
      });
    });
  }

  /** Enregistre le traitement de la file (API sans Redis, worker avec Redis) ; `everyMs` planifie la reprise. */
  register(options: { everyMs?: number } = {}): void {
    if (this.registered) return;
    this.registered = true;
    this.queues.process('notifications', async (job) => this.run(job.data as NotificationJob | { at?: string }), { concurrency: 8, ...(options.everyMs ? { everyMs: options.everyMs, jobName: 'sweep' } : {}) });
  }

  async run(job: NotificationJob | { at?: string }): Promise<void> {
    if ('kind' in job && job.kind === 'deliver') {
      await this.delivery.deliver(job.id);
      return;
    }
    if ('kind' in job && job.kind === 'receipts') {
      await this.delivery.pollReceipts();
      return;
    }
    const sent = await this.delivery.sweep();
    if (sent) this.logger.info({ sent }, 'notifications reprises');
    // Tous les quarts d'heure (30 passes de 30 secondes) : reçus de livraison des push.
    this.sweeps += 1;
    if (this.sweeps % 30 === 0) await this.delivery.pollReceipts().catch((error: unknown) => this.logger.warn({ err: error }, 'Reçus push indisponibles'));
  }
}
