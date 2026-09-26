/**
 * Adaptateur Stripe réel (prompt 07), par l'API REST de Stripe sans SDK : corps encodés en formulaire, clé
 * d'idempotence sur chaque écriture financière, version d'API figée, signature des webhooks vérifiée en temps constant
 * avec une tolérance de 5 minutes. Les refus de carte sont rendus comme un échec typé (`status: failed`, code de la
 * banque), les autres erreurs de Stripe comme une erreur 502.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../common/app-error.js';
import type { CardDetails, PaymentAuthorization, PaymentProvider, SetupIntentResult, WebhookEvent } from '../types.js';

const API = 'https://api.stripe.com';
const API_VERSION = '2024-06-20';
const WEBHOOK_TOLERANCE_SECONDS = 300;

type Params = Record<string, unknown>;

interface StripeErrorBody {
  error?: { type?: string; code?: string; decline_code?: string; message?: string; payment_intent?: { id?: string; status?: string } };
}

/** Encodage des paramètres imbriqués à la manière de Stripe : `metadata[ride_id]=…`, `payment_method_types[0]=card`. */
export function encodeForm(params: Params, prefix = ''): string[] {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) value.forEach((item, i) => (typeof item === 'object' && item !== null ? parts.push(...encodeForm(item as Params, `${name}[${i}]`)) : parts.push(`${encodeURIComponent(`${name}[${i}]`)}=${encodeURIComponent(String(item))}`)));
    else if (typeof value === 'object') parts.push(...encodeForm(value as Params, name));
    else parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
  }
  return parts;
}

/** Signature `Stripe-Signature` (`t=…,v1=…`) : HMAC SHA-256 de `t.corps` avec le secret du point de terminaison. */
export function stripeSignature(secret: string, payload: string, timestamp: number): string {
  return createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
}

