/**
 * Facturation certifiée (section 5.13, prompt 09 tâche 5) : émission de la facture d'une course terminée, d'une facture de
 * frais d'annulation ou de non-présentation, et d'une note de crédit par remboursement ; vues, PDF, vérification publique.
 *
 * Numérotation : le numéro global (`next_invoice_number()`) puis la séquence du fournisseur
 * (`next_invoice_supplier_sequence(chauffeur)`) sont tirés dans la transaction qui insère la facture. Les compteurs
 * (table `counters`, migration 0001) sont verrouillés jusqu'à la validation : une transaction annulée ne consomme aucun
 * numéro, deux transactions ne tirent jamais le même. L'ordre des verrous est toujours le même (émission, global,
 * fournisseur), sans interblocage. Un verrou consultatif par course (ou par remboursement) et l'index unique
 * `invoices_ride_unique` rendent l'émission idempotente : plusieurs processus peuvent recevoir le même événement.
 *
 * Une facture émise est immuable : son contenu est figé dans `invoices.lines` (document de version 1). Seuls l'état de
 * transmission au SEV, l'identifiant de transaction et la clé du PDF changent ensuite.
 */
import { randomUUID } from 'node:crypto';
import { schema } from '@neomoov/db';
import {
  buildCreditNote, buildFeeInvoice, buildRideInvoice, creditableOf, invoiceDocumentSchema, invoiceKindForRide,
  type InvoiceAmounts, type InvoiceDocument, type InvoiceKind, type InvoiceVerification, type Language, type RideInvoiceView, type VehicleCategory,
} from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import QRCode from 'qrcode';
import { STORAGE_PROVIDER, type StorageProvider } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { DB, type Database } from '../../infra/db.module.js';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';
import { invoiceLabel } from './invoice-labels.js';
import { renderInvoicePdf } from './invoice-pdf.js';
import { invoiceVerificationKey, signInvoiceToken, verificationUrl, verifyInvoiceToken } from './invoice-token.js';
import { FieldCipher } from '../../common/field-cipher.js';

export type InvoiceRow = typeof schema.invoices.$inferSelect;
type NewInvoice = typeof schema.invoices.$inferInsert;
type InvoiceValues = Omit<NewInvoice, 'id' | 'number' | 'supplierSequence' | 'qrPayload'>;
type RideRow = typeof schema.rides.$inferSelect;
type Executor = Pick<Database['db'], 'insert' | 'update' | 'select' | 'execute'>;

export interface IssueResult {
  invoice: InvoiceRow;
  created: boolean;
}

/** Espace des verrous consultatifs de la facturation (section 5.13). */
const LOCK_SPACE = 513;

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}

/** « Camille R. » : prénom et initiale du nom, assez pour identifier le client sans exposer plus que nécessaire. */
function shortName(first: string | null | undefined, last: string | null | undefined): string | null {
  const f = first?.trim();
  const l = last?.trim();
  if (!f && !l) return null;
  return [f, l ? `${l[0]!.toUpperCase()}.` : null].filter(Boolean).join(' ');
}

function nameParts(full: string | null): [string | null, string | null] {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean);
  return [parts[0] ?? null, parts.length > 1 ? parts.at(-1)! : null];
}

