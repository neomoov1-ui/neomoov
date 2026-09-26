/**
 * Tests contre Stripe en mode test (prompt 07, tâche 8), lancés seulement avec `RUN_STRIPE_TESTS=1` et une clé
 * `sk_test_…` dans `STRIPE_SECRET_KEY` (jamais une clé de production). Cartes de test Stripe (`pm_card_visa`) :
 * SetupIntent confirmé côté serveur, autorisation, capture partielle, pourboire hors session, remboursement, webhook
 * signé avec le secret de test (signature produite localement comme le fait Stripe).
 */
import { describe, expect, it } from 'vitest';
import { StripePaymentProvider, stripeSignature } from '../src/adapters/real/stripe.js';
import { loadDotenvFromRoot } from '../src/config/env.js';

loadDotenvFromRoot();
const secret = process.env['STRIPE_SECRET_KEY'] ?? '';
const enabled = process.env['RUN_STRIPE_TESTS'] === '1' && secret.startsWith('sk_test_');

async function stripeCall(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.stripe.com${path}`, { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  return (await res.json()) as Record<string, unknown>;
}

describe.skipIf(!enabled)('Stripe en mode test (RUN_STRIPE_TESTS=1)', () => {
  const stripe = new StripePaymentProvider(secret, 'whsec_test_local');
  const run = `neomoov-test-${Date.now()}`;

  it('carte enregistrée, autorisation, capture partielle, pourboire, remboursement, rejeu idempotent', async () => {
    const { customerRef } = await stripe.createCustomer({ externalId: run });
    const setup = await stripe.createSetupIntent(customerRef);
    await stripeCall(`/v1/setup_intents/${setup.setupIntentId}/confirm`, { payment_method: 'pm_card_visa' });
    const confirmed = await stripe.retrieveSetupIntent(setup.setupIntentId);
    expect(confirmed.status).toBe('succeeded');
    expect(confirmed.card?.last4).toBe('4242');
    const card = confirmed.card!.ref;

    const auth = await stripe.authorize({ amountCents: 5_750, currency: 'CAD', customerRef, paymentMethodRef: card, idempotencyKey: `${run}:auth` });
    expect(auth.status).toBe('authorized');
    const replay = await stripe.authorize({ amountCents: 5_750, currency: 'CAD', customerRef, paymentMethodRef: card, idempotencyKey: `${run}:auth` });
    expect(replay.intentId).toBe(auth.intentId);

    expect((await stripe.capture(auth.intentId, 4_500, `${run}:capture`)).status).toBe('captured');
    const tip = await stripe.chargeOffSession({ amountCents: 500, customerRef, paymentMethodRef: card, idempotencyKey: `${run}:tip`, description: 'Pourboire (test)' });
    expect(tip.status).toBe('captured');
    const refund = await stripe.refund({ intentId: auth.intentId, amountCents: 1_000, idempotencyKey: `${run}:refund`, reason: 'test' });
    expect(['succeeded', 'pending']).toContain(refund.status);
    const again = await stripe.refund({ intentId: auth.intentId, amountCents: 1_000, idempotencyKey: `${run}:refund`, reason: 'test' });
    expect(again.refundId).toBe(refund.refundId);
  }, 60_000);

  it('webhook signé avec le secret de test', async () => {
    const payload = JSON.stringify({ id: `evt_${run}`, type: 'payment_intent.succeeded', data: { object: { id: 'pi_test' } } });
    const t = Math.floor(Date.now() / 1000);
    const event = await stripe.verifyWebhook(payload, `t=${t},v1=${stripeSignature('whsec_test_local', payload, t)}`);
    expect(event.id).toBe(`evt_${run}`);
  });

  it('compte Connect Express et lien d\'inscription', async () => {
    const { accountRef } = await stripe.createConnectAccount({ externalId: run, email: `${run}@example.com` });
    expect(accountRef).toMatch(/^acct_/);
    const link = await stripe.createConnectOnboardingLink({ accountRef, returnUrl: 'https://neomoov.net/retour', refreshUrl: 'https://neomoov.net/reprendre' });
    expect(link.url).toMatch(/^https:\/\/connect\.stripe\.com\//);
    expect((await stripe.connectAccountStatus(accountRef)).onboarded).toBe(false);
  }, 60_000);
});
