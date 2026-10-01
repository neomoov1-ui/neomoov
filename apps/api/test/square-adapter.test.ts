/**
 * Adaptateur Square réel (étape 26), sans réseau : un faux `fetch` répond par méthode et chemin et enregistre chaque
 * requête. Client, carte par jeton, empreinte, capture (baisse du montant ou complétion plus remboursement de la
 * différence, rejouable), annulation, remboursements, paiement direct, signature et traduction des webhooks.
 */
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { normalizeSquareEvent, SQUARE_API_VERSION, squareIdempotencyKey, SquarePaymentProvider, squareSignature, verifySquareSignature } from '../src/adapters/real/square.js';

interface Recorded {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}
type Reply = { status?: number; json: unknown };
type Route = Reply | ((body: Record<string, unknown> | null, calls: Recorded[]) => Reply);

/** Faux `fetch` : réponse préparée pour « MÉTHODE /chemin » (la dernière réponse d'une liste est rejouée). */
function fakeFetch(routes: Record<string, Route | Route[]>) {
  const calls: Recorded[] = [];
  const seen = new Map<string, number>();
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ method, path: url.pathname, headers: init?.headers as Record<string, string>, body });
    const routeKey = `${method} ${url.pathname}`;
    const entry = routes[routeKey];
    const index = seen.get(routeKey) ?? 0;
    seen.set(routeKey, index + 1);
    const route = Array.isArray(entry) ? entry[Math.min(index, entry.length - 1)] : entry;
    const reply = typeof route === 'function' ? route(body, calls) : (route ?? { status: 404, json: { errors: [{ category: 'INVALID_REQUEST_ERROR', code: 'NOT_FOUND', detail: routeKey }] } });
    return new Response(JSON.stringify(reply.json), { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, impl };
}

const TOKEN = 'EAAA-jeton-de-test-jamais-reel';
const provider = (impl: typeof fetch, extra: Partial<ConstructorParameters<typeof SquarePaymentProvider>[0]> = {}) =>
  new SquarePaymentProvider({ accessToken: TOKEN, locationId: 'LTEST123', environment: 'sandbox', fetchImpl: impl, ...extra });
const payment = (fields: Record<string, unknown>) => ({ json: { payment: { id: 'pay_1', ...fields } } });

