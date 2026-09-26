import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, startTestApp } from './helpers.js';

/** Assistance : le chauffeur écrit à l'équipe (sans l'agent relation client), l'équipe répond et termine depuis My Hub. */
describe('assistance des chauffeurs et réponse de l\'équipe (intégration)', () => {
  let app: NestExpressApplication | null = null;
  const server = () => app!.getHttpServer();

  beforeAll(async () => {
    app = await startTestApp({ AGENT_TRIGGERS: 'on' });
  });
  afterAll(async () => {
    if (app) await cleanupTestData(app);
    await app?.close();
  });

  it('message du chauffeur remis à l\'équipe avec accusé, réponse par notification, conversation terminée ; refusé sans profil chauffeur', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const driver = await createDriver(app);
    const operator = await createStaffAndLogin(app, ['operator']);
    const readonly = await createStaffAndLogin(app, ['readonly']);
    await request(server()).post('/v1/me/support/messages').set(bearer(driver.tokens)).send({ text: 'Mon relevé de la semaine est incomplet', audience: 'driver' }).expect(202);
    const own = await request(server()).get('/v1/me/support/conversation').set(bearer(driver.tokens)).expect(200);
    expect(own.body.conversation).toMatchObject({ status: 'escalated', channel: 'app' });
    expect(own.body.conversation.escalationReason).toMatch(/^driver_support/);
    expect(own.body.conversation.messages.map((m: { direction: string; author: string }) => `${m.direction}:${m.author}`)).toEqual(['inbound:client', 'outbound:system']);
    // Aucun appel à l'agent relation client pour un chauffeur.
    const runs = await db(app).select().from(schema.agentRuns).where(eq(schema.agentRuns.agentCode, 'customer_relations'));
    expect(runs.filter((r) => JSON.stringify(r.input).includes(own.body.conversation.id))).toHaveLength(0);
    const alerts = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.recipientUserId, operator.userId), eq(schema.notifications.template, 'alert.agent_escalation')));
    expect(alerts).not.toHaveLength(0);

    const id = own.body.conversation.id as string;
    expect((await request(server()).post(`/v1/admin/conversations/${id}/messages`).set(bearer(readonly.tokens)).send({ text: 'Bonjour' })).status).toBe(403);
    const replied = await request(server()).post(`/v1/admin/conversations/${id}/messages`).set(bearer(operator.tokens)).send({ text: 'Le relevé est corrigé, merci.', close: true }).expect(200);
    expect(replied.body.status).toBe('closed');
    expect(replied.body.messages.at(-1)).toMatchObject({ direction: 'outbound', author: 'staff', body: 'Le relevé est corrigé, merci.' });
    const pushed = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.recipientUserId, driver.userId), eq(schema.notifications.template, 'agent.reply')));
    expect(pushed.some((n) => n.channel === 'push')).toBe(true);
    const again = await request(server()).post(`/v1/admin/conversations/${id}/messages`).set(bearer(operator.tokens)).send({ text: 'Encore ?' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('CONVERSATION_CLOSED');

    const client = await loginByOtp(app, undefined, {}, { card: false });
    const refused = await request(server()).post('/v1/me/support/messages').set(bearer(client)).send({ text: 'Bonjour', audience: 'driver' });
    expect(refused.status).toBe(404);
    expect(refused.body.code).toBe('DRIVER_NOT_FOUND');
  });
});
