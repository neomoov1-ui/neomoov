import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MockSocialProvider } from '../src/adapters/mock/index.js';
import { SOCIAL_PUBLISHERS, type SocialPublishers } from '../src/adapters/marketing.types.js';
import type { MockSocialPublisher } from '../src/adapters/mock/marketing.mock.js';
import { SOCIAL_PROVIDER } from '../src/adapters/types.js';
import { SettingsService } from '../src/common/settings.service.js';
import { AgentToolsService } from '../src/modules/agents/agent-tools.service.js';
import { ConversationsService } from '../src/modules/agents/conversations.service.js';
import { InboundEmailService } from '../src/modules/inbox/inbound-email.service.js';
import { MOCK_TIDIO_SECRET } from '../src/modules/inbox/inbox.controller.js';
import { PublishingService } from '../src/modules/marketing/publishing.service.js';
import { NotificationDeliveryService } from '../src/modules/notifications/notification-delivery.service.js';
import { DispatchService } from '../src/modules/rides/dispatch.service.js';
import { ScheduledService } from '../src/modules/rides/scheduled.service.js';
import { bearer, cleanupTestData, createStaffAndLogin, db, loginByOtp, startTestApp, testEmail, type StaffSession } from './helpers.js';

/**
 * Finalisation du 3 octobre 2026 (agent U3, exploitation et communications) avec les fournisseurs simulés : fenêtre de
 * 24 heures de Meta (étiquette HUMAN_AGENT, autre canal, personnel), discussion du site Tidio vers la boîte, retrait
 * « STOP » et réponse d'un prospect reçus par courriel, indicateurs de la boîte au rapport quotidien, diffusion par outils
 * déclarés et infolettre automatique derrière son réglage, attribution planifiée rattrapée après un signal perdu.
 */
const rand = () => Math.random().toString(36).slice(2, 10);
const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };

