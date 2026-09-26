import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MockVoiceProvider } from '../src/adapters/mock/index.js';
import { VOICE_PROVIDER } from '../src/adapters/types.js';
import { SettingsService } from '../src/common/settings.service.js';
import { SosCallService } from '../src/modules/voice/sos-call.service.js';
import { cleanupTestData, db, loginByOtp, startTestApp } from './helpers.js';

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

describe('agent vocal Vapi (intégration)', () => {
  let app: NestExpressApplication | null = null;
  const server = () => app!.getHttpServer();
  const guestPhones: string[] = [];

  beforeAll(async () => {
    app = await startTestApp();
  });
  afterAll(async () => {
    if (app) {
      for (const phone of guestPhones) {
        await db(app).delete(schema.notifications).where(eq(schema.notifications.recipientAddress, phone));
        // Courses sur fiche minimale (aucun utilisateur de test) : `ride_events` est en ajout seul, suspendu le temps du nettoyage.
        await db(app).transaction(async (tx) => {
          await tx.execute(sql`ALTER TABLE ride_events DISABLE TRIGGER ride_events_append_only`);
          await tx.delete(schema.rides).where(eq(schema.rides.guestPhone, phone));
          await tx.execute(sql`ALTER TABLE ride_events ENABLE TRIGGER ride_events_append_only`);
        });
      }
      await db(app).delete(schema.agentRuns).where(and(eq(schema.agentRuns.agentCode, 'voice_call_center'), eq(schema.agentRuns.trigger, 'call')));
      await cleanupTestData(app);
    }
    await app?.close();
  });

  /** Appel d'outils tel que Vapi l'envoie ; le résultat de chaque outil est un JSON à reformuler par l'assistant. */
  async function tools(phone: string | null, calls: Array<{ name: string; args: Record<string, unknown> }>, secret = 'mock-signature') {
    const body = { message: { type: 'tool-calls', call: { id: `call-${Math.random().toString(36).slice(2)}`, customer: phone ? { number: phone } : {} }, toolCallList: calls.map((c, i) => ({ id: `tc${i}`, type: 'function', function: { name: c.name, arguments: c.args } })) } };
    const res = await request(server()).post('/v1/webhooks/vapi').set('x-vapi-secret', secret).send(body);
    return { status: res.status, results: (res.body.results ?? []).map((r: { result: string }) => JSON.parse(r.result) as Record<string, unknown>) };
  }

  it('appelant inconnu : prix, réservation sur fiche minimale, texto de confirmation, état, annulation', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const phone = `+1999${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
    guestPhones.push(phone);
    expect((await tools(phone, [{ name: 'quote', args: {} }], 'faux')).status).toBe(400);

    const [missing] = (await tools(phone, [{ name: 'quote', args: { pickupAddress: '4500 rue Saint-Denis, Montréal' } }])).results;
    expect(missing).toMatchObject({ ok: false, reason: 'missing_details' });
    const [tooSoon] = (await tools(phone, [{ name: 'voice.quote', args: { pickupAddress: '4500 rue Saint-Denis, Montréal', dropoffAddress: 'Aéroport Montréal-Trudeau', pickupTime: inHours(0.5) } }])).results;
    expect(tooSoon).toMatchObject({ ok: false, reason: 'LEAD_TIME_TOO_SHORT' });

    const [quote] = (await tools(phone, [{ name: 'quote', args: { pickupAddress: '4500 rue Saint-Denis, Montréal', dropoffAddress: '1000 rue De La Gauchetière Ouest, Montréal', pickupTime: inHours(5) } }])).results;
    expect(quote).toMatchObject({ ok: true, category: 'neo_premium' });
    expect(quote!['totalCents']).toBeGreaterThan(0);
    expect(String(quote!['total'])).toContain('$');

    const [noName] = (await tools(phone, [{ name: 'createRide', args: { quoteId: quote!['quoteId'] } }])).results;
    expect(noName).toMatchObject({ ok: false, reason: 'missing_name' });
    const [booked] = (await tools(phone, [{ name: 'createRide', args: { quoteId: quote!['quoteId'], name: 'Marie Tremblay', notes: 'Deux valises' } }])).results;
    expect(booked).toMatchObject({ ok: true });
    expect(booked!['publicNumber']).toMatch(/^NM-/);
    const [ride] = await db(app).select().from(schema.rides).where(eq(schema.rides.guestPhone, phone));
    expect(ride).toMatchObject({ clientId: null, guestName: 'Marie Tremblay', paymentChoice: 'pay_driver_after', type: 'scheduled', specialRequests: 'Deux valises', state: 'requested' });
    const [sms] = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.recipientAddress, phone), eq(schema.notifications.template, 'ride.voice_confirmation')));
    expect(sms).toMatchObject({ channel: 'sms', data: expect.objectContaining({ publicNumber: booked!['publicNumber'], totalCents: quote!['totalCents'] }) });

    const [status] = (await tools(phone, [{ name: 'rideStatus', args: {} }])).results;
    expect(status).toMatchObject({ ok: true, rides: [expect.objectContaining({ publicNumber: booked!['publicNumber'], state: 'requested', driver: null })] });
    const [cancelled] = (await tools(phone, [{ name: 'cancelRide', args: { publicNumber: booked!['publicNumber'] } }])).results;
    expect(cancelled).toMatchObject({ ok: true, feeCents: 0 });
    expect((await db(app).select({ state: schema.rides.state }).from(schema.rides).where(eq(schema.rides.id, ride!.id)))[0]!.state).toBe('cancelled_by_client');
    const [none] = (await tools(phone, [{ name: 'rideStatus', args: {} }, { name: 'transferToHuman', args: { reason: 'plainte' } }])).results;
    expect(none).toMatchObject({ ok: true, rides: [] });
  });

  it('appelant reconnu : course sur son compte, langue du compte ; rapport de fin d\'appel journalisé une fois', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    await db(app).update(schema.users).set({ language: 'en', firstName: 'John' }).where(eq(schema.users.id, client.user.id));
    const { results } = await tools(client.user.phone, [{ name: 'quote', args: { pickupAddress: '4500 rue Saint-Denis, Montréal', dropoffAddress: '1000 rue De La Gauchetière Ouest, Montréal', pickupTime: inHours(6) } }]);
    const [booked, transfer] = (await tools(client.user.phone, [{ name: 'createRide', args: { quoteId: results[0]!['quoteId'] } }, { name: 'transferToHuman', args: {} }])).results;
    expect(booked).toMatchObject({ ok: true, payment: 'Paid to the driver at the end of the ride.' });
    expect(transfer).toMatchObject({ ok: true, destination: expect.stringMatching(/^\+1/) });
    const [client0] = await db(app).select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.userId, client.user.id));
    const rides = await db(app).select().from(schema.rides).where(eq(schema.rides.clientId, client0!.id));
    expect(rides).toHaveLength(1);
    expect(rides[0]).toMatchObject({ guestPhone: null, createdByUserId: client.user.id });

    const report = { message: { type: 'end-of-call-report', call: { id: `call-report-${client.user.id}`, customer: { number: client.user.phone } }, summary: 'Réservation pour demain.', endedReason: 'customer-ended-call', cost: 0.12, durationSeconds: 95 } };
    await request(server()).post('/v1/webhooks/vapi').set('x-vapi-secret', 'mock-signature').send(report).expect(200);
    await request(server()).post('/v1/webhooks/vapi').set('x-vapi-secret', 'mock-signature').send(report).expect(200);
    const runs = await db(app).select().from(schema.agentRuns).where(and(eq(schema.agentRuns.agentCode, 'voice_call_center'), eq(schema.agentRuns.triggerRef, `call-report-${client.user.id}`)));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'succeeded', costMicros: 120_000, durationMs: 95_000, output: { summary: 'Réservation pour demain.', endedReason: 'customer-ended-call' } });
    // Numéro masqué dans le journal (quatre derniers chiffres seulement).
    expect(JSON.stringify(runs[0]!.input)).not.toContain(client.user.phone);
  });
  it('SOS : le fondateur est appelé une seule fois par incident, jamais sans numéro ni assistant configurés', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const phone = `+1999${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
    guestPhones.push(phone);
    const [quote] = (await tools(phone, [{ name: 'quote', args: { pickupAddress: '4500 rue Saint-Denis, Montréal', dropoffAddress: '1000 rue De La Gauchetière Ouest, Montréal', pickupTime: inHours(7) } }])).results;
    await tools(phone, [{ name: 'createRide', args: { quoteId: quote!['quoteId'], name: 'Marie Tremblay' } }]);
    const [ride] = await db(app).select({ id: schema.rides.id }).from(schema.rides).where(eq(schema.rides.guestPhone, phone));
    const sos = app.get(SosCallService);
    expect(await sos.call(ride!.id, 'incident-sans-reglage')).toBeNull();
    const settings = app.get(SettingsService);
    const original = settings.string.bind(settings);
    const spy = vi.spyOn(settings, 'string').mockImplementation(async (k: string, fallback: string) => (k === 'alerts.founder_phone' ? '+15145550199' : k === 'voice.sos_assistant_id' ? 'asst-sos' : original(k, fallback)));
    try {
      const voice = app.get<MockVoiceProvider>(VOICE_PROVIDER);
      const callId = await sos.call(ride!.id, 'incident-1');
      expect(callId).toMatch(/^call_mock/);
      expect(voice.calls.at(-1)).toMatchObject({ to: '+15145550199', assistantId: 'asst-sos' });
      expect(await sos.call(ride!.id, 'incident-1')).toBeNull();
      expect(await sos.call(ride!.id, 'incident-2')).toMatch(/^call_mock/);
    } finally {
      spy.mockRestore();
    }
  });
});