export function verifyStripeSignature(secret: string, payload: string, header: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  const pairs = header.split(',').map((p) => p.trim().split('=') as [string, string]);
  const timestamp = Number(pairs.find(([k]) => k === 't')?.[1]);
  const signatures = pairs.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!Number.isFinite(timestamp) || !signatures.length) return false;
  if (Math.abs(nowSeconds - timestamp) > WEBHOOK_TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(stripeSignature(secret, payload, timestamp), 'hex');
  return signatures.some((sig) => {
    const given = Buffer.from(sig, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

function cardOf(pm: unknown): CardDetails | null {
  const method = pm as { id?: string; card?: { brand?: string; last4?: string; exp_month?: number; exp_year?: number } } | null;
  if (!method?.id || !method.card) return null;
  return { ref: method.id, brand: method.card.brand ?? 'card', last4: method.card.last4 ?? '0000', expMonth: method.card.exp_month ?? null, expYear: method.card.exp_year ?? null };
}

function authorizationOf(intent: { id: string; status: string; client_secret?: string; last_payment_error?: { code?: string; decline_code?: string } | null }): PaymentAuthorization {
  const failureCode = intent.last_payment_error?.decline_code ?? intent.last_payment_error?.code;
  switch (intent.status) {
    case 'requires_capture':
      return { intentId: intent.id, status: 'authorized' };
    case 'succeeded':
      return { intentId: intent.id, status: 'captured' };
    case 'requires_action':
      return { intentId: intent.id, status: 'requires_action', ...(intent.client_secret ? { clientSecret: intent.client_secret } : {}) };
    case 'canceled':
      return { intentId: intent.id, status: 'canceled' };
    default:
      return { intentId: intent.id, status: 'failed', ...(failureCode ? { failureCode } : { failureCode: intent.status }) };
  }
}

export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe';
  // Champs privés JavaScript : jamais énumérés, ni par le journal ni par util.inspect.
  readonly #secretKey: string;
  readonly #webhookSecret: string | undefined;
  readonly #fetch: typeof fetch;

  constructor(secretKey: string, webhookSecret: string | undefined, fetchImpl: typeof fetch = (input, init) => fetch(input, init)) {
    this.#secretKey = secretKey;
    this.#webhookSecret = webhookSecret;
    this.#fetch = fetchImpl;
  }

  toJSON() {
    return { name: this.name, configured: true };
  }

  private async call<T>(method: 'GET' | 'POST', path: string, params: Params = {}, idempotencyKey?: string): Promise<T> {
    const body = encodeForm(params).join('&');
    const url = method === 'GET' && body ? `${API}${path}?${body}` : `${API}${path}`;
    const headers: Record<string, string> = { authorization: `Bearer ${this.#secretKey}`, 'stripe-version': API_VERSION };
    if (method === 'POST') headers['content-type'] = 'application/x-www-form-urlencoded';
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    const res = await this.#fetch(url, { method, headers, ...(method === 'POST' ? { body } : {}), signal: AbortSignal.timeout(20_000) });
    const json = (await res.json().catch(() => ({}))) as T & StripeErrorBody;
    if (!res.ok) {
      const error = json.error ?? {};
      throw new AppError(error.type === 'card_error' ? 'PAYMENT_DECLINED' : 'PAYMENT_PROVIDER_ERROR', error.message ?? `Stripe ${res.status}`, error.type === 'card_error' ? 402 : 502, {
        code: error.decline_code ?? error.code ?? null,
        intentId: error.payment_intent?.id ?? null,
      });
    }
    return json;
  }

  /** Un refus de carte à la confirmation n'est pas une panne : il devient un échec typé avec le code de la banque. */
  private async intent(params: Params, idempotencyKey: string): Promise<PaymentAuthorization> {
    try {
      return authorizationOf(await this.call('POST', '/v1/payment_intents', params, idempotencyKey));
    } catch (error) {
      if (error instanceof AppError && error.code === 'PAYMENT_DECLINED') {
        const details = error.details as { code: string | null; intentId: string | null };
        return { intentId: details.intentId ?? '', status: 'failed', failureCode: details.code ?? 'card_declined' };
      }
      throw error;
    }
  }

  async createCustomer(input: { externalId: string; email?: string; phone?: string }) {
    const customer = await this.call<{ id: string }>('POST', '/v1/customers', { email: input.email, phone: input.phone, metadata: { neomoov_user_id: input.externalId } }, `customer:${input.externalId}`);
    return { customerRef: customer.id };
  }

  async createSetupIntent(customerRef: string) {
    const intent = await this.call<{ id: string; client_secret: string }>('POST', '/v1/setup_intents', { customer: customerRef, usage: 'off_session', payment_method_types: ['card'] });
    return { setupIntentId: intent.id, clientSecret: intent.client_secret };
  }

  async retrieveSetupIntent(setupIntentId: string): Promise<SetupIntentResult> {
    const intent = await this.call<{ id: string; status: SetupIntentResult['status']; customer: string | null; payment_method: unknown }>('GET', `/v1/setup_intents/${encodeURIComponent(setupIntentId)}`, { expand: ['payment_method'] });
    return { setupIntentId: intent.id, status: intent.status, customerRef: intent.customer, card: cardOf(intent.payment_method) };
  }

  async detachPaymentMethod(paymentMethodRef: string) {
    await this.call('POST', `/v1/payment_methods/${encodeURIComponent(paymentMethodRef)}/detach`);
  }

  authorize(input: Parameters<PaymentProvider['authorize']>[0]) {
    return this.intent(
      { amount: input.amountCents, currency: input.currency.toLowerCase(), customer: input.customerRef, payment_method: input.paymentMethodRef, capture_method: 'manual', confirm: true, payment_method_types: ['card'], metadata: input.metadata },
      input.idempotencyKey,
    );
  }

  async capture(intentId: string, amountCents: number, idempotencyKey: string) {
    try {
      return authorizationOf(await this.call('POST', `/v1/payment_intents/${encodeURIComponent(intentId)}/capture`, { amount_to_capture: amountCents }, idempotencyKey));
    } catch (error) {
      if (error instanceof AppError) return { intentId, status: 'failed' as const, failureCode: (error.details as { code?: string | null } | undefined)?.code ?? error.code };
      throw error;
    }
  }

  async cancel(intentId: string, idempotencyKey?: string) {
    await this.call('POST', `/v1/payment_intents/${encodeURIComponent(intentId)}/cancel`, {}, idempotencyKey);
  }

  async refund(input: { intentId: string; amountCents: number; idempotencyKey: string; reason?: string }) {
    const refund = await this.call<{ id: string; status: string }>('POST', '/v1/refunds', { payment_intent: input.intentId, amount: input.amountCents, metadata: input.reason ? { reason: input.reason.slice(0, 450) } : undefined }, input.idempotencyKey);
    return { refundId: refund.id, status: refund.status === 'succeeded' ? ('succeeded' as const) : refund.status === 'failed' || refund.status === 'canceled' ? ('failed' as const) : ('pending' as const) };
  }

  chargeOffSession(input: Parameters<PaymentProvider['chargeOffSession']>[0]) {
    return this.intent(
      { amount: input.amountCents, currency: 'cad', customer: input.customerRef, payment_method: input.paymentMethodRef, off_session: true, confirm: true, payment_method_types: ['card'], description: input.description, metadata: input.metadata },
      input.idempotencyKey,
    );
  }

  async verifyWebhook(rawBody: string | Buffer, signature: string): Promise<WebhookEvent> {
    if (!this.#webhookSecret) throw new AppError('PROVIDER_NOT_CONFIGURED', 'STRIPE_WEBHOOK_SECRET absente', 501);
    const payload = rawBody.toString();
    if (!verifyStripeSignature(this.#webhookSecret, payload, signature)) throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Signature de webhook invalide', 400);
    return JSON.parse(payload) as WebhookEvent;
  }

  async createConnectAccount(input: { externalId: string; email?: string; phone?: string }) {
    const account = await this.call<{ id: string }>(
      'POST',
      '/v1/accounts',
      { type: 'express', country: 'CA', email: input.email, business_type: 'individual', capabilities: { transfers: { requested: true } }, metadata: { neomoov_driver_id: input.externalId } },
      `connect:${input.externalId}`,
    );
    return { accountRef: account.id };
  }

  async createConnectOnboardingLink(input: { accountRef: string; returnUrl: string; refreshUrl: string }) {
    const link = await this.call<{ url: string; expires_at: number }>('POST', '/v1/account_links', { account: input.accountRef, return_url: input.returnUrl, refresh_url: input.refreshUrl, type: 'account_onboarding' });
    return { url: link.url, expiresAt: new Date(link.expires_at * 1000) };
  }

  async connectAccountStatus(accountRef: string) {
    const account = await this.call<{ details_submitted?: boolean; payouts_enabled?: boolean }>('GET', `/v1/accounts/${encodeURIComponent(accountRef)}`);
    return { onboarded: Boolean(account.details_submitted), payoutsEnabled: Boolean(account.payouts_enabled) };
  }

  async transfer(input: { accountRef: string; amountCents: number; idempotencyKey: string; description: string }) {
    const transfer = await this.call<{ id: string }>('POST', '/v1/transfers', { amount: input.amountCents, currency: 'cad', destination: input.accountRef, description: input.description }, input.idempotencyKey);
    return { transferId: transfer.id };
  }
}
