/**
 * Adaptateur Square réel (étape 26) : encaissement des courses avec le compte Square canadien du fondateur en attendant
 * la validation du compte Stripe. API REST de Square sans SDK, comme `stripe.ts` : corps JSON, version d'API datée
 * (`Square-Version`), clé d'idempotence sur chaque écriture financière (Square la limite à 45 caractères : nos clés sont
 * condensées de façon déterministe), signature des webhooks vérifiée en temps constant (HMAC-SHA256 de l'adresse de
 * notification suivie du corps brut, clé de signature du point de réception).
 *
 * Ce que Square n'a pas, et comment c'est rendu :
 * - pas de SetupIntent : la carte vient d'un jeton de carte produit par le Web Payments SDK dans la page `/carte` du web,
 *   enregistré par `saveCard` (`POST /v2/cards`) ;
 * - pas de capture partielle à la complétion : `capture` baisse d'abord le montant de l'empreinte (`UpdatePayment`) quand
 *   Square le permet (`EDIT_AMOUNT_DOWN`), sinon complète le paiement puis rembourse aussitôt la différence (rejouable) ;
 * - pas d'équivalent de Stripe Connect : les versements aux chauffeurs se font hors plateforme (`capabilities.connect`
 *   à faux, routes Connect refusées en 409 `CONNECT_UNAVAILABLE`).
 * Les événements de webhook sont traduits dans le vocabulaire interne (celui de Stripe) ; l'original est gardé dans `raw`.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../common/app-error.js';
import type { CardDetails, PaymentAuthorization, PaymentCapabilities, PaymentProvider, SetupIntentResult, WebhookEvent } from '../types.js';

export const SQUARE_API_VERSION = '2025-01-23';
const HOSTS = { production: 'https://connect.squareup.com', sandbox: 'https://connect.squareupsandbox.com' } as const;
/** Adresses du Web Payments SDK, par environnement (chargées par la page `/carte`). */
export const SQUARE_SDK_URLS = { production: 'https://web.squarecdn.com/v1/square.js', sandbox: 'https://sandbox.web.squarecdn.com/v1/square.js' } as const;
/**
 * Empreinte à capture différée : `delay_duration` est omis, Square applique alors le maximum permis pour une carte
 * absente (7 jours ; une valeur explicite doit être inférieure), puis annule l'empreinte (`delay_action: CANCEL`).
 */
const AUTHORIZATION_DELAY_ACTION = 'CANCEL';
const CURRENCY = 'CAD';
const MAX_IDEMPOTENCY_LENGTH = 45;

export type SquareEnvironment = keyof typeof HOSTS;

export interface SquareOptions {
  accessToken: string;
  locationId: string;
  environment: SquareEnvironment;
  webhookSignatureKey?: string | undefined;
  webhookUrl?: string | undefined;
  apiVersion?: string;
  fetchImpl?: typeof fetch;
}

interface SquareError {
  category?: string;
  code?: string;
  detail?: string;
  field?: string;
}

interface SquareMoney {
  amount?: number;
  currency?: string;
}

/** Objet `payment` de Square, réduit à ce que l'adaptateur lit. */
export interface SquarePayment {
  id: string;
  status: 'APPROVED' | 'PENDING' | 'COMPLETED' | 'CANCELED' | 'FAILED' | string;
  amount_money?: SquareMoney;
  approved_money?: SquareMoney;
  total_money?: SquareMoney;
  refunded_money?: SquareMoney;
  card_details?: { status?: string; errors?: SquareError[] };
  /** Modifications permises sur un paiement approuvé (`EDIT_AMOUNT_DOWN`, `EDIT_AMOUNT_UP`…). */
  capabilities?: string[];
}

interface SquareRefund {
  id: string;
  status: 'PENDING' | 'COMPLETED' | 'REJECTED' | 'FAILED' | string;
  payment_id?: string;
  amount_money?: SquareMoney;
}

interface SquareCard {
  id: string;
  card_brand?: string;
  last_4?: string;
  exp_month?: number;
  exp_year?: number;
  customer_id?: string;
  enabled?: boolean;
}

/** Notification de webhook telle que Square l'envoie. */
export interface SquareEvent {
  merchant_id?: string;
  type: string;
  event_id: string;
  created_at?: string;
  data?: { type?: string; id?: string; object?: Record<string, unknown> };
}

type Json = Record<string, unknown>;