@Injectable()
export class InvoicingService {
  private readonly verificationKey: Buffer;

  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly settings: SettingsService,
    private readonly outbox: NotificationsOutbox,
    private readonly fields: FieldCipher,
  ) {
    this.verificationKey = invoiceVerificationKey(env.DERIVATION_KEY ?? env.ENCRYPTION_KEY!);
  }

  private get db() {
    return this.database.db;
  }

  // --- Émission ---

  /** Facture non créditée de la course (course, annulation ou non-présentation), s'il y en a une. */
  async invoiceOfRide(rideId: string, executor: Executor = this.db): Promise<InvoiceRow | null> {
    const [row] = await executor.select().from(schema.invoices).where(and(eq(schema.invoices.rideId, rideId), isNull(schema.invoices.creditNoteOfId))).limit(1);
    return row ?? null;
  }

  async byId(invoiceId: string): Promise<InvoiceRow | null> {
    const [row] = await this.db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId)).limit(1);
    return row ?? null;
  }

  /**
   * Facture due pour la course dans son état actuel : course terminée, ou frais d'annulation ou de non-présentation
   * facturés (montant enregistré sur la course par la transition). Idempotente ; null si rien n'est à facturer.
   */
  async issueForRide(rideId: string): Promise<IssueResult | null> {
    const existing = await this.invoiceOfRide(rideId);
    if (existing) return { invoice: existing, created: false };
    const [ride] = await this.db.select().from(schema.rides).where(eq(schema.rides.id, rideId)).limit(1);
    if (!ride) return null;
    const kind = invoiceKindForRide(ride.state, ride.cancellationFeeCents);
    if (!kind) return null;
    if (!ride.driverId) {
      this.logger.warn({ rideId, state: ride.state }, 'Facture impossible : course sans chauffeur');
      return null;
    }
    const rates = await this.taxRates();
    const amounts = kind === 'ride' ? buildRideInvoice(await this.rideInvoiceInput(ride), rates) : buildFeeInvoice(kind, ride.cancellationFeeCents);
    if (amounts.discrepancyCents !== 0) this.logger.warn({ rideId, discrepancyCents: amounts.discrepancyCents }, 'Facture : écart d\'arrondi compensé par une ligne');
    const context = await this.contextOf(ride);
    const document: InvoiceDocument = {
      version: 1,
      ridePublicNumber: ride.publicNumber,
      supplier: context.supplier,
      platform: context.platform,
      customerName: context.customerName,
      trip: this.tripOf(ride, kind),
      lines: amounts.lines.map((l) => ({ ...l, label: invoiceLabel(l.code) })),
      tollsCents: amounts.tollsCents,
      taxes: { ...amounts.taxes, gstRatePpm: rates.gstRatePpm, qstRatePpm: rates.qstRatePpm },
      payment: { creditsAppliedCents: amounts.creditsAppliedCents, paidCents: amounts.paidCents },
      legalNotice: context.legalNotice,
      creditable: creditableOf(amounts),
      creditNote: null,
    };
    const values = this.rowValues(ride, kind, amounts, document, null);
    return this.insertNumbered(`ride:${rideId}`, (tx) => this.invoiceOfRide(rideId, tx), async () => values, context.verificationBaseUrl);
  }

  /**
   * Note de crédit d'un remboursement (carte ou crédit, garantie modèle comprise), rattachée à la facture de la course
   * (émise d'abord si elle manque). Idempotente par remboursement ; null si rien n'est à créditer.
   */
  async issueCreditNote(refundId: string): Promise<IssueResult | null> {
    const found = await this.creditNoteOfRefund(refundId);
    if (found) return { invoice: found, created: false };
    const [refund] = await this.db
      .select({ id: schema.refunds.id, amountCents: schema.refunds.amountCents, mode: schema.refunds.mode, reason: schema.refunds.reason, status: schema.refunds.status, rideId: schema.payments.rideId })
      .from(schema.refunds)
      .innerJoin(schema.payments, eq(schema.payments.id, schema.refunds.paymentId))
      .where(eq(schema.refunds.id, refundId))
      .limit(1);
    // Un remboursement encore en attente chez Stripe n'a pas de note : le webhook qui le confirme la déclenche.
    if (!refund || refund.status !== 'succeeded') return null;
    const original = await this.issueForRide(refund.rideId);
    if (!original) {
      this.logger.warn({ refundId, rideId: refund.rideId }, 'Note de crédit impossible : la course n\'a pas de facture');
      return null;
    }
    const originalDocument = invoiceDocumentSchema.parse(original.invoice.lines);
    const [ride] = await this.db.select().from(schema.rides).where(eq(schema.rides.id, refund.rideId)).limit(1);
    const context = await this.contextOf(ride!);
    // Verrou de la facture d'origine : deux remboursements simultanés de la même course sont crédités l'un après l'autre,
    // chacun sur le reste réel (notes déjà émises relues dans la transaction).
    return this.insertNumbered(
      `credit:${original.invoice.id}`,
      (tx) => this.creditNoteOfRefund(refundId, tx),
      async (tx) => {
        const previous = await tx.select({ lines: schema.invoices.lines }).from(schema.invoices).where(eq(schema.invoices.creditNoteOfId, original.invoice.id));
        const amounts = buildCreditNote(originalDocument.creditable, previous.map((p) => invoiceDocumentSchema.parse(p.lines).creditable), refund.amountCents);
        if (amounts.discrepancyCents !== 0) this.logger.warn({ refundId, discrepancyCents: amounts.discrepancyCents }, 'Note de crédit plafonnée au reste de la facture');
        if (amounts.totalCents === 0) return null;
        const document: InvoiceDocument = {
          ...originalDocument,
          lines: amounts.lines.map((l) => ({ ...l, label: invoiceLabel(l.code) })),
          tollsCents: amounts.tollsCents,
          taxes: { ...amounts.taxes, gstRatePpm: originalDocument.taxes.gstRatePpm, qstRatePpm: originalDocument.taxes.qstRatePpm },
          payment: { creditsAppliedCents: 0, paidCents: amounts.totalCents },
          legalNotice: context.legalNotice,
          creditable: amounts.credited,
          creditNote: { refundId, originalInvoiceId: original.invoice.id, originalNumber: original.invoice.number, mode: refund.mode === 'credit' ? 'credit' : 'refund', reason: refund.reason },
        };
        return {
          ...this.rowValues(ride!, 'credit_note', amounts, document, original.invoice.id),
          driverId: original.invoice.driverId, supplierName: original.invoice.supplierName, supplierGstNumber: original.invoice.supplierGstNumber, supplierQstNumber: original.invoice.supplierQstNumber,
        };
      },
      context.verificationBaseUrl,
    );
  }

  private async creditNoteOfRefund(refundId: string, executor: Executor = this.db): Promise<InvoiceRow | null> {
    const [row] = await executor.select().from(schema.invoices).where(and(eq(schema.invoices.kind, 'credit_note'), sql`${schema.invoices.lines} -> 'creditNote' ->> 'refundId' = ${refundId}`)).limit(1);
    return row ?? null;
  }

  /**
   * Insertion numérotée : verrou de l'émission, relecture (une autre émission a pu gagner entre-temps), numéro global puis
   * séquence du fournisseur, insertion ; tout dans la même transaction. Une violation de l'index unique (course déjà
   * facturée par un autre chemin) annule la transaction, numéros compris : la facture existante est renvoyée. `build` lit
   * par la transaction ce qui dépend d'autres factures (reste à créditer) ; null : rien à émettre, aucun numéro tiré.
   */
  private async insertNumbered(lockKey: string, find: (tx: Executor) => Promise<InvoiceRow | null>, build: (tx: Executor) => Promise<InvoiceValues | null>, verificationBaseUrl: string): Promise<IssueResult | null> {
    const id = randomUUID();
    const qrPayload = this.verificationUrlOf(id, verificationBaseUrl);
    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_SPACE}, hashtext(${lockKey}))`);
        const existing = await find(tx);
        if (existing) return { invoice: existing, created: false };
        const values = await build(tx);
        if (!values) return null;
        // Deux requêtes, dans cet ordre : le verrou du compteur global toujours avant celui du fournisseur.
        const [global] = await tx.execute<{ number: string }>(sql`SELECT next_invoice_number() AS number`);
        const [supplier] = await tx.execute<{ sequence: number }>(sql`SELECT next_invoice_supplier_sequence(${values.driverId}::uuid) AS sequence`);
        const [invoice] = await tx.insert(schema.invoices).values({ ...values, id, number: global!.number, supplierSequence: Number(supplier!.sequence), qrPayload }).returning();
        return { invoice: invoice!, created: true };
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await find(this.db);
      if (!existing) throw error;
      return { invoice: existing, created: false };
    }
  }

  private rowValues(ride: RideRow, kind: InvoiceKind, amounts: InvoiceAmounts, document: InvoiceDocument, creditNoteOfId: string | null): InvoiceValues {
    return {
      rideId: ride.id,
      driverId: ride.driverId!,
      supplierName: document.supplier.name.slice(0, 150),
      supplierGstNumber: document.supplier.gstNumber,
      supplierQstNumber: document.supplier.qstNumber,
      lines: document,
      fareCents: amounts.fareCents,
      serviceFeeCents: amounts.serviceFeeCents,
      regulatoryFeeCents: amounts.regulatoryFeeCents,
      gstCents: amounts.taxes.gstCents,
      qstCents: amounts.taxes.qstCents,
      tipCents: amounts.tipCents,
      totalCents: amounts.totalCents,
      paymentMethod: ride.paymentMethod,
      kind,
      creditNoteOfId,
    };
  }

  private async taxRates() {
    const [gstRatePpm, qstRatePpm] = await Promise.all([this.settings.number('pricing.gst_rate_ppm', 50_000), this.settings.number('pricing.qst_rate_ppm', 99_750)]);
    return { gstRatePpm, qstRatePpm };
  }

  /** Montants enregistrés par la fin de course et lignes du devis (composantes du tarif, suppléments). */
  private async rideInvoiceInput(ride: RideRow) {
    const [quote] = ride.quoteId ? await this.db.select({ lines: schema.quotes.lines }).from(schema.quotes).where(eq(schema.quotes.id, ride.quoteId)).limit(1) : [];
    const quoteLines = Array.isArray(quote?.lines) ? (quote.lines as Array<{ code?: unknown; amountCents?: unknown }>).filter((l) => typeof l.code === 'string' && Number.isInteger(l.amountCents)).map((l) => ({ code: l.code as string, amountCents: l.amountCents as number })) : [];
    return {
      fareCents: ride.fareCents ?? 0,
      promotionDiscountCents: ride.promotionDiscountCents,
      serviceFeeCents: ride.serviceFeeCents ?? 0,
      regulatoryFeeCents: ride.regulatoryFeeCents ?? 0,
      tollsCents: ride.tollsCents,
      gstCents: ride.gstCents ?? 0,
      qstCents: ride.qstCents ?? 0,
      waitChargeCents: ride.waitChargeCents,
      tipCents: ride.tipCents,
      creditsAppliedCents: ride.creditsAppliedCents,
      finalPriceCents: ride.finalPriceCents ?? ride.quotedTotalCents,
      quoteLines,
    };
  }

  /** Fournisseur (chauffeur), Neomoov (réglages `company.*`), client, mention légale, adresse de vérification. */
  private async contextOf(ride: RideRow) {
    const [driver] = await this.db
      .select({ publicNumber: schema.drivers.publicNumber, tradeName: schema.drivers.tradeName, gstNumber: schema.drivers.gstNumber, qstNumber: schema.drivers.qstNumber, firstName: schema.users.firstName, lastName: schema.users.lastName })
      .from(schema.drivers)
      .innerJoin(schema.users, eq(schema.users.id, schema.drivers.userId))
      .where(eq(schema.drivers.id, ride.driverId!))
      .limit(1);
    const [client] = ride.clientId
      ? await this.db.select({ firstName: schema.users.firstName, lastName: schema.users.lastName }).from(schema.clients).innerJoin(schema.users, eq(schema.users.id, schema.clients.userId)).where(eq(schema.clients.id, ride.clientId)).limit(1)
      : [];
    const [legalName, address, gst, qst, legalNotice, verificationBaseUrl] = await Promise.all([
      this.settings.string('company.legal_name', 'Neomoov'),
      this.settings.string('company.address', 'Montréal (Québec)'),
      this.settings.get<unknown>('company.gst_number', ''),
      this.settings.get<unknown>('company.qst_number', ''),
      this.settings.string('invoices.legal_notice', 'Le transport est fourni et facturé par le chauffeur indiqué ; les frais de service et la redevance sont facturés par Neomoov.'),
      this.settings.string('invoices.verification_base_url', `${this.env.WEB_BASE_URL}/verifier-facture`),
    ]);
    const personal = [driver?.firstName, driver?.lastName].filter(Boolean).join(' ').trim();
    const [guestFirst, guestLast] = nameParts(ride.guestName);
    const taxId = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
    return {
      supplier: {
        publicNumber: driver?.publicNumber ?? '',
        name: driver?.tradeName?.trim() || personal || `Chauffeur ${driver?.publicNumber ?? ''}`.trim(),
        gstNumber: taxId(this.fields.decrypt(driver?.gstNumber)),
        qstNumber: taxId(this.fields.decrypt(driver?.qstNumber)),
      },
      platform: { name: legalName, address, gstNumber: taxId(gst), qstNumber: taxId(qst) },
      customerName: client ? shortName(client.firstName, client.lastName) : shortName(guestFirst, guestLast),
      legalNotice,
      verificationBaseUrl,
    };
  }

  private tripOf(ride: RideRow, kind: InvoiceKind): InvoiceDocument['trip'] {
    const stamps = (ride.stateTimestamps ?? {}) as Record<string, string | undefined>;
    const at = kind === 'ride' ? stamps['completed'] : stamps[ride.state];
    return {
      category: (ride.servedCategory ?? ride.reservedCategory) as VehicleCategory,
      originAddress: ride.originAddress,
      destinationAddress: ride.destinationAddress,
      distanceMeters: kind === 'ride' ? ride.distanceMeters : null,
      durationSeconds: kind === 'ride' ? ride.durationSeconds : null,
      occurredAt: at ? new Date(at).toISOString() : null,
    };
  }

  private verificationUrlOf(invoiceId: string, baseUrl: string): string {
    const token = signInvoiceToken(invoiceId, this.verificationKey);
    try {
      return verificationUrl(baseUrl, token);
    } catch {
      return verificationUrl(`${this.env.WEB_BASE_URL}/verifier-facture`, token);
    }
  }

  // --- Vues ---

  /** Facture de la course pour son client, son chauffeur ou le personnel (404 tant qu'elle n'est pas émise). */
  async rideInvoice(rideId: string): Promise<RideInvoiceView> {
    const row = await this.invoiceOfRide(rideId);
    if (!row) throw AppError.notFound('INVOICE_NOT_FOUND', 'Aucune facture pour cette course pour le moment');
    return this.view(row);
  }

  async view(row: InvoiceRow): Promise<RideInvoiceView> {
    const document = invoiceDocumentSchema.parse(row.lines);
    const [original] = row.creditNoteOfId ? await this.db.select({ id: schema.invoices.id, number: schema.invoices.number }).from(schema.invoices).where(eq(schema.invoices.id, row.creditNoteOfId)).limit(1) : [];
    const notes = row.creditNoteOfId
      ? []
      : await this.db
          .select({ id: schema.invoices.id, number: schema.invoices.number, kind: schema.invoices.kind, issuedAt: schema.invoices.issuedAt, totalCents: schema.invoices.totalCents, sevStatus: schema.invoices.sevStatus })
          .from(schema.invoices)
          .where(eq(schema.invoices.creditNoteOfId, row.id))
          .orderBy(asc(schema.invoices.issuedAt), asc(schema.invoices.number));
    return {
      id: row.id,
      rideId: row.rideId,
      ridePublicNumber: document.ridePublicNumber,
      kind: row.kind as InvoiceKind,
      number: row.number,
      supplierSequence: row.supplierSequence,
      issuedAt: row.issuedAt.toISOString(),
      supplier: { ...document.supplier, driverId: row.driverId },
      platform: document.platform,
      customerName: document.customerName,
      trip: document.trip,
      lines: document.lines,
      fareCents: row.fareCents,
      serviceFeeCents: row.serviceFeeCents,
      regulatoryFeeCents: row.regulatoryFeeCents,
      tollsCents: document.tollsCents,
      taxes: document.taxes,
      tipCents: row.tipCents,
      totalCents: row.totalCents,
      payment: { method: row.paymentMethod, ...document.payment },
      sev: { status: row.sevStatus, transactionId: row.sevTransactionId ?? null },
      verificationUrl: row.qrPayload ?? null,
      legalNotice: document.legalNotice,
      pdfAvailable: row.pdfKey !== null,
      creditNoteOf: original ? { id: original.id, number: original.number } : null,
      refund: document.creditNote ? { id: document.creditNote.refundId, mode: document.creditNote.mode, reason: document.creditNote.reason } : null,
      creditNotes: notes.map((n) => ({ id: n.id, number: n.number, kind: n.kind as InvoiceKind, issuedAt: n.issuedAt.toISOString(), totalCents: n.totalCents, sevStatus: n.sevStatus })),
    };
  }

  // --- PDF ---

  /**
   * Produit le PDF (tâche de la file `invoicing`), le range par l'adaptateur de stockage et note sa clé. Le premier
   * rendu met en file le courriel `invoice.issued` (envoi réel à l'étape 13) ; un nouveau rendu après l'accusé du SEV
   * remplace le fichier pour y porter le numéro de transaction.
   */
  async renderPdf(invoiceId: string): Promise<{ key: string; firstRender: boolean } | null> {
    const row = await this.byId(invoiceId);
    if (!row) return null;
    const view = await this.view(row);
    const qr = view.verificationUrl ? await QRCode.toBuffer(view.verificationUrl, { type: 'png', margin: 1, width: 240, errorCorrectionLevel: 'M' }) : null;
    const pdf = await renderInvoicePdf(view, qr);
    const month = row.issuedAt.toISOString().slice(0, 7).replace('-', '/');
    const key = row.pdfKey ?? `invoices/${month}/${row.number}.pdf`;
    await this.storage.putObject({ key, body: pdf, contentType: 'application/pdf' });
    if (row.pdfKey) return { key, firstRender: false };
    const updated = await this.db.update(schema.invoices).set({ pdfKey: key }).where(and(eq(schema.invoices.id, row.id), isNull(schema.invoices.pdfKey))).returning({ id: schema.invoices.id });
    if (updated.length) await this.notifyIssued(row, key);
    return { key, firstRender: updated.length > 0 };
  }

  /** Courriel au client (compte) avec la facture ou la note de crédit ; un invité sans courriel la reçoit par le reçu de course. */
  private async notifyIssued(row: InvoiceRow, pdfKey: string): Promise<void> {
    const [client] = await this.db
      .select({ userId: schema.users.id, language: schema.users.language })
      .from(schema.rides)
      .innerJoin(schema.clients, eq(schema.clients.id, schema.rides.clientId))
      .innerJoin(schema.users, eq(schema.users.id, schema.clients.userId))
      .where(eq(schema.rides.id, row.rideId))
      .limit(1);
    if (!client) return;
    await this.outbox.queue({
      recipientUserId: client.userId, channel: 'email', template: 'invoice.issued', language: client.language as Language,
      data: { invoiceId: row.id, rideId: row.rideId, number: row.number, kind: row.kind, totalCents: row.totalCents, pdfKey },
    });
  }

  /** PDF stocké d'une facture de la course (la facture, ou l'une de ses notes de crédit avec `documentId`). */
  async pdfOfRide(rideId: string, documentId?: string): Promise<{ body: Buffer; filename: string }> {
    const row = documentId ? await this.byId(documentId) : await this.invoiceOfRide(rideId);
    if (!row || row.rideId !== rideId) throw AppError.notFound('INVOICE_NOT_FOUND', 'Facture introuvable pour cette course');
    return this.pdfOf(row);
  }

  async pdfById(invoiceId: string): Promise<{ body: Buffer; filename: string }> {
    const row = await this.byId(invoiceId);
    if (!row) throw AppError.notFound('INVOICE_NOT_FOUND', 'Facture introuvable');
    return this.pdfOf(row);
  }

  private async pdfOf(row: InvoiceRow): Promise<{ body: Buffer; filename: string }> {
    if (!row.pdfKey) throw AppError.conflict('INVOICE_PDF_PENDING', 'Le PDF de la facture est en préparation : réessayez dans un instant');
    const file = await this.storage.getObject(row.pdfKey);
    if (!file) throw AppError.conflict('INVOICE_PDF_PENDING', 'Le PDF de la facture est en préparation : réessayez dans un instant');
    return { body: file.body, filename: `neomoov-${row.number}.pdf` };
  }

  // --- Vérification publique ---

  /** Vérification par le code QR : le minimum (numéro, date, fournisseur, total, état SEV) ; un jeton altéré est refusé. */
  async verify(token: string): Promise<InvoiceVerification> {
    const invoiceId = verifyInvoiceToken(token, this.verificationKey);
    const row = invoiceId ? await this.byId(invoiceId) : null;
    if (!row) throw AppError.notFound('INVOICE_NOT_VERIFIED', 'Facture introuvable : le code de vérification est invalide');
    return { number: row.number, kind: row.kind as InvoiceKind, issuedAt: row.issuedAt.toISOString(), supplierName: row.supplierName, totalCents: row.totalCents, sevStatus: row.sevStatus };
  }

  // --- Reprise ---

  /**
   * Courses terminées ou facturées de frais sans facture (événement perdu, panne) depuis moins de
   * `invoices.catchup_days` jours : reprises par la passe périodique.
   */
  async ridesMissingInvoice(limit = 50): Promise<string[]> {
    const days = await this.settings.number('invoices.catchup_days', 2);
    const rows = await this.db.execute<{ id: string }>(sql`
      SELECT r.id FROM rides r
      WHERE r.driver_id IS NOT NULL
        AND (r.state IN ('completed', 'rated', 'disputed') OR (r.state IN ('cancelled_by_client', 'no_show') AND r.cancellation_fee_cents > 0))
        AND r.updated_at > now() - make_interval(days => ${days}::int) AND r.updated_at < now() - interval '2 minutes'
        AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.ride_id = r.id AND i.credit_note_of_id IS NULL)
      ORDER BY r.updated_at LIMIT ${limit}`);
    return [...rows].map((r) => r.id);
  }

  /** Factures sans PDF depuis plus de 2 minutes (rendu interrompu) : rendues par la passe périodique. */
  async invoicesMissingPdf(limit = 50): Promise<string[]> {
    const rows = await this.db.execute<{ id: string }>(sql`SELECT id FROM invoices WHERE pdf_key IS NULL AND issued_at < now() - interval '2 minutes' ORDER BY issued_at LIMIT ${limit}`);
    return [...rows].map((r) => r.id);
  }
}
