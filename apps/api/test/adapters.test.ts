import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { MockMapsProvider, MockPaymentProvider, haversineMeters } from '../src/adapters/mock/index.js';
import { realPayment, realSms, realStorage } from '../src/adapters/real/index.js';
import { loadEnv } from '../src/config/env.js';

describe('adaptateurs simulés', () => {
  it('le simulateur de cartes est déterministe et tient compte de l\'heure de départ', async () => {
    const maps = new MockMapsProvider();
    const a = await maps.geocode('1 rue Test, Montréal');
    const b = await maps.geocode('1 rue Test, Montréal');
    expect(a).toEqual(b);
    const yul = await maps.geocode('Aéroport Montréal-Trudeau');
    expect(yul.placeId).toBe('mock-yul');
    // Heures locales de Montréal : 14 h (hors pointe) et 8 h (pointe) en heure avancée (UTC−4)…
    const offPeak = await maps.route({ origin: a, destination: yul, departureTime: new Date('2026-10-01T18:00:00Z') });
    const peak = await maps.route({ origin: a, destination: yul, departureTime: new Date('2026-10-01T12:00:00Z') });
    expect(offPeak.distanceMeters).toBe(peak.distanceMeters);
    expect(peak.durationSeconds).toBeGreaterThan(offPeak.durationSeconds);
    // … et en heure normale (UTC−5) : 8 h de Montréal = 13 h UTC est en pointe, 12 h UTC (7 h moins une minute) ne l'est pas.
    const winterPeak = await maps.route({ origin: a, destination: yul, departureTime: new Date('2027-01-15T13:00:00Z') });
    const winterOff = await maps.route({ origin: a, destination: yul, departureTime: new Date('2027-01-15T11:59:00Z') });
    expect(winterPeak.durationSeconds).toBe(peak.durationSeconds);
    expect(winterOff.durationSeconds).toBe(offPeak.durationSeconds);
    expect(haversineMeters(a, a)).toBe(0);
  });

  it('le simulateur de paiement respecte l\'idempotence et refuse une capture supérieure à l\'autorisation', async () => {
    const pay = new MockPaymentProvider();
    const first = await pay.authorize({ amountCents: 3156, currency: 'CAD', customerRef: 'cus', paymentMethodRef: 'pm_ok', idempotencyKey: 'k1' });
    const again = await pay.authorize({ amountCents: 3156, currency: 'CAD', customerRef: 'cus', paymentMethodRef: 'pm_ok', idempotencyKey: 'k1' });
    expect(again.intentId).toBe(first.intentId);
    await expect(pay.capture(first.intentId, 5000, 'k2')).rejects.toThrow(/supérieure/);
    const captured = await pay.capture(first.intentId, 3000, 'k3');
    expect(captured.status).toBe('captured');
    await expect(pay.verifyWebhook('{}', 'mauvaise')).rejects.toThrow(/Signature/);
  });

  it('un adaptateur réel sans clé refuse tout appel avec PROVIDER_NOT_CONFIGURED', async () => {
    const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://x', PAYMENT_PROVIDER: 'real' }, { dotenv: false });
    expect(() => realPayment(env)).toThrow(/STRIPE_SECRET_KEY/);
    const withKey = loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://x', PAYMENT_PROVIDER: 'real', STRIPE_SECRET_KEY: 'sk_test_x' }, { dotenv: false });
    const provider = realPayment(withKey);
    expect(provider.name).toBe('stripe');
    // Adaptateur livré (étape 7) : sans secret de webhook, la vérification refuse proprement, sans appel réseau.
    await expect(provider.verifyWebhook('{}', 't=1,v1=00')).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED', status: 501 });
  });

  it('un adaptateur réel est un objet ordinaire pour NestJS et le journal (pas de crochets fantômes)', () => {
    const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://x', STRIPE_SECRET_KEY: 'sk_test_x', TWILIO_ACCOUNT_SID: 'AC_x', TWILIO_AUTH_TOKEN: 'tw_secret_x', TWILIO_FROM_NUMBER: '+15145550100', S3_ACCESS_KEY: 'k' }, { dotenv: false });
    const provider = realPayment(env) as unknown as Record<string, unknown>;
    // NestJS appelle onModuleInit / onModuleDestroy s'ils existent : ils ne doivent pas exister.
    expect(provider['onModuleInit']).toBeUndefined();
    expect(provider['onModuleDestroy']).toBeUndefined();
    expect(provider['onApplicationBootstrap']).toBeUndefined();
    expect(() => JSON.stringify(provider)).not.toThrow();
    expect(JSON.parse(JSON.stringify(provider))).toEqual({ name: 'stripe', configured: true });
    // La clé secrète n'apparaît ni dans le journal ni à l'inspection de l'objet.
    expect(JSON.stringify(provider)).not.toContain('sk_test_x');
    expect(inspect(provider, { depth: 5, showHidden: true })).not.toContain('sk_test_x');
    expect(realSms(env).name).toBe('twilio');
    expect(inspect(realSms(env), { depth: 5, showHidden: true })).not.toContain('tw_secret_x');
    expect(() => realSms(loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://x', TWILIO_ACCOUNT_SID: 'AC_x' }, { dotenv: false }))).toThrow(/TWILIO_AUTH_TOKEN/);
    expect(realStorage(env).name).toBe('s3');
  });
});
