/**
 * Tests contre le bac à sable de Square (étape 26), lancés seulement avec `RUN_SQUARE_TESTS=1` et un jeton d'accès du
 * bac à sable dans `SQUARE_SANDBOX_ACCESS_TOKEN` (forme `EAAA…`). Jamais contre la production : l'environnement est
 * forcé à `sandbox`, le jeton de production n'est pas lu. Jeton de carte de test de Square (`cnon:card-nonce-ok`) :
 * client, carte enregistrée, empreinte rejouée, capture plafonnée, pourboire, remboursement partiel, annulation d'une
 * empreinte, retrait de la carte ; signature de webhook produite localement comme le fait Square.
 * Emplacement : `SQUARE_SANDBOX_LOCATION_ID`, sinon le premier emplacement actif du bac à sable (il doit encaisser en CAD).
 */
import { describe, expect, it } from 'vitest';
import { SquarePaymentProvider, squareSignature } from '../src/adapters/real/square.js';
import { loadDotenvFromRoot } from '../src/config/env.js';

loadDotenvFromRoot();
const token = process.env['SQUARE_SANDBOX_ACCESS_TOKEN'] ?? '';
const enabled = process.env['RUN_SQUARE_TESTS'] === '1' && token.startsWith('EAAA');

async function sandboxLocation(): Promise<{ id: string; currency: string }> {
  const res = await fetch('https://connect.squareupsandbox.com/v2/locations', { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
  const body = (await res.json()) as { locations?: Array<{ id: string; status?: string; currency?: string }> };
  const wanted = process.env['SQUARE_SANDBOX_LOCATION_ID'];
  const location = body.locations?.find((l) => (wanted ? l.id === wanted : l.status === 'ACTIVE'));
  if (!location) throw new Error('Aucun emplacement actif dans le bac à sable Square (ou SQUARE_SANDBOX_LOCATION_ID inconnu)');
  return { id: location.id, currency: location.currency ?? 'inconnue' };
}

describe.skipIf(!enabled)('Square en bac à sable (RUN_SQUARE_TESTS=1)', () => {
  const run = `neomoov-test-${Date.now()}`;

  it('client, carte par jeton, empreinte, capture plafonnée, pourboire, remboursement, annulation, retrait', async () => {
    const location = await sandboxLocation();
    expect(location.currency, 'l\'emplacement du bac à sable doit encaisser en CAD').toBe('CAD');
    const square = new SquarePaymentProvider({ accessToken: token, locationId: location.id, environment: 'sandbox' });

    const { customerRef } = await square.createCustomer({ externalId: run, email: `${run}@test.neomoov.local` });
    expect((await square.createCustomer({ externalId: run })).customerRef).toBe(customerRef);
    const card = await square.saveCard({ customerRef, sourceId: 'cnon:card-nonce-ok', idempotencyKey: `${run}:card`, externalId: run });
    expect(card.ref).toMatch(/^ccof:/);
    expect(card.last4).toMatch(/^\d{4}$/);

    const auth = await square.authorize({ amountCents: 5_750, currency: 'CAD', customerRef, paymentMethodRef: card.ref, idempotencyKey: `${run}:auth`, metadata: { ride_id: run } });
    expect(auth.status).toBe('authorized');
    const replay = await square.authorize({ amountCents: 5_750, currency: 'CAD', customerRef, paymentMethodRef: card.ref, idempotencyKey: `${run}:auth`, metadata: { ride_id: run } });
    expect(replay.intentId).toBe(auth.intentId);

    expect((await square.capture(auth.intentId, 4_500, `${run}:capture:1`)).status).toBe('captured');
    // Rejouée, la capture ne complète ni ne rembourse une seconde fois.
    expect((await square.capture(auth.intentId, 4_500, `${run}:capture:2`)).status).toBe('captured');

    const tip = await square.chargeOffSession({ amountCents: 500, customerRef, paymentMethodRef: card.ref, idempotencyKey: `${run}:tip`, description: 'Pourboire (test)' });
    expect(tip.status).toBe('captured');
    const refund = await square.refund({ intentId: auth.intentId, amountCents: 700, idempotencyKey: `${run}:refund`, reason: 'Test Neomoov' });
    expect(['pending', 'succeeded']).toContain(refund.status);

    const released = await square.authorize({ amountCents: 2_000, currency: 'CAD', customerRef, paymentMethodRef: card.ref, idempotencyKey: `${run}:auth2` });
    expect(released.status).toBe('authorized');
    await square.cancel(released.intentId);
    await square.cancel(released.intentId);

    await square.detachPaymentMethod(card.ref);
  });

  it('signature de webhook : vérifiée sur l\'adresse de notification et le corps brut', async () => {
    const url = 'https://api.neomoov.test/v1/webhooks/square';
    const square = new SquarePaymentProvider({ accessToken: token, locationId: 'L0', environment: 'sandbox', webhookSignatureKey: 'cle-locale', webhookUrl: url });
    const raw = JSON.stringify({ type: 'payment.updated', event_id: `${run}-evt`, data: { object: { payment: { id: 'p', status: 'COMPLETED', total_money: { amount: 100 } } } } });
    expect((await square.verifyWebhook(Buffer.from(raw), squareSignature('cle-locale', url, raw))).type).toBe('payment_intent.succeeded');
  });
});
