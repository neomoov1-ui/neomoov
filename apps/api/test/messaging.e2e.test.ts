import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MockSmsProvider } from '../src/adapters/mock/index.js';
import { SMS_PROVIDER } from '../src/adapters/types.js';
import { DomainEventsService } from '../src/common/domain-events.js';
import { NotificationDeliveryService } from '../src/modules/notifications/notification-delivery.service.js';
import { ApproachNotifierService } from '../src/modules/rides/approach-notifier.service.js';
import { bearer, cleanupTestData, createDriver, db, loginByOtp, startTestApp } from './helpers.js';

const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
const key = () => `test-${Math.random().toString(36).slice(2, 14)}`;

describe('messagerie masquée et messages entrants (intégration)', () => {
  let app: NestExpressApplication | null = null;
  const server = () => app!.getHttpServer();

  beforeAll(async () => {
    app = await startTestApp();
  });
  afterAll(async () => {
    if (app) await cleanupTestData(app);
    await app?.close();
  });

  /** Écoute un événement de domaine le temps d'un test. */
  function listen<T>(name: 'conversation.inbound' | 'ride.message') {
    const seen: T[] = [];
    const off = app!.get(DomainEventsService).on(name, (p) => void seen.push(p as T));
    return { seen, off };
  }

  it('client sans application : le message du chauffeur part par texto, sa réponse revient dans la course et au chauffeur', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const booker = await loginByOtp(app);
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const requestedAt = new Date(Date.now() + 4 * 3_600_000).toISOString();
    const quote = (await request(server()).post('/v1/quotes').set(bearer(booker)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt }).expect(201)).body.quotes[0];
    const ride = (await request(server()).post('/v1/rides').set(bearer(booker)).set('Idempotency-Key', key())
      .send({ quoteId: quote.id, type: 'scheduled', requestedAt, paymentMethod: 'cash', paymentChoice: 'pay_driver_after', maxConsentedCents: quote.maxConsentedCents }).expect(201)).body;
    // Réservation par téléphone : aucun compte client, seulement le numéro de l'invité.
    const guestPhone = `+1999${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
    await db(app).update(schema.rides).set({ clientId: null, guestPhone, guestName: 'Invité', driverId: driver.driverId, state: 'en_route' }).where(eq(schema.rides.id, ride.id));

    await request(server()).post(`/v1/rides/${ride.id}/messages`).set(bearer(driver.tokens)).send({ body: 'Je suis devant la porte bleue' }).expect(201);
    const [texted] = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.recipientAddress, guestPhone), eq(schema.notifications.template, 'ride.message_sms')));
    expect(texted).toMatchObject({ channel: 'sms', data: { rideId: ride.id, body: 'Je suis devant la porte bleue' } });
    expect(await app.get(NotificationDeliveryService).deliver(texted!.id)).toBe('sent');
    const sms = app.get<MockSmsProvider>(SMS_PROVIDER);
    const sent = sms.sent.find((s) => s.to === guestPhone)!;
    expect(sent.body).toContain('« Je suis devant la porte bleue »');
    expect(sent.body).not.toContain(driver.phone);

    const messages = listen<{ rideId: string; senderKind: string }>('ride.message');
    const form = { From: guestPhone, To: '+15145550100', Body: 'J\'arrive dans 2 minutes', MessageSid: `SM${key()}` };
    expect((await request(server()).post('/v1/webhooks/twilio/inbound').type('form').set('x-twilio-signature', 'faux').send(form)).status).toBe(400);
    const reply = await request(server()).post('/v1/webhooks/twilio/inbound').type('form').set('x-twilio-signature', 'mock-signature').send(form).expect(200);
    expect(reply.headers['content-type']).toContain('text/xml');
    messages.off();
    const [relayed] = await db(app).select().from(schema.rideMessages).where(and(eq(schema.rideMessages.rideId, ride.id), eq(schema.rideMessages.channel, 'sms')));
    expect(relayed).toMatchObject({ senderKind: 'client', senderUserId: null, body: 'J\'arrive dans 2 minutes' });
    expect(messages.seen).toEqual([expect.objectContaining({ rideId: ride.id, senderKind: 'client' })]);
    const toDriver = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.recipientUserId, driver.userId), eq(schema.notifications.template, 'ride.message')));
    expect(toDriver).toHaveLength(1);
    // Le chauffeur lit la réponse dans le fil de la course.
    const thread = await request(server()).get(`/v1/rides/${ride.id}/messages`).set(bearer(driver.tokens)).expect(200);
    expect(thread.body.map((m: { body: string }) => m.body)).toEqual(['Je suis devant la porte bleue', 'J\'arrive dans 2 minutes']);
    await db(app).delete(schema.notifications).where(eq(schema.notifications.recipientAddress, guestPhone));
  });

  it('texto sans course en cours et message WhatsApp : confiés à l\'agent relation client ; vérification de l\'abonnement WhatsApp', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const inbound = listen<{ channel: string; userId: string | null; phone: string; text: string; externalId: string }>('conversation.inbound');
    await request(server()).post('/v1/webhooks/twilio/inbound').type('form').set('x-twilio-signature', 'mock-signature')
      .send({ From: client.user.phone, To: '+15145550100', Body: 'Bonjour, j\'ai oublié mon parapluie', MessageSid: 'SM-lost-item' }).expect(200);

    expect((await request(server()).get('/v1/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'mock-verify', 'hub.challenge': '1234' }).expect(200)).text).toBe('1234');
    expect((await request(server()).get('/v1/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'autre', 'hub.challenge': '1234' })).status).toBe(403);
    const payload = { messages: [{ from: '+19995550111', text: 'Je veux réserver pour demain 8 h', id: 'wamid.test-1' }] };
    expect((await request(server()).post('/v1/webhooks/whatsapp').set('x-hub-signature-256', 'faux').send(payload)).status).toBe(400);
    const received = await request(server()).post('/v1/webhooks/whatsapp').set('x-hub-signature-256', 'mock-signature').send(payload).expect(200);
    expect(received.body).toEqual({ received: 1 });
    inbound.off();
    expect(inbound.seen).toEqual([
      expect.objectContaining({ channel: 'sms', userId: client.user.id, phone: client.user.phone, text: 'Bonjour, j\'ai oublié mon parapluie', externalId: 'SM-lost-item' }),
      expect.objectContaining({ channel: 'whatsapp', userId: null, phone: '+19995550111', text: 'Je veux réserver pour demain 8 h', externalId: 'wamid.test-1' }),
    ]);
  });
  it('chauffeur en approche : le client est prévenu une seule fois sous 700 m du départ, jamais hors de la phase « en route »', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const requestedAt = new Date(Date.now() + 5 * 3_600_000).toISOString();
    const quote = (await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt }).expect(201)).body.quotes[0];
    const ride = (await request(server()).post('/v1/rides').set(bearer(client)).set('Idempotency-Key', key())
      .send({ quoteId: quote.id, type: 'scheduled', requestedAt, paymentMethod: 'cash', paymentChoice: 'pay_driver_after', maxConsentedCents: quote.maxConsentedCents }).expect(201)).body;
    const approach = app.get(ApproachNotifierService);
    // Course pas encore en route : rien, même tout près.
    expect(await approach.onPosition(ride.id, { lat: 45.5232, lng: -73.5822 })).toBe(false);
    await db(app).update(schema.rides).set({ driverId: driver.driverId, state: 'en_route' }).where(eq(schema.rides.id, ride.id));
    const later = Date.now() + 120_000;
    expect(await approach.onPosition(ride.id, CENTRE.coordinates, later)).toBe(false);
    expect(await approach.onPosition(ride.id, { lat: 45.5245, lng: -73.5835 }, later)).toBe(true);
    expect(await approach.onPosition(ride.id, { lat: 45.5232, lng: -73.5822 }, later)).toBe(false);
    const notices = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.recipientUserId, client.user.id), eq(schema.notifications.template, 'ride.driver_approaching')));
    expect(notices.map((n) => n.channel)).toEqual(['push']);
    const events = await db(app).select().from(schema.rideEvents).where(and(eq(schema.rideEvents.rideId, ride.id), eq(schema.rideEvents.type, 'driver_approaching')));
    expect(events).toHaveLength(1);
    await db(app).delete(schema.notifications).where(eq(schema.notifications.recipientUserId, client.user.id));
  });
});
