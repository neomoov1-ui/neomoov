import { describe, expect, it } from 'vitest';
import { encodeForm, StripePaymentProvider, stripeSignature, verifyStripeSignature } from '../src/adapters/real/stripe.js';

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/** Faux `fetch` : enregistre chaque requête et renvoie la réponse préparée pour son chemin. */
function fakeFetch(responses: Record<string, { status?: number; json: unknown }>) {
  const calls: Recorded[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET', headers: init?.headers as Record<string, string>, body: init?.body as string | undefined });
    const path = new URL(url).pathname;
    const match = Object.keys(responses).find((p) => path === p || path.startsWith(`${p}/`)) ?? '';
    const response = responses[match] ?? { status: 404, json: { error: { message: 'inconnu' } } };
    return new Response(JSON.stringify(response.json), { status: response.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, impl };
}

describe('adaptateur Stripe réel (sans réseau)', () => {
  it('encode les paramètres imbriqués comme Stripe', () => {
    expect(encodeForm({ amount: 5750, payment_method_types: ['card'], metadata: { ride_id: 'abc' }, skip: undefined }).join('&')).toBe(
      'amount=5750&payment_method_types%5B0%5D=card&metadata%5Bride_id%5D=abc',
    );
  });

  it('autorise à capture différée avec la clé d\'idempotence et rend l\'état attendu', async () => {
    const { calls, impl } = fakeFetch({ '/v1/payment_intents': { json: { id: 'pi_1', status: 'requires_capture' } } });
    const stripe = new StripePaymentProvider('sk_test_x', 'whsec_x', impl);
    const auth = await stripe.authorize({ amountCents: 5750, currency: 'CAD', customerRef: 'cus_1', paymentMethodRef: 'pm_1', idempotencyKey: 'ride-auth:k1', metadata: { quote_id: 'q1' } });
    expect(auth).toEqual({ intentId: 'pi_1', status: 'authorized' });
    expect(calls[0]!.headers).toMatchObject({ authorization: 'Bearer sk_test_x', 'idempotency-key': 'ride-auth:k1', 'content-type': 'application/x-www-form-urlencoded' });
    expect(calls[0]!.body).toContain('capture_method=manual');
    expect(calls[0]!.body).toContain('currency=cad');
    expect(calls[0]!.body).toContain('metadata%5Bquote_id%5D=q1');
  });

  it('un refus de carte devient un échec typé avec le code de la banque ; une panne de Stripe une erreur 502', async () => {
    const declined = fakeFetch({ '/v1/payment_intents': { status: 402, json: { error: { type: 'card_error', code: 'card_declined', decline_code: 'insufficient_funds', payment_intent: { id: 'pi_2' } } } } });
    const auth = await new StripePaymentProvider('sk_test_x', undefined, declined.impl).authorize({ amountCents: 100, currency: 'CAD', customerRef: 'c', paymentMethodRef: 'p', idempotencyKey: 'k' });
    expect(auth).toEqual({ intentId: 'pi_2', status: 'failed', failureCode: 'insufficient_funds' });
    const down = fakeFetch({ '/v1/customers': { status: 500, json: { error: { type: 'api_error', message: 'panne' } } } });
    await expect(new StripePaymentProvider('sk_test_x', undefined, down.impl).createCustomer({ externalId: 'u1' })).rejects.toMatchObject({ code: 'PAYMENT_PROVIDER_ERROR', status: 502 });
  });

  it('capture partielle, 3-D Secure, SetupIntent relu avec la carte, compte Connect', async () => {
    const { calls, impl } = fakeFetch({
      '/v1/payment_intents': { json: { id: 'pi_3', status: 'succeeded' } },
      '/v1/setup_intents': { json: { id: 'seti_1', status: 'succeeded', customer: 'cus_1', payment_method: { id: 'pm_9', card: { brand: 'visa', last4: '4242', exp_month: 4, exp_year: 2030 } } } },
      '/v1/accounts': { json: { id: 'acct_1', details_submitted: true, payouts_enabled: false } },
    });
    const stripe = new StripePaymentProvider('sk_test_x', undefined, impl);
    expect(await stripe.capture('pi_3', 4500, 'capture:p:1')).toEqual({ intentId: 'pi_3', status: 'captured' });
    expect(calls[0]!.url).toContain('/v1/payment_intents/pi_3/capture');
    expect(calls[0]!.body).toBe('amount_to_capture=4500');
    expect(await stripe.retrieveSetupIntent('seti_1')).toEqual({ setupIntentId: 'seti_1', status: 'succeeded', customerRef: 'cus_1', card: { ref: 'pm_9', brand: 'visa', last4: '4242', expMonth: 4, expYear: 2030 } });
    expect(calls[1]!.url).toContain('expand%5B0%5D=payment_method');
    expect(await stripe.connectAccountStatus('acct_1')).toEqual({ onboarded: true, payoutsEnabled: false });
    const action = fakeFetch({ '/v1/payment_intents': { json: { id: 'pi_4', status: 'requires_action', client_secret: 'pi_4_secret' } } });
    expect(await new StripePaymentProvider('sk', undefined, action.impl).authorize({ amountCents: 1, currency: 'CAD', customerRef: 'c', paymentMethodRef: 'p', idempotencyKey: 'k' })).toEqual({ intentId: 'pi_4', status: 'requires_action', clientSecret: 'pi_4_secret' });
  });

  it('vérifie la signature des webhooks (secret, horodatage, tolérance de 5 minutes)', async () => {
    const payload = JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded', data: { object: { id: 'pi_1' } } });
    const now = Math.floor(Date.now() / 1000);
    const header = `t=${now},v1=${stripeSignature('whsec_secret', payload, now)}`;
    expect(verifyStripeSignature('whsec_secret', payload, header, now)).toBe(true);
    expect(verifyStripeSignature('whsec_autre', payload, header, now)).toBe(false);
    expect(verifyStripeSignature('whsec_secret', `${payload} `, header, now)).toBe(false);
    expect(verifyStripeSignature('whsec_secret', payload, header, now + 301)).toBe(false);
    expect(verifyStripeSignature('whsec_secret', payload, 'v1=abc', now)).toBe(false);
    const stripe = new StripePaymentProvider('sk_test_x', 'whsec_secret');
    await expect(stripe.verifyWebhook(payload, header)).resolves.toMatchObject({ id: 'evt_1' });
    await expect(stripe.verifyWebhook(payload, `t=${now},v1=00`)).rejects.toMatchObject({ code: 'WEBHOOK_SIGNATURE_INVALID' });
    await expect(new StripePaymentProvider('sk_test_x', undefined).verifyWebhook(payload, header)).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
  });
});
