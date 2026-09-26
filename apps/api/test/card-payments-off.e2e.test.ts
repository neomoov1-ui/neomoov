import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cardPaymentsEnabled } from '../src/config/env.js';
import { bearer, cleanupTestData, loginByOtp, startTestApp } from './helpers.js';

/** Bêta sans Stripe : aucune carte proposée ni acceptée, paiement au chauffeur seulement. */
const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
const inThreeHours = () => new Date(Date.now() + 3 * 3_600_000).toISOString();

describe('paiement par carte fermé (intégration)', () => {
  let app: NestExpressApplication | null = null;
  beforeAll(async () => {
    app = await startTestApp({ CARD_PAYMENTS: 'off' });
  });
  afterAll(async () => {
    if (app) await cleanupTestData(app);
    await app?.close();
  });

  it('règle : jamais en production avec le simulateur, forçable dans les deux sens', () => {
    expect(cardPaymentsEnabled({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'mock', CARD_PAYMENTS: undefined })).toBe(false);
    expect(cardPaymentsEnabled({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'real', CARD_PAYMENTS: undefined })).toBe(true);
    expect(cardPaymentsEnabled({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'mock', CARD_PAYMENTS: undefined })).toBe(true);
    expect(cardPaymentsEnabled({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'real', CARD_PAYMENTS: 'off' })).toBe(false);
  });

  it('configuration, devis sans carte, réservation par carte refusée, paiement au chauffeur accepté', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const server = app.getHttpServer();
    const config = await request(server).get('/v1/config').expect(200);
    expect(config.body.features.cardPayments).toBe(false);
    const client = await loginByOtp(app, undefined, {}, { card: false });
    const quotes = await request(server).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: inThreeHours() }).expect(201);
    expect(quotes.body.paymentMethods).not.toEqual(expect.arrayContaining(['card_app']));
    expect(quotes.body.paymentMethods.some((m: string) => ['card_app', 'apple_pay', 'google_pay'].includes(m))).toBe(false);
    const q = quotes.body.quotes[0] as { id: string; maxConsentedCents: number };
    const card = await request(server).post('/v1/rides').set(bearer(client)).set('Idempotency-Key', `carte-${Date.now()}`)
      .send({ quoteId: q.id, type: 'scheduled', requestedAt: inThreeHours(), paymentChoice: 'prepaid', paymentMethod: 'card_app', maxConsentedCents: q.maxConsentedCents });
    expect(card.status).toBe(409);
    expect(card.body.code).toBe('CARD_PAYMENTS_UNAVAILABLE');
    await request(server).post('/v1/rides').set(bearer(client)).set('Idempotency-Key', `especes-${Date.now()}`)
      .send({ quoteId: q.id, type: 'scheduled', requestedAt: inThreeHours(), paymentChoice: 'pay_driver_after', paymentMethod: 'cash', maxConsentedCents: q.maxConsentedCents }).expect(201);
  });
});
