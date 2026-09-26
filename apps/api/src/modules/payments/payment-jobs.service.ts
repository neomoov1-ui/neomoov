/**
 * Traitements des paiements par la file `payments` (prompt 07) : réactions aux événements de course (autorisation
 * d'une planifiée attribuée, capture à la fin, frais d'annulation ou d'absence, levée de l'autorisation) et traitement
 * des webhooks, avec reprise des événements en échec. Chaque tâche porte un identifiant stable (événement et course) :
 * avec Redis, plusieurs processus reçoivent le même événement de course, BullMQ n'en garde qu'une tâche. Sans Redis,
 * le processus de l'API traite lui-même la file (mode mémoire).
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Logger } from 'pino';
import { DomainEventsService } from '../../common/domain-events.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { APP_LOGGER } from '../../common/logger.js';
import { QueueService } from '../../infra/queue.module.js';
import { PaymentsService } from './payments.service.js';

type PaymentJob =
  | { kind: 'assigned'; rideId: string }
  | { kind: 'completed'; rideId: string }
  | { kind: 'fee'; rideId: string; feeCents: number; fee: 'cancellation_fee' | 'no_show_fee' }
  | { kind: 'released'; rideId: string; reason: string }
  | { kind: 'webhook'; eventId: string }
  | { kind: 'sweep' };

@Injectable()
export class PaymentJobsService implements OnModuleInit {
  private registered = false;

  constructor(
    private readonly payments: PaymentsService,
    private readonly queues: QueueService,
    private readonly events: DomainEventsService,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  onModuleInit() {
    // En mode mémoire, le processus qui ajoute une tâche doit aussi la traiter ; avec Redis, c'est le worker.
    // Hors tests, la reprise périodique tourne aussi dans l'API sans Redis (autorisations différées, webhooks en échec).
    if (this.queues.mode === 'memory') this.register(this.env.NODE_ENV === 'test' ? {} : { sweepEveryMs: 300_000 });
    this.events.on('ride.assigned', (p) => this.enqueue({ kind: 'assigned', rideId: p.rideId }, `assigned:${p.rideId}`));
    this.events.on('ride.completed', (p) => this.enqueue({ kind: 'completed', rideId: p.rideId }, `completed:${p.rideId}`));
    this.events.on('ride.cancelled_by_client', (p) => this.enqueue({ kind: 'fee', rideId: p.rideId, feeCents: p.feeCents, fee: 'cancellation_fee' }, `fee:${p.rideId}`));
    this.events.on('ride.no_show', (p) => this.enqueue({ kind: 'fee', rideId: p.rideId, feeCents: p.feeCents, fee: 'no_show_fee' }, `fee:${p.rideId}`));
    this.events.on('ride.no_driver', (p) => this.enqueue({ kind: 'released', rideId: p.rideId, reason: 'no_driver' }, `released:${p.rideId}`));
    this.events.on('ride.interrupted', (p) => this.enqueue({ kind: 'released', rideId: p.rideId, reason: 'interrupted' }, `released:${p.rideId}`));
    this.events.on('ride.cancelled_by_driver', (p) => this.enqueue({ kind: 'released', rideId: p.rideId, reason: 'cancelled_by_driver' }, `released:${p.rideId}:${p.occurredAt.getTime()}`));
  }

  /** Enregistre le traitement de la file (API en mode mémoire, worker avec Redis) ; `everyMs` reprend les webhooks en échec. */
  register(options: { sweepEveryMs?: number } = {}): void {
    if (this.registered) return;
    this.registered = true;
    this.queues.process('payments', async (job) => this.run(job.data as PaymentJob), { concurrency: 4, ...(options.sweepEveryMs ? { everyMs: options.sweepEveryMs, jobName: 'sweep' } : {}) });
  }

  private enqueue(job: PaymentJob, jobId: string): void {
    this.queues.add('payments', job.kind, job, { jobId }).catch((error: unknown) => this.logger.error({ err: error, job }, 'Tâche de paiement non mise en file'));
  }

  /** Mise en file du traitement d'un webhook reçu (réponse rapide à Stripe, traitement à part). */
  async enqueueWebhook(eventId: string): Promise<void> {
    await this.queues.add('payments', 'webhook', { kind: 'webhook', eventId } satisfies PaymentJob, { jobId: `webhook:${eventId}` });
  }

  async run(job: PaymentJob | { at?: string }): Promise<void> {
    const task = 'kind' in job ? job : ({ kind: 'sweep' } as const);
    switch (task.kind) {
      case 'assigned':
        return this.payments.onRideAssigned(task.rideId);
      case 'completed':
        return this.payments.onRideCompleted(task.rideId);
      case 'fee':
        return this.payments.onRideClosedWithFee(task.rideId, task.feeCents, task.fee);
      case 'released':
        return this.payments.onRideReleased(task.rideId, task.reason);
      case 'webhook':
        await this.payments.processWebhook(task.eventId);
        return;
      case 'sweep':
        await this.sweep();
        return;
    }
  }

  /** Reprise : webhooks reçus mais non traités (panne, redémarrage) ou en échec, autorisations différées arrivées à échéance. */
  async sweep(): Promise<{ retried: number; authorized: number }> {
    const ids = await this.payments.pendingWebhooks();
    for (const id of ids) await this.payments.processWebhook(id);
    const authorized = await this.payments.authorizeDueScheduled();
    if (ids.length || authorized) this.logger.info({ retried: ids.length, authorized }, 'Reprise des paiements');
    return { retried: ids.length, authorized };
  }
}
