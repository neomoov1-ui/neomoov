import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MockLlmProvider, MockPaymentProvider } from '../src/adapters/mock/index.js';
import { LLM_PROVIDER, PAYMENT_PROVIDER } from '../src/adapters/types.js';
import { DomainEventsService } from '../src/common/domain-events.js';
import { bearer, cleanupTestData, db, loginByOtp, startTestApp } from './helpers.js';

/**
 * Mode dégradé (prompt 15, tâche 4 ; `docs/runbooks/degraded-mode.md`) : Stripe en panne à la réservation, modèle de
 * langage en panne pour l'agent relation client. Routes (disjoncteur) : `circuit-breaker.e2e` ; textos et push (reprise,
 * repli) : `notifications.e2e`.
 */
const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
const key = () => `dgr-${Math.random().toString(36).slice(2, 14)}`;

describe('mode dégradé (intégration)', () => {
  let app: NestExpressApplication | null = null;
  const server = () => app!.getHttpServer();
  const triggerRefs: string[] = [];

  beforeAll(async () => {
    app = await startTestApp({ FEATURE_IMMEDIATE_RIDES: 'on', AGENT_TRIGGERS: 'on' });
  });
  afterAll(async () => {
    if (app) {
      const runs = triggerRefs.length ? await db(app).select({ id: schema.agentRuns.id }).from(schema.agentRuns).where(inArray(schema.agentRuns.triggerRef, triggerRefs)) : [];
      if (runs.length) {
        const ids = runs.map((r) => r.id);
        await db(app).update(schema.conversationMessages).set({ agentRunId: null }).where(inArray(schema.conversationMessages.agentRunId, ids));
        await db(app).delete(schema.agentRuns).where(inArray(schema.agentRuns.id, ids));
      }
      await cleanupTestData(app);
    }
    await app?.close();
  });

  it('Stripe en panne : réservation par carte refusée avec un code clair, aucune course créée ; paiement au chauffeur possible', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const stripe = app.get<MockPaymentProvider>(PAYMENT_PROVIDER);
    const client = await loginByOtp(app);
    const quote = (await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE }).expect(201)).body.quotes[0] as { id: string; maxConsentedCents: number };
    stripe.unavailable = true;
    try {
      const refused = await request(server()).post('/v1/rides').set(bearer(client)).set('Idempotency-Key', key())
        .send({ quoteId: quote.id, type: 'immediate', paymentChoice: 'prepaid', paymentMethod: 'card_app', maxConsentedCents: quote.maxConsentedCents });
      expect(refused.status).toBe(502);
      expect(refused.body).toMatchObject({ code: 'PAYMENT_PROVIDER_ERROR', correlationId: expect.any(String) });
      expect(await db(app).select({ id: schema.rides.id }).from(schema.rides).where(eq(schema.rides.quoteId, quote.id))).toHaveLength(0);
      // Le client choisit de payer le chauffeur : la course part sans Stripe.
      const cash = await request(server()).post('/v1/rides').set(bearer(client)).set('Idempotency-Key', key())
        .send({ quoteId: quote.id, type: 'immediate', paymentChoice: 'pay_driver_after', paymentMethod: 'cash', maxConsentedCents: quote.maxConsentedCents }).expect(201);
      expect(cash.body.state).toBe('requested');
      expect(await db(app).select().from(schema.payments).where(eq(schema.payments.rideId, cash.body.id))).toHaveLength(0);
    } finally {
      stripe.unavailable = false;
    }
  });

  it('modèle de langage en panne : accusé de réception, exécution en échec, conversation confiée à l\'équipe', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const llm = app.get<MockLlmProvider>(LLM_PROVIDER);
    const client = await loginByOtp(app, undefined, {}, { card: false });
    llm.scripts.length = 0;
    llm.script(() => ({ refuse: true }));
    const externalId = key();
    triggerRefs.push(externalId);
    try {
      await app.get(DomainEventsService).emitAndWait('conversation.inbound', { channel: 'app', externalId, userId: client.user.id, phone: null, text: 'Bonjour, où est mon chauffeur ?', language: 'fr', rideId: null, receivedAt: new Date() });
    } finally {
      llm.scripts.length = 0;
    }
    const [run] = await db(app).select().from(schema.agentRuns).where(eq(schema.agentRuns.triggerRef, externalId));
    expect(run).toMatchObject({ agentCode: 'customer_relations', status: 'failed' });
    const [conversation] = await db(app).select().from(schema.conversations).where(eq(schema.conversations.userId, client.user.id));
    expect(conversation).toMatchObject({ status: 'escalated' });
    expect(conversation!.escalationReason).toContain('agent_error');
    const messages = await db(app).select().from(schema.conversationMessages).where(eq(schema.conversationMessages.conversationId, conversation!.id)).orderBy(schema.conversationMessages.createdAt);
    // Message du client, accusé de réception immédiat, puis relais humain annoncé : jamais de silence.
    expect(messages.map((m) => m.direction)).toEqual(['inbound', 'outbound', 'outbound']);
  });
});
