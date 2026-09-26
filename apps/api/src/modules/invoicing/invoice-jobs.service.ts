/**
 * File `invoicing` (prompt 09) : émission de la facture à la fin d'une course (`ride.completed`), à une annulation ou une
 * non-présentation facturée (`ride.cancelled_by_client`, `ride.no_show` avec des frais), note de crédit à chaque
 * remboursement (`payment.refunded`) ; puis transmission au SEV et PDF, dans cet ordre (le premier PDF porte la
 * transaction quand le SEV répond aussitôt). Chaque tâche porte un identifiant stable : avec Redis, plusieurs processus
 * reçoivent le même événement, BullMQ n'en garde qu'une tâche ; l'émission elle-même est idempotente. Sans Redis, l'API
 * traite elle-même la file (mode mémoire), comme les paiements. Passe périodique : transmissions à reprendre, factures
 * manquantes (événement perdu), PDF manquants.
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { SevRetryResult } from '@neomoov/domain';
import type { Logger } from 'pino';
import { DomainEventsService } from '../../common/domain-events.js';
import { APP_LOGGER } from '../../common/logger.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { QueueService } from '../../infra/queue.module.js';
import { InvoicingService, type IssueResult } from './invoicing.service.js';
import { SevService, type SevOutcome } from './sev.service.js';

type InvoicingJob =
  | { kind: 'ride'; rideId: string }
  | { kind: 'refund'; refundId: string; rideId: string }
  | { kind: 'transmit'; invoiceId: string }
  | { kind: 'render'; invoiceId: string }
  | { kind: 'sweep' };

const accepted = (outcome: SevOutcome): boolean => outcome.status === 'acknowledged' || outcome.status === 'sent';

export interface InvoicingSweepReport {
  transmitted: number;
  issued: number;
  rendered: number;
}

@Injectable()
export class InvoiceJobsService implements OnModuleInit {
  private registered = false;

  constructor(
    private readonly invoicing: InvoicingService,
    private readonly sev: SevService,
    private readonly queues: QueueService,
    private readonly events: DomainEventsService,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  onModuleInit() {
    // En mode mémoire, le processus qui ajoute une tâche la traite ; avec Redis, c'est le worker. Hors tests, la passe
    // périodique tourne aussi dans l'API sans Redis.
    if (this.queues.mode === 'memory') this.register(this.env.NODE_ENV === 'test' ? {} : { sweepEveryMs: 300_000 });
    this.events.on('ride.completed', (p) => this.enqueue({ kind: 'ride', rideId: p.rideId }, `ride-${p.rideId}`));
    this.events.on('ride.cancelled_by_client', (p) => {
      if (p.feeCents > 0) this.enqueue({ kind: 'ride', rideId: p.rideId }, `ride-${p.rideId}`);
    });
    this.events.on('ride.no_show', (p) => {
      if (p.feeCents > 0) this.enqueue({ kind: 'ride', rideId: p.rideId }, `ride-${p.rideId}`);
    });
    this.events.on('payment.refunded', (p) => this.enqueue({ kind: 'refund', refundId: p.refundId, rideId: p.rideId }, `refund-${p.refundId}`));
  }

  /** Enregistre le traitement de la file (API en mode mémoire, worker avec Redis) ; `sweepEveryMs` planifie la passe périodique. */
  register(options: { sweepEveryMs?: number } = {}): void {
    if (this.registered) return;
    this.registered = true;
    this.queues.process('invoicing', async (job) => this.run(job.data as InvoicingJob), { concurrency: 4, ...(options.sweepEveryMs ? { everyMs: options.sweepEveryMs, jobName: 'sweep' } : {}) });
  }

  /** Identifiants sans deux-points : BullMQ refuse « : » dans un identifiant personnalisé (sauf la forme à trois parties des répétitions). */
  private enqueue(job: InvoicingJob, jobId: string): void {
    this.queues.add('invoicing', job.kind, job, { jobId }).catch((error: unknown) => this.logger.error({ err: error, job }, 'Tâche de facturation non mise en file'));
  }

  async run(job: InvoicingJob | { at?: string }): Promise<void> {
    const task = 'kind' in job ? job : ({ kind: 'sweep' } as const);
    switch (task.kind) {
      case 'ride':
        return this.afterIssue(await this.invoicing.issueForRide(task.rideId));
      case 'refund':
        // La facture de la course d'abord (émise, transmise et rendue si elle manquait), puis la note de crédit.
        await this.afterIssue(await this.invoicing.issueForRide(task.rideId));
        return this.afterIssue(await this.invoicing.issueCreditNote(task.refundId));
      case 'transmit':
        await this.transmitAndRender(task.invoiceId);
        return;
      case 'render':
        await this.invoicing.renderPdf(task.invoiceId);
        return;
      case 'sweep':
        await this.sweep();
        return;
    }
  }

  /**
   * Suite d'une émission (ou de sa reprise par BullMQ) : première transmission au SEV si aucune n'a eu lieu, puis PDF
   * s'il manque, ou nouveau PDF si la facture vient d'être accusée. Une panne du SEV n'empêche pas le PDF : la reprise
   * périodique transmettra plus tard.
   */
  private async afterIssue(result: IssueResult | null): Promise<void> {
    if (!result) return;
    const { invoice } = result;
    const outcome = invoice.sevStatus === 'pending' && !invoice.sevTransactionId ? await this.transmitWithOriginal(invoice.id) : null;
    if (!invoice.pdfKey || (outcome && accepted(outcome))) await this.invoicing.renderPdf(invoice.id);
  }

  /**
   * Transmission d'une facture ; pour une note de crédit dont la facture d'origine n'a pas encore de transaction, l'origine
   * d'abord (et son PDF refait si elle est acceptée, pour y porter la transaction).
   */
  private async transmitWithOriginal(invoiceId: string): Promise<SevOutcome> {
    const invoice = await this.invoicing.byId(invoiceId);
    if (invoice?.creditNoteOfId) {
      const original = await this.invoicing.byId(invoice.creditNoteOfId);
      if (original && !original.sevTransactionId && accepted(await this.sev.transmit(original.id))) await this.invoicing.renderPdf(original.id);
    }
    return this.sev.transmit(invoiceId);
  }

  /** Reprise demandée : transmission, puis nouveau PDF quand la facture vient d'être accusée. */
  private async transmitAndRender(invoiceId: string): Promise<SevOutcome> {
    const outcome = await this.transmitWithOriginal(invoiceId);
    if (accepted(outcome)) await this.invoicing.renderPdf(invoiceId);
    return outcome;
  }

  /**
   * `POST /v1/admin/sev/retry/{invoiceId}` : la reprise passe par la file (traitée tout de suite en mode mémoire, par le
   * worker avec Redis) ; la réponse donne l'état connu après la mise en file.
   */
  async retry(invoiceId: string): Promise<SevRetryResult> {
    await this.sev.assertRetryable(invoiceId);
    await this.queues.add('invoicing', 'transmit', { kind: 'transmit', invoiceId } satisfies InvoicingJob, { jobId: `transmit-${invoiceId}-${Date.now()}` });
    return this.sev.retryResult(invoiceId);
  }

  /**
   * Passe périodique : transmissions à reprendre (et PDF refaits), factures manquantes, PDF manquants. Chaque élément est
   * traité à part : une facture en échec est journalisée et n'arrête pas les autres.
   */
  async sweep(now = new Date()): Promise<InvoicingSweepReport> {
    const transmitted = await this.sev.retryDue(now);
    for (const id of transmitted) await this.safely('render', id, () => this.invoicing.renderPdf(id));
    let issued = 0;
    for (const rideId of await this.invoicing.ridesMissingInvoice()) {
      await this.safely('issue', rideId, async () => {
        const result = await this.invoicing.issueForRide(rideId);
        if (result?.created) issued += 1;
        await this.afterIssue(result);
      });
    }
    const missing = await this.invoicing.invoicesMissingPdf();
    for (const id of missing) await this.safely('render', id, () => this.invoicing.renderPdf(id));
    if (issued || missing.length) this.logger.info({ issued, rendered: missing.length, transmitted: transmitted.length }, 'Reprise de la facturation');
    return { transmitted: transmitted.length, issued, rendered: missing.length };
  }

  private async safely(step: 'issue' | 'render', id: string, run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.logger.error({ err: error, step, id }, 'Reprise de la facturation impossible pour cet élément');
    }
  }
}
