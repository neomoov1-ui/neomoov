import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, inArray, or } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockEmailProvider, MockLlmProvider, MockMailboxProvider, MockSmsProvider, MockSocialProvider } from '../src/adapters/mock/index.js';
import { EMAIL_PROVIDER, LLM_PROVIDER, MAILBOX_PROVIDER, SMS_PROVIDER, SOCIAL_PROVIDER } from '../src/adapters/types.js';
import { SettingsService } from '../src/common/settings.service.js';
import { QueueService } from '../src/infra/queue.module.js';
import { CustomerRelationsAgent } from '../src/modules/agents/customer-relations.agent.js';
import { InboxJobsService } from '../src/modules/inbox/inbox-jobs.service.js';
import { NotificationDeliveryService } from '../src/modules/notifications/notification-delivery.service.js';
import { bearer, cleanupTestData, createStaffAndLogin, db, startTestApp, testEmail, type StaffSession } from './helpers.js';

/**
 * Boîte de réception unifiée (phase 1 « entreprise autonome », agent D) avec les fournisseurs simulés : courriel entrant
 * (relais Brevo et lecture IMAP) → conversation `email`, accusé puis réponse de l'agent par courriel dans le fil, doublon
 * ignoré, courriel automatique classé sans réponse ; message Messenger → conversation `social` répondue par le connecteur ;
 * commentaire négatif → escalade avec réponse publique neutre ; appel manqué → conversation `voice`, texto et rappel ;
 * relais manuel d'un réseau sans connecteur ; heures silencieuses ; écran Boîte de réception (liste, filtres, résumé).
 */
const INBOUND_SECRET = 'secret-de-test-du-relais-entrant';
const rand = () => Math.random().toString(36).slice(2, 10);

