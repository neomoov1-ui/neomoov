/**
 * Facturation de la plateforme simulée (étape 25) : en mémoire, déterministe, sans réseau. Mêmes règles que l'adaptateur
 * Stripe pour ce que l'API en attend : client unique par organisation, facture unique par facture Neomoov (idempotence),
 * signature de webhook vérifiée (`mock-signature`, refusée en production), panne simulée (`unavailable`). Les tests
 * simulent l'issue d'un prélèvement par `paymentEvent` (réussite ou échec) et postent l'événement rendu au webhook.
 */
import { randomBytes } from 'node:crypto';
import { AppError } from '../../common/app-error.js';
import type { BillingCustomerInput, BillingInvoiceInput, BillingInvoiceResult, BillingProvider, BillingSubscriptionInfo, BillingWebhookEvent } from '../billing.types.js';

let counter = 0;
const RUN = randomBytes(3).toString('hex');
const nextId = (prefix: string) => `${prefix}_${RUN}${(++counter).toString(36).padStart(6, '0')}`;

export interface MockBillingInvoice {
  id: string;
  platformInvoiceId: string;
  number: string;
  customerId: string;
  totalCents: number;
  lines: BillingInvoiceInput['lines'];
  taxes: BillingInvoiceInput['taxes'];
  status: 'open' | 'paid' | 'void';
  paidOutOfBand: boolean;
  hostedInvoiceUrl: string;
}

export class MockBillingProvider implements BillingProvider {
  readonly name = 'mock';
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  /** Clients par organisation. */
  readonly customers = new Map<string, { id: string; name: string; email: string | null; subscription: BillingSubscriptionInfo | null }>();
  /** Factures par identifiant du fournisseur. */
  readonly invoices = new Map<string, MockBillingInvoice>();
  /** Panne simulée de Stripe : tout appel échoue en 502 `BILLING_PROVIDER_ERROR`, comme l'adaptateur réel. */
  unavailable = false;

  constructor(private readonly options: { acceptTestSignatures?: boolean } = {}) {}

  private available(): void {
    if (this.unavailable) throw new AppError('BILLING_PROVIDER_ERROR', 'Stripe Billing indisponible (panne simulée)', 502);
  }

  private invoice(invoiceId: string): MockBillingInvoice {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) throw new AppError('BILLING_PROVIDER_ERROR', `Facture inconnue du fournisseur : ${invoiceId}`, 502);
    return invoice;
  }

  async createCustomer(input: BillingCustomerInput): Promise<{ customerId: string }> {
    this.calls.push({ method: 'createCustomer', args: [input] });
    this.available();
    const existing = this.customers.get(input.organizationId);
    if (existing) return { customerId: existing.id };
    const id = `cus_mockb_${input.organizationId.replace(/-/g, '').slice(0, 20)}`;
    this.customers.set(input.organizationId, { id, name: input.name, email: input.email, subscription: null });
    return { customerId: id };
  }

  async syncSubscription(customerId: string, subscription: BillingSubscriptionInfo): Promise<void> {
    this.calls.push({ method: 'syncSubscription', args: [customerId, subscription] });
    this.available();
    const customer = [...this.customers.values()].find((c) => c.id === customerId);
    if (customer) customer.subscription = { ...subscription };
  }

  async createInvoice(input: BillingInvoiceInput): Promise<BillingInvoiceResult> {
    this.calls.push({ method: 'createInvoice', args: [input] });
    this.available();
    const existing = [...this.invoices.values()].find((i) => i.platformInvoiceId === input.platformInvoiceId);
    if (existing) return { invoiceId: existing.id, status: existing.status === 'paid' ? 'paid' : 'open', hostedInvoiceUrl: existing.hostedInvoiceUrl };
    const id = nextId('in_mock');
    const invoice: MockBillingInvoice = {
      id, platformInvoiceId: input.platformInvoiceId, number: input.number, customerId: input.customerId, totalCents: input.totalCents,
      lines: input.lines, taxes: input.taxes, status: 'open', paidOutOfBand: false, hostedInvoiceUrl: `https://invoice.stripe.mock/${id}`,
    };
    this.invoices.set(id, invoice);
    return { invoiceId: id, status: 'open', hostedInvoiceUrl: invoice.hostedInvoiceUrl };
  }

  async markPaidOutOfBand(invoiceId: string): Promise<void> {
    this.calls.push({ method: 'markPaidOutOfBand', args: [invoiceId] });
    this.available();
    const invoice = this.invoice(invoiceId);
    if (invoice.status === 'open') Object.assign(invoice, { status: 'paid', paidOutOfBand: true });
  }

  async voidInvoice(invoiceId: string): Promise<void> {
    this.calls.push({ method: 'voidInvoice', args: [invoiceId] });
    this.available();
    const invoice = this.invoice(invoiceId);
    if (invoice.status === 'open') invoice.status = 'void';
  }

  async verifyWebhook(rawBody: string | Buffer, signature: string): Promise<BillingWebhookEvent> {
    this.calls.push({ method: 'verifyWebhook', args: [signature] });
    if (this.options.acceptTestSignatures === false || signature !== 'mock-signature') throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Signature de webhook invalide', 400);
    return JSON.parse(rawBody.toString()) as BillingWebhookEvent;
  }

  /**
   * Issue simulée du prélèvement d'une facture : l'événement que Stripe enverrait au webhook de la facturation
   * (`invoice.paid`, ou `invoice.payment_failed` avec le code de refus de la banque). Une réussite marque la facture
   * payée chez le simulateur.
   */
  paymentEvent(invoiceId: string, outcome: 'paid' | 'failed', failureCode = 'card_declined'): BillingWebhookEvent {
    const invoice = this.invoice(invoiceId);
    if (outcome === 'paid') invoice.status = 'paid';
    return {
      id: nextId('evt_mockb'),
      type: outcome === 'paid' ? 'invoice.paid' : 'invoice.payment_failed',
      data: {
        object: {
          id: invoice.id, object: 'invoice', status: invoice.status, customer: invoice.customerId, amount_due: invoice.totalCents,
          amount_paid: outcome === 'paid' ? invoice.totalCents : 0, metadata: { neomoov_platform_invoice_id: invoice.platformInvoiceId, neomoov_invoice_number: invoice.number },
          ...(outcome === 'failed' ? { last_payment_error: { code: 'card_declined', decline_code: failureCode } } : {}),
        },
      },
    };
  }
}
