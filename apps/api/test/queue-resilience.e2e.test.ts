import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MockSmsProvider } from '../src/adapters/mock/index.js';
import { SMS_PROVIDER } from '../src/adapters/types.js';
import { NotificationDeliveryService } from '../src/modules/notifications/notification-delivery.service.js';
import { NotificationsOutbox } from '../src/modules/rides/notifications-outbox.js';
import { startTestApp, db, testPhone } from './helpers.js';

/**
 * Résilience des files (prompt 15, tâche 5) : un worker arrêté en plein envoi ne fait ni perte ni doublon. La reprise
 * (`sweep`, toutes les 30 secondes) envoie ce qu'aucun processus n'a pris, libère une réservation abandonnée depuis
 * 10 minutes et ne touche jamais un envoi en cours ailleurs, même sur une notification ancienne. Les autres traitements
 * rejouables (paiements, factures, registres, relevés) sont couverts par leurs tests de rejeu (clés d'idempotence).
 */
describe('résilience des files : redémarrage du worker (intégration)', () => {
  let app: NestExpressApplication | null = null;
  const ids: string[] = [];

  beforeAll(async () => {
    app = await startTestApp();
  });
  afterAll(async () => {
    if (app && ids.length) await db(app).delete(schema.notifications).where(inArray(schema.notifications.id, ids));
    await app?.close();
  });

  it('réservation abandonnée reprise une fois, envoi en cours ailleurs jamais doublé, tâche perdue envoyée', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const outbox = app.get(NotificationsOutbox);
    const delivery = app.get(NotificationDeliveryService);
    const sms = app.get<MockSmsProvider>(SMS_PROVIDER);
    const phones = { dead: testPhone(), busy: testPhone(), lost: testPhone() };
    for (const to of Object.values(phones)) {
      await outbox.queue({ recipientUserId: null, recipientAddress: to, template: 'ride.passenger_tracking', data: { trackingUrl: 'https://neomoov.net/suivi/r' } });
    }
    const rows = await db(app).select().from(schema.notifications).where(inArray(schema.notifications.recipientAddress, Object.values(phones)));
    ids.push(...rows.map((r) => r.id));
    const byPhone = (to: string) => rows.find((r) => r.recipientAddress === to)!;
    const now = Date.now();
    // Worker arrêté il y a 11 minutes en plein envoi ; autre worker en train d'envoyer une notification vieille de 20 minutes.
    await db(app).update(schema.notifications).set({ providerMessageId: `claim:${now - 11 * 60_000}:arrete` }).where(eq(schema.notifications.id, byPhone(phones.dead).id));
    await db(app).update(schema.notifications).set({ providerMessageId: `claim:${now - 5_000}:en-cours`, createdAt: new Date(now - 20 * 60_000) }).where(eq(schema.notifications.id, byPhone(phones.busy).id));

    const sentTo = (to: string) => sms.sent.filter((m) => m.to === to).length;
    await delivery.sweep(new Date(now), { ids });
    await delivery.sweep(new Date(now), { ids });
    expect(sentTo(phones.dead)).toBe(1);
    expect(sentTo(phones.lost)).toBe(1);
    expect(sentTo(phones.busy)).toBe(0);
    const [busy] = await db(app).select().from(schema.notifications).where(eq(schema.notifications.id, byPhone(phones.busy).id));
    expect(busy).toMatchObject({ sentAt: null, providerMessageId: `claim:${now - 5_000}:en-cours` });
    // Le worker « en cours » meurt à son tour : sa réservation est reprise 10 minutes plus tard, une seule fois.
    await delivery.sweep(new Date(now + 11 * 60_000), { ids });
    await delivery.sweep(new Date(now + 11 * 60_000), { ids });
    expect(sentTo(phones.busy)).toBe(1);
    expect(sentTo(phones.dead)).toBe(1);
  });
});
