/**
 * Étape 25 : adaptateur Stripe Billing réel, testé avec un faux `fetch` (le compte Stripe de Neomoov n'est pas encore
 * validé), et simulateur de la facturation (idempotence, échec de paiement, signature, panne). Aucun réseau, aucune base.
 */
import { describe, expect, it } from 'vitest';
import type { BillingInvoiceInput } from '../src/adapters/billing.types.js';
import { MockBillingProvider } from '../src/adapters/mock/billing.mock.js';
import { StripeBillingProvider } from '../src/adapters/real/stripe-billing.real.js';
import { stripeSignature } from '../src/adapters/real/stripe.js';
import { AppError } from '../src/common/app-error.js';

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: URLSearchParams;
}

/** Faux `fetch` : chaque requête prend la prochaine réponse prévue pour sa méthode et son chemin. */
function fakeStripe(routes: Array<{ method: string; path: string; status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const path = new URL(url).pathname;
    calls.push({ method, url, headers: init?.headers as Record<string, string>, body: new URLSearchParams(typeof init?.body === 'string' ? init.body : '') });
    const index = routes.findIndex((r) => r.method === method && r.path === path);
    if (index < 0) throw new Error(`Appel inattendu : ${method} ${path}`);
    const [route] = routes.splice(index, 1);
    return new Response(JSON.stringify(route!.body), { status: route!.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const NOW = Date.parse('2026-10-01T12:00:00Z');
const invoiceInput = (over: Partial<BillingInvoiceInput> = {}): BillingInvoiceInput => ({
  platformInvoiceId: '11111111-1111-4111-8111-111111111111', number: 'PF-2026-000001', organizationId: '22222222-2222-4222-8222-222222222222', customerId: 'cus_123',
  lines: [{ label: 'Frais d\'installation, formule Pro', amountCents: 150_000 }, { label: 'Abonnement mensuel, formule Pro', amountCents: 19_900 }],
  taxes: [{ label: 'TPS (5 %)', amountCents: 8_495 }, { label: 'TVQ (9,975 %)', amountCents: 16_948 }],
  totalCents: 195_343, currency: 'CAD', issuedAt: new Date(NOW), dueAt: new Date(NOW), taxNumbers: { gst: '123456789 RT0001', qst: null }, ...over,
});

describe('adaptateur Stripe Billing réel (faux fetch)', () => {
  it('client : formulaire, clé d\'idempotence par organisation, version d\'API, jamais la clé dans le journal', async () => {
    const { calls, fetchImpl } = fakeStripe([{ method: 'POST', path: '/v1/customers', body: { id: 'cus_123' } }]);
    const provider = new StripeBillingProvider('sk_test_secret', 'whsec_x', fetchImpl, () => NOW);
    expect(await provider.createCustomer({ organizationId: 'org-1', name: 'Taxi Laval inc.', email: 'proprio@test.neomoov.local', language: 'fr' })).toEqual({ customerId: 'cus_123' });
    const call = calls[0]!;
    expect(call.headers).toMatchObject({ authorization: 'Bearer sk_test_secret', 'stripe-version': '2024-06-20', 'idempotency-key': 'platform-customer:org-1', 'content-type': 'application/x-www-form-urlencoded' });
    expect(Object.fromEntries(call.body)).toEqual({ name: 'Taxi Laval inc.', email: 'proprio@test.neomoov.local', 'preferred_locales[0]': 'fr-CA', 'metadata[neomoov_organization_id]': 'org-1' });
    expect(JSON.stringify(provider)).not.toContain('sk_test_secret');
    expect(provider.name).toBe('stripe');
  });

  it('abonnement : formule, période et statut en métadonnées du client', async () => {
    const { calls, fetchImpl } = fakeStripe([{ method: 'POST', path: '/v1/customers/cus_123', body: { id: 'cus_123' } }]);
    await new StripeBillingProvider('sk', 'whsec', fetchImpl).syncSubscription('cus_123', { organizationId: 'org-1', planCode: 'pro', billingPeriod: 'annual', status: 'past_due' });
    expect(Object.fromEntries(calls[0]!.body)).toEqual({ 'metadata[neomoov_organization_id]': 'org-1', 'metadata[neomoov_plan]': 'pro', 'metadata[neomoov_billing_period]': 'annual', 'metadata[neomoov_subscription_status]': 'past_due' });
  });

  it('facture sans carte enregistrée : brouillon envoyé (send_invoice), une ligne par élément, taxes comprises, puis finalisation', async () => {
    const { calls, fetchImpl } = fakeStripe([
      { method: 'GET', path: '/v1/customers/cus_123', body: { id: 'cus_123', invoice_settings: { default_payment_method: null } } },
      { method: 'POST', path: '/v1/invoices', body: { id: 'in_1', status: 'draft' } },
      ...[0, 1, 2, 3].map(() => ({ method: 'POST', path: '/v1/invoiceitems', body: { id: 'ii' } })),
      { method: 'POST', path: '/v1/invoices/in_1/finalize', body: { id: 'in_1', status: 'open', hosted_invoice_url: 'https://invoice.stripe.com/i/abc' } },
    ]);
    const result = await new StripeBillingProvider('sk', 'whsec', fetchImpl, () => NOW).createInvoice(invoiceInput());
    expect(result).toEqual({ invoiceId: 'in_1', status: 'open', hostedInvoiceUrl: 'https://invoice.stripe.com/i/abc' });
    const create = Object.fromEntries(calls[1]!.body);
    expect(create).toMatchObject({
      customer: 'cus_123', currency: 'cad', auto_advance: 'false', pending_invoice_items_behavior: 'exclude', 'automatic_tax[enabled]': 'false', collection_method: 'send_invoice', days_until_due: '1',
      'custom_fields[0][name]': 'Facture Neomoov', 'custom_fields[0][value]': 'PF-2026-000001', 'custom_fields[1][name]': 'TPS', 'custom_fields[1][value]': '123456789 RT0001',
      'metadata[neomoov_platform_invoice_id]': '11111111-1111-4111-8111-111111111111', 'metadata[neomoov_invoice_number]': 'PF-2026-000001',
    });
    expect(create['custom_fields[2][name]']).toBeUndefined();
    expect(calls[1]!.headers['idempotency-key']).toBe('platform-invoice:11111111-1111-4111-8111-111111111111:send:create');
    const items = calls.filter((c) => c.url.endsWith('/v1/invoiceitems'));
    expect(items.map((c) => [c.body.get('amount'), c.body.get('description'), c.body.get('invoice'), c.headers['idempotency-key']])).toEqual([
      ['150000', 'Frais d\'installation, formule Pro', 'in_1', 'platform-invoice:11111111-1111-4111-8111-111111111111:send:item:0'],
      ['19900', 'Abonnement mensuel, formule Pro', 'in_1', 'platform-invoice:11111111-1111-4111-8111-111111111111:send:item:1'],
      ['8495', 'TPS (5 %)', 'in_1', 'platform-invoice:11111111-1111-4111-8111-111111111111:send:item:2'],
      ['16948', 'TVQ (9,975 %)', 'in_1', 'platform-invoice:11111111-1111-4111-8111-111111111111:send:item:3'],
    ]);
    // Le total chez Stripe est exactement celui de la facture PF.
    expect(items.reduce((sum, c) => sum + Number(c.body.get('amount')), 0)).toBe(195_343);
    expect(Object.fromEntries(calls.at(-1)!.body)).toEqual({ auto_advance: 'true' });
    expect(calls.at(-1)!.headers['idempotency-key']).toBe('platform-invoice:11111111-1111-4111-8111-111111111111:send:finalize');
  });

  it('facture avec carte par défaut : prélèvement automatique, sans délai de paiement ; lignes à zéro omises ; facture déjà payée', async () => {
    const { calls, fetchImpl } = fakeStripe([
      { method: 'GET', path: '/v1/customers/cus_123', body: { invoice_settings: { default_payment_method: 'pm_1' } } },
      { method: 'POST', path: '/v1/invoices', body: { id: 'in_2', status: 'draft' } },
      { method: 'POST', path: '/v1/invoiceitems', body: { id: 'ii' } },
      { method: 'POST', path: '/v1/invoices/in_2/finalize', body: { id: 'in_2', status: 'paid' } },
    ]);
    const result = await new StripeBillingProvider('sk', 'whsec', fetchImpl, () => NOW).createInvoice(invoiceInput({ lines: [{ label: 'Abonnement', amountCents: 4_900 }], taxes: [{ label: 'TPS', amountCents: 0 }, { label: 'TVQ', amountCents: 0 }], totalCents: 4_900, taxNumbers: { gst: null, qst: '1234567890 TQ0001' } }));
    expect(result).toEqual({ invoiceId: 'in_2', status: 'paid', hostedInvoiceUrl: null });
    const create = Object.fromEntries(calls[1]!.body);
    expect(create['collection_method']).toBe('charge_automatically');
    expect(create['days_until_due']).toBeUndefined();
    expect(create['custom_fields[1][name]']).toBe('TVQ');
    expect(calls.filter((c) => c.url.endsWith('/v1/invoiceitems'))).toHaveLength(1);
    // Le mode d'encaissement fait partie de la clé : un nouvel essai après l'ajout d'une carte ne réutilise pas la clé du brouillon envoyé.
    expect(calls[1]!.headers['idempotency-key']).toBe('platform-invoice:11111111-1111-4111-8111-111111111111:auto:create');
  });

  it('délai de paiement tiré des dates de la facture (mêmes paramètres à chaque essai) ; un crédit négatif est transmis', async () => {
    const route = () => [
      { method: 'GET', path: '/v1/customers/cus_123', body: { invoice_settings: {} } },
      { method: 'POST', path: '/v1/invoices', body: { id: 'in_5', status: 'draft' } },
      ...[0, 1, 2].map(() => ({ method: 'POST', path: '/v1/invoiceitems', body: { id: 'ii' } })),
      { method: 'POST', path: '/v1/invoices/in_5/finalize', body: { id: 'in_5', status: 'open' } },
    ];
    const input = invoiceInput({ dueAt: new Date(NOW + 14 * 86_400_000), lines: [{ label: 'Abonnement', amountCents: 19_900 }, { label: 'Crédit commercial', amountCents: -1_000 }], taxes: [{ label: 'TPS', amountCents: 945 }, { label: 'TVQ', amountCents: 0 }], totalCents: 19_845 });
    for (const offset of [0, 3 * 3_600_000]) {
      const { calls, fetchImpl } = fakeStripe(route());
      await new StripeBillingProvider('sk', 'whsec', fetchImpl, () => NOW + offset).createInvoice(input);
      expect(calls[1]!.body.get('days_until_due')).toBe('14');
      const amounts = calls.filter((c) => c.url.endsWith('/v1/invoiceitems')).map((c) => Number(c.body.get('amount')));
      expect(amounts).toEqual([19_900, -1_000, 945]);
      expect(amounts.reduce((a, b) => a + b, 0)).toBe(19_845);
    }
  });

  it('règlement hors plateforme et annulation : relus d\'abord, rejouables', async () => {
    const { calls, fetchImpl } = fakeStripe([
      { method: 'GET', path: '/v1/invoices/in_1', body: { id: 'in_1', status: 'open' } },
      { method: 'POST', path: '/v1/invoices/in_1/pay', body: { id: 'in_1', status: 'paid' } },
      { method: 'GET', path: '/v1/invoices/in_1', body: { id: 'in_1', status: 'paid' } },
      { method: 'GET', path: '/v1/invoices/in_2', body: { id: 'in_2', status: 'draft' } },
      { method: 'DELETE', path: '/v1/invoices/in_2', body: { deleted: true } },
      { method: 'GET', path: '/v1/invoices/in_3', body: { id: 'in_3', status: 'uncollectible' } },
      { method: 'POST', path: '/v1/invoices/in_3/void', body: { id: 'in_3', status: 'void' } },
      { method: 'GET', path: '/v1/invoices/in_4', body: { id: 'in_4', status: 'paid' } },
    ]);
    const provider = new StripeBillingProvider('sk', 'whsec', fetchImpl);
    await provider.markPaidOutOfBand('in_1');
    expect(Object.fromEntries(calls[1]!.body)).toEqual({ paid_out_of_band: 'true' });
    expect(calls[1]!.headers['idempotency-key']).toBe('platform-invoice-paid-out-of-band:in_1');
    await provider.markPaidOutOfBand('in_1');
    await provider.voidInvoice('in_2');
    await provider.voidInvoice('in_3');
    await provider.voidInvoice('in_4');
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      'GET /v1/invoices/in_1', 'POST /v1/invoices/in_1/pay', 'GET /v1/invoices/in_1', 'GET /v1/invoices/in_2', 'DELETE /v1/invoices/in_2', 'GET /v1/invoices/in_3', 'POST /v1/invoices/in_3/void', 'GET /v1/invoices/in_4',
    ]);
  });

  it('erreurs de Stripe et réseau en 502 BILLING_PROVIDER_ERROR', async () => {
    const { fetchImpl } = fakeStripe([{ method: 'POST', path: '/v1/customers', status: 400, body: { error: { code: 'parameter_invalid', message: 'Invalid email' } } }]);
    const error = await new StripeBillingProvider('sk', 'whsec', fetchImpl).createCustomer({ organizationId: 'o', name: 'n', email: 'x', language: 'en' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'BILLING_PROVIDER_ERROR', status: 502, details: { status: 400, code: 'parameter_invalid' } });
    const down = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    await expect(new StripeBillingProvider('sk', 'whsec', down).markPaidOutOfBand('in_1')).rejects.toMatchObject({ code: 'BILLING_PROVIDER_ERROR', message: /injoignable/ });
  });

  it('webhook : signature du point de terminaison de la facturation, tolérance de 5 minutes, secret obligatoire', async () => {
    const payload = JSON.stringify({ id: 'evt_1', type: 'invoice.paid', data: { object: { id: 'in_1' } } });
    const t = Math.floor(NOW / 1000);
    const provider = new StripeBillingProvider('sk', 'whsec_billing', fakeStripe([]).fetchImpl, () => NOW);
    await expect(provider.verifyWebhook(payload, `t=${t},v1=${stripeSignature('whsec_billing', payload, t)}`)).resolves.toMatchObject({ id: 'evt_1', type: 'invoice.paid' });
    await expect(provider.verifyWebhook(payload, `t=${t},v1=${stripeSignature('whsec_paiements', payload, t)}`)).rejects.toMatchObject({ code: 'WEBHOOK_SIGNATURE_INVALID', status: 400 });
    await expect(provider.verifyWebhook(payload, `t=${t - 600},v1=${stripeSignature('whsec_billing', payload, t - 600)}`)).rejects.toMatchObject({ code: 'WEBHOOK_SIGNATURE_INVALID' });
    await expect(new StripeBillingProvider('sk', undefined).verifyWebhook(payload, 'x')).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED', status: 501 });
  });
});

describe('facturation simulée', () => {
  it('client unique par organisation, facture unique par facture Neomoov, abonnement en métadonnées', async () => {
    const mock = new MockBillingProvider();
    const a = await mock.createCustomer({ organizationId: '33333333-3333-4333-8333-333333333333', name: 'A', email: null, language: 'fr' });
    expect(a.customerId).toBe('cus_mockb_33333333333343338333');
    expect(await mock.createCustomer({ organizationId: '33333333-3333-4333-8333-333333333333', name: 'A', email: null, language: 'fr' })).toEqual(a);
    await mock.syncSubscription(a.customerId, { organizationId: 'x', planCode: 'pro', billingPeriod: 'monthly', status: 'active' });
    await mock.syncSubscription('cus_inconnu', { organizationId: 'x', planCode: 'pro', billingPeriod: 'monthly', status: 'active' });
    expect([...mock.customers.values()][0]!.subscription).toMatchObject({ planCode: 'pro', status: 'active' });
    const first = await mock.createInvoice(invoiceInput({ customerId: a.customerId }));
    expect(first).toMatchObject({ status: 'open', hostedInvoiceUrl: `https://invoice.stripe.mock/${first.invoiceId}` });
    expect(await mock.createInvoice(invoiceInput({ customerId: a.customerId }))).toEqual(first);
    expect(mock.invoices.size).toBe(1);
  });

  it('échec de paiement simulé, paiement réussi, règlement hors plateforme, annulation', async () => {
    const mock = new MockBillingProvider();
    const { invoiceId } = await mock.createInvoice(invoiceInput());
    const failed = mock.paymentEvent(invoiceId, 'failed', 'insufficient_funds');
    expect(failed).toMatchObject({ type: 'invoice.payment_failed', data: { object: { id: invoiceId, amount_paid: 0, last_payment_error: { decline_code: 'insufficient_funds' }, metadata: { neomoov_invoice_number: 'PF-2026-000001' } } } });
    expect(mock.invoices.get(invoiceId)!.status).toBe('open');
    const paid = mock.paymentEvent(invoiceId, 'paid');
    expect(paid).toMatchObject({ type: 'invoice.paid', data: { object: { status: 'paid', amount_paid: 195_343 } } });
    expect(paid.id).not.toBe(failed.id);
    expect((await mock.createInvoice(invoiceInput())).status).toBe('paid');
    const other = await mock.createInvoice(invoiceInput({ platformInvoiceId: '44444444-4444-4444-8444-444444444444' }));
    await mock.markPaidOutOfBand(other.invoiceId);
    expect(mock.invoices.get(other.invoiceId)).toMatchObject({ status: 'paid', paidOutOfBand: true });
    await mock.voidInvoice(other.invoiceId);
    expect(mock.invoices.get(other.invoiceId)!.status).toBe('paid');
    const third = await mock.createInvoice(invoiceInput({ platformInvoiceId: '55555555-5555-4555-8555-555555555555' }));
    await mock.voidInvoice(third.invoiceId);
    await mock.markPaidOutOfBand(third.invoiceId);
    expect(mock.invoices.get(third.invoiceId)!.status).toBe('void');
    expect(() => mock.paymentEvent('in_inconnue', 'paid')).toThrow(/inconnue/);
  });

  it('signature de test acceptée hors production seulement ; panne simulée en 502', async () => {
    const event = JSON.stringify({ id: 'evt_x', type: 'invoice.paid', data: { object: {} } });
    await expect(new MockBillingProvider().verifyWebhook(event, 'mock-signature')).resolves.toMatchObject({ id: 'evt_x' });
    await expect(new MockBillingProvider().verifyWebhook(event, 'autre')).rejects.toMatchObject({ code: 'WEBHOOK_SIGNATURE_INVALID' });
    await expect(new MockBillingProvider({ acceptTestSignatures: false }).verifyWebhook(event, 'mock-signature')).rejects.toMatchObject({ code: 'WEBHOOK_SIGNATURE_INVALID' });
    const down = new MockBillingProvider();
    down.unavailable = true;
    await expect(down.createCustomer({ organizationId: 'o', name: 'n', email: null, language: 'fr' })).rejects.toMatchObject({ code: 'BILLING_PROVIDER_ERROR', status: 502 });
    await expect(down.createInvoice(invoiceInput())).rejects.toMatchObject({ status: 502 });
    expect(down.calls.map((c) => c.method)).toEqual(['createCustomer', 'createInvoice']);
  });
});
