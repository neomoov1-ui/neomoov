/**
 * Adaptateur Stripe Billing réel (étape 25), par l'API REST de Stripe sans SDK, comme l'adaptateur de paiement : corps
 * encodés en formulaire, version d'API figée, clé d'idempotence dérivée de l'identifiant Neomoov sur chaque écriture,
 * signature des webhooks vérifiée en temps constant (tolérance de 5 minutes) avec le secret propre au point de
 * terminaison de la facturation (`STRIPE_BILLING_WEBHOOK_SECRET`, distinct de celui des paiements). Toute erreur de
 * Stripe devient une erreur 502 `BILLING_PROVIDER_ERROR` : la tâche quotidienne reprend les factures non transmises.
 *
 * Facture : brouillon sans éléments en attente ni taxe automatique, une ligne par élément calculé par Neomoov (TPS et
 * TVQ comprises, en lignes distinctes : le total est exactement celui de la facture PF), puis finalisation avec
 * `auto_advance` : Stripe prélève la carte par défaut du client (`charge_automatically`) ou envoie la facture avec sa
 * page de paiement hébergée (`send_invoice`). L'issue revient par `invoice.paid` ou `invoice.payment_failed`.
 */
import { AppError } from '../../common/app-error.js';
import type { BillingCustomerInput, BillingInvoiceInput, BillingInvoiceResult, BillingProvider, BillingSubscriptionInfo, BillingWebhookEvent } from '../billing.types.js';
import { encodeForm, verifyStripeSignature } from './stripe.js';

const API = 'https://api.stripe.com';
const API_VERSION = '2024-06-20';
const DAY_MS = 86_400_000;

type Params = Record<string, unknown>;

interface StripeInvoice {
  id: string;
  status: string;
  hosted_invoice_url?: string | null;
}

export class StripeBillingProvider implements BillingProvider {
  readonly name = 'stripe';
  // Champs privés JavaScript : jamais énumérés, ni par le journal ni par util.inspect.
  readonly #secretKey: string;
  readonly #webhookSecret: string | undefined;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;

  constructor(secretKey: string, webhookSecret: string | undefined, fetchImpl: typeof fetch = (input, init) => fetch(input, init), now: () => number = Date.now) {
    this.#secretKey = secretKey;
    this.#webhookSecret = webhookSecret;
    this.#fetch = fetchImpl;
    this.#now = now;
  }

  toJSON() {
    return { name: this.name, configured: true };
  }