/** Clé d'idempotence acceptée par Square (45 caractères au plus) : condensé déterministe de la nôtre, courte ou longue. */
export function squareIdempotencyKey(key: string): string {
  if (key.length <= MAX_IDEMPOTENCY_LENGTH && /^[A-Za-z0-9:_-]+$/.test(key)) return key;
  return createHash('sha256').update(key).digest('base64url').slice(0, MAX_IDEMPOTENCY_LENGTH - 2);
}

/** Signature `x-square-hmacsha256-signature` : HMAC-SHA256 de l'adresse de notification suivie du corps, en base64. */
export function squareSignature(signatureKey: string, notificationUrl: string, payload: string): string {
  return createHmac('sha256', signatureKey).update(notificationUrl + payload).digest('base64');
}

export function verifySquareSignature(signatureKey: string, notificationUrl: string, payload: string, header: string | undefined): boolean {
  if (!header) return false;
  const expected = Buffer.from(squareSignature(signatureKey, notificationUrl, payload), 'base64');
  const given = Buffer.from(header.trim(), 'base64');
  return given.length === expected.length && given.length > 0 && timingSafeEqual(given, expected);
}

function money(value: SquareMoney | undefined): number | null {
  return typeof value?.amount === 'number' ? value.amount : null;
}

/** Code d'échec dans le style des codes internes (`card_declined`, `insufficient_funds`…). */
function failureCodeOf(errors: SquareError[] | undefined, fallback: string): string {
  const code = errors?.find((e) => e.code)?.code;
  return (code ?? fallback).toLowerCase();
}

function cardOf(card: SquareCard): CardDetails {
  return { ref: card.id, brand: (card.card_brand ?? 'card').toLowerCase(), last4: card.last_4 ?? '0000', expMonth: card.exp_month ?? null, expYear: card.exp_year ?? null };
}

/** Montant net encaissé d'un paiement complété : total moins ce qui a déjà été remboursé. */
function netReceived(payment: SquarePayment): number {
  return (money(payment.total_money) ?? money(payment.amount_money) ?? 0) - (money(payment.refunded_money) ?? 0);
}

function authorizationOf(payment: SquarePayment): PaymentAuthorization {
  switch (payment.status) {
    case 'APPROVED':
      return { intentId: payment.id, status: 'authorized' };
    case 'COMPLETED':
      return { intentId: payment.id, status: 'captured' };
    case 'CANCELED':
      return { intentId: payment.id, status: 'canceled' };
    case 'PENDING':
      // Un paiement par carte enregistrée est traité tout de suite ; « en attente » reste exceptionnel et n'est pas un encaissement.
      return { intentId: payment.id, status: 'failed', failureCode: 'pending' };
    default:
      return { intentId: payment.id, status: 'failed', failureCode: failureCodeOf(payment.card_details?.errors, payment.status || 'failed') };
  }
}

function refundStatusOf(status: string): 'pending' | 'succeeded' | 'failed' {
  if (status === 'COMPLETED') return 'succeeded';
  if (status === 'REJECTED' || status === 'FAILED') return 'failed';
  return 'pending';
}

/**
 * Traduction d'une notification Square dans le vocabulaire interne des paiements. Un type inconnu est rendu tel quel :
 * le service l'enregistre comme ignoré.
 */
export function normalizeSquareEvent(event: SquareEvent): WebhookEvent {
  const object = event.data?.object ?? {};
  const translated = (type: string, data: Json): WebhookEvent => ({ id: event.event_id, type, data: { object: data }, raw: event });
  switch (event.type) {
    case 'payment.created':
    case 'payment.updated':
    case 'payment.completed': {
      const payment = object['payment'] as SquarePayment | undefined;
      if (!payment?.id) return translated(event.type, object);
      switch (payment.status) {
        case 'COMPLETED':
          return translated('payment_intent.succeeded', { id: payment.id, status: 'succeeded', amount_received: netReceived(payment) });
        case 'APPROVED':
          return translated('payment_intent.amount_capturable_updated', { id: payment.id, status: 'requires_capture', amount_capturable: money(payment.approved_money) ?? money(payment.amount_money) ?? 0 });
        case 'CANCELED':
          return translated('payment_intent.canceled', { id: payment.id, status: 'canceled' });
        case 'FAILED':
          return translated('payment_intent.payment_failed', { id: payment.id, status: 'failed', last_payment_error: { code: failureCodeOf(payment.card_details?.errors, 'payment_failed') } });
        default:
          return translated(`square.${event.type}.${String(payment.status).toLowerCase()}`, { id: payment.id });
      }
    }
    case 'refund.created':
    case 'refund.updated': {
      const refund = object['refund'] as SquareRefund | undefined;
      if (!refund?.id) return translated(event.type, object);
      return translated('refund.updated', { id: refund.id, status: refundStatusOf(refund.status), payment_intent: refund.payment_id ?? null, amount: money(refund.amount_money) });
    }
    case 'card.disabled': {
      const card = object['card'] as SquareCard | undefined;
      return card?.id ? translated('payment_method.detached', { id: card.id }) : translated(event.type, object);
    }
    case 'dispute.created': {
      const dispute = object['dispute'] as { id?: string; reason?: string; amount_money?: SquareMoney; disputed_payment?: { payment_id?: string } } | undefined;
      return translated('charge.dispute.created', { id: dispute?.id ?? event.event_id, payment_intent: dispute?.disputed_payment?.payment_id ?? '', reason: dispute?.reason ?? 'unknown', amount: money(dispute?.amount_money) ?? 0 });
    }
    default:
      return translated(event.type, object);
  }
}

