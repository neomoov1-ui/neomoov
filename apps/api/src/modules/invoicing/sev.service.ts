/**
 * Transmission des factures au système d'enregistrement des ventes (SEV, section 5.13, prompt 09 tâche 6), par la file
 * `invoicing`. Une facture est d'abord réservée (état `sent`, en cours) pour qu'un seul processus la transmette à la
 * fois ; chaque tentative laisse une ligne `sev_transmissions` (requête, réponse, état, rang). Succès : identifiant de
 * transaction et état `acknowledged` (ou `sent` si le fournisseur accuse réception plus tard). Échec : retour à `pending`,
 * puis `error` (visible dans My Hub) après `sev.max_attempts` tentatives. La passe périodique reprend les factures en
 * attente (après `sev.retry_delay_seconds`) et en erreur (après `sev.error_retry_seconds`) ; une transmission
 * interrompue (processus arrêté pendant l'appel) est libérée après 10 minutes. Une note de crédit attend la transaction
 * de sa facture d'origine : la passe ne la reprend qu'ensuite. Une facture en échec n'arrête jamais la passe.
 */
import { schema } from '@neomoov/db';
import type { InvoiceKind, SevRetryResult, SevStatusReport } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { SEV_PROVIDER, type SevDocument, type SevProvider, type SevReceipt } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { InvoicingService, type InvoiceRow } from './invoicing.service.js';

export type SevOutcome =
  | { status: 'acknowledged' | 'sent'; transactionId: string; attempt: number }
  | { status: 'pending' | 'error'; attempt: number; error: string }
  /** Rien n'a été tenté : déjà transmise, en cours ailleurs, ou note de crédit dont l'origine n'a pas encore de transaction. */
  | { status: 'skipped'; reason: 'already_transmitted' | 'in_progress' | 'original_not_transmitted' | 'not_found' };

