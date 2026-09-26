/**
 * Revue de sécurité 17.B : en production, un fournisseur simulé (configuration par défaut du serveur tant que les clés
 * ne sont pas posées) ne doit accepter aucun webhook. Sinon, la signature publique `mock-signature` permet à n'importe
 * qui de forger un événement Stripe, un texto entrant, un message WhatsApp ou un appel de l'agent vocal au nom d'un
 * client (annulation de sa course, état de ses courses).
 */
import { Global, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { AdaptersModule } from '../src/adapters/adapters.module.js';
import { PAYMENT_PROVIDER, SMS_PROVIDER, VOICE_PROVIDER, WHATSAPP_PROVIDER, type PaymentProvider, type SmsProvider, type VoiceProvider, type WhatsAppProvider } from '../src/adapters/types.js';
import { APP_ENV, loadEnv, type AppEnv } from '../src/config/env.js';

const PRODUCTION = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://x', JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32), ENCRYPTION_KEY: 'c'.repeat(32), REDIS_URL: 'redis://localhost:6379', SOCIAL_LOGIN_PROVIDER: 'real' };

async function providersFor(env: AppEnv) {
  @Global()
  @Module({ providers: [{ provide: APP_ENV, useValue: env }], exports: [APP_ENV] })
  class EnvModule {}
  @Module({ imports: [EnvModule, AdaptersModule] })
  class RootModule {}
  const ctx = await NestFactory.createApplicationContext(RootModule, { logger: false });
  const providers = {
    payment: ctx.get<PaymentProvider>(PAYMENT_PROVIDER),
    sms: ctx.get<SmsProvider>(SMS_PROVIDER),
    whatsapp: ctx.get<WhatsAppProvider>(WHATSAPP_PROVIDER),
    voice: ctx.get<VoiceProvider>(VOICE_PROVIDER),
  };
  await ctx.close();
  return providers;
}

const stripeEvent = JSON.stringify({ id: 'evt_forged', type: 'payment_method.detached', data: { object: { id: 'pm_x' } } });
const vapiMessage = JSON.stringify({ message: { type: 'tool-calls', call: { customer: { number: '+15145550123' } }, toolCallList: [] } });

describe('webhooks des fournisseurs simulés', () => {
  it('en production, aucun fournisseur simulé n\'accepte la signature de test', async () => {
    const { payment, sms, whatsapp, voice } = await providersFor(loadEnv(PRODUCTION, { dotenv: false }));
    expect(payment.name).toBe('mock');
    await expect(payment.verifyWebhook(stripeEvent, 'mock-signature')).rejects.toThrow(/Signature/);
    expect(sms.verifyStatusWebhook({ url: 'https://api.neomoov.net/v1/webhooks/twilio/inbound', params: { From: '+15145550123' }, signature: 'mock-signature' })).toBe(false);
    expect(whatsapp.verifySignature(Buffer.from('{}'), 'mock-signature')).toBe(false);
    expect(whatsapp.verifyWebhook({ 'hub.mode': 'subscribe', 'hub.verify_token': 'mock-verify', 'hub.challenge': 'defi' })).toBeNull();
    await expect(voice.verifyWebhook(vapiMessage, 'mock-signature')).rejects.toThrow(/Signature/);
  });

  it('hors production (tests, développement), la signature de test reste acceptée', async () => {
    const { payment, sms, whatsapp, voice } = await providersFor(loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://x' }, { dotenv: false }));
    await expect(payment.verifyWebhook(stripeEvent, 'mock-signature')).resolves.toMatchObject({ id: 'evt_forged' });
    expect(sms.verifyStatusWebhook({ url: 'u', params: {}, signature: 'mock-signature' })).toBe(true);
    expect(whatsapp.verifySignature(Buffer.from('{}'), 'mock-signature')).toBe(true);
    expect(whatsapp.verifyWebhook({ 'hub.mode': 'subscribe', 'hub.verify_token': 'mock-verify', 'hub.challenge': 'defi' })).toBe('defi');
    await expect(voice.verifyWebhook(vapiMessage, 'mock-signature')).resolves.toMatchObject({ type: 'tool-calls' });
  });
});