describe('adaptateur Square réel (sans réseau)', () => {
  it('capacités : pas de SetupIntent ni de Connect, carte par jeton ; le jeton d\'accès n\'est jamais énuméré', () => {
    const square = provider(fakeFetch({}).impl);
    expect(square.name).toBe('square');
    expect(square.capabilities).toEqual({ setupIntent: false, cardToken: true, connect: false });
    expect(JSON.stringify(square)).not.toContain(TOKEN);
    expect(inspect(square, { depth: 5 })).not.toContain(TOKEN);
    expect(square.ownsCustomerRef('CUSTOMER123')).toBe(true);
    expect(square.ownsCustomerRef('cus_mock_abc')).toBe(false);
    expect(square.ownsCustomerRef('cus_stripe')).toBe(false);
  });

  it('clés d\'idempotence : courtes gardées telles quelles, longues condensées de façon déterministe (45 caractères au plus)', () => {
    expect(squareIdempotencyKey('ride-auth:abc')).toBe('ride-auth:abc');
    const long = `capture:${'a'.repeat(36)}:${'b'.repeat(36)}:1`;
    const short = squareIdempotencyKey(long);
    expect(short.length).toBeLessThanOrEqual(45);
    expect(squareIdempotencyKey(long)).toBe(short);
    expect(squareIdempotencyKey(`${long}x`)).not.toBe(short);
  });

  it('client : retrouvé par notre identifiant (reference_id), sinon créé avec une clé d\'idempotence ; en-têtes Square', async () => {
    const found = fakeFetch({ 'POST /v2/customers/search': { json: { customers: [{ id: 'CUST_EXISTING' }] } } });
    expect(await provider(found.impl).createCustomer({ externalId: 'user-1', email: 'a@test.neomoov.local' })).toEqual({ customerRef: 'CUST_EXISTING' });
    expect(found.calls).toHaveLength(1);
    expect(found.calls[0]!.body).toMatchObject({ query: { filter: { reference_id: { exact: 'user-1' } } } });
    expect(found.calls[0]!.headers).toMatchObject({ authorization: `Bearer ${TOKEN}`, 'square-version': SQUARE_API_VERSION, 'content-type': 'application/json' });

    const created = fakeFetch({ 'POST /v2/customers/search': { json: {} }, 'POST /v2/customers': { json: { customer: { id: 'CUST_NEW' } } } });
    expect(await provider(created.impl).createCustomer({ externalId: 'user-2', phone: '+15145550000', email: 'b@test.neomoov.local' })).toEqual({ customerRef: 'CUST_NEW' });
    expect(created.calls[1]!.body).toMatchObject({ idempotency_key: 'customer:user-2', reference_id: 'user-2', email_address: 'b@test.neomoov.local', phone_number: '+15145550000' });
    expect(created.calls[0]!.path).toBe('/v2/customers/search');
  });

  it('carte enregistrée à partir du jeton du Web Payments SDK (avec jeton de vérification), retrait par désactivation', async () => {
    const { calls, impl } = fakeFetch({
      'POST /v2/cards': { json: { card: { id: 'ccof:card1', card_brand: 'VISA', last_4: '1111', exp_month: 9, exp_year: 2031 } } },
      'POST /v2/cards/ccof:card1/disable': { json: { card: { id: 'ccof:card1', enabled: false } } },
    });
    const square = provider(impl);
    const card = await square.saveCard({ customerRef: 'CUST_1', sourceId: 'cnon:abc', verificationToken: 'verf:xyz', idempotencyKey: 'card:k1', externalId: 'user-1' });
    expect(card).toEqual({ ref: 'ccof:card1', brand: 'visa', last4: '1111', expMonth: 9, expYear: 2031 });
    expect(calls[0]!.body).toEqual({ idempotency_key: 'card:k1', source_id: 'cnon:abc', verification_token: 'verf:xyz', card: { customer_id: 'CUST_1', reference_id: 'user-1' } });
    await square.detachPaymentMethod('ccof:card1');
    expect(calls[1]).toMatchObject({ method: 'POST', path: '/v2/cards/ccof:card1/disable' });
    // Square enregistre les cartes par jeton : un SetupIntent est refusé (501), jamais simulé.
    await expect(square.createSetupIntent()).rejects.toMatchObject({ code: 'SETUP_INTENT_UNAVAILABLE', status: 501 });
    await expect(square.retrieveSetupIntent()).rejects.toMatchObject({ code: 'SETUP_INTENT_UNAVAILABLE', status: 501 });
  });

  it('empreinte : paiement non complété (autocomplete faux, délai par défaut de Square, annulation à l\'échéance), en CAD sur l\'emplacement', async () => {
    const { calls, impl } = fakeFetch({ 'POST /v2/payments': payment({ status: 'APPROVED', amount_money: { amount: 5_750, currency: 'CAD' } }) });
    const auth = await provider(impl).authorize({ amountCents: 5_750, currency: 'CAD', customerRef: 'CUST_1', paymentMethodRef: 'ccof:card1', idempotencyKey: 'ride-auth:k1', metadata: { ride_id: 'ride-1', public_number: 'NM-1' } });
    expect(auth).toEqual({ intentId: 'pay_1', status: 'authorized' });
    expect(calls[0]!.body).toMatchObject({
      idempotency_key: 'ride-auth:k1', source_id: 'ccof:card1', customer_id: 'CUST_1', location_id: 'LTEST123', amount_money: { amount: 5_750, currency: 'CAD' },
      autocomplete: false, delay_action: 'CANCEL', reference_id: 'ride-1', note: 'Neomoov NM-1',
    });
    expect(calls[0]!.body).not.toHaveProperty('delay_duration');
  });

  it('refus de carte : échec typé avec le code de Square et l\'identifiant du paiement refusé ; panne : erreur 502', async () => {
    const declined = fakeFetch({
      'POST /v2/payments': { status: 400, json: { errors: [{ category: 'PAYMENT_METHOD_ERROR', code: 'INSUFFICIENT_FUNDS', detail: 'Refusée' }], payment: { id: 'pay_failed', status: 'FAILED' } } },
    });
    expect(await provider(declined.impl).authorize({ amountCents: 100, currency: 'CAD', customerRef: 'c', paymentMethodRef: 'p', idempotencyKey: 'k' })).toEqual({ intentId: 'pay_failed', status: 'failed', failureCode: 'insufficient_funds' });
    const down = fakeFetch({ 'POST /v2/customers/search': { status: 500, json: { errors: [{ category: 'API_ERROR', code: 'INTERNAL_SERVER_ERROR' }] } } });
    await expect(provider(down.impl).createCustomer({ externalId: 'u' })).rejects.toMatchObject({ code: 'PAYMENT_PROVIDER_ERROR', status: 502 });
    const badCard = fakeFetch({ 'POST /v2/cards': { status: 400, json: { errors: [{ category: 'PAYMENT_METHOD_ERROR', code: 'CVV_FAILURE' }] } } });
    await expect(provider(badCard.impl).saveCard({ customerRef: 'c', sourceId: 'cnon:x', idempotencyKey: 'k', externalId: 'u' })).rejects.toMatchObject({ code: 'PAYMENT_DECLINED', status: 402, details: { code: 'cvv_failure' } });
  });

  it('capture : montant baissé avant complétion quand Square le permet (aucun remboursement)', async () => {
    const { calls, impl } = fakeFetch({
      'GET /v2/payments/pay_1': payment({ status: 'APPROVED', amount_money: { amount: 5_750, currency: 'CAD' }, capabilities: ['EDIT_AMOUNT_UP', 'EDIT_AMOUNT_DOWN'] }),
      'PUT /v2/payments/pay_1': payment({ status: 'APPROVED', amount_money: { amount: 4_500, currency: 'CAD' } }),
      'POST /v2/payments/pay_1/complete': payment({ status: 'COMPLETED', amount_money: { amount: 4_500 }, total_money: { amount: 4_500 } }),
    });
    expect(await provider(impl).capture('pay_1', 4_500, 'capture:p1:1')).toEqual({ intentId: 'pay_1', status: 'captured' });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /v2/payments/pay_1', 'PUT /v2/payments/pay_1', 'POST /v2/payments/pay_1/complete']);
    expect(calls[1]!.body).toEqual({ idempotency_key: 'reduce:pay_1:4500', payment: { amount_money: { amount: 4_500, currency: 'CAD' } } });
  });

  it('capture : sans baisse possible, complétion puis remboursement immédiat de la différence ; rejouée, rien n\'est refait', async () => {
    const approved = payment({ status: 'APPROVED', amount_money: { amount: 5_750 }, capabilities: [] });
    const completed = payment({ status: 'COMPLETED', amount_money: { amount: 5_750 }, total_money: { amount: 5_750 } });
    const adjusted = payment({ status: 'COMPLETED', amount_money: { amount: 5_750 }, total_money: { amount: 5_750 }, refunded_money: { amount: 1_250 } });
    const { calls, impl } = fakeFetch({
      'GET /v2/payments/pay_1': [approved, adjusted],
      'POST /v2/payments/pay_1/complete': completed,
      'POST /v2/refunds': { json: { refund: { id: 'ref_adj', status: 'PENDING', payment_id: 'pay_1', amount_money: { amount: 1_250 } } } },
    });
    const square = provider(impl);
    expect(await square.capture('pay_1', 4_500, 'capture:p1:1')).toEqual({ intentId: 'pay_1', status: 'captured' });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /v2/payments/pay_1', 'POST /v2/payments/pay_1/complete', 'POST /v2/refunds']);
    expect(calls[2]!.body).toMatchObject({ idempotency_key: 'adjust:pay_1:4500', payment_id: 'pay_1', amount_money: { amount: 1_250, currency: 'CAD' } });
    // Nouvelle tentative (autre clé de tentative) : paiement déjà complété et différence déjà rendue, aucun appel d'écriture.
    expect(await square.capture('pay_1', 4_500, 'capture:p1:2')).toEqual({ intentId: 'pay_1', status: 'captured' });
    expect(calls.slice(3).map((c) => `${c.method} ${c.path}`)).toEqual(['GET /v2/payments/pay_1']);
  });

  it('capture : refus de Square à la baisse du montant, repli sur complétion plus remboursement ; échec de complétion rendu typé', async () => {
    const fallback = fakeFetch({
      'GET /v2/payments/pay_1': payment({ status: 'APPROVED', amount_money: { amount: 3_000 }, capabilities: ['EDIT_AMOUNT_DOWN'] }),
      'PUT /v2/payments/pay_1': { status: 400, json: { errors: [{ category: 'INVALID_REQUEST_ERROR', code: 'BAD_REQUEST' }] } },
      'POST /v2/payments/pay_1/complete': payment({ status: 'COMPLETED', total_money: { amount: 3_000 } }),
      'POST /v2/refunds': { json: { refund: { id: 'ref_2', status: 'PENDING' } } },
    });
    expect((await provider(fallback.impl).capture('pay_1', 2_000, 'k')).status).toBe('captured');
    expect(fallback.calls.at(-1)!.body).toMatchObject({ amount_money: { amount: 1_000 } });

    const expired = fakeFetch({ 'GET /v2/payments/pay_1': payment({ status: 'CANCELED', amount_money: { amount: 3_000 } }) });
    expect(await provider(expired.impl).capture('pay_1', 2_000, 'k')).toEqual({ intentId: 'pay_1', status: 'failed', failureCode: 'payment_canceled' });
    const refused = fakeFetch({
      'GET /v2/payments/pay_1': payment({ status: 'APPROVED', amount_money: { amount: 3_000 } }),
      'POST /v2/payments/pay_1/complete': { status: 400, json: { errors: [{ category: 'PAYMENT_METHOD_ERROR', code: 'GENERIC_DECLINE' }] } },
    });
    expect(await provider(refused.impl).capture('pay_1', 3_000, 'k')).toEqual({ intentId: 'pay_1', status: 'failed', failureCode: 'generic_decline' });
  });

  it('annulation de l\'empreinte : annulée une fois, sans effet si déjà annulée, refusée si déjà encaissée', async () => {
    const { calls, impl } = fakeFetch({
      'GET /v2/payments/pay_1': [payment({ status: 'APPROVED' }), payment({ status: 'CANCELED' }), payment({ status: 'COMPLETED' })],
      'POST /v2/payments/pay_1/cancel': payment({ status: 'CANCELED' }),
    });
    const square = provider(impl);
    await square.cancel('pay_1');
    await square.cancel('pay_1');
    await expect(square.cancel('pay_1')).rejects.toMatchObject({ code: 'PAYMENT_ALREADY_CAPTURED', status: 409 });
    expect(calls.filter((c) => c.path.endsWith('/cancel'))).toHaveLength(1);
  });

  it('remboursement partiel avec motif et clé d\'idempotence ; état traduit', async () => {
    const { calls, impl } = fakeFetch({ 'POST /v2/refunds': [{ json: { refund: { id: 'ref_1', status: 'PENDING' } } }, { json: { refund: { id: 'ref_1', status: 'COMPLETED' } } }] });
    const square = provider(impl);
    expect(await square.refund({ intentId: 'pay_1', amountCents: 700, idempotencyKey: 'refund:ride-1:abc', reason: 'Détour' })).toEqual({ refundId: 'ref_1', status: 'pending' });
    expect(calls[0]!.body).toEqual({ idempotency_key: 'refund:ride-1:abc', payment_id: 'pay_1', amount_money: { amount: 700, currency: 'CAD' }, reason: 'Détour' });
    expect(await square.refund({ intentId: 'pay_1', amountCents: 700, idempotencyKey: 'refund:ride-1:abc' })).toEqual({ refundId: 'ref_1', status: 'succeeded' });
  });

  it('paiement direct (pourboire, frais, solde dû) : complété tout de suite', async () => {
    const { calls, impl } = fakeFetch({ 'POST /v2/payments': payment({ status: 'COMPLETED', total_money: { amount: 500 } }) });
    expect(await provider(impl).chargeOffSession({ amountCents: 500, customerRef: 'CUST_1', paymentMethodRef: 'ccof:card1', idempotencyKey: 'tip:ride-1', description: 'Pourboire', metadata: { ride_id: 'ride-1' } })).toEqual({ intentId: 'pay_1', status: 'captured' });
    expect(calls[0]!.body).toMatchObject({ autocomplete: true, amount_money: { amount: 500, currency: 'CAD' }, note: 'Pourboire', reference_id: 'ride-1', idempotency_key: 'tip:ride-1' });
  });

  it('Connect absent : versements refusés en 409 CONNECT_UNAVAILABLE, état du compte jamais ouvert', async () => {
    const square = provider(fakeFetch({}).impl);
    await expect(square.createConnectAccount()).rejects.toMatchObject({ code: 'CONNECT_UNAVAILABLE', status: 409 });
    await expect(square.createConnectOnboardingLink()).rejects.toMatchObject({ code: 'CONNECT_UNAVAILABLE', status: 409 });
    await expect(square.transfer()).rejects.toMatchObject({ code: 'CONNECT_UNAVAILABLE', status: 409 });
    expect(await square.connectAccountStatus()).toEqual({ onboarded: false, payoutsEnabled: false });
  });

  describe('webhooks', () => {
    const URL_ = 'https://api.neomoov.test/v1/webhooks/square';
    const KEY = 'cle-de-signature-de-test';
    const event = { merchant_id: 'M1', type: 'payment.updated', event_id: 'evt-1', data: { type: 'payment', id: 'pay_1', object: { payment: { id: 'pay_1', status: 'COMPLETED', total_money: { amount: 5_750 }, refunded_money: { amount: 1_250 } } } } };

    it('signature HMAC-SHA256 de l\'adresse et du corps brut : valide acceptée et traduite, altérée ou absente refusée', async () => {
      const square = provider(fakeFetch({}).impl, { webhookSignatureKey: KEY, webhookUrl: URL_ });
      const raw = JSON.stringify(event);
      const signature = squareSignature(KEY, URL_, raw);
      expect(verifySquareSignature(KEY, URL_, raw, signature)).toBe(true);
      const verified = await square.verifyWebhook(Buffer.from(raw), signature);
      expect(verified).toMatchObject({ id: 'evt-1', type: 'payment_intent.succeeded', data: { object: { id: 'pay_1', amount_received: 4_500 } } });
      expect(verified.raw).toEqual(event);

      await expect(square.verifyWebhook(Buffer.from(raw.replace('5750', '9999')), signature)).rejects.toMatchObject({ code: 'WEBHOOK_SIGNATURE_INVALID', status: 400 });
      await expect(square.verifyWebhook(Buffer.from(raw), squareSignature(KEY, 'https://autre.test/v1/webhooks/square', raw))).rejects.toMatchObject({ code: 'WEBHOOK_SIGNATURE_INVALID' });
      await expect(square.verifyWebhook(Buffer.from(raw), squareSignature('autre-cle', URL_, raw))).rejects.toMatchObject({ code: 'WEBHOOK_SIGNATURE_INVALID' });
      await expect(square.verifyWebhook(Buffer.from(raw), '')).rejects.toMatchObject({ code: 'WEBHOOK_SIGNATURE_INVALID' });
      expect(verifySquareSignature(KEY, URL_, raw, undefined)).toBe(false);
      const garbage = 'pas du json';
      await expect(square.verifyWebhook(Buffer.from(garbage), squareSignature(KEY, URL_, garbage))).rejects.toMatchObject({ code: 'WEBHOOK_SIGNATURE_INVALID', status: 400 });
    });

    it('sans clé de signature ni adresse : point de réception non configuré (501)', async () => {
      await expect(provider(fakeFetch({}).impl).verifyWebhook(Buffer.from('{}'), 'x')).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED', status: 501 });
    });

    it('traduction des événements dans le vocabulaire interne (même transitions que Stripe)', () => {
      const of = (type: string, object: Record<string, unknown>) => normalizeSquareEvent({ type, event_id: `evt-${type}`, data: { object } });
      expect(of('payment.updated', { payment: { id: 'p', status: 'APPROVED', approved_money: { amount: 900 } } })).toMatchObject({ type: 'payment_intent.amount_capturable_updated', data: { object: { id: 'p', amount_capturable: 900 } } });
      expect(of('payment.updated', { payment: { id: 'p', status: 'CANCELED' } })).toMatchObject({ type: 'payment_intent.canceled' });
      expect(of('payment.updated', { payment: { id: 'p', status: 'FAILED', card_details: { errors: [{ code: 'CARD_EXPIRED' }] } } })).toMatchObject({ type: 'payment_intent.payment_failed', data: { object: { last_payment_error: { code: 'card_expired' } } } });
      expect(of('payment.completed', { payment: { id: 'p', status: 'COMPLETED', amount_money: { amount: 300 } } })).toMatchObject({ type: 'payment_intent.succeeded', data: { object: { amount_received: 300 } } });
      expect(of('refund.updated', { refund: { id: 'r', status: 'COMPLETED', payment_id: 'p', amount_money: { amount: 100 } } })).toMatchObject({ type: 'refund.updated', data: { object: { id: 'r', status: 'succeeded', payment_intent: 'p' } } });
      expect(of('refund.updated', { refund: { id: 'r', status: 'REJECTED' } })).toMatchObject({ data: { object: { status: 'failed' } } });
      expect(of('refund.created', { refund: { id: 'r', status: 'PENDING' } })).toMatchObject({ type: 'refund.updated', data: { object: { status: 'pending' } } });
      expect(of('card.disabled', { card: { id: 'ccof:1' } })).toMatchObject({ type: 'payment_method.detached', data: { object: { id: 'ccof:1' } } });
      expect(of('dispute.created', { dispute: { id: 'd', reason: 'FRAUD', amount_money: { amount: 4_000 }, disputed_payment: { payment_id: 'p' } } })).toMatchObject({ type: 'charge.dispute.created', data: { object: { payment_intent: 'p', amount: 4_000 } } });
      expect(of('customer.created', { customer: { id: 'c' } })).toMatchObject({ type: 'customer.created' });
    });
  });
});