export class SquarePaymentProvider implements PaymentProvider {
  readonly name = 'square';
  readonly capabilities: PaymentCapabilities = { setupIntent: false, cardToken: true, connect: false };
  readonly environment: SquareEnvironment;
  readonly locationId: string;
  // Champs privés JavaScript : jamais énumérés, ni par le journal ni par util.inspect.
  readonly #accessToken: string;
  readonly #signatureKey: string | undefined;
  readonly #webhookUrl: string | undefined;
  readonly #apiVersion: string;
  readonly #fetch: typeof fetch;

  constructor(options: SquareOptions) {
    this.#accessToken = options.accessToken;
    this.locationId = options.locationId;
    this.environment = options.environment;
    this.#signatureKey = options.webhookSignatureKey;
    this.#webhookUrl = options.webhookUrl;
    this.#apiVersion = options.apiVersion ?? SQUARE_API_VERSION;
    this.#fetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  toJSON() {
    return { name: this.name, configured: true, environment: this.environment };
  }

  private async call<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: Json): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.#accessToken}`, 'square-version': this.#apiVersion, accept: 'application/json' };
    if (body) headers['content-type'] = 'application/json';
    const res = await this.#fetch(`${HOSTS[this.environment]}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20_000) });
    const json = (await res.json().catch(() => ({}))) as T & { errors?: SquareError[]; payment?: { id?: string } };
    if (!res.ok || json.errors?.length) {
      const first = json.errors?.[0] ?? {};
      const declined = first.category === 'PAYMENT_METHOD_ERROR';
      // Un refus de carte garde l'identifiant du paiement en échec que Square a créé (rapprochement avec son tableau de bord).
      throw new AppError(declined ? 'PAYMENT_DECLINED' : 'PAYMENT_PROVIDER_ERROR', first.detail ?? `Square ${res.status}`, declined ? 402 : 502, {
        code: first.code?.toLowerCase() ?? null, category: first.category ?? null, field: first.field ?? null, paymentId: json.payment?.id ?? null,
      });
    }
    return json;
  }

  /** Un refus de carte n'est pas une panne : il devient un échec typé avec le code de Square. */
  private async payment(body: Json): Promise<PaymentAuthorization> {
    try {
      const { payment } = await this.call<{ payment: SquarePayment }>('POST', '/v2/payments', body);
      return authorizationOf(payment);
    } catch (error) {
      if (error instanceof AppError && error.code === 'PAYMENT_DECLINED') {
        const details = error.details as { code: string | null; paymentId: string | null };
        return { intentId: details.paymentId ?? '', status: 'failed', failureCode: details.code ?? 'card_declined' };
      }
      throw error;
    }
  }

  private async getPayment(paymentId: string): Promise<SquarePayment> {
    const { payment } = await this.call<{ payment: SquarePayment }>('GET', `/v2/payments/${encodeURIComponent(paymentId)}`);
    return payment;
  }

  // --- Clients et cartes ---

  ownsCustomerRef(customerRef: string): boolean {
    return customerRef.length > 0 && !customerRef.startsWith('cus_');
  }

  /** Client Square de l'utilisateur : retrouvé par `reference_id` (notre identifiant) s'il existe déjà, sinon créé. */
  async createCustomer(input: { externalId: string; email?: string; phone?: string }) {
    const found = await this.call<{ customers?: Array<{ id: string }> }>('POST', '/v2/customers/search', { limit: 1, query: { filter: { reference_id: { exact: input.externalId } } } });
    const existing = found.customers?.[0];
    if (existing) return { customerRef: existing.id };
    const phone = input.phone && /^\+\d{8,15}$/.test(input.phone) ? input.phone : undefined;
    const { customer } = await this.call<{ customer: { id: string } }>('POST', '/v2/customers', {
      idempotency_key: squareIdempotencyKey(`customer:${input.externalId}`), reference_id: input.externalId, ...(input.email ? { email_address: input.email } : {}), ...(phone ? { phone_number: phone } : {}), note: 'Neomoov',
    });
    return { customerRef: customer.id };
  }

  createSetupIntent(): Promise<{ setupIntentId: string; clientSecret: string }> {
    return Promise.reject(new AppError('SETUP_INTENT_UNAVAILABLE', 'Square enregistre les cartes par jeton de carte (page de saisie), pas par SetupIntent', 501));
  }

  retrieveSetupIntent(): Promise<SetupIntentResult> {
    return Promise.reject(new AppError('SETUP_INTENT_UNAVAILABLE', 'Square enregistre les cartes par jeton de carte (page de saisie), pas par SetupIntent', 501));
  }

  /** Carte enregistrée chez Square à partir du jeton du Web Payments SDK ; le numéro ne transite jamais par l'API. */
  async saveCard(input: { customerRef: string; sourceId: string; verificationToken?: string; idempotencyKey: string; externalId: string }): Promise<CardDetails> {
    const { card } = await this.call<{ card: SquareCard }>('POST', '/v2/cards', {
      idempotency_key: squareIdempotencyKey(input.idempotencyKey), source_id: input.sourceId, ...(input.verificationToken ? { verification_token: input.verificationToken } : {}),
      card: { customer_id: input.customerRef, reference_id: input.externalId.slice(0, 128) },
    });
    return cardOf(card);
  }

  async detachPaymentMethod(paymentMethodRef: string) {
    await this.call('POST', `/v2/cards/${encodeURIComponent(paymentMethodRef)}/disable`);
  }

  // --- Paiements ---

  /** Empreinte (autorisation à capture différée) sur la carte enregistrée ; Square l'annule de lui-même après 7 jours. */
  authorize(input: Parameters<PaymentProvider['authorize']>[0]) {
    return this.payment({
      idempotency_key: squareIdempotencyKey(input.idempotencyKey), source_id: input.paymentMethodRef, customer_id: input.customerRef, location_id: this.locationId,
      amount_money: { amount: input.amountCents, currency: input.currency }, autocomplete: false, delay_action: AUTHORIZATION_DELAY_ACTION,
      ...(input.metadata?.['ride_id'] ? { reference_id: input.metadata['ride_id'].slice(0, 40) } : input.metadata?.['quote_id'] ? { reference_id: input.metadata['quote_id'].slice(0, 40) } : {}),
      note: `Neomoov${input.metadata?.['public_number'] ? ` ${input.metadata['public_number']}` : ''}`,
    });
  }

  /**
   * Montant d'une empreinte baissé avant sa complétion (`UpdatePayment`), quand Square le permet : le client n'est débité
   * que du montant final, sans remboursement. Un refus de Square n'est pas bloquant : la capture se replie sur la
   * complétion du montant autorisé suivie du remboursement de la différence.
   */
  private async reduce(payment: SquarePayment, amountCents: number): Promise<SquarePayment> {
    const approved = money(payment.amount_money) ?? 0;
    if (amountCents <= 0 || amountCents >= approved || !payment.capabilities?.includes('EDIT_AMOUNT_DOWN')) return payment;
    try {
      const { payment: updated } = await this.call<{ payment: SquarePayment }>('PUT', `/v2/payments/${encodeURIComponent(payment.id)}`, {
        idempotency_key: squareIdempotencyKey(`reduce:${payment.id}:${amountCents}`), payment: { amount_money: { amount: amountCents, currency: CURRENCY } },
      });
      return updated;
    } catch (error) {
      if (error instanceof AppError) return payment;
      throw error;
    }
  }

  /**
   * Capture plafonnée au montant final. Square ne complète pas un montant inférieur à l'empreinte : le montant est baissé
   * d'abord quand Square le permet, sinon le paiement est complété pour le montant autorisé puis la différence est
   * remboursée aussitôt. Rejouable : un paiement déjà complété n'est pas recomplété, la différence déjà remboursée ne
   * l'est pas deux fois (montant net relu ; clé d'idempotence fixée par le paiement et le montant final, pas par la tentative).
   */
  async capture(intentId: string, amountCents: number, _idempotencyKey: string): Promise<PaymentAuthorization> {
    let payment: SquarePayment;
    try {
      payment = await this.getPayment(intentId);
      if (payment.status === 'APPROVED') {
        payment = await this.reduce(payment, amountCents);
        payment = (await this.call<{ payment: SquarePayment }>('POST', `/v2/payments/${encodeURIComponent(intentId)}/complete`, {})).payment;
      }
    } catch (error) {
      if (error instanceof AppError) return { intentId, status: 'failed', failureCode: (error.details as { code?: string | null } | undefined)?.code ?? error.code.toLowerCase() };
      throw error;
    }
    if (payment.status !== 'COMPLETED') return { intentId, status: 'failed', failureCode: failureCodeOf(payment.card_details?.errors, `payment_${String(payment.status).toLowerCase()}`) };
    const excess = netReceived(payment) - amountCents;
    if (excess > 0) {
      // Sans remboursement de la différence, le client serait débité du montant autorisé : l'erreur est rendue (la tâche est
      // reprise ; une nouvelle tentative relit le montant déjà rendu).
      await this.call('POST', '/v2/refunds', {
        idempotency_key: squareIdempotencyKey(`adjust:${intentId}:${amountCents}`), payment_id: intentId, amount_money: { amount: excess, currency: CURRENCY }, reason: 'Ajustement au montant final de la course (Neomoov)',
      });
    }
    return { intentId, status: 'captured' };
  }

  /** Annulation de l'empreinte ; une empreinte déjà annulée (par nous ou par le délai de Square) ne gêne pas. */
  async cancel(intentId: string) {
    const payment = await this.getPayment(intentId);
    if (payment.status === 'CANCELED') return;
    if (payment.status === 'COMPLETED') throw new AppError('PAYMENT_ALREADY_CAPTURED', 'Ce paiement est déjà encaissé : passer par un remboursement', 409);
    await this.call('POST', `/v2/payments/${encodeURIComponent(intentId)}/cancel`, {});
  }

  async refund(input: { intentId: string; amountCents: number; idempotencyKey: string; reason?: string }) {
    const { refund } = await this.call<{ refund: SquareRefund }>('POST', '/v2/refunds', {
      idempotency_key: squareIdempotencyKey(input.idempotencyKey), payment_id: input.intentId, amount_money: { amount: input.amountCents, currency: CURRENCY }, ...(input.reason ? { reason: input.reason.slice(0, 192) } : {}),
    });
    return { refundId: refund.id, status: refundStatusOf(refund.status) };
  }

  /** Paiement direct (pourboire, frais, solde dû, prélèvement d'un chauffeur) : complété tout de suite. */
  chargeOffSession(input: Parameters<PaymentProvider['chargeOffSession']>[0]) {
    return this.payment({
      idempotency_key: squareIdempotencyKey(input.idempotencyKey), source_id: input.paymentMethodRef, customer_id: input.customerRef, location_id: this.locationId,
      amount_money: { amount: input.amountCents, currency: CURRENCY }, autocomplete: true, note: input.description.slice(0, 500),
      ...(input.metadata?.['ride_id'] ? { reference_id: input.metadata['ride_id'].slice(0, 40) } : input.metadata?.['statement_id'] ? { reference_id: input.metadata['statement_id'].slice(0, 40) } : {}),
    });
  }

  // --- Webhooks ---

  async verifyWebhook(rawBody: string | Buffer, signature: string): Promise<WebhookEvent> {
    if (!this.#signatureKey || !this.#webhookUrl) throw new AppError('PROVIDER_NOT_CONFIGURED', 'SQUARE_WEBHOOK_SIGNATURE_KEY ou SQUARE_WEBHOOK_URL absente', 501);
    const payload = rawBody.toString();
    if (!verifySquareSignature(this.#signatureKey, this.#webhookUrl, payload, signature)) throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Signature de webhook invalide', 400);
    let event: SquareEvent;
    try {
      event = JSON.parse(payload) as SquareEvent;
    } catch {
      throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Notification Square illisible', 400);
    }
    if (!event?.event_id || !event.type) throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Notification Square incomplète', 400);
    return normalizeSquareEvent(event);
  }

  // --- Versements aux chauffeurs : aucun équivalent de Connect chez Square ---

  private connectUnavailable(): AppError {
    return new AppError('CONNECT_UNAVAILABLE', 'Les versements par la plateforme ne sont pas disponibles avec Square : les relevés sont réglés par virement ou Interac', 409);
  }

  createConnectAccount(): Promise<{ accountRef: string }> {
    return Promise.reject(this.connectUnavailable());
  }

  createConnectOnboardingLink(): Promise<{ url: string; expiresAt: Date }> {
    return Promise.reject(this.connectUnavailable());
  }

  async connectAccountStatus() {
    return { onboarded: false, payoutsEnabled: false };
  }

  transfer(): Promise<{ transferId: string }> {
    return Promise.reject(this.connectUnavailable());
  }
}