async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, label: string, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > deadline) throw new Error(`Délai dépassé : ${label} (${JSON.stringify(value)})`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

describe('boîte de réception unifiée : courriel, réseaux sociaux, appels manqués, relais (intégration)', () => {
  let app: NestExpressApplication | null = null;
  let llm: MockLlmProvider;
  let email: MockEmailProvider;
  let social: MockSocialProvider;
  let mailbox: MockMailboxProvider;
  let sms: MockSmsProvider;
  let operator: StaffSession;
  const server = () => app!.getHttpServer();
  const addresses: string[] = [];
  const phones: string[] = [];
  const callIds: string[] = [];

  beforeAll(async () => {
    app = await startTestApp({ AGENT_TRIGGERS: 'on', EMAIL_INBOUND_SECRET: INBOUND_SECRET });
    if (!app) return;
    llm = app.get<MockLlmProvider>(LLM_PROVIDER);
    email = app.get<MockEmailProvider>(EMAIL_PROVIDER);
    social = app.get<MockSocialProvider>(SOCIAL_PROVIDER);
    mailbox = app.get<MockMailboxProvider>(MAILBOX_PROVIDER);
    sms = app.get<MockSmsProvider>(SMS_PROVIDER);
    operator = await createStaffAndLogin(app, ['operator']);
  });
  beforeEach(() => {
    if (!app) return;
    llm.scripts.length = 0;
    llm.requests.length = 0;
  });
  afterAll(async () => {
    if (app) {
      const database = db(app);
      const conversations = await database
        .select({ id: schema.conversations.id })
        .from(schema.conversations)
        .where(or(...(addresses.length ? [inArray(schema.conversations.address, addresses)] : []), ...(phones.length ? [inArray(schema.conversations.phone, phones)] : [])));
      const ids = conversations.map((c) => c.id);
      if (ids.length) {
        const messages = await database.select({ externalId: schema.conversationMessages.externalId }).from(schema.conversationMessages).where(inArray(schema.conversationMessages.conversationId, ids));
        const refs = messages.map((m) => m.externalId).filter((e): e is string => Boolean(e));
        if (refs.length) {
          await database.update(schema.conversationMessages).set({ agentRunId: null }).where(inArray(schema.conversationMessages.conversationId, ids));
          await database.delete(schema.agentRuns).where(and(eq(schema.agentRuns.agentCode, 'customer_relations'), inArray(schema.agentRuns.triggerRef, refs)));
        }
        await database.delete(schema.conversations).where(inArray(schema.conversations.id, ids));
      }
      if (callIds.length) await database.delete(schema.agentRuns).where(and(eq(schema.agentRuns.agentCode, 'voice_call_center'), inArray(schema.agentRuns.triggerRef, callIds)));
      const recipients = [...addresses, ...phones];
      if (recipients.length) await database.delete(schema.notifications).where(inArray(schema.notifications.recipientAddress, recipients));
      if (operator) await database.delete(schema.notifications).where(eq(schema.notifications.recipientUserId, operator.userId));
      await cleanupTestData(app);
    }
    await app?.close();
  });

  const conversationsOf = async (where: { address?: string; phone?: string }) => {
    const [conversation] = await db(app!)
      .select()
      .from(schema.conversations)
      .where(where.address ? eq(schema.conversations.address, where.address) : eq(schema.conversations.phone, where.phone ?? ''))
      .orderBy(schema.conversations.createdAt)
      .limit(1);
    const messages = conversation ? await db(app!).select().from(schema.conversationMessages).where(eq(schema.conversationMessages.conversationId, conversation.id)).orderBy(schema.conversationMessages.createdAt) : [];
    return { conversation, messages };
  };
  const notificationsTo = (address: string) => db(app!).select().from(schema.notifications).where(eq(schema.notifications.recipientAddress, address)).orderBy(schema.notifications.createdAt);
  /** Attend que les avis mis en file existent (l'avis est inséré juste après le message), puis les envoie. */
  const deliverAll = async (address: string, expected = 1) => {
    const delivery = app!.get(NotificationDeliveryService);
    const outcomes: string[] = [];
    const rows = await until(() => notificationsTo(address), (n) => n.length >= expected, 'avis en file');
    for (const n of rows) if (!n.sentAt) outcomes.push(await delivery.deliver(n.id));
    return outcomes;
  };
  const scriptReply = (text: string, classification: Record<string, unknown> = {}) =>
    llm.script((req) => (req.schemaName === 'classification'
      ? { output: { category: 'question', language: 'fr', safetyComplaint: false, hostile: false, sentiment: 'neutral', summary: 'Question', ...classification } }
      : req.kind === 'tools' ? { text } : undefined));
  const brevoItem = (from: { Name?: string; Address: string }, subject: string, text: string, extra: Record<string, unknown> = {}) => ({
    MessageId: `<${rand()}@example.com>`, From: from, To: [{ Address: 'contact@neomoov.net' }], Subject: subject, RawTextBody: text, SentAtDate: new Date().toISOString(), ...extra,
  });

  it('courriel entrant (relais Brevo) : conversation email, accusé puis réponse de l\'agent par courriel dans le fil ; doublon ignoré ; courriel automatique classé sans réponse', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const sender = testEmail('marie');
    addresses.push(sender);
    scriptReply('Le prix vers l\'aéroport est fixe : 48,20 $ depuis le centre-ville. Réservez au moins 2 heures à l\'avance dans l\'application.');
    const item = brevoItem({ Name: 'Marie Tremblay', Address: sender }, 'Prix pour l\'aéroport', 'Bonjour,\n\nQuel est le prix pour aller à l\'aéroport demain matin ?\n\nMerci\nMarie\n\nLe 1 oct. 2026, Neomoov <contact@neomoov.net> a écrit :\n> Votre réservation est confirmée.', {
      Attachments: [{ Name: 'billet.pdf', ContentType: 'application/pdf', ContentLength: 1234 }], Headers: { 'Content-Type': 'multipart/mixed' },
    });
    expect((await request(server()).post('/v1/webhooks/email').query({ secret: 'faux' }).send({ items: [item] })).status).toBe(400);
    expect((await request(server()).post('/v1/webhooks/email').send({ items: [item] })).status).toBe(400);
    const accepted = await request(server()).post('/v1/webhooks/email').set('x-inbound-secret', INBOUND_SECRET).send({ items: [item] }).expect(200);
    expect(accepted.body).toEqual({ received: 1, queued: 1, automated: 0, duplicates: 0 });

    const state = await until(() => conversationsOf({ address: sender }), (s) => s.messages.length === 3, 'réponse de l\'agent par courriel');
    expect(state.conversation).toMatchObject({ channel: 'email', kind: 'message', status: 'open', address: sender, displayName: 'Marie Tremblay', subject: 'Prix pour l\'aéroport', userId: null });
    expect(state.messages.map((m) => `${m.direction}:${m.author}`)).toEqual(['inbound:client', 'outbound:system', 'outbound:agent']);
    // Citation et signature coupées ; pièces jointes listées mais jamais transmises au modèle.
    expect(state.messages[0]!.body).toBe('Bonjour,\n\nQuel est le prix pour aller à l\'aéroport demain matin ?\n\nMerci\nMarie');
    expect(state.messages[0]!.metadata).toMatchObject({ attachments: [{ name: 'billet.pdf' }] });
    expect(llm.requests.some((r) => JSON.stringify(r.messages).includes('billet.pdf'))).toBe(false);
    expect(llm.requests[0]!.messages.at(-1)!.content).toContain('canal courriel');

    // Les deux courriels partent de contact@, dans le fil du courriel reçu, avec l'objet « Re: ».
    expect(await deliverAll(sender, 2)).toEqual(['sent', 'sent']);
    const mails = email.sent.filter((m) => m.to === sender);
    expect(mails).toHaveLength(2);
    expect(mails[0]).toMatchObject({ from: 'Neomoov <contact@neomoov.net>', replyTo: 'Neomoov <contact@neomoov.net>', subject: 'Re: Prix pour l\'aéroport', headers: { 'In-Reply-To': item.MessageId, References: item.MessageId } });
    expect(mails[0]!.text).toContain('Bien reçu');
    expect(mails[1]!.text).toContain('48,20');

    // Même Message-ID reçu deux fois : rien n'est refait.
    const again = await request(server()).post('/v1/webhooks/email').set('x-inbound-secret', INBOUND_SECRET).send(item).expect(200);
    expect(again.body).toMatchObject({ received: 1, duplicates: 1 });
    expect((await conversationsOf({ address: sender })).messages.filter((m) => m.direction === 'inbound')).toHaveLength(1);

    // Réponse d'absence (Auto-Submitted) et notification sans réponse : classées, fermées, jamais confiées à l'agent.
    const robot = `no-reply-${rand()}@test.neomoov.local`;
    addresses.push(robot);
    const auto = await request(server()).post('/v1/webhooks/email').set('x-inbound-secret', INBOUND_SECRET).send({ items: [
      brevoItem({ Address: sender }, 'Réponse automatique : absente', 'Je suis absente jusqu\'au 10 octobre.', { Headers: { 'Auto-Submitted': 'auto-replied' } }),
      brevoItem({ Name: 'Notifications', Address: robot }, 'Votre facture est disponible', 'Bonjour, votre facture est prête.'),
    ] }).expect(200);
    expect(auto.body).toMatchObject({ received: 2, queued: 0, automated: 2 });
    const classified = await db(app).select().from(schema.conversations).where(eq(schema.conversations.address, sender));
    const automated = classified.find((c) => c.kind === 'automated');
    expect(automated).toMatchObject({ status: 'closed', channel: 'email' });
    // La conversation ouverte de Marie n'a pas reçu la réponse d'absence.
    expect((await conversationsOf({ address: sender })).messages).toHaveLength(3);
    expect(await notificationsTo(robot)).toEqual([]);
    const runs = await db(app).select().from(schema.agentRuns).where(and(eq(schema.agentRuns.agentCode, 'customer_relations'), eq(schema.agentRuns.trigger, 'conversation.email')));
    expect(runs.filter((r) => JSON.stringify(r.input).includes(automated!.id))).toHaveLength(0);

    // Boîte de réception : la conversation est listée comme répondue, filtrable par canal et par état.
    const listed = await request(server()).get('/v1/admin/inbox').query({ channel: 'email', pageSize: 50 }).set(bearer(operator.tokens)).expect(200);
    const row = listed.body.items.find((i: { id: string }) => i.id === state.conversation!.id);
    expect(row).toMatchObject({ channel: 'email', state: 'answered', lastDirection: 'outbound', messageCount: 3, relayPending: false, firstReplyLate: false, subject: 'Prix pour l\'aéroport', displayName: 'Marie Tremblay' });
    expect(row.firstReplySeconds).toBeGreaterThanOrEqual(0);
    expect((await request(server()).get('/v1/admin/inbox').query({ channel: 'email', state: 'awaiting', pageSize: 50 }).set(bearer(operator.tokens)).expect(200)).body.items.some((i: { id: string }) => i.id === state.conversation!.id)).toBe(false);
    const closed = await request(server()).get('/v1/admin/inbox').query({ state: 'closed', q: 'no-reply-', pageSize: 50 }).set(bearer(operator.tokens)).expect(200);
    expect(closed.body.items.some((i: { address: string }) => i.address === robot)).toBe(true);
    const detail = await request(server()).get(`/v1/admin/inbox/${state.conversation!.id}`).set(bearer(operator.tokens)).expect(200);
    expect(detail.body.messages[0]).toMatchObject({ attachments: ['billet.pdf'], relayStatus: null });
  });

  it('lecture IMAP de repli : courriel non lu → conversation ; relu plus tard : doublon', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const sender = testEmail('paul');
    addresses.push(sender);
    scriptReply('Oui, un siège enfant est offert sur demande (3 $).');
    const message = { messageId: `<imap-${rand()}@example.com>`, inReplyTo: null, references: [], from: `Paul Roy <${sender}>`, to: ['contact@neomoov.net'], subject: 'Siège enfant', text: 'Bonjour, avez-vous des sièges enfant ?', html: null, attachments: [], headers: {}, receivedAt: new Date() };
    mailbox.unseen.push(message);
    const jobs = app.get(InboxJobsService);
    expect(await jobs.pollMailbox()).toEqual({ fetched: 1, byStatus: { queued: 1, automated: 0, duplicate: 0, ignored: 0 } });
    const state = await until(() => conversationsOf({ address: sender }), (s) => s.messages.length === 3, 'réponse de l\'agent (IMAP)');
    expect(state.conversation).toMatchObject({ channel: 'email', subject: 'Siège enfant', displayName: 'Paul Roy' });
    mailbox.unseen.push(message, { ...message, messageId: null, from: 'sans adresse' });
    expect(await jobs.pollMailbox()).toEqual({ fetched: 2, byStatus: { queued: 0, automated: 0, duplicate: 1, ignored: 1 } });
  });

  it('Messenger : message privé → conversation social répondue par le connecteur ; commentaire Facebook négatif → escalade et réponse publique neutre', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const psid = `psid-test-${rand()}`;
    addresses.push(psid);
    scriptReply('Vous pouvez réserver dans l\'application Neomoov, au moins 2 heures à l\'avance.', { category: 'booking' });
    expect((await request(server()).get('/v1/webhooks/meta').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'mock-verify', 'hub.challenge': '4321' }).expect(200)).text).toBe('4321');
    expect((await request(server()).get('/v1/webhooks/meta').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'autre', 'hub.challenge': '1' })).status).toBe(403);
    const dm = { object: 'page', entry: [{ id: 'mock-page', time: Date.now(), messaging: [{ sender: { id: psid }, recipient: { id: 'mock-page' }, timestamp: Date.now(), message: { mid: `m_${rand()}`, text: 'Bonjour, je veux réserver pour demain' } }] }] };
    expect((await request(server()).post('/v1/webhooks/meta').set('x-hub-signature-256', 'faux').send(dm)).status).toBe(400);
    expect((await request(server()).post('/v1/webhooks/meta').set('x-hub-signature-256', 'mock-signature').send(dm).expect(200)).body).toEqual({ messages: 1, comments: 0 });
    const state = await until(() => conversationsOf({ address: psid }), (s) => s.messages.length === 3, 'réponse de l\'agent (Messenger)');
    expect(state.conversation).toMatchObject({ channel: 'social', network: 'messenger', kind: 'message', status: 'open', address: psid, threadRef: psid });
    expect(await deliverAll(psid, 2)).toEqual(['sent', 'sent']);
    const replies = social.sent.filter((s) => s.threadId === psid);
    expect(replies.map((r) => r.network)).toEqual(['messenger', 'messenger']);
    expect(replies[1]!.text).toContain('réserver dans l\'application');
    // Le même webhook, rejoué : rien de plus.
    await request(server()).post('/v1/webhooks/meta').set('x-hub-signature-256', 'mock-signature').send(dm).expect(200);
    expect((await conversationsOf({ address: psid })).messages).toHaveLength(3);

    // Commentaire négatif sous une publication : conversation `social` escaladée, l'équipe prévenue, réponse publique neutre.
    const author = `fb-user-${rand()}`;
    addresses.push(author);
    llm.scripts.length = 0;
    llm.requests.length = 0;
    scriptReply('ne devrait pas être appelé', { category: 'complaint', sentiment: 'negative', summary: 'Plainte publique : retard de 40 minutes' });
    const comment = { object: 'page', entry: [{ id: 'mock-page', time: Date.now(), changes: [{ field: 'feed', value: { item: 'comment', verb: 'add', comment_id: `c_${rand()}`, post_id: 'p_1', message: 'Service horrible, 40 minutes de retard et personne ne répond', from: { id: author, name: 'Jean R.' } } }] }] };
    // Les webhooks de la même application Meta sont aussi acceptés sur l'adresse WhatsApp.
    expect((await request(server()).post('/v1/webhooks/whatsapp').set('x-hub-signature-256', 'mock-signature').send(comment).expect(200)).body).toEqual({ received: 1 });
    const escalated = await until(() => conversationsOf({ address: author }), (s) => s.conversation?.status === 'escalated' && s.messages.length === 2, 'commentaire escaladé');
    expect(escalated.conversation).toMatchObject({ channel: 'social', network: 'facebook', kind: 'comment', displayName: 'Jean R.' });
    expect(escalated.conversation!.escalationReason).toMatch(/^other : /);
    expect(escalated.messages.map((m) => `${m.direction}:${m.author}`)).toEqual(['inbound:client', 'outbound:agent']);
    expect(escalated.messages[1]!.body).toContain('message privé');
    expect(llm.requests.map((r) => r.kind)).toEqual(['structured']);
    expect(await deliverAll(author)).toEqual(['sent']);
    expect(social.commentReplies.at(-1)).toMatchObject({ network: 'facebook', commentId: comment.entry[0]!.changes[0]!.value.comment_id });
    const alerts = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.recipientUserId, operator.userId), eq(schema.notifications.template, 'alert.agent_escalation')));
    expect(alerts.some((a) => (a.data as { conversationId: string }).conversationId === escalated.conversation!.id)).toBe(true);
    const listed = await request(server()).get('/v1/admin/inbox').query({ channel: 'social', state: 'escalated', pageSize: 50 }).set(bearer(operator.tokens)).expect(200);
    expect(listed.body.items.find((i: { id: string }) => i.id === escalated.conversation!.id)).toMatchObject({ network: 'facebook', kind: 'comment', state: 'escalated' });
  });

  it('appel manqué (rapport de fin d\'appel Vapi sans réservation) : conversation voice escaladée, texto « nous vous rappelons », rappel différé puis alerte si toujours ouverte', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const phone = `+1999${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
    phones.push(phone);
    const callId = `call-d-${rand()}`;
    callIds.push(callId);
    const queues = app.get(QueueService);
    const added = vi.spyOn(queues, 'add');
    const report = { message: { type: 'end-of-call-report', call: { id: callId, customer: { number: phone } }, summary: 'La personne voulait un prix pour Laval et a raccroché.', endedReason: 'customer-ended-call', cost: 0.05, durationSeconds: 20 } };
    await request(server()).post('/v1/webhooks/vapi').set('x-vapi-secret', 'mock-signature').send(report).expect(200);
    const state = await until(() => conversationsOf({ phone }), (s) => s.conversation?.status === 'escalated' && s.messages.length === 2, 'conversation de l\'appel manqué');
    expect(state.conversation).toMatchObject({ channel: 'voice', kind: 'missed_call', phone, userId: null });
    expect(state.conversation!.escalationReason).toContain('missed_call : La personne voulait un prix');
    expect(state.messages[0]).toMatchObject({ direction: 'inbound', body: 'La personne voulait un prix pour Laval et a raccroché.', metadata: { endedReason: 'customer-ended-call', reason: 'short', callId } });
    expect(state.messages[1]).toMatchObject({ direction: 'outbound', author: 'system' });
    expect(state.messages[1]!.body).toContain('rappelle');
    expect(await deliverAll(phone)).toEqual(['sent']);
    expect(sms.sent.find((s) => s.to === phone)!.body).toContain('rappelle');
    const callback = added.mock.calls.find((c) => c[0] === 'inbox' && c[1] === 'callback');
    expect(callback?.[2]).toMatchObject({ conversationId: state.conversation!.id, minutes: 60 });
    expect(callback?.[3]).toMatchObject({ jobId: `callback-${state.conversation!.id}`, delay: 3_600_000 });
    added.mockRestore();

    // Rapport rejoué : une seule conversation, un seul texto.
    await request(server()).post('/v1/webhooks/vapi').set('x-vapi-secret', 'mock-signature').send(report).expect(200);
    await new Promise((r) => setTimeout(r, 300));
    expect(await db(app).select().from(schema.conversations).where(eq(schema.conversations.phone, phone))).toHaveLength(1);
    expect(await notificationsTo(phone)).toHaveLength(1);

    // Rappel : conversation toujours ouverte, le personnel est rappelé ; conversation terminée, plus rien.
    const jobs = app.get(InboxJobsService);
    expect(await jobs.callbackDue(state.conversation!.id, 60)).toBe(true);
    const due = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.recipientUserId, operator.userId), eq(schema.notifications.template, 'alert.callback_due')));
    expect(due.some((n) => (n.data as { conversationId: string }).conversationId === state.conversation!.id)).toBe(true);
    expect(JSON.stringify(due[0]!.data)).not.toContain(phone);
    await request(server()).post(`/v1/admin/conversations/${state.conversation!.id}/messages`).set(bearer(operator.tokens)).send({ text: 'Rappel fait, réservation prise par téléphone.', close: true }).expect(200);
    expect(await jobs.callbackDue(state.conversation!.id, 60)).toBe(false);
  });

  it('relais manuel : message collé d\'un réseau sans connecteur → réponse préparée par l\'agent, à relayer puis marquée relayée', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    scriptReply('Merci pour votre message ! Nous desservons le Grand Montréal ; Québec n\'est pas encore couverte.');
    const sentBefore = social.sent.length;
    const readonly = await createStaffAndLogin(app, ['readonly']);
    const body = { network: 'tiktok', kind: 'comment', from: '@Marie.Qc', text: 'Est-ce que vous allez jusqu\'à Québec ?', link: 'https://www.tiktok.com/@neomoov/video/1' };
    expect((await request(server()).post('/v1/admin/inbox/relay').set(bearer(readonly.tokens)).send(body)).status).toBe(403);
    expect((await request(server()).post('/v1/admin/inbox/relay').set(bearer(operator.tokens)).send({ ...body, network: 'messenger' })).status).toBe(400);
    const relayed = await request(server()).post('/v1/admin/inbox/relay').set(bearer(operator.tokens)).send(body).expect(200);
    addresses.push(relayed.body.address);
    expect(relayed.body).toMatchObject({ channel: 'social', network: 'tiktok', kind: 'comment', status: 'open', relayPending: true, displayName: '@Marie.Qc', address: 'tiktok:marie.qc' });
    expect(relayed.body.messages.map((m: { direction: string; author: string; relayStatus: string | null }) => `${m.direction}:${m.author}:${m.relayStatus}`)).toEqual(['inbound:client:null', 'outbound:agent:pending']);
    expect(relayed.body.messages[1].body).toContain('Grand Montréal');
    // Rien ne part par un connecteur, aucun avis mis en file.
    expect(social.sent).toHaveLength(sentBefore);
    expect(await notificationsTo(relayed.body.address)).toEqual([]);
    const pending = await request(server()).get('/v1/admin/inbox').query({ state: 'relay', pageSize: 50 }).set(bearer(operator.tokens)).expect(200);
    expect(pending.body.items.find((i: { id: string }) => i.id === relayed.body.id)).toMatchObject({ state: 'relay', relayPending: true, network: 'tiktok' });
    const summary = await request(server()).get('/v1/admin/inbox/summary').set(bearer(operator.tokens)).expect(200);
    expect(summary.body.relayPending).toBeGreaterThanOrEqual(1);
    expect(summary.body.firstReplySeconds).toBe(5);
    expect(summary.body.byChannel.find((c: { channel: string }) => c.channel === 'social')?.open).toBeGreaterThanOrEqual(1);

    const messageId = relayed.body.messages[1].id as string;
    const done = await request(server()).post(`/v1/admin/inbox/messages/${messageId}/relayed`).set(bearer(operator.tokens)).expect(200);
    expect(done.body.relayPending).toBe(false);
    expect(done.body.messages[1].relayStatus).toBe('done');
    expect((await request(server()).post(`/v1/admin/inbox/messages/${messageId}/relayed`).set(bearer(operator.tokens))).status).toBe(404);
    // Une réponse de l'équipe sur ce réseau attend elle aussi d'être relayée.
    const staff = await request(server()).post(`/v1/admin/conversations/${relayed.body.id}/messages`).set(bearer(operator.tokens)).send({ text: 'Nous vous tiendrons au courant pour Québec.' }).expect(200);
    expect(staff.body.messages.at(-1)).toMatchObject({ author: 'staff', relayStatus: 'pending' });
    expect(staff.body.relayPending).toBe(true);
  });

  it('heures silencieuses : accusé seulement, réponse de fond différée par une tâche, puis reprise', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const sender = testEmail('nuit');
    addresses.push(sender);
    const settings = app.get(SettingsService);
    const originalGet = settings.get.bind(settings);
    const quiet = vi.spyOn(settings, 'get').mockImplementation(async (key: string, fallback: unknown) => (key === 'inbox.quiet_hours' ? { from: '00:00', to: '23:59', channels: ['email'] } : originalGet(key, fallback)));
    const queues = app.get(QueueService);
    const originalAdd = queues.add.bind(queues);
    // Seule la tâche différée (reprise) est interceptée ; le message entrant suit la file comme d'habitude.
    const added = vi.spyOn(queues, 'add').mockImplementation(async (name, job, data, options) => (options?.delay ? undefined : originalAdd(name, job, data, options)));
    scriptReply('Réponse du matin.');
    const item = brevoItem({ Name: 'Noctambule', Address: sender }, 'Question de nuit', 'Vous êtes ouverts la nuit ?');
    try {
      await request(server()).post('/v1/webhooks/email').set('x-inbound-secret', INBOUND_SECRET).send({ items: [item] }).expect(200);
      const state = await until(() => conversationsOf({ address: sender }), (s) => s.messages.length === 2, 'accusé des heures silencieuses');
      expect(state.messages[1]!.body).toContain('reprend à 23 h 59');
      expect(llm.requests).toHaveLength(0);
      // La tâche différée est mise en file juste après l'accusé : attendue à son tour.
      const deferred = await until(async () => added.mock.calls.find((c) => c[0] === 'agents' && c[1] === 'conversation' && (c[2] as { resumed?: boolean }).resumed === true), (c) => c !== undefined, 'tâche différée');
      expect(deferred?.[2]).toMatchObject({ resumed: true, channel: 'email', address: sender });
      expect(deferred?.[3]).toMatchObject({ jobId: expect.stringMatching(/-resume$/) });
      expect((deferred?.[3] as { delay: number }).delay).toBeGreaterThan(0);
      expect((await request(server()).get('/v1/admin/inbox').query({ state: 'awaiting', channel: 'email', pageSize: 50 }).set(bearer(operator.tokens)).expect(200)).body.items.some((i: { id: string }) => i.id === state.conversation!.id)).toBe(false);

      // Reprise à la fin de la fenêtre : la réponse de fond part, sans nouvel accusé.
      quiet.mockRestore();
      const resumed = await app.get(CustomerRelationsAgent).handleInbound(deferred![2] as never, { resumed: true });
      expect(resumed?.run?.status).toBe('succeeded');
      const after = await conversationsOf({ address: sender });
      expect(after.messages.map((m) => m.author)).toEqual(['client', 'system', 'agent']);
      expect(after.messages[2]!.body).toBe('Réponse du matin.');
    } finally {
      quiet.mockRestore();
      added.mockRestore();
    }
  });
});
