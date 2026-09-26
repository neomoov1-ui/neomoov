import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { MockLlmProvider, MockLlmRequest, MockPaymentProvider, MockStorageProvider } from '../src/adapters/mock/index.js';
import { LLM_PROVIDER, PAYMENT_PROVIDER, STORAGE_PROVIDER } from '../src/adapters/types.js';
import { DomainEventsService } from '../src/common/domain-events.js';
import { RateLimitService } from '../src/common/rate-limit.service.js';
import { SettingsService } from '../src/common/settings.service.js';
import { AgentJobsService } from '../src/modules/agents/agent-jobs.service.js';
import { AgentRunnerService } from '../src/modules/agents/agent-runner.service.js';
import { AnalyticsAgent } from '../src/modules/agents/back-office.agents.js';
import { ConversationsService } from '../src/modules/agents/conversations.service.js';
import { ApiKeysService } from '../src/modules/auth/api-keys.service.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, resetHttpLimits, startTestApp, testEmail, type StaffSession, type TestDriver } from './helpers.js';

/**
 * Agents IA (prompt 13, tâches 4 à 9 et 12) avec le modèle simulé scripté : exécuteur (journal, coût, plafond de
 * dépense qui bascule en manuel), outils et plafonds, file d'approbation (parcours 19 de la section 9.2 et critère
 * d'acceptation du remboursement de 20 $), agents relation client, recrutement, comptabilité et analyse, droits
 * d'accès aux routes internes. Les déclencheurs sont activés pour ce fichier seulement (`AGENT_TRIGGERS=on`).
 */
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
const YUL = { address: 'Aéroport international Montréal-Trudeau, Dorval', coordinates: { lat: 45.468, lng: -73.742 } };
const inThreeHours = () => new Date(Date.now() + 3 * 3_600_000).toISOString();
const rand = () => Math.random().toString(36).slice(2, 10);
type Tokens = { accessToken: string; user: { id: string } };
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, label: string, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > deadline) throw new Error(`Délai dépassé : ${label} (${JSON.stringify(value)})`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

describe('agents IA : exécuteur, outils, file d\'approbation, agents V1 (intégration, modèle simulé)', () => {
  let app: NestExpressApplication | null = null;
  let llm: MockLlmProvider;
  let payments: MockPaymentProvider;
  const server = () => app!.getHttpServer();
  const runIds = new Set<string>();
  const tempAgents: string[] = [];
  const emails: string[] = [];
  let operator: StaffSession;
  let admin: StaffSession;
  let shared: { client: Tokens; driver: TestDriver; rideId: string; paidCents: number } | null = null;

  beforeAll(async () => {
    app = await startTestApp({ AGENT_TRIGGERS: 'on', FEATURE_IMMEDIATE_RIDES: 'on' });
    if (!app) return;
    llm = app.get<MockLlmProvider>(LLM_PROVIDER);
    payments = app.get<MockPaymentProvider>(PAYMENT_PROVIDER);
    operator = await createStaffAndLogin(app, ['operator']);
    admin = await createStaffAndLogin(app, ['admin']);
  });
  beforeEach(async () => {
    if (!app) return;
    await resetHttpLimits(app);
    llm.scripts.length = 0;
    llm.requests.length = 0;
  });
  afterAll(async () => {
    if (app) {
      const database = db(app);
      const ids = [...runIds];
      // Exécutions des appels d'outils faits par les comptes de ce fichier, repérées par l'appelant journalisé.
      const callers = [`user:${operator?.userId}`, `user:${admin?.userId}`, 'key:t13b-cr', 'key:t13b-acc', 'key:t13b-noagent'];
      const byCaller = await database.select({ id: schema.agentRuns.id }).from(schema.agentRuns).where(sql`${schema.agentRuns.input}->>'caller' IN ${callers}`);
      const all = [...new Set([...ids, ...byCaller.map((r) => r.id)])];
      if (all.length) {
        await database.delete(schema.approvals).where(inArray(schema.approvals.agentRunId, all));
        await database.update(schema.conversationMessages).set({ agentRunId: null }).where(inArray(schema.conversationMessages.agentRunId, all));
        await database.delete(schema.agentRuns).where(inArray(schema.agentRuns.id, all));
      }
      for (const code of tempAgents) {
        await database.delete(schema.approvals).where(sql`${schema.approvals.agentRunId} IN (SELECT id FROM agent_runs WHERE agent_code = ${code})`);
        await database.delete(schema.agentRuns).where(eq(schema.agentRuns.agentCode, code));
        await database.delete(schema.agentPrompts).where(eq(schema.agentPrompts.agentCode, code));
        await database.delete(schema.agents).where(eq(schema.agents.code, code));
      }
      if (emails.length) await database.delete(schema.notifications).where(inArray(schema.notifications.recipientAddress, emails));
      await cleanupTestData(app);
    }
    await app?.close();
  });

  const runner = () => app!.get(AgentRunnerService);
  const events = () => app!.get(DomainEventsService);
  const runsByRef = (ref: string) => db(app!).select().from(schema.agentRuns).where(eq(schema.agentRuns.triggerRef, ref));
  const approvalsOf = (runId: string) => db(app!).select().from(schema.approvals).where(eq(schema.approvals.agentRunId, runId));
  const track = (id: string | null | undefined) => { if (id) runIds.add(id); };
  const inbound = (client: Tokens | null, text: string, extra: Partial<{ channel: 'app' | 'whatsapp' | 'web' | 'voice'; language: 'fr' | 'en' | null; phone: string | null }> = {}) => {
    const externalId = `t13b-${rand()}`;
    return {
      externalId,
      emit: () => events().emitAndWait('conversation.inbound', { channel: extra.channel ?? 'app', externalId, userId: client?.user.id ?? null, phone: extra.phone ?? null, text, language: extra.language === undefined ? 'fr' : extra.language, rideId: null, receivedAt: new Date() }),
    };
  };
  const conversationOf = async (userId: string) => {
    const [conversation] = await db(app!).select().from(schema.conversations).where(eq(schema.conversations.userId, userId)).orderBy(sql`${schema.conversations.createdAt} DESC`).limit(1);
    const messages = conversation ? await db(app!).select().from(schema.conversationMessages).where(eq(schema.conversationMessages.conversationId, conversation.id)).orderBy(schema.conversationMessages.createdAt) : [];
    return { conversation, messages };
  };

  /** Course planifiée vers l'aéroport (forfait), payée par carte, attribuée et terminée (paiement capturé). */
  async function paidRide(): Promise<NonNullable<typeof shared>> {
    if (shared) return shared;
    const client = await loginByOtp(app!);
    const driver = await createDriver(app!, 'neo_premium', { acceptsScheduled: false });
    const q = (await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: CENTRE, destination: YUL, requestedAt: inThreeHours() }).expect(201)).body.quotes[0] as { id: string; maxConsentedCents: number };
    const ride = (await request(server()).post('/v1/rides').set(bearer(client)).set('Idempotency-Key', `t13b-${rand()}`)
      .send({ quoteId: q.id, type: 'scheduled', requestedAt: inThreeHours(), paymentChoice: 'prepaid', paymentMethod: 'card_app', maxConsentedCents: q.maxConsentedCents }).expect(201)).body as { id: string };
    await request(server()).post(`/v1/admin/rides/${ride.id}/assign`).set(bearer(operator.tokens)).send({ driverId: driver.driverId }).expect(200);
    for (const step of ['depart', 'arrive', 'start']) await request(server()).post(`/v1/driver/rides/${ride.id}/${step}`).set(bearer(driver.tokens)).expect(200);
    await request(server()).post(`/v1/driver/rides/${ride.id}/complete`).set(bearer(driver.tokens)).send({ measuredDistanceMeters: 8200, measuredDurationSeconds: 1100 }).expect(200);
    const payment = await until(async () => (await db(app!).select().from(schema.payments).where(and(eq(schema.payments.rideId, ride.id), eq(schema.payments.kind, 'ride'))))[0], (p) => p?.status === 'captured', 'capture');
    // La course est « d'hier ».
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    await db(app!).update(schema.rides).set({ stateTimestamps: sql`jsonb_set(${schema.rides.stateTimestamps}, '{completed}', to_jsonb(${yesterday}::text))` }).where(eq(schema.rides.id, ride.id));
    shared = { client, driver, rideId: ride.id, paidCents: payment!.capturedCents };
    return shared;
  }

  /** Script du parcours du remboursement : classification, courses du client, remboursement de 20 $, réponse. */
  const refundScript = (amountCents = 2_000) => (req: MockLlmRequest) => {
    if (req.kind === 'structured' && req.schemaName === 'classification') return { output: { category: 'refund_request', language: 'fr', safetyComplaint: false, hostile: false, summary: 'Demande de remboursement de 20 $ pour la course d\'hier' } };
    if (req.kind !== 'tools') return undefined;
    if (req.iteration === 1) return { toolCalls: [{ name: 'lookupRide', input: {} }] };
    if (req.iteration === 2) {
      const rides = (req.toolResults[0]!.result as { data: { rides: Array<{ rideId: string }> } }).data.rides;
      return { toolCalls: [{ name: 'refund', input: { rideId: rides[0]!.rideId, amountCents, reason: 'Retard important sur la course d\'hier', justification: 'Le client signale un retard sur la course d\'hier ; course retrouvée, terminée et payée par carte ; 20 $ restent sous le montant payé.' } }] };
    }
    return { text: 'Votre demande de remboursement de 20,00 $ est transmise pour validation. Vous serez prévenu dès la décision.' };
  };

  it('parcours 19 et critère d\'acceptation : « je veux un remboursement de 20 $ pour la course d\'hier » → proposition justifiée → approbation dans My Hub → remboursement réel, une seule fois', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const { client, rideId, paidCents } = await paidRide();
    expect(paidCents).toBeGreaterThan(2_900);
    const order: string[] = [];
    const conversations = app.get(ConversationsService);
    const original = conversations.send.bind(conversations);
    const send = vi.spyOn(conversations, 'send').mockImplementation(async (...args) => {
      order.push(`envoi:${args[2]}`);
      return original(...args);
    });
    const script = refundScript();
    llm.script((req) => { order.push(`modèle:${req.kind}`); return script(req); });
    const message = inbound(client, 'je veux un remboursement de 20 $ pour la course d\'hier');
    try {
      await message.emit();
    } finally {
      send.mockRestore();
    }

    // Accusé de réception envoyé avant le premier appel au modèle, puis la réponse de l'agent.
    expect(order[0]).toBe('envoi:system');
    expect(order[1]).toBe('modèle:structured');
    expect(order.at(-1)).toBe('envoi:agent');
    const [run] = await runsByRef(message.externalId);
    track(run?.id);
    expect(run).toMatchObject({ agentCode: 'customer_relations', trigger: 'conversation.app', status: 'awaiting_approval', model: 'claude-opus-5-5' });
    // Journal : 4 requêtes au modèle (classification, puis 3 tours de la boucle d'outils), coût selon le barème (4 $ et 20 $ par million).
    expect(run!.inputTokens).toBe(4_000);
    expect(run!.outputTokens).toBe(800);
    expect(run!.costMicros).toBe(4_000 * 4 + 800 * 20);
    const calls = run!.toolCalls as Array<{ tool: string; ok: boolean; approvalId: string | null }>;
    expect(calls.map((c) => c.tool)).toEqual(['lookupRide', 'refund']);
    expect(calls.every((c) => c.ok)).toBe(true);
    expect(JSON.stringify(run!.input)).not.toContain('remboursement');
    // Les contenus du client arrivent au modèle balisés comme des données.
    expect(llm.requests[0]!.messages.at(-1)!.content).toContain('<donnees_utilisateur source="client">');

    const [approval] = await approvalsOf(run!.id);
    expect(approval).toMatchObject({ proposedAction: 'refund', decision: 'pending' });
    expect(approval!.data).toMatchObject({ rideId, amountCents: 2_000, mode: 'refund' });
    expect(approval!.justification).toContain('course d\'hier');
    expect(calls[1]!.approvalId).toBe(approval!.id);
    expect(payments.calls.filter((c) => c.method === 'refund')).toHaveLength(0);

    const { conversation, messages } = await conversationOf(client.user.id);
    expect(conversation).toMatchObject({ channel: 'app', status: 'open', language: 'fr' });
    expect(messages.map((m) => `${m.direction}:${m.author}`)).toEqual(['inbound:client', 'outbound:system', 'outbound:agent']);
    expect(messages[2]!.body).toContain('transmise pour validation');

    // My Hub : la proposition est dans la file, avec sa justification.
    const list = await request(server()).get('/v1/admin/approvals').query({ pageSize: 100 }).set(bearer(operator.tokens)).expect(200);
    expect(list.body.items.find((a: { id: string }) => a.id === approval!.id)).toMatchObject({ agentCode: 'customer_relations', proposedAction: 'refund', decision: 'pending', justification: approval!.justification });

    // Approuvée : remboursement réel (fournisseur simulé), client prévenu, exécution close.
    const approved = await request(server()).post(`/v1/admin/approvals/${approval!.id}/decide`).set(bearer(operator.tokens)).send({ decision: 'approved' }).expect(200);
    expect(approved.body).toMatchObject({ decision: 'approved', executionError: null, executionResult: { amountCents: 2_000, mode: 'refund', status: 'succeeded' } });
    expect(approved.body.executedAt).toBeTruthy();
    const refunds = await db(app).select().from(schema.refunds).where(sql`${schema.refunds.paymentId} IN (SELECT id FROM payments WHERE ride_id = ${rideId})`);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ amountCents: 2_000, mode: 'refund', decidedByAgentCode: 'customer_relations', decidedByUserId: operator.userId, status: 'succeeded' });
    expect(payments.calls.filter((c) => c.method === 'refund')).toHaveLength(1);
    expect((await runsByRef(message.externalId))[0]!.status).toBe('succeeded');
    const after = await conversationOf(client.user.id);
    expect(after.messages.at(-1)!.body).toContain('remboursement de 20,00');

    // Approbation rejouée (et doublée en même temps) : aucun second remboursement.
    const again = await request(server()).post(`/v1/admin/approvals/${approval!.id}/decide`).set(bearer(operator.tokens)).send({ decision: 'approved' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('APPROVAL_ALREADY_DECIDED');
    const [a, b] = await Promise.all([1, 2].map(() => request(server()).post(`/v1/admin/approvals/${approval!.id}/decide`).set(bearer(operator.tokens)).send({ decision: 'approved' })));
    expect([a!.status, b!.status]).toEqual([409, 409]);
    expect(payments.calls.filter((c) => c.method === 'refund')).toHaveLength(1);
    expect(await db(app).select().from(schema.refunds).where(sql`${schema.refunds.paymentId} IN (SELECT id FROM payments WHERE ride_id = ${rideId})`)).toHaveLength(1);

    // Message reçu deux fois : un seul traitement.
    await events().emitAndWait('conversation.inbound', { channel: 'app', externalId: message.externalId, userId: client.user.id, phone: null, text: 'doublon', language: 'fr', rideId: null, receivedAt: new Date() });
    expect((await conversationOf(client.user.id)).messages.filter((m) => m.direction === 'inbound')).toHaveLength(1);
  });

  it('file d\'approbation : deux décisions simultanées, une seule exécution ; refus avec motif obligatoire ; lecture seule pour le rôle readonly', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const { client } = await paidRide();
    llm.script(refundScript(600));
    const message = inbound(client, 'Pouvez-vous me rembourser 6 $ ?');
    await message.emit();
    const [run] = await runsByRef(message.externalId);
    track(run?.id);
    const [approval] = await approvalsOf(run!.id);
    const refundCalls = payments.calls.filter((c) => c.method === 'refund').length;
    const [first, second] = await Promise.all([1, 2].map(() => request(server()).post(`/v1/admin/approvals/${approval!.id}/decide`).set(bearer(operator.tokens)).send({ decision: 'approved' })));
    expect([first!.status, second!.status].sort()).toEqual([200, 409]);
    expect(payments.calls.filter((c) => c.method === 'refund').length).toBe(refundCalls + 1);

    llm.script(refundScript(300));
    const other = inbound(client, 'Et 3 $ pour l\'attente ?');
    await other.emit();
    const [run2] = await runsByRef(other.externalId);
    track(run2?.id);
    const [pending] = await approvalsOf(run2!.id);
    const readonly = await createStaffAndLogin(app, ['readonly']);
    await request(server()).get('/v1/admin/approvals').set(bearer(readonly.tokens)).expect(200);
    await request(server()).post(`/v1/admin/approvals/${pending!.id}/decide`).set(bearer(readonly.tokens)).send({ decision: 'approved' }).expect(403);
    const noReason = await request(server()).post(`/v1/admin/approvals/${pending!.id}/decide`).set(bearer(operator.tokens)).send({ decision: 'rejected' });
    expect(noReason.status).toBe(400);
    const rejected = await request(server()).post(`/v1/admin/approvals/${pending!.id}/decide`).set(bearer(operator.tokens)).send({ decision: 'rejected', note: 'Attente déjà compensée par un crédit' }).expect(200);
    expect(rejected.body).toMatchObject({ decision: 'rejected', decisionNote: 'Attente déjà compensée par un crédit', executedAt: null });
    expect(payments.calls.filter((c) => c.method === 'refund').length).toBe(refundCalls + 1);
    // Refus : un humain reprend la conversation.
    expect((await conversationOf(client.user.id)).conversation).toMatchObject({ status: 'escalated' });
    await db(app).update(schema.conversations).set({ status: 'closed' }).where(eq(schema.conversations.userId, client.user.id));
  });

  it('relation client : plainte de sécurité escaladée sans outil ; conversation escaladée laissée à l\'équipe ; client anglais ; mode manuel', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app, undefined, {}, { card: false });
    llm.script((req) => (req.schemaName === 'classification' ? { output: { category: 'complaint', language: 'fr', safetyComplaint: true, hostile: false, summary: 'Conduite dangereuse signalée' } } : undefined));
    const danger = inbound(client, 'Le chauffeur conduisait à 150 km/h, j\'ai eu très peur');
    await danger.emit();
    const [run] = await runsByRef(danger.externalId);
    track(run?.id);
    expect(run).toMatchObject({ status: 'succeeded' });
    expect((run!.toolCalls as Array<{ tool: string }>).map((c) => c.tool)).toEqual(['escalateToHuman']);
    expect(llm.requests.map((r) => r.kind)).toEqual(['structured']);
    let state = await conversationOf(client.user.id);
    expect(state.conversation).toMatchObject({ status: 'escalated' });
    expect(state.conversation!.escalationReason).toContain('safety');
    expect(state.messages.at(-1)!.body).toContain('911');
    const incidents = await db(app).select().from(schema.incidents).where(eq(schema.incidents.reportedByUserId, client.user.id));
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ type: 'complaint', severity: 'high', reportedByKind: 'agent' });

    // Conversation escaladée : l'agent n'intervient plus, l'équipe est alertée.
    const followUp = inbound(client, 'Vous êtes là ?');
    await followUp.emit();
    expect(await runsByRef(followUp.externalId)).toHaveLength(0);
    state = await conversationOf(client.user.id);
    expect(state.messages.at(-1)).toMatchObject({ direction: 'inbound', body: 'Vous êtes là ?' });

    // Client anglophone : accusé et réponse en anglais.
    llm.scripts.length = 0;
    const english = await loginByOtp(app, undefined, {}, { card: false });
    await db(app).update(schema.users).set({ language: 'en' }).where(eq(schema.users.id, english.user.id));
    llm.script((req) => (req.schemaName === 'classification' ? { output: { category: 'question', language: 'en', safetyComplaint: false, hostile: false, summary: 'Question about bookings' } } : req.kind === 'tools' ? { text: 'Rides can be booked at least 2 hours in advance.' } : undefined));
    const hello = inbound(english, 'How far in advance can I book?', { language: null });
    await hello.emit();
    track((await runsByRef(hello.externalId))[0]?.id);
    const en = await conversationOf(english.user.id);
    expect(en.conversation).toMatchObject({ language: 'en', status: 'open' });
    expect(en.messages.map((m) => m.body)).toEqual(['How far in advance can I book?', 'Got it, thank you. I am looking into your request and will reply in a moment.', 'Rides can be booked at least 2 hours in advance.']);
    // Accusé à l'écran seulement, réponse en push, dans la langue du client.
    const replies = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.recipientUserId, english.user.id), eq(schema.notifications.template, 'agent.reply'))).orderBy(schema.notifications.createdAt);
    expect(replies.map((n) => [n.channel, n.language])).toEqual([['in_app', 'en'], ['push', 'en']]);

    // Agent en mode manuel : aucun appel au modèle, relais humain.
    const [agent] = await db(app).select({ mode: schema.agents.mode }).from(schema.agents).where(eq(schema.agents.code, 'customer_relations'));
    await db(app).update(schema.agents).set({ mode: 'manual' }).where(eq(schema.agents.code, 'customer_relations'));
    try {
      llm.requests.length = 0;
      const manual = inbound(english, 'Another question');
      await manual.emit();
      const [skipped] = await runsByRef(manual.externalId);
      track(skipped?.id);
      expect(skipped).toMatchObject({ status: 'skipped', output: { skipped: 'manual_mode' } });
      expect(llm.requests).toHaveLength(0);
      expect((await conversationOf(english.user.id)).conversation).toMatchObject({ status: 'escalated' });
    } finally {
      await db(app).update(schema.agents).set({ mode: agent!.mode }).where(eq(schema.agents.code, 'customer_relations'));
    }
  });

  it('assistance de l\'application : message du client, accusé puis réponse, conversation relue ; course d\'un autre client refusée ; débit limité', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app, undefined, {}, { card: false });
    llm.script((req) => (req.schemaName === 'classification' ? { output: { category: 'question', language: 'fr', safetyComplaint: false, hostile: false, summary: 'Question sur les réservations' } } : req.kind === 'tools' ? { text: 'Vous pouvez réserver jusqu\'à 30 jours à l\'avance, au moins 2 heures avant le départ.' } : undefined));
    expect((await request(server()).get('/v1/me/support/conversation').set(bearer(client)).expect(200)).body).toEqual({ conversation: null });
    const sent = await request(server()).post('/v1/me/support/messages').set(bearer(client)).send({ text: 'Jusqu\'à quand puis-je réserver ?' }).expect(202);
    expect(sent.body).toMatchObject({ accepted: true });
    const conversation = await until(async () => (await request(server()).get('/v1/me/support/conversation').set(bearer(client)).expect(200)).body.conversation as { status: string; messages: Array<{ author: string; body: string }> } | null, (c) => c?.messages.length === 3, 'réponse de l\'agent');
    expect(conversation!.messages.map((m) => m.author)).toEqual(['client', 'system', 'agent']);
    expect(conversation!.status).toBe('open');
    track((await until(() => runsByRef(sent.body.externalId), (rows) => rows[0]?.status === 'succeeded', 'exécution'))[0]?.id);

    const { rideId } = await paidRide();
    expect((await request(server()).post('/v1/me/support/messages').set(bearer(client)).send({ text: 'Cette course ?', rideId }).expect(404)).body.code).toBe('RIDE_NOT_FOUND');
    const limits = app.get(RateLimitService);
    for (let i = 0; i < 30; i += 1) await limits.hit(`support:${client.user.id}`, 30, 3_600);
    expect((await request(server()).post('/v1/me/support/messages').set(bearer(client)).send({ text: 'Encore une question' }).expect(429)).body.code).toBe('RATE_LIMITED');
    await limits.reset(`support:${client.user.id}`);
  });

  it('exécuteur : journal minimisé, coût, rejeu idempotent, plafond de dépense qui bascule en manuel, échec repris ; réglage d\'un agent', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const code = `t13b_${rand()}`;
    tempAgents.push(code);
    const database = db(app);
    await database.insert(schema.agents).values({ code, name: 'Agent de test', mode: 'auto', model: 'claude-opus-5-5', effort: 'low', systemPromptKey: `${code}.v1`, tools: [], thresholds: { dailyBudgetMicros: 1 } });
    await database.insert(schema.agentPrompts).values({ key: `${code}.v1`, agentCode: code, version: 1, body: 'Agent de test : réponds par la sortie demandée.', sha256: '0'.repeat(64) });
    const echo = z.object({ ok: z.boolean() });
    const body = (ctx: { structured: <T>(n: string, s: z.ZodType<T>, m: Array<{ role: 'user'; content: string }>) => Promise<T> }) => ctx.structured('echo', echo, [{ role: 'user', content: 'Test' }]);
    llm.script((req) => (req.schemaName === 'echo' ? { output: { ok: true }, usage: { inputTokens: 2_000, outputTokens: 100, cacheReadInputTokens: 1_000 } } : undefined));
    const skips: string[] = [];

    const first = await runner().execute(code, { name: 'test', ref: `r1-${code}`, input: { note: 'carte 4242 4242 4242 4242', password: 'x' } }, body, { onSkip: async (reason) => { skips.push(reason); } });
    expect(first.run).toMatchObject({ status: 'succeeded', inputTokens: 2_000, outputTokens: 100, cacheReadTokens: 1_000, model: 'claude-opus-5-5', output: { ok: true } });
    expect(first.run.costMicros).toBe(2_000 * 4 + 100 * 20 + 1_000 * 0.2);
    expect(first.run.input).toEqual({ note: 'carte [numéro de carte masqué]', password: '[masqué]' });
    expect(first.run.durationMs).toBeGreaterThanOrEqual(0);
    // Plafond de l'agent (1 micro-dollar) dépassé par cette exécution : l'agent passe en manuel, le personnel est prévenu.
    const [switched] = await database.select().from(schema.agents).where(eq(schema.agents.code, code));
    expect(switched!.mode).toBe('manual');
    const [audit] = await database.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, 'agent.mode_manual_budget'), eq(schema.auditLog.actorAgentCode, code)));
    expect(audit).toBeTruthy();

    const replay = await runner().execute(code, { name: 'test', ref: `r1-${code}`, input: {} }, body);
    expect(replay).toMatchObject({ replayed: true, result: null });
    expect(replay.run.id).toBe(first.run.id);
    const requestsBefore = llm.requests.length;
    const manual = await runner().execute(code, { name: 'test', ref: `r2-${code}`, input: {} }, body, { onSkip: async (reason) => { skips.push(reason); } });
    expect(manual.run).toMatchObject({ status: 'skipped', output: { skipped: 'manual_mode' }, costMicros: 0 });
    expect(llm.requests.length).toBe(requestsBefore);
    expect(skips).toEqual(['manual_mode']);

    // My Hub : remise en automatique sans plafond propre (réservé à l'administrateur), réglages journalisés.
    await request(server()).patch(`/v1/admin/agents/${code}`).set(bearer(operator.tokens)).send({ mode: 'auto' }).expect(403);
    const updated = await request(server()).patch(`/v1/admin/agents/${code}`).set(bearer(admin.tokens)).send({ mode: 'auto', effort: 'medium', thresholds: { dailyBudgetMicros: null, maxAutoRefundCents: 1_000 } }).expect(200);
    expect(updated.body).toMatchObject({ code, mode: 'auto', effort: 'medium', thresholds: { maxAutoRefundCents: 1_000 }, modeLocked: false, dailyCapMicros: 20_000_000 });
    expect(updated.body.thresholds.dailyBudgetMicros).toBeUndefined();
    expect(updated.body.spentTodayMicros).toBeGreaterThanOrEqual(first.run.costMicros);
    const [row] = await database.select({ autoSince: schema.agents.autoSince }).from(schema.agents).where(eq(schema.agents.code, code));
    expect(row!.autoSince).toBeTruthy();

    // Échec du modèle : exécution en échec, puis reprise du même déclencheur.
    llm.scripts.length = 0;
    llm.script((req) => (req.schemaName === 'echo' ? { refuse: true } : undefined));
    const failed = await runner().execute(code, { name: 'test', ref: `r3-${code}`, input: {} }, body);
    expect(failed.run).toMatchObject({ status: 'failed' });
    expect(failed.run.error).toContain('refused');
    llm.scripts.length = 0;
    llm.script((req) => (req.schemaName === 'echo' ? { output: { ok: true } } : undefined));
    const retried = await runner().execute(code, { name: 'test', ref: `r3-${code}`, input: {} }, body);
    expect(retried.run).toMatchObject({ id: failed.run.id, status: 'succeeded' });

    // Plafond déjà atteint avant l'exécution : aucun appel, bascule en manuel.
    await request(server()).patch(`/v1/admin/agents/${code}`).set(bearer(admin.tokens)).send({ thresholds: { dailyBudgetMicros: 1 } }).expect(200);
    const blocked = await runner().execute(code, { name: 'test', ref: `r4-${code}`, input: {} }, body);
    expect(blocked.run).toMatchObject({ status: 'skipped', output: { skipped: 'budget_exceeded' } });
    const list = (await request(server()).get('/v1/admin/agents').set(bearer(operator.tokens)).expect(200)).body as Array<{ code: string; mode: string; modeLocked: boolean }>;
    expect(list.find((a) => a.code === code)!.mode).toBe('manual');
    expect(list.find((a) => a.code === 'driver_recruitment')!.modeLocked).toBe(true);
    const journal = await request(server()).get('/v1/admin/agents/runs').query({ agentCode: code }).set(bearer(operator.tokens)).expect(200);
    expect(journal.body.items.map((r: { status: string }) => r.status).sort()).toEqual(['skipped', 'skipped', 'succeeded', 'succeeded']);
  });

  it('outils internes : comptes de service et personnel, périmètre du client, plafonds, outils déclarés, droits d\'accès', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const { client, rideId, driver } = await paidRide();
    const keys = app.get(ApiKeysService);
    const cr = await keys.create({ name: 't13b-cr', scopes: ['tools:*', 'agents:read'], agentCode: 'customer_relations' }, operator.userId);
    const acc = await keys.create({ name: 't13b-acc', scopes: ['tools:*'], agentCode: 'accounting' }, operator.userId);
    const noAgent = await keys.create({ name: 't13b-noagent', scopes: ['tools:*'] }, operator.userId);
    const readOnlyKey = await keys.create({ name: 't13b-rides', scopes: ['rides:read'], agentCode: 'customer_relations' }, operator.userId);
    const key = (k: { key: string }) => ({ Authorization: `Bearer ${k.key}` });

    const found = await request(server()).post('/v1/internal/tools/lookupRide').set(key(cr)).send({ subjectUserId: client.user.id }).expect(200);
    expect(found.body).toMatchObject({ ok: true, status: 'done' });
    const ride = found.body.data.rides.find((r: { rideId: string }) => r.rideId === rideId);
    expect(ride).toMatchObject({ state: 'completed' });
    expect(JSON.stringify(found.body)).not.toMatch(/\+1999|@test\.neomoov|pm_mock/);
    const profile = await request(server()).post('/v1/internal/tools/lookupClient').set(key(cr)).send({ subjectUserId: client.user.id }).expect(200);
    expect(Object.keys(profile.body.data).sort()).toEqual(['balanceDueCents', 'clientSince', 'creditsAvailableCents', 'firstName', 'language', 'openIncidents', 'ridesCompleted']);

    // Sans client concerné, ou pour la course d'un autre client : refus.
    expect((await request(server()).post('/v1/internal/tools/lookupRide').set(key(cr)).send({ rideId }).expect(200)).body).toMatchObject({ ok: false, status: 'refused' });
    const stranger = await loginByOtp(app, undefined, {}, { card: false });
    expect((await request(server()).post('/v1/internal/tools/refund').set(key(cr)).send({ subjectUserId: stranger.user.id, rideId, amountCents: 500, reason: 'Essai', justification: 'Course d\'un autre client' }).expect(200)).body).toMatchObject({ ok: false, status: 'not_found' });

    // Plafonds : au-delà de 50 $ refusé (escalade), montant supérieur au payé refusé, sinon proposé à l'approbation.
    const tooMuch = await request(server()).post('/v1/internal/tools/refund').set(key(cr)).send({ subjectUserId: client.user.id, rideId, amountCents: 5_001, reason: 'Trop', justification: 'Au-delà du plafond' }).expect(200);
    expect(tooMuch.body).toMatchObject({ ok: false, status: 'refused' });
    expect(tooMuch.body.message).toContain('plafond');
    const credit = await request(server()).post('/v1/internal/tools/issueCredit').set(bearer(operator.tokens)).send({ agentCode: 'customer_relations', subjectUserId: client.user.id, amountCents: 700, reason: 'Geste commercial', justification: 'Attente de 10 minutes au départ' }).expect(200);
    expect(credit.body).toMatchObject({ ok: true, status: 'pending_approval' });
    const approved = await request(server()).post(`/v1/admin/approvals/${credit.body.approvalId}/decide`).set(bearer(operator.tokens)).send({ decision: 'approved' }).expect(200);
    expect(approved.body.executionResult).toMatchObject({ amountCents: 700 });
    const credits = await db(app).select().from(schema.credits).where(and(eq(schema.credits.userId, client.user.id), eq(schema.credits.origin, 'goodwill')));
    expect(credits).toHaveLength(1);
    expect(credits[0]!.reference).toBe(`approval-${credit.body.approvalId}`);

    // Outil non déclaré par l'agent de la clé ; clé sans agent ; portée insuffisante ; client et lecture seule refusés.
    expect((await request(server()).post('/v1/internal/tools/refund').set(key(acc)).send({ subjectUserId: client.user.id, rideId, amountCents: 100, reason: 'Essai', justification: 'Outil non déclaré' }).expect(200)).body.message).toContain('non déclaré');
    expect((await request(server()).post('/v1/internal/tools/lookupRide').set(key(noAgent)).send({ subjectUserId: client.user.id }).expect(403)).body.code).toBe('AGENT_CODE_REQUIRED');
    expect((await request(server()).post('/v1/internal/tools/lookupRide').set(key(readOnlyKey)).send({ subjectUserId: client.user.id }).expect(403)).body.code).toBe('INSUFFICIENT_SCOPE');
    expect((await request(server()).post('/v1/internal/tools/lookupRide').set(key(cr)).send({ subjectUserId: client.user.id, agentCode: 'accounting' }).expect(403)).body.code).toBe('AGENT_MISMATCH');
    await request(server()).post('/v1/internal/tools/lookupRide').set(bearer(client)).send({ agentCode: 'customer_relations', subjectUserId: client.user.id }).expect(403);
    const readonly = await createStaffAndLogin(app, ['readonly']);
    await request(server()).post('/v1/internal/tools/lookupRide').set(bearer(readonly.tokens)).send({ agentCode: 'customer_relations', subjectUserId: client.user.id }).expect(403);
    await request(server()).post('/v1/internal/tools/lookupRide').send({}).expect(401);
    await request(server()).post('/v1/internal/agents/analytics/run').set(bearer(driver.tokens)).send({ input: {} }).expect(403);
    const journal = await request(server()).get('/v1/internal/agents/runs').query({ agentCode: 'customer_relations', pageSize: 5 }).set(key(cr)).expect(200);
    expect(journal.body.items.length).toBeGreaterThan(0);
    await request(server()).get('/v1/internal/agents/runs').set(key(acc)).expect(403);
  });

  it('agent recrutement : extraction par la vision, cohérence avec le profil, proposition soumise à la validation humaine (mode verrouillé)', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false, firstName: 'Élodie' });
    await db(app).update(schema.users).set({ lastName: 'Tremblay' }).where(eq(schema.users.id, driver.userId));
    const fileKey = `test/${driver.driverId}/licence-${rand()}.png`;
    await app.get<MockStorageProvider>(STORAGE_PROVIDER).putObject({ key: fileKey, body: PNG, contentType: 'image/png' });
    const [doc] = await db(app).insert(schema.driverDocuments).values({ driverId: driver.driverId, type: 'licence', fileKey, number: 'T1234-567890-12', expiresOn: '2031-05-01', status: 'pending' }).returning();
    llm.script((req) => {
      if (req.schemaName === 'document_fields') return { output: { documentType: 'licence', fullName: 'TREMBLAY, ELODIE', number: 'T1234 567890 12', issuedOn: '2023-05-01', expiresOn: '2031-05-01', issuer: 'SAAQ', legible: true, doubts: [] } };
      if (req.schemaName === 'document_decision') return { output: { decision: 'approve', reason: 'Permis valide et conforme au profil', justification: 'Nom, numéro et échéance concordent ; document lisible.' } };
      return undefined;
    });
    await events().emitAndWait('driver.document_uploaded', { documentId: doc!.id, driverId: driver.driverId, type: 'licence' });
    const [run] = await db(app).select().from(schema.agentRuns).where(and(eq(schema.agentRuns.agentCode, 'driver_recruitment'), eq(schema.agentRuns.triggerRef, doc!.id)));
    track(run?.id);
    expect(run).toMatchObject({ status: 'awaiting_approval', trigger: 'document.uploaded' });
    expect((run!.toolCalls as Array<{ tool: string }>).map((c) => c.tool)).toEqual(['extractDocumentFields', 'compareIdentity', 'proposeDecision']);
    const vision = llm.requests.find((r) => r.schemaName === 'document_fields')!;
    expect(vision.messages[0]!.attachments?.[0]).toMatchObject({ kind: 'image', mediaType: 'image/png' });
    // Le modèle de décision ne voit jamais le numéro complet.
    const decisionRequest = llm.requests.find((r) => r.schemaName === 'document_decision')!;
    expect(decisionRequest.messages[0]!.content).not.toContain('567890');
    const [stored] = await db(app).select().from(schema.driverDocuments).where(eq(schema.driverDocuments.id, doc!.id));
    expect(stored).toMatchObject({ status: 'pending', extractedFields: { fullName: 'TREMBLAY, ELODIE', expiresOn: '2031-05-01' } });
    const [approval] = await approvalsOf(run!.id);
    expect(approval).toMatchObject({ proposedAction: 'proposeDecision', data: { documentId: doc!.id, decision: 'approve' } });

    const locked = await request(server()).patch('/v1/admin/agents/driver_recruitment').set(bearer(admin.tokens)).send({ mode: 'auto' });
    expect(locked.status).toBe(409);
    expect(locked.body.code).toBe('AGENT_MODE_LOCKED');
    await request(server()).post(`/v1/admin/approvals/${approval!.id}/decide`).set(bearer(operator.tokens)).send({ decision: 'approved' }).expect(200);
    const [reviewed] = await db(app).select().from(schema.driverDocuments).where(eq(schema.driverDocuments.id, doc!.id));
    expect(reviewed).toMatchObject({ status: 'approved', verifiedByAgentCode: 'driver_recruitment', verifiedByUserId: operator.userId });
  });

  it('agent comptabilité : relevé émis, contrôles déterministes, explications, anomalies signalées pour validation', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const [statement] = await db(app).insert(schema.weeklyStatements).values({ driverId: driver.driverId, periodStart: '2026-09-14', periodEnd: '2026-09-20', creditsCents: 5_000, debitsCents: 0, netCents: 4_000, status: 'issued', issuedAt: new Date() }).returning();
    const [line] = await db(app).insert(schema.statementLines).values({ statementId: statement!.id, kind: 'ride_fare_platform', amountCents: 5_000, rideId: '00000000-0000-4000-8000-00000000abcd', label: 'Tarif de la course', occurredAt: new Date('2026-09-15T15:00:00Z') }).returning();
    llm.script((req) => (req.schemaName === 'statement_review' ? { output: { explanations: [{ index: 0, explanation: 'Le net inscrit (40,00 $) ne correspond pas aux lignes (50,00 $).' }], additional: [{ kind: 'other', lineIds: ['ligne-inconnue'], amountCents: 1, explanation: 'Sans appui' }], summary: 'Deux anomalies à vérifier.' } } : undefined));
    await events().emitAndWait('statement.issued', { statementId: statement!.id, driverId: driver.driverId, periodStart: '2026-09-14', netCents: 4_000 });
    const [run] = await db(app).select().from(schema.agentRuns).where(and(eq(schema.agentRuns.agentCode, 'accounting'), eq(schema.agentRuns.triggerRef, statement!.id)));
    track(run?.id);
    expect(run).toMatchObject({ status: 'awaiting_approval', output: { automaticChecks: 2, summary: 'Deux anomalies à vérifier.' } });
    const approvals = await approvalsOf(run!.id);
    expect(approvals.map((a) => (a.data as { kind: string }).kind).sort()).toEqual(['line_without_ride', 'totals_mismatch']);
    const totals = approvals.find((a) => (a.data as { kind: string }).kind === 'totals_mismatch')!;
    expect(totals.justification).toContain('ne correspond pas');
    expect((approvals.find((a) => (a.data as { kind: string }).kind === 'line_without_ride')!.data as { lineIds: string[] }).lineIds).toEqual([line!.id]);
    const confirmed = await request(server()).post(`/v1/admin/approvals/${totals.id}/decide`).set(bearer(operator.tokens)).send({ decision: 'approved' }).expect(200);
    expect(confirmed.body.executionResult).toMatchObject({ acknowledged: true });
  });

  it('agent d\'analyse : rapport en français (lecture seule), envoi au fondateur par courriel, visible dans My Hub, période planifiée faite une fois', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    llm.script((req) => (req.schemaName === 'report' ? { output: { title: 'Rapport quotidien du 25 septembre 2026', summary: 'Journée calme.', highlights: ['Aucune annulation'], concerns: ['Peu de courses'], body: 'Détail des indicateurs.' } } : undefined));
    const onDemand = await request(server()).post('/v1/internal/agents/analytics/run').set(bearer(operator.tokens)).send({ input: { kind: 'daily', from: '2026-09-25', to: '2026-09-25', send: false } }).expect(200);
    track(onDemand.body.run?.id);
    expect(onDemand.body.run).toMatchObject({ agentCode: 'analytics', status: 'succeeded', output: { title: 'Rapport quotidien du 25 septembre 2026', sentTo: 0 } });
    expect(onDemand.body.run.toolCalls.map((c: { tool: string }) => c.tool)).toEqual(['queryMetrics', 'queryMetrics']);
    const metrics = llm.requests.find((r) => r.schemaName === 'report')!.messages[0]!.content;
    expect(metrics).toContain('ridesCompleted');

    const founder = testEmail('fondateur');
    emails.push(founder);
    const period = { kind: 'daily' as const, from: '2026-09-24', to: '2026-09-24', ref: `daily:t13b-${rand()}` };
    const scheduled = await app.get(AnalyticsAgent).runReport(period, { send: true, recipients: [founder], scheduled: true });
    track(scheduled.run.id);
    expect(scheduled.run).toMatchObject({ status: 'succeeded', triggerRef: period.ref, output: { sentTo: 1 } });
    const [mail] = await db(app).select().from(schema.notifications).where(eq(schema.notifications.recipientAddress, founder));
    expect(mail).toMatchObject({ channel: 'email', template: 'agent.report', language: 'fr' });
    expect((mail!.data as { text: string }).text).toContain('Points d\'attention');
    const again = await app.get(AnalyticsAgent).runReport(period, { send: true, recipients: [founder], scheduled: true });
    expect(again.replayed).toBe(true);
    expect(await db(app).select().from(schema.notifications).where(eq(schema.notifications.recipientAddress, founder))).toHaveLength(1);

    const reports = await request(server()).get('/v1/admin/agents/reports').query({ pageSize: 50 }).set(bearer(operator.tokens)).expect(200);
    expect(reports.body.items.find((r: { runId: string }) => r.runId === scheduled.run.id)).toMatchObject({ kind: 'daily', title: 'Rapport quotidien du 25 septembre 2026', sentTo: 1 });
    // Avant 7 h (heure de Montréal), aucun rapport n'est dû.
    expect(await app.get(AgentJobsService).reportTick(new Date('2026-09-28T10:00:00Z'))).toEqual([]);
    const settings = app.get(SettingsService);
    expect(await settings.number('agents.report_hour', 0)).toBe(7);
  });
});