const CALL_TIMEOUT_MS = 15_000;
const STALE_MINUTES = 10;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Délai de ${ms} ms dépassé`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

@Injectable()
export class SevService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(SEV_PROVIDER) private readonly provider: SevProvider,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly settings: SettingsService,
    private readonly invoicing: InvoicingService,
  ) {}

  private get db() {
    return this.database.db;
  }

  get providerName(): string {
    return this.provider.name;
  }

  /**
   * Une tentative de transmission. Une note de crédit dont la facture d'origine n'a pas encore de transaction n'est pas
   * tentée (aucune tentative comptée) : la file transmet l'origine d'abord (`InvoiceJobsService`).
   */
  async transmit(invoiceId: string): Promise<SevOutcome> {
    const current = await this.invoicing.byId(invoiceId);
    if (!current) return { status: 'skipped', reason: 'not_found' };
    if (current.sevTransactionId || current.sevStatus === 'acknowledged') return { status: 'skipped', reason: 'already_transmitted' };
    let original: InvoiceRow | null = null;
    if (current.creditNoteOfId) {
      original = await this.invoicing.byId(current.creditNoteOfId);
      if (!original?.sevTransactionId) return { status: 'skipped', reason: 'original_not_transmitted' };
    }

    // Réservation et ligne de la tentative dans une même transaction : un seul processus transmet une facture donnée, et
    // la libération des transmissions interrompues (`retryDue`) voit toujours la réservation avec sa tentative.
    const document = await this.documentOf(current, original);
    const reserved = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(schema.invoices)
        .set({ sevStatus: 'sent' })
        .where(and(eq(schema.invoices.id, invoiceId), inArray(schema.invoices.sevStatus, ['pending', 'error']), isNull(schema.invoices.sevTransactionId)))
        .returning();
      if (!row) return null;
      const [previous] = await tx.select({ n: count() }).from(schema.sevTransmissions).where(eq(schema.sevTransmissions.invoiceId, invoiceId));
      const attempt = (previous?.n ?? 0) + 1;
      const [transmission] = await tx
        .insert(schema.sevTransmissions)
        .values({ invoiceId, adapter: this.provider.name, request: document as unknown as Record<string, unknown>, status: 'sent', attempt })
        .returning({ id: schema.sevTransmissions.id });
      return { claimed: row, attempt, transmission: transmission! };
    });
    if (!reserved) return { status: 'skipped', reason: 'in_progress' };
    const { claimed, attempt, transmission } = reserved;

    let receipt: SevReceipt;
    try {
      const call = claimed.kind === 'credit_note' ? this.provider.registerCredit(document) : claimed.kind === 'ride' ? this.provider.registerSale(document) : this.provider.registerCancellation(document);
      receipt = await withTimeout(call, CALL_TIMEOUT_MS);
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      const maxAttempts = await this.settings.number('sev.max_attempts', 5);
      const status = attempt >= maxAttempts ? 'error' : 'pending';
      await this.db.update(schema.sevTransmissions).set({ status: 'error', response: { error: message } }).where(eq(schema.sevTransmissions.id, transmission.id));
      await this.db.update(schema.invoices).set({ sevStatus: status }).where(eq(schema.invoices.id, invoiceId));
      this.logger.warn({ invoiceId, number: claimed.number, attempt, maxAttempts, adapter: this.provider.name, error: message }, 'Transmission au SEV en échec');
      return { status, attempt, error: message };
    }
    await this.db.update(schema.sevTransmissions).set({ status: receipt.status, response: { transactionId: receipt.transactionId, status: receipt.status, qrPayload: receipt.qrPayload ?? null, raw: receipt.raw ?? null } }).where(eq(schema.sevTransmissions.id, transmission.id));
    await this.db.update(schema.invoices).set({ sevStatus: receipt.status, sevTransactionId: receipt.transactionId }).where(eq(schema.invoices.id, invoiceId));
    this.logger.info({ invoiceId, number: claimed.number, kind: claimed.kind, attempt, adapter: this.provider.name, transactionId: receipt.transactionId, status: receipt.status }, 'Facture transmise au SEV');
    return { status: receipt.status, transactionId: receipt.transactionId, attempt };
  }

  /** Document transmis : contenu figé de la facture, et transaction de la facture d'origine pour une note de crédit. */
  private async documentOf(row: InvoiceRow, original: InvoiceRow | null): Promise<SevDocument> {
    const view = await this.invoicing.view(row);
    return {
      invoiceId: row.id,
      kind: row.kind as InvoiceKind,
      number: row.number,
      supplierSequence: row.supplierSequence,
      issuedAt: row.issuedAt,
      supplier: { name: view.supplier.name, publicNumber: view.supplier.publicNumber, gstNumber: view.supplier.gstNumber, qstNumber: view.supplier.qstNumber },
      platform: { name: view.platform.name, gstNumber: view.platform.gstNumber, qstNumber: view.platform.qstNumber },
      paymentMethod: row.paymentMethod,
      lines: view.lines,
      gstCents: row.gstCents,
      qstCents: row.qstCents,
      tipCents: row.tipCents,
      totalCents: row.totalCents,
      original: original?.sevTransactionId ? { number: original.number, transactionId: original.sevTransactionId } : null,
    };
  }

  /**
   * Passe périodique : libère les transmissions interrompues, puis transmet les factures en attente dont la dernière
   * tentative date de plus de `sev.retry_delay_seconds` et celles en erreur, plus lentement. Renvoie les factures acceptées.
   */
  async retryDue(now = new Date(), limit = 50): Promise<string[]> {
    await this.db.execute(sql`
      UPDATE invoices i SET sev_status = 'pending'
      WHERE i.sev_status = 'sent' AND i.sev_transaction_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM sev_transmissions t WHERE t.invoice_id = i.id AND t.created_at > ${now.toISOString()}::timestamptz - make_interval(mins => ${STALE_MINUTES}::int))`);
    const [retryDelay, errorDelay] = await Promise.all([this.settings.number('sev.retry_delay_seconds', 60), this.settings.number('sev.error_retry_seconds', 3_600)]);
    const rows = await this.db.execute<{ id: string }>(sql`
      SELECT i.id FROM invoices i
      LEFT JOIN LATERAL (SELECT max(t.created_at) AS last_at FROM sev_transmissions t WHERE t.invoice_id = i.id) t ON true
      WHERE ((i.sev_status = 'pending' AND (t.last_at IS NULL OR t.last_at < ${now.toISOString()}::timestamptz - make_interval(secs => ${retryDelay}::int)))
          OR (i.sev_status = 'error' AND (t.last_at IS NULL OR t.last_at < ${now.toISOString()}::timestamptz - make_interval(secs => ${errorDelay}::int))))
        -- Une note de crédit attend que sa facture d'origine ait une transaction (reprise de l'origine d'abord).
        AND (i.credit_note_of_id IS NULL OR EXISTS (SELECT 1 FROM invoices o WHERE o.id = i.credit_note_of_id AND o.sev_transaction_id IS NOT NULL))
      ORDER BY i.issued_at LIMIT ${limit}`);
    const accepted: string[] = [];
    for (const { id } of rows) {
      try {
        const outcome = await this.transmit(id);
        if (outcome.status === 'acknowledged' || outcome.status === 'sent') accepted.push(id);
      } catch (error) {
        // Une facture en échec (donnée illisible, base indisponible) n'arrête pas la reprise des autres.
        this.logger.error({ err: error, invoiceId: id }, 'Reprise de la transmission au SEV impossible pour cette facture');
      }
    }
    if (rows.length) this.logger.info({ due: rows.length, accepted: accepted.length }, 'Reprise des transmissions au SEV');
    return accepted;
  }

  /** Reprise demandée depuis My Hub : refusée si la facture est déjà accusée ou en cours de transmission. */
  async assertRetryable(invoiceId: string): Promise<InvoiceRow> {
    const row = await this.invoicing.byId(invoiceId);
    if (!row) throw AppError.notFound('INVOICE_NOT_FOUND', 'Facture introuvable');
    if (row.sevStatus === 'acknowledged' || row.sevTransactionId) throw AppError.conflict('SEV_ALREADY_ACKNOWLEDGED', 'Cette facture est déjà enregistrée au SEV', { transactionId: row.sevTransactionId });
    if (row.sevStatus === 'sent') throw AppError.conflict('SEV_TRANSMISSION_IN_PROGRESS', 'Une transmission de cette facture est déjà en cours');
    return row;
  }

  async retryResult(invoiceId: string): Promise<SevRetryResult> {
    const row = await this.invoicing.byId(invoiceId);
    if (!row) throw AppError.notFound('INVOICE_NOT_FOUND', 'Facture introuvable');
    const [attempts] = await this.db.select({ n: count() }).from(schema.sevTransmissions).where(eq(schema.sevTransmissions.invoiceId, invoiceId));
    return { invoiceId: row.id, number: row.number, sevStatus: row.sevStatus, transactionId: row.sevTransactionId ?? null, attempts: attempts?.n ?? 0 };
  }

  /** État pour My Hub : compteurs par état, dernières erreurs, santé de l'adaptateur. */
  async statusReport(): Promise<SevStatusReport> {
    const [byStatus, errors, maxAttempts, adapter] = await Promise.all([
      this.db.select({ status: schema.invoices.sevStatus, n: count() }).from(schema.invoices).groupBy(schema.invoices.sevStatus),
      this.db
        .select({ invoiceId: schema.sevTransmissions.invoiceId, number: schema.invoices.number, kind: schema.invoices.kind, sevStatus: schema.invoices.sevStatus, attempt: schema.sevTransmissions.attempt, response: schema.sevTransmissions.response, occurredAt: schema.sevTransmissions.occurredAt })
        .from(schema.sevTransmissions)
        .innerJoin(schema.invoices, eq(schema.invoices.id, schema.sevTransmissions.invoiceId))
        .where(eq(schema.sevTransmissions.status, 'error'))
        .orderBy(desc(schema.sevTransmissions.occurredAt))
        .limit(20),
      this.settings.number('sev.max_attempts', 5),
      this.health(),
    ]);
    const counts = { pending: 0, sent: 0, acknowledged: 0, error: 0 };
    for (const row of byStatus) counts[row.status] = row.n;
    return {
      adapter,
      maxAttempts,
      counts,
      lastErrors: errors.map((e) => ({
        invoiceId: e.invoiceId, number: e.number, kind: e.kind as InvoiceKind, sevStatus: e.sevStatus, attempt: e.attempt,
        error: String((e.response as { error?: unknown } | null)?.error ?? 'Erreur inconnue'), occurredAt: e.occurredAt.toISOString(),
      })),
    };
  }

  private async health(): Promise<SevStatusReport['adapter']> {
    const started = Date.now();
    try {
      const result = await withTimeout(this.provider.healthcheck(), 5_000);
      return { name: this.provider.name, healthy: result.ok, latencyMs: result.latencyMs ?? Date.now() - started, detail: result.detail ?? null };
    } catch (error) {
      return { name: this.provider.name, healthy: false, latencyMs: null, detail: (error instanceof Error ? error.message : String(error)).slice(0, 300) };
    }
  }
}