  private async call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, params: Params = {}, idempotencyKey?: string): Promise<T> {
    const body = encodeForm(params).join('&');
    const url = method !== 'POST' && body ? `${API}${path}?${body}` : `${API}${path}`;
    const headers: Record<string, string> = { authorization: `Bearer ${this.#secretKey}`, 'stripe-version': API_VERSION };
    if (method === 'POST') headers['content-type'] = 'application/x-www-form-urlencoded';
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    let res: Response;
    try {
      res = await this.#fetch(url, { method, headers, ...(method === 'POST' ? { body } : {}), signal: AbortSignal.timeout(20_000) });
    } catch (error) {
      throw new AppError('BILLING_PROVIDER_ERROR', `Stripe Billing injoignable : ${error instanceof Error ? error.message : String(error)}`, 502);
    }
    const json = (await res.json().catch(() => ({}))) as T & { error?: { code?: string; message?: string } };
    if (!res.ok) throw new AppError('BILLING_PROVIDER_ERROR', json.error?.message ?? `Stripe ${res.status}`, 502, { status: res.status, code: json.error?.code ?? null });
    return json;
  }

  async createCustomer(input: BillingCustomerInput): Promise<{ customerId: string }> {
    const customer = await this.call<{ id: string }>(
      'POST',
      '/v1/customers',
      { name: input.name, email: input.email ?? undefined, preferred_locales: [input.language === 'en' ? 'en' : 'fr-CA'], metadata: { neomoov_organization_id: input.organizationId } },
      `platform-customer:${input.organizationId}`,
    );
    return { customerId: customer.id };
  }

  async syncSubscription(customerId: string, subscription: BillingSubscriptionInfo): Promise<void> {
    await this.call('POST', `/v1/customers/${encodeURIComponent(customerId)}`, {
      metadata: { neomoov_organization_id: subscription.organizationId, neomoov_plan: subscription.planCode, neomoov_billing_period: subscription.billingPeriod, neomoov_subscription_status: subscription.status },
    });
  }

  /**
   * Une clé d'idempotence n'est valable chez Stripe qu'avec les mêmes paramètres : le délai de paiement découle des dates
   * de la facture PF (jamais de l'heure de l'essai) et le mode d'encaissement fait partie de la clé. Si le client ajoute
   * une carte entre deux essais, un nouveau brouillon est créé ; l'ancien, jamais finalisé, n'est jamais prélevé.
   */
  async createInvoice(input: BillingInvoiceInput): Promise<BillingInvoiceResult> {
    // Prélèvement automatique si le client a une carte par défaut (portail client de Stripe) ; sinon facture envoyée.
    const customer = await this.call<{ invoice_settings?: { default_payment_method?: string | null } }>('GET', `/v1/customers/${encodeURIComponent(input.customerId)}`);
    const automatic = Boolean(customer.invoice_settings?.default_payment_method);
    const key = `platform-invoice:${input.platformInvoiceId}:${automatic ? 'auto' : 'send'}`;
    const customFields = [
      { name: 'Facture Neomoov', value: input.number },
      ...(input.taxNumbers.gst ? [{ name: 'TPS', value: input.taxNumbers.gst }] : []),
      ...(input.taxNumbers.qst ? [{ name: 'TVQ', value: input.taxNumbers.qst }] : []),
    ];
    const metadata = { neomoov_platform_invoice_id: input.platformInvoiceId, neomoov_invoice_number: input.number, neomoov_organization_id: input.organizationId };
    const draft = await this.call<StripeInvoice>('POST', '/v1/invoices', {
      customer: input.customerId,
      currency: input.currency.toLowerCase(),
      auto_advance: false,
      pending_invoice_items_behavior: 'exclude',
      automatic_tax: { enabled: false },
      collection_method: automatic ? 'charge_automatically' : 'send_invoice',
      ...(automatic ? {} : { days_until_due: Math.max(1, Math.ceil((input.dueAt.getTime() - input.issuedAt.getTime()) / DAY_MS)) }),
      description: `Facture ${input.number} de la plateforme Neomoov`,
      custom_fields: customFields,
      metadata,
    }, `${key}:create`);
    // Seules les lignes nulles sont omises : un crédit (montant négatif) passe, le total reste celui de la facture PF.
    const items = [...input.lines, ...input.taxes].filter((item) => item.amountCents !== 0);
    for (const [index, item] of items.entries()) {
      await this.call('POST', '/v1/invoiceitems', {
        customer: input.customerId, invoice: draft.id, currency: input.currency.toLowerCase(), amount: item.amountCents, description: item.label, metadata: { neomoov_platform_invoice_id: input.platformInvoiceId },
      }, `${key}:item:${index}`);
    }
    const finalized = await this.call<StripeInvoice>('POST', `/v1/invoices/${encodeURIComponent(draft.id)}/finalize`, { auto_advance: true }, `${key}:finalize`);
    return { invoiceId: finalized.id, status: finalized.status === 'paid' ? 'paid' : 'open', hostedInvoiceUrl: finalized.hosted_invoice_url ?? null };
  }

  /** Relit la facture : une facture déjà payée ou annulée chez Stripe n'est pas touchée (rejouable). */
  async markPaidOutOfBand(invoiceId: string): Promise<void> {
    const invoice = await this.call<StripeInvoice>('GET', `/v1/invoices/${encodeURIComponent(invoiceId)}`);
    if (invoice.status !== 'open' && invoice.status !== 'uncollectible') return;
    await this.call('POST', `/v1/invoices/${encodeURIComponent(invoiceId)}/pay`, { paid_out_of_band: true }, `platform-invoice-paid-out-of-band:${invoiceId}`);
  }

  async voidInvoice(invoiceId: string): Promise<void> {
    const invoice = await this.call<StripeInvoice>('GET', `/v1/invoices/${encodeURIComponent(invoiceId)}`);
    if (invoice.status === 'draft') await this.call('DELETE', `/v1/invoices/${encodeURIComponent(invoiceId)}`);
    else if (invoice.status === 'open' || invoice.status === 'uncollectible') await this.call('POST', `/v1/invoices/${encodeURIComponent(invoiceId)}/void`, {}, `platform-invoice-void:${invoiceId}`);
  }

  /** Portail client de Stripe (`POST /v1/billing_portal/sessions`) : à activer une fois dans le tableau de bord (docs/platform-billing.md, section 8). */
  async createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }> {
    const session = await this.call<{ url: string }>('POST', '/v1/billing_portal/sessions', { customer: customerId, return_url: returnUrl });
    return { url: session.url };
  }

  async verifyWebhook(rawBody: string | Buffer, signature: string): Promise<BillingWebhookEvent> {
    if (!this.#webhookSecret) throw new AppError('PROVIDER_NOT_CONFIGURED', 'STRIPE_BILLING_WEBHOOK_SECRET absente', 501);
    const payload = rawBody.toString();
    if (!verifyStripeSignature(this.#webhookSecret, payload, signature, Math.floor(this.#now() / 1000))) throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Signature de webhook invalide', 400);
    return JSON.parse(payload) as BillingWebhookEvent;
  }
}
