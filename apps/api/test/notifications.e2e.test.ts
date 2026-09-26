import 'reflect-metadata';
import { schema } from '@neomoov/db';
import { NOTIFICATION_MATRIX, type TokensView } from '@neomoov/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MockEmailProvider, MockPushProvider, MockSmsProvider, MockStorageProvider } from '../src/adapters/mock/index.js';
import { EMAIL_PROVIDER, PUSH_PROVIDER, SMS_PROVIDER, STORAGE_PROVIDER } from '../src/adapters/types.js';
import { NotificationDeliveryService } from '../src/modules/notifications/notification-delivery.service.js';
import { hasTemplate, renderNotification } from '../src/modules/notifications/templates.js';
import { NotificationsOutbox } from '../src/modules/rides/notifications-outbox.js';
import { cleanupTestData, createDriver, db, loginByOtp, startTestApp, testEmail } from './helpers.js';

describe('notifications (intégration)', () => {
  let app: NestExpressApplication | null = null;
  let user: TokensView;
  const server = () => app!.getHttpServer();
  const created: string[] = [];

  beforeAll(async () => {
    app = await startTestApp();
    if (!app) return;
    user = await loginByOtp(app);
    await db(app).update(schema.users).set({ email: testEmail('notif') }).where(eq(schema.users.id, user.user.id));
  });
  afterAll(async () => {
    if (app) {
      if (created.length) await db(app).delete(schema.notifications).where(inArray(schema.notifications.id, created));
      await db(app).delete(schema.notifications).where(eq(schema.notifications.recipientUserId, user.user.id));
      await cleanupTestData(app);
    }
    await app?.close();
  });

  const delivery = () => app!.get(NotificationDeliveryService);
  const outbox = () => app!.get(NotificationsOutbox);
  const rows = (template: string, userId = user.user.id) =>
    db(app!).select().from(schema.notifications).where(and(eq(schema.notifications.recipientUserId, userId), eq(schema.notifications.template, template)));
  const token = (label: string) => `ExponentPushToken[${label}-${Math.random().toString(36).slice(2, 10)}]`;

  it('chaque ligne de la matrice 5.14 : gabarit en français et en anglais, canaux de la matrice, envoi par chaque canal', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const device = token('matrix');
    const [dev] = await db(app).insert(schema.devices).values({ userId: user.user.id, platform: 'ios', pushToken: device }).returning();
    const push = app.get<MockPushProvider>(PUSH_PROVIDER);
    const email = app.get<MockEmailProvider>(EMAIL_PROVIDER);
    const sms = app.get<MockSmsProvider>(SMS_PROVIDER);
    for (const rule of NOTIFICATION_MATRIX) {
      expect(hasTemplate(rule.template), rule.template).toBe(true);
      const data = { rideId: '00000000-0000-4000-8000-000000000001', publicNumber: 'NM-2026-09-26-0001', finalPriceCents: 4_250, requestedAt: '2026-09-27T12:00:00Z', netCents: 10_000, remaining: 3, feeCents: 500 };
      const fr = renderNotification(rule.template, data, 'fr');
      const en = renderNotification(rule.template, data, 'en');
      expect(fr.title).not.toBe('Neomoov');
      expect(en.body).not.toBe(fr.body);
      if (rule.audience === 'passenger') continue;
      await outbox().queue({ recipientUserId: user.user.id, template: rule.template, data });
      const queued = await rows(rule.template);
      expect(queued.map((r) => r.channel).sort(), rule.template).toEqual([...rule.channels].sort());
      for (const row of queued) {
        created.push(row.id);
        expect(await delivery().deliver(row.id), `${rule.template} ${row.channel}`).toBe('sent');
      }
      const sent = await rows(rule.template);
      expect(sent.every((r) => r.sentAt && !r.error && r.providerMessageId && !r.providerMessageId.startsWith('claim:'))).toBe(true);
    }
    // Les envois sont bien partis par les fournisseurs, dans la langue du destinataire.
    expect(push.sent.some((p) => p.tokens.includes(device) && p.title === 'Course terminée')).toBe(true);
    expect(email.sent.some((e) => e.subject.startsWith('Relevé hebdomadaire'))).toBe(true);
    expect(sms.sent.some((s) => s.body.includes('Rappel') || s.body.includes('prévue'))).toBe(true);
    // Rejouée, une notification déjà envoyée ne repart pas.
    const [first] = await rows('ride.completed');
    expect(await delivery().deliver(first!.id)).toBe('skipped');
    await db(app).delete(schema.devices).where(eq(schema.devices.id, dev!.id));
  });

  it('repli texto d\'un événement critique sans appareil ; événement ordinaire en erreur ; appareil désinstallé retiré', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const sms = app.get<MockSmsProvider>(SMS_PROVIDER);
    const client = await loginByOtp(app);
    await outbox().queue({ recipientUserId: client.user.id, template: 'ride.assigned', data: { rideId: 'r-critical' } });
    const [assigned] = await rows('ride.assigned', client.user.id);
    expect(await delivery().deliver(assigned!.id)).toBe('sent');
    const [afterFallback] = await rows('ride.assigned', client.user.id);
    expect(afterFallback!.data).toMatchObject({ fallback: { channel: 'sms', reason: 'no_device' } });
    expect(sms.sent.find((s) => s.messageId === afterFallback!.providerMessageId)?.to).toBe(client.user.phone);

    await outbox().queue({ recipientUserId: client.user.id, template: 'pack.low', data: { remaining: 3 } });
    const [low] = await rows('pack.low', client.user.id);
    expect(await delivery().deliver(low!.id)).toBe('failed');
    expect((await rows('pack.low', client.user.id))[0]!.error).toBe('no_device');

    const dead = token('dead');
    await db(app).insert(schema.devices).values({ userId: client.user.id, platform: 'android', pushToken: dead });
    await outbox().queue({ recipientUserId: client.user.id, template: 'ride.driver_arrived', data: { rideId: 'r-arrived' } });
    const [arrived] = await rows('ride.driver_arrived', client.user.id);
    expect(await delivery().deliver(arrived!.id)).toBe('sent');
    expect((await rows('ride.driver_arrived', client.user.id))[0]!.data).toMatchObject({ fallback: { channel: 'sms', reason: 'DeviceNotRegistered' } });
    const devices = await db(app).select().from(schema.devices).where(eq(schema.devices.userId, client.user.id));
    expect(devices.every((d) => d.pushToken === null)).toBe(true);

    // Tiers sans compte : texto seulement.
    await outbox().queue({ recipientUserId: null, recipientAddress: '+19995550123', template: 'ride.assigned', data: { rideId: 'r-guest' } });
    const [guest] = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.recipientAddress, '+19995550123'), eq(schema.notifications.template, 'ride.assigned')));
    created.push(guest!.id);
    expect(guest!.channel).toBe('sms');
    expect(await delivery().deliver(guest!.id)).toBe('sent');
    await db(app).delete(schema.notifications).where(eq(schema.notifications.recipientUserId, client.user.id));
  });

  it('courriel du relevé : attend son PDF, puis le joint ; sans PDF après 10 minutes, part sans pièce jointe', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    await db(app).update(schema.users).set({ email: testEmail('releve') }).where(eq(schema.users.id, driver.userId));
    const [statement] = await db(app).insert(schema.weeklyStatements).values({ driverId: driver.driverId, periodStart: '2026-03-02', periodEnd: '2026-03-08', status: 'issued', netCents: 1_000, creditsCents: 1_000 }).returning();
    await outbox().queue({ recipientUserId: driver.userId, template: 'statement.issued', data: { statementId: statement!.id, periodStart: '2026-03-02', periodEnd: '2026-03-08', netCents: 1_000 } });
    const [mail] = (await rows('statement.issued', driver.userId)).filter((r) => r.channel === 'email');
    expect(await delivery().deliver(mail!.id)).toBe('deferred');
    expect((await rows('statement.issued', driver.userId)).find((r) => r.id === mail!.id)!.providerMessageId).toBeNull();

    const storage = app.get<MockStorageProvider>(STORAGE_PROVIDER);
    await storage.putObject({ key: `statements/test/${statement!.id}.pdf`, body: Buffer.from('%PDF-1.7 test'), contentType: 'application/pdf' });
    await db(app).update(schema.weeklyStatements).set({ pdfKey: `statements/test/${statement!.id}.pdf` }).where(eq(schema.weeklyStatements.id, statement!.id));
    expect(await delivery().deliver(mail!.id)).toBe('sent');
    const email = app.get<MockEmailProvider>(EMAIL_PROVIDER);
    expect(email.sent.at(-1)).toMatchObject({ attachments: ['releve-2026-03-02.pdf'] });

    await outbox().queue({ recipientUserId: driver.userId, template: 'statement.issued', data: { statementId: '00000000-0000-4000-8000-00000000dead', netCents: 0 } });
    const late = (await rows('statement.issued', driver.userId)).find((r) => r.channel === 'email' && r.id !== mail!.id)!;
    expect(await delivery().deliver(late.id, new Date(Date.now() + 11 * 60_000))).toBe('sent');
    expect(email.sent.at(-1)!.attachments).toEqual([]);
    await db(app).delete(schema.notifications).where(eq(schema.notifications.recipientUserId, driver.userId));
  });

  it('reçus push et statut de livraison des textos (webhook Twilio signé)', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    await db(app).insert(schema.devices).values({ userId: client.user.id, platform: 'ios', pushToken: token('receipt') });
    await outbox().queue({ recipientUserId: client.user.id, template: 'ride.no_driver', data: { rideId: 'r-receipt' } });
    const [pushed] = await rows('ride.no_driver', client.user.id);
    await delivery().deliver(pushed!.id);
    expect(await delivery().pollReceipts(new Date(Date.now() + 60_000))).toBeGreaterThanOrEqual(1);
    expect((await rows('ride.no_driver', client.user.id))[0]!.deliveredAt).not.toBeNull();

    await outbox().queue({ recipientUserId: null, recipientAddress: '+19995550188', template: 'ride.passenger_tracking', data: { trackingUrl: 'https://neomoov.net/suivi/x' } });
    const [texted] = await db(app).select().from(schema.notifications).where(eq(schema.notifications.recipientAddress, '+19995550188'));
    created.push(texted!.id);
    await delivery().deliver(texted!.id);
    const [sent] = await db(app).select().from(schema.notifications).where(eq(schema.notifications.id, texted!.id));
    const bad = await request(server()).post('/v1/webhooks/twilio/status').type('form').set('x-twilio-signature', 'faux').send({ MessageSid: sent!.providerMessageId, MessageStatus: 'delivered' });
    expect(bad.status).toBe(400);
    const ok = await request(server()).post('/v1/webhooks/twilio/status').type('form').set('x-twilio-signature', 'mock-signature').send({ MessageSid: sent!.providerMessageId, MessageStatus: 'delivered' }).expect(200);
    expect(ok.body).toEqual({ received: true, matched: true });
    expect((await db(app).select().from(schema.notifications).where(eq(schema.notifications.id, texted!.id)))[0]!.deliveredAt).not.toBeNull();
    await db(app).delete(schema.notifications).where(eq(schema.notifications.recipientUserId, client.user.id));
  });
});