async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, label: string, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > deadline) throw new Error(`Délai dépassé : ${label} (${JSON.stringify(value)})`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

describe('finalisation U3 : boîte unifiée, ventes, diffusion, attribution planifiée (intégration)', () => {
  let app: NestExpressApplication | null = null;
  let operator: StaffSession;
  let social: MockSocialProvider;
  const server = () => app!.getHttpServer();
  const started = new Date();
  const addresses: string[] = [];
  const prospectIds: string[] = [];
  const contentIds: string[] = [];
  const overrides = new Map<string, unknown>();

  beforeAll(async () => {
    app = await startTestApp();
    if (!app) return;
    operator = await createStaffAndLogin(app, ['operator']);
    social = app.get<MockSocialProvider>(SOCIAL_PROVIDER);
    // Réglages forcés par un essai (cache des réglages de 60 secondes : on lit la valeur voulue sans écrire en base partagée).
    const settings = app.get(SettingsService);
    const originalGet = settings.get.bind(settings);
    vi.spyOn(settings, 'get').mockImplementation(async (key: string, fallback: unknown) => (overrides.has(key) ? overrides.get(key) : originalGet(key, fallback)) as never);
  });
  afterEach(() => overrides.clear());
  afterAll(async () => {
    if (app) {
      const database = db(app);
      const conversations = addresses.length ? await database.select({ id: schema.conversations.id }).from(schema.conversations).where(inArray(schema.conversations.address, addresses)) : [];
      const ids = conversations.map((c) => c.id);
      if (ids.length) await database.delete(schema.conversations).where(inArray(schema.conversations.id, ids));
      if (addresses.length) await database.delete(schema.notifications).where(inArray(schema.notifications.recipientAddress, addresses));
      if (prospectIds.length) await database.delete(schema.prospects).where(inArray(schema.prospects.id, prospectIds));
      if (contentIds.length) await database.delete(schema.contentItems).where(inArray(schema.contentItems.id, contentIds));
      await database.delete(schema.agentRuns).where(and(eq(schema.agentRuns.agentCode, 'publishing'), gte(schema.agentRuns.startedAt, started)));
      await database.delete(schema.notifications).where(eq(schema.notifications.recipientUserId, operator.userId));
      await cleanupTestData(app);
    }
    vi.restoreAllMocks();
    await app?.close();
  });

  const conversations = () => app!.get(ConversationsService);
  const messagesOf = (conversationId: string) => db(app!).select().from(schema.conversationMessages).where(eq(schema.conversationMessages.conversationId, conversationId)).orderBy(schema.conversationMessages.createdAt);
  const socialNotices = (conversationId: string) => db(app!).select().from(schema.notifications).where(and(eq(schema.notifications.channel, 'social'), sql`${schema.notifications.data}->>'conversationId' = ${conversationId}`));
  const openSocial = async (network: 'messenger' | 'instagram', userId: string | null = null) => {
    const psid = `psid-${rand()}`;
    addresses.push(psid);
    const { conversation } = await conversations().receive({ channel: 'social', externalId: `social:${network}:${rand()}`, userId, phone: null, text: 'Bonjour, une question sur ma course', language: 'fr', rideId: null, address: psid, network, kind: 'message', threadRef: psid });
    return { conversation, psid };
  };
  const ageInbound = (conversationId: string, hours: number) => db(app!).execute(sql`UPDATE conversation_messages SET created_at = now() - make_interval(hours => ${hours}) WHERE conversation_id = ${conversationId}::uuid AND direction = 'inbound'`);

  it('fenêtre de 24 heures de Meta : hors fenêtre, réponse du personnel à relayer et remise au personnel ; étiquette HUMAN_AGENT si Meta l\'a permise ; agent jamais étiqueté', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const { conversation, psid } = await openSocial('messenger');
    await ageInbound(conversation.id, 25);

    // Réglage désactivé (défaut) : aucun envoi chez Meta, réponse à relayer, conversation remise au personnel.
    await request(server()).post(`/v1/admin/conversations/${conversation.id}/messages`).set(bearer(operator.tokens)).send({ text: 'Bonjour, voici la réponse à votre question.', close: false }).expect(200);
    let messages = await messagesOf(conversation.id);
    expect(messages.at(-1)).toMatchObject({ direction: 'outbound', author: 'staff', relayStatus: 'pending', metadata: { deliveryFallback: 'meta_window_closed' } });
    expect(await socialNotices(conversation.id)).toHaveLength(0);
    const escalated = await conversations().get(conversation.id);
    expect(escalated.status).toBe('escalated');
    expect(escalated.escalationReason).toContain('meta_window_closed');

    // Permission « Human Agent » accordée : la réponse du personnel part étiquetée, dans les 7 jours.
    overrides.set('inbox.meta_human_agent_tag', true);
    await request(server()).post(`/v1/admin/conversations/${conversation.id}/messages`).set(bearer(operator.tokens)).send({ text: 'Complément de réponse.', close: false }).expect(200);
    const [notice] = await until(() => socialNotices(conversation.id), (n) => n.length === 1, 'réponse étiquetée en file');
    expect(notice!.data).toMatchObject({ network: 'messenger', threadRef: psid, tag: 'HUMAN_AGENT' });
    await app.get(NotificationDeliveryService).deliver(notice!.id);
    await until(async () => social.sent.filter((s) => s.threadId === psid), (s) => s.length === 1, 'réponse étiquetée envoyée');
    expect(social.sent.find((s) => s.threadId === psid)).toMatchObject({ network: 'messenger', tag: 'HUMAN_AGENT', text: 'Complément de réponse.' });

    // Réponse de l'agent hors fenêtre : jamais étiquetée (réservée aux humains), donc à relayer.
    await conversations().send(await conversations().get(conversation.id), 'Réponse automatique tardive', 'agent');
    messages = await messagesOf(conversation.id);
    expect(messages.at(-1)).toMatchObject({ author: 'agent', relayStatus: 'pending' });
    expect(await socialNotices(conversation.id)).toHaveLength(1);
  });

  it('refus de Meta à l\'envoi (fenêtre close) : pas de nouvel essai, réponse transmise par le courriel du compte', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const email = testEmail('meta');
    addresses.push(email);
    await db(app).update(schema.users).set({ email }).where(eq(schema.users.id, client.user.id));
    const { conversation, psid } = await openSocial('instagram', client.user.id);
    social.closedThreads.add(psid);
    const messageId = await conversations().send(conversation, 'Votre chauffeur arrive dans 5 minutes.', 'agent');
    const [notice] = await until(() => socialNotices(conversation.id), (n) => n.length === 1, 'réponse Instagram en file');
    await app.get(NotificationDeliveryService).deliver(notice!.id);
    const failed = await until(async () => (await db(app!).select().from(schema.notifications).where(eq(schema.notifications.id, notice!.id)))[0]!, (n) => n.error !== null, 'refus consigné');
    expect(failed.error).toBe('meta_window_closed');
    expect((failed.data as { attempts: number }).attempts).toBe(1);
    // L'événement de refus fait partir la même réponse par courriel (canal du compte), une seule fois.
    const fallback = await until(
      () => db(app!).select().from(schema.notifications).where(and(eq(schema.notifications.channel, 'email'), eq(schema.notifications.recipientAddress, email))),
      (n) => n.length === 1, 'réponse par courriel',
    );
    expect(fallback[0]).toMatchObject({ template: 'agent.reply', recipientUserId: client.user.id, data: { text: 'Votre chauffeur arrive dans 5 minutes.', conversationId: conversation.id, messageId, fallbackFrom: 'instagram' } });
    const [message] = await db(app).select().from(schema.conversationMessages).where(eq(schema.conversationMessages.id, messageId));
    expect(message!.metadata).toMatchObject({ deliveryFallback: 'meta_window_closed', deliveredVia: 'email' });
    // Événement reçu deux fois (API et worker avec Redis) : aucune seconde reprise.
    expect(await conversations().deliverElsewhere(conversation, messageId, 'x', 'meta_window_closed')).toBeNull();
    social.closedThreads.delete(psid);
  });

  it('discussion du site (Tidio) : secret vérifié, visiteur avec courriel confié à l\'agent, sans courriel remis au personnel, doublon et messages de l\'équipe ignorés', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const visitor = `v-${rand()}`;
    const email = testEmail('tidio');
    addresses.push(email, `tidio:${visitor}`);
    const withEmail = { data: { conversation_id: `c-${rand()}`, message: { id: `m-${rand()}`, content: 'Avez-vous une voiture pour 6 personnes ?' }, visitor: { id: `v-${rand()}`, email, name: 'Julie' } } };
    const withoutEmail = { messages: [
      { conversation_id: 'c-2', message: { id: `m-${rand()}`, content: 'Bonjour, je voudrais réserver pour demain.' }, visitor: { id: visitor, name: 'Marc' } },
      { conversation_id: 'c-2', message: { id: `m-${rand()}`, content: 'Bonjour Marc !', author: 'operator' } },
    ] };
    expect((await request(server()).post('/v1/webhooks/tidio').send(withEmail)).status).toBe(400);
    expect((await request(server()).post('/v1/webhooks/tidio').query({ secret: 'faux' }).send(withEmail)).status).toBe(400);
    const first = await request(server()).post('/v1/webhooks/tidio').set('x-tidio-secret', MOCK_TIDIO_SECRET).send(withEmail).expect(200);
    expect(first.body).toEqual({ received: 1, queued: 1, escalated: 0, duplicates: 0, ignored: 0 });
    const second = await request(server()).post('/v1/webhooks/tidio').query({ secret: MOCK_TIDIO_SECRET }).send(withoutEmail).expect(200);
    expect(second.body).toEqual({ received: 2, queued: 0, escalated: 1, duplicates: 0, ignored: 1 });
    const [conversation] = await db(app).select().from(schema.conversations).where(eq(schema.conversations.address, `tidio:${visitor}`));
    expect(conversation).toMatchObject({ channel: 'web', status: 'escalated', displayName: 'Marc' });
    expect(conversation!.escalationReason).toContain('tidio_chat');
    expect((await messagesOf(conversation!.id))[0]).toMatchObject({ direction: 'inbound', body: 'Bonjour, je voudrais réserver pour demain.', metadata: { source: 'tidio', tidioVisitor: visitor } });
    const replay = await request(server()).post('/v1/webhooks/tidio').query({ secret: MOCK_TIDIO_SECRET }).send(withoutEmail).expect(200);
    expect(replay.body).toMatchObject({ duplicates: 1, escalated: 0 });
  });

  it('ventes : un « STOP » d\'un prospect par courriel le retire (ne plus contacter), une autre réponse le passe en « a répondu » et prévient le personnel', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const database = db(app);
    const make = async (name: string) => {
      const email = `${name}-${rand()}@hotel-essai-u3.ca`;
      addresses.push(email);
      const [row] = await database.insert(schema.prospects).values({ organizationName: `Hôtel ${name}`, source: 'manual', email, stage: 'contacted', sourceRef: `t-u3-${rand()}` }).returning();
      prospectIds.push(row!.id);
      await database.insert(schema.followups).values({ targetType: 'prospect', targetId: row!.id, prospectId: row!.id, channel: 'email', dueAt: new Date(Date.now() + 86_400_000), referenceAt: new Date(), maxAttempts: 3 });
      return row!;
    };
    const mail = (from: string, subject: string, text: string) => ({ messageId: `<${rand()}@hotel-essai-u3.ca>`, inReplyTo: null, references: [], from: `Direction <${from}>`, to: ['contact@neomoov.net'], subject, text, html: null, attachments: [], headers: {}, receivedAt: new Date() });
    const inbound = app.get(InboundEmailService);

    const quitting = await make('stop');
    const stop = await inbound.receive(mail(quitting.email!, 'Re: Proposition de compte entreprise', 'STOP\n\nLe 1 oct. 2026, Neomoov a écrit :\n> Bonjour'));
    expect(stop.status).toBe('opt_out');
    const [after] = await database.select().from(schema.prospects).where(eq(schema.prospects.id, quitting.id));
    expect(after).toMatchObject({ stage: 'do_not_contact' });
    expect(after!.unsubscribedAt).not.toBeNull();
    expect((await database.select().from(schema.followups).where(eq(schema.followups.prospectId, quitting.id)))[0]).toMatchObject({ status: 'cancelled', closeReason: 'do_not_contact' });
    const [closed] = await database.select().from(schema.conversations).where(eq(schema.conversations.id, stop.conversationId!));
    expect(closed).toMatchObject({ channel: 'email', status: 'closed', address: quitting.email });

    const interested = await make('oui');
    const answer = mail(interested.email!, 'Re: Proposition de compte entreprise', 'Bonjour, pouvez-vous m\'appeler jeudi pour en parler ?');
    const reply = await inbound.receive(answer);
    expect(reply.status).toBe('prospect_reply');
    const [replied] = await database.select().from(schema.prospects).where(eq(schema.prospects.id, interested.id));
    expect(replied!.stage).toBe('replied');
    const touches = await database.select().from(schema.prospectTouches).where(eq(schema.prospectTouches.prospectId, interested.id));
    expect(touches.some((t) => t.direction === 'inbound' && t.result === 'replied' && t.channel === 'email')).toBe(true);
    const [handed] = await database.select().from(schema.conversations).where(eq(schema.conversations.id, reply.conversationId!));
    expect(handed!.status).toBe('escalated');
    expect(handed!.escalationReason).toContain('prospect_reply');
    // Rejoué (même Message-ID, relais puis lecture IMAP) : doublon, rien n'est refait.
    expect((await inbound.receive(answer)).status).toBe('duplicate');
    expect(await database.select().from(schema.prospectTouches).where(eq(schema.prospectTouches.prospectId, interested.id))).toHaveLength(touches.length);
  });

  it('rapport quotidien : temps de première réponse par canal et rappel des problèmes de paiement mesuré contre 4 heures', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const email = testEmail('metrics');
    addresses.push(email);
    const { conversation } = await conversations().receive({ channel: 'email', externalId: `email:${rand()}`, userId: null, phone: null, text: 'Bonjour', language: 'fr', rideId: null, address: email, kind: 'message' });
    await conversations().send(conversation, 'Bonjour, merci pour votre message.', 'agent');
    const payer = testEmail('paiement');
    addresses.push(payer);
    const { conversation: payment } = await conversations().receive({ channel: 'email', externalId: `email:${rand()}`, userId: null, phone: null, text: 'Ma carte a été refusée deux fois', language: 'fr', rideId: null, address: payer, kind: 'message' });
    await conversations().escalate(payment.id, 'payment', 'Carte refusée deux fois');
    await conversations().reply(payment.id, 'Je vous rappelle tout de suite pour régler cela.', false);
    const metrics = await app.get(AgentToolsService).inboxMetrics(sql`now() - interval '1 hour'`, sql`now() + interval '1 hour'`);
    expect(metrics.firstReplyTargetSeconds).toBeGreaterThan(0);
    const emailChannel = metrics.firstReplyByChannel.find((c) => c.channel === 'email')!;
    expect(emailChannel.conversations).toBeGreaterThanOrEqual(2);
    expect(emailChannel.answered).toBeGreaterThanOrEqual(2);
    expect(metrics.accountCallbacks.targetHours).toBe(4);
    expect(metrics.accountCallbacks.escalated).toBeGreaterThanOrEqual(1);
    expect(metrics.accountCallbacks.withinTarget).toBeGreaterThanOrEqual(1);
  });

  it('diffusion par outils déclarés (journal homogène) ; infolettre en brouillon, envoyée seulement si le réglage est activé', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const database = db(app);
    await database.insert(schema.agents).values({ code: 'publishing', name: 'Marketing : diffusion', mode: 'approval', model: 'claude-opus-5-5', effort: 'low', tools: ['socialPublish', 'socialMetrics', 'replyComment', 'forwardComment'], thresholds: {} }).onConflictDoNothing();
    await database.update(schema.agents).set({ mode: 'approval', active: true }).where(eq(schema.agents.code, 'publishing'));
    const newsletter = app.get<SocialPublishers>(SOCIAL_PUBLISHERS).get('newsletter') as MockSocialPublisher;
    const item = async () => {
      const [row] = await database.insert(schema.contentItems).values({ weekOf: '2031-05-05', space: 'newsletter', format: 'newsletter', title: `Infolettre ${rand()}`, body: 'Les nouvelles de la semaine.', status: 'scheduled', scheduledAt: new Date(Date.now() - 60_000) }).returning({ id: schema.contentItems.id });
      contentIds.push(row!.id);
      return row!.id;
    };
    const publishing = app.get(PublishingService);
    const draftId = await item();
    const draft = await publishing.publishItem(draftId);
    expect(draft.status).toBe('published');
    const published = [...newsletter.published.values()].find((p) => p.itemId === draftId)!;
    expect(published.draft).toBe(true);
    const [run] = await database.select().from(schema.agentRuns).where(and(eq(schema.agentRuns.agentCode, 'publishing'), eq(schema.agentRuns.triggerRef, `publish:${draftId}:1`)));
    expect((run!.toolCalls as Array<{ tool: string; ok: boolean; input: Record<string, unknown> }>)[0]).toMatchObject({ tool: 'socialPublish', ok: true, input: { itemId: draftId } });

    overrides.set('marketing.newsletter_auto_send', true);
    const sentId = await item();
    await publishing.publishItem(sentId);
    expect([...newsletter.published.values()].find((p) => p.itemId === sentId)!.draft).toBe(false);
  });

  it('attribution planifiée : signal à 60 minutes resté sans suite rattrapé, puis plus rien une fois la répartition relancée', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const requestedAt = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const quote = (await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt }).expect(201)).body.quotes[0];
    const rideId = (await request(server()).post('/v1/rides').set(bearer(client)).set('Idempotency-Key', `u3-${rand()}`)
      .send({ quoteId: quote.id, type: 'scheduled', requestedAt, paymentMethod: 'cash', paymentChoice: 'pay_driver_after', maxConsentedCents: quote.maxConsentedCents }).expect(201)).body.id as string;
    const database = db(app);
    // Signal marqué par la passe du worker (horloge simulée, 10 minutes plus tard), puis perdu : rien ne démarre la répartition.
    const dueAt = new Date(Date.now() + 10 * 60_000);
    await database.insert(schema.rideEvents).values({ rideId, type: 'scheduled_dispatch_due', fromState: 'requested', toState: 'requested', actorUserId: null, actorKind: 'system', data: { secondsLeft: 3600 }, occurredAt: dueAt });
    const scheduled = app.get(ScheduledService);
    // Dans le délai de grâce (120 s) : on attend encore le traitement du signal.
    expect(await scheduled.dispatchDueToRecover(new Date(dueAt.getTime() + 30_000), 500)).not.toContain(rideId);
    const later = new Date(dueAt.getTime() + 5 * 60_000);
    expect(await scheduled.dispatchDueToRecover(later, 500)).toContain(rideId);
    // Le worker relance par le service de répartition existant (motif et source du rattrapage journalisés).
    await app.get(DispatchService).start(rideId, { reason: 'scheduled_due', source: 'sweep' });
    const [started] = await database.select().from(schema.rideEvents).where(and(eq(schema.rideEvents.rideId, rideId), eq(schema.rideEvents.type, 'dispatch_started'), sql`${schema.rideEvents.data}->>'source' = 'sweep'`));
    expect(started!.data).toMatchObject({ reason: 'scheduled_due', source: 'sweep' });
    // Répartition démarrée après le signal (à l'heure simulée de la passe) : plus rien à rattraper.
    await database.insert(schema.rideEvents).values({ rideId, type: 'dispatch_started', fromState: 'requested', toState: 'requested', actorUserId: null, actorKind: 'system', data: { reason: 'scheduled_due', source: 'sweep' }, occurredAt: new Date(dueAt.getTime() + 1_000) });
    expect(await scheduled.dispatchDueToRecover(later, 500)).not.toContain(rideId);
    await database.update(schema.rides).set({ state: 'cancelled_by_client' }).where(eq(schema.rides.id, rideId));
  });
});
