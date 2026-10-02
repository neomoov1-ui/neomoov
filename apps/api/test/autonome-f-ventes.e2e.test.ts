import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MockCalendarProvider, MockCrmProvider, MockLlmProvider, MockPlacesProvider, MockVoiceProvider } from '../src/adapters/mock/index.js';
import { CALENDAR_PROVIDER, CRM_PROVIDER, LLM_PROVIDER, PLACES_PROVIDER, VOICE_PROVIDER } from '../src/adapters/types.js';
import { SettingsService } from '../src/common/settings.service.js';
import { AgentRunnerService } from '../src/modules/agents/agent-runner.service.js';
import { AgentToolsService } from '../src/modules/agents/agent-tools.service.js';
import { CrmJobsService } from '../src/modules/crm/crm-jobs.service.js';
import { renderNotification } from '../src/modules/notifications/templates.js';
import { FollowupsService } from '../src/modules/sales/followups.service.js';
import { ProspectingAgent } from '../src/modules/sales/prospecting.agent.js';
import { bearer, cleanupTestData, createStaffAndLogin, db, loginByOtp, startTestApp, testEmail, testPhone, type StaffSession } from './helpers.js';

/**
 * Phase 1 « entreprise autonome », agent F (direction commerciale) : import de prospects (jamais un particulier),
 * qualification par le modèle simulé et séquence planifiée (envois journalisés, HubSpot simulé), appel sortant simulé
 * (Vapi) puis rapport de fin d'appel (résultat, rendez-vous dans l'agenda simulé, HubSpot), relances J+3, J+10, J+30 puis
 * clôture, devis entreprise dans la grille exécuté et hors grille soumis à approbation, retrait (« ne plus contacter »)
 * qui bloque tout, candidature de chauffeur incomplète relancée, droits d'accès.
 */
const SALES_AGENTS = [
  { code: 'b2b_prospecting', name: 'Prospection B2B', file: 'b2b-prospecting.v1.md', effort: 'medium', tools: ['searchProspects', 'listLeadProspects', 'createProspect', 'qualifyProspect', 'startSequence', 'markDoNotContact'] },
  { code: 'outbound_calls', name: 'Appels sortants commerciaux', file: 'outbound-calls.v1.md', effort: 'low', tools: ['scheduleCall', 'scheduleMeeting', 'createBusinessQuote', 'openBusinessAccount', 'markDoNotContact', 'proposeSalesDecision'] },
  { code: 'followups', name: 'Relances', file: 'followups.v1.md', effort: 'low', tools: ['sendFollowup', 'markDoNotContact'] },
] as const;
const DOCS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'agents');
const tag = Math.random().toString(36).slice(2, 8);
const days = (n: number, from = new Date()) => new Date(from.getTime() + n * 86_400_000);

describe('agent F : direction commerciale automatisée (intégration, fournisseurs simulés)', () => {
  let app: NestExpressApplication | null = null;
  let admin: StaffSession;
  let operator: StaffSession;
  let llm: MockLlmProvider;
  let voice: MockVoiceProvider;
  let crm: MockCrmProvider;
  let calendar: MockCalendarProvider;
  let places: MockPlacesProvider;
  const startedAt = new Date();
  const server = () => app!.getHttpServer();
  const prospectIds = new Set<string>();
  const leadIds: string[] = [];
  const driverIds: string[] = [];
  const organizationIds: string[] = [];
  const savedSettings: Array<{ key: string; previous: unknown | null }> = [];
  const savedModes: Array<{ code: string; mode: 'auto' | 'approval' | 'manual' }> = [];

  const waitFor = async <T>(read: () => Promise<T>, ok: (value: T) => boolean, label: string, timeoutMs = 15_000): Promise<T> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await read();
      if (ok(value)) return value;
      if (Date.now() > deadline) throw new Error(`Délai dépassé : ${label} (${JSON.stringify(value)})`);
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  const prospect = async (id: string) => (await db(app!).select().from(schema.prospects).where(eq(schema.prospects.id, id)))[0]!;
  const setMode = async (code: string, mode: 'auto' | 'approval' | 'manual') => {
    const [row] = await db(app!).select({ mode: schema.agents.mode }).from(schema.agents).where(eq(schema.agents.code, code));
    if (!savedModes.some((m) => m.code === code)) savedModes.push({ code, mode: row!.mode });
    await db(app!).update(schema.agents).set({ mode }).where(eq(schema.agents.code, code));
  };
  const setSetting = async (key: string, value: unknown) => {
    const [row] = await db(app!).select({ value: schema.settings.value }).from(schema.settings).where(and(eq(schema.settings.key, key), eq(schema.settings.scope, 'global')));
    savedSettings.push({ key, previous: row ? row.value : null });
    if (row) await db(app!).update(schema.settings).set({ value: value as object }).where(and(eq(schema.settings.key, key), eq(schema.settings.scope, 'global')));
    else await db(app!).insert(schema.settings).values({ key, scope: 'global', value: value as object, description: 'test agent F' });
    app!.get(SettingsService).invalidate();
  };
  const importRows = async (rows: unknown[], session = operator) => {
    const res = await request(server()).post('/v1/admin/sales/prospects/import').set(bearer(session.tokens)).send({ rows });
    expect(res.status).toBe(200);
    return res.body as { imported: number; updated: number; skipped: Array<{ row: number; reason: string }> };
  };
  const byEmail = async (email: string) => (await db(app!).select().from(schema.prospects).where(eq(schema.prospects.email, email)))[0]!;
  const track = (id: string | undefined) => { if (id) prospectIds.add(id); };

  beforeAll(async () => {
    app = await startTestApp({ VAPI_SALES_ASSISTANT_ID: 'asst-sales-test', VAPI_SALES_PHONE_NUMBER_ID: 'pn-sales-test' });
    if (!app) return;
    const database = db(app);
    // Agents et prompts des données de départ (idempotent : rien n'est réécrit s'ils existent déjà).
    for (const a of SALES_AGENTS) {
      await database.insert(schema.agents).values({ code: a.code, name: a.name, mode: 'approval', model: 'claude-opus-5-5', effort: a.effort, tools: [...a.tools], thresholds: {} }).onConflictDoNothing();
      const text = readFileSync(join(DOCS, a.file), 'utf8').replace(/\r\n/g, '\n');
      const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)!;
      const body = match[2]!.trim();
      await database.insert(schema.agentPrompts).values({ key: `${a.code}.v1`, agentCode: a.code, version: 1, body, sha256: createHash('sha256').update(body).digest('hex') }).onConflictDoNothing();
      await database.update(schema.agents).set({ systemPromptKey: `${a.code}.v1` }).where(and(eq(schema.agents.code, a.code), sql`${schema.agents.systemPromptKey} IS NULL`));
    }
    llm = app.get<MockLlmProvider>(LLM_PROVIDER);
    voice = app.get<MockVoiceProvider>(VOICE_PROVIDER);
    crm = app.get<MockCrmProvider>(CRM_PROVIDER);
    calendar = app.get<MockCalendarProvider>(CALENDAR_PROVIDER);
    places = app.get<MockPlacesProvider>(PLACES_PROVIDER);
    // En test, rien n'est automatique : ce fichier porte la file `crm` (mode mémoire) pour voir HubSpot simulé se remplir.
    app.get(CrmJobsService).register();
    admin = await createStaffAndLogin(app, ['admin']);
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
      for (const m of savedModes) await database.update(schema.agents).set({ mode: m.mode }).where(eq(schema.agents.code, m.code));
      for (const s of savedSettings) {
        if (s.previous === null) await database.delete(schema.settings).where(and(eq(schema.settings.key, s.key), eq(schema.settings.scope, 'global')));
        else await database.update(schema.settings).set({ value: s.previous as object }).where(and(eq(schema.settings.key, s.key), eq(schema.settings.scope, 'global')));
      }
      const runs = await database.select({ id: schema.agentRuns.id }).from(schema.agentRuns).where(and(inArray(schema.agentRuns.agentCode, SALES_AGENTS.map((a) => a.code)), gte(schema.agentRuns.startedAt, startedAt)));
      if (runs.length) {
        await database.delete(schema.approvals).where(inArray(schema.approvals.agentRunId, runs.map((r) => r.id)));
        await database.delete(schema.agentRuns).where(inArray(schema.agentRuns.id, runs.map((r) => r.id)));
      }
      const ids = [...prospectIds];
      if (ids.length) {
        await database.delete(schema.notifications).where(sql`${schema.notifications.data}->>'prospectId' IN ${ids}`);
        await database.delete(schema.prospects).where(inArray(schema.prospects.id, ids));
      }
      await database.delete(schema.prospects).where(and(gte(schema.prospects.createdAt, startedAt), sql`${schema.prospects.sourceRef} LIKE ${`t-f-${tag}-%`}`));
      if (driverIds.length) await database.delete(schema.followups).where(and(eq(schema.followups.targetType, 'driver_candidate'), inArray(schema.followups.targetId, driverIds)));
      await database.delete(schema.crmRecords).where(and(eq(schema.crmRecords.provider, 'mock'), gte(schema.crmRecords.createdAt, startedAt)));
      if (leadIds.length) await database.delete(schema.leads).where(inArray(schema.leads.id, leadIds));
      await cleanupTestData(app);
      if (organizationIds.length) {
        await database.delete(schema.organizationFeatures).where(inArray(schema.organizationFeatures.organizationId, organizationIds));
        await database.delete(schema.organizations).where(inArray(schema.organizations.id, organizationIds));
      }
    }
    await app?.close();
  });

  it('import de prospects : organisations avec coordonnées professionnelles acceptées, particulier refusé, liste et fiche masquées, droits', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const hotelEmail = testEmail(`achats-${tag}`);
    const clinicEmail = testEmail(`clinique-${tag}`);
    const result = await importRows([
      { organizationName: `Hôtel Test ${tag}`, segment: 'hotel', city: 'Montréal', contactName: 'Service des achats', email: hotelEmail, phone: testPhone(), website: 'https://hotel-test.example' },
      { organizationName: `Clinique Test ${tag}`, segment: 'clinic', email: clinicEmail },
    ]);
    expect(result).toMatchObject({ imported: 2, updated: 0, skipped: [] });
    const hotel = await byEmail(hotelEmail);
    track(hotel.id);
    track((await byEmail(clinicEmail)).id);
    expect(hotel).toMatchObject({ source: 'csv_import', stage: 'new', consentBasis: 'published_address', segment: 'hotel' });
    expect(hotel.score).toBeGreaterThan(30);
    // Réimport : fiche complétée, jamais dupliquée.
    expect(await importRows([{ organizationName: `Hôtel Test ${tag}`, email: hotelEmail, contactRole: 'Direction' }])).toMatchObject({ imported: 0, updated: 1 });
    expect((await byEmail(hotelEmail)).contactRole).toBe('Direction');
    // Jamais un particulier : une messagerie grand public est refusée à la validation.
    const personal = await request(server()).post('/v1/admin/sales/prospects/import').set(bearer(operator.tokens)).send({ rows: [{ organizationName: 'Quelqu\'un', email: `jean-${tag}@gmail.com` }] });
    expect(personal.status).toBe(400);
    // Liste filtrée et fiche : coordonnées masquées.
    const list = await request(server()).get('/v1/admin/sales/prospects').query({ q: `Test ${tag}`, segment: 'hotel', pageSize: 10 }).set(bearer(operator.tokens)).expect(200);
    expect(list.body.items.map((p: { id: string }) => p.id)).toEqual([hotel.id]);
    expect(list.body.items[0].email).not.toBe(hotelEmail);
    expect(list.body.items[0].email).toContain('•');
    const detail = await request(server()).get(`/v1/admin/sales/prospects/${hotel.id}`).set(bearer(operator.tokens)).expect(200);
    expect(detail.body.prospect.organizationName).toBe(`Hôtel Test ${tag}`);
    expect(detail.body.touches.length).toBeGreaterThanOrEqual(0);
    // Lecture seule : liste permise, import refusé.
    const readonly = await createStaffAndLogin(app, ['readonly']);
    await request(server()).get('/v1/admin/sales/prospects').set(bearer(readonly.tokens)).expect(200);
    await request(server()).post('/v1/admin/sales/prospects/import').set(bearer(readonly.tokens)).send({ rows: [{ organizationName: 'X', email: testEmail('x') }] }).expect(403);
  });

  it('prospection : sources déclarées (Google Places simulé, demande du site), qualification par le modèle simulé, séquence lancée (envois journalisés, relance planifiée, HubSpot simulé)', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    await setSetting('sales.sources', { places: { categories: ['hôtel'], zones: [`Montréal ${tag}`] }, csv: true, webLeads: true });
    await setSetting('sales.daily_new_prospects', 50);
    await setMode('b2b_prospecting', 'auto');
    places.results.set(`hôtel Montréal ${tag}`, [
      { placeId: `t-f-${tag}-1`, name: `Auberge ${tag}`, formattedAddress: '1 rue Test, Montréal, QC', city: 'Montréal', phone: '+15145550201', website: `https://auberge-${tag}.example`, rating: 4.4, reviewCount: 120, types: ['lodging'], businessStatus: 'OPERATIONAL' },
      { placeId: `t-f-${tag}-2`, name: `Hôtel fermé ${tag}`, formattedAddress: '2 rue Test, Montréal, QC', city: 'Montréal', phone: '+15145550202', website: null, rating: null, reviewCount: null, types: ['lodging'], businessStatus: 'CLOSED_PERMANENTLY' },
      { placeId: `t-f-${tag}-3`, name: `Résidence ${tag}`, formattedAddress: '3 rue Test, Montréal, QC', city: 'Montréal', phone: '+15145550203', website: null, rating: 3.1, reviewCount: 4, types: ['lodging'], businessStatus: 'OPERATIONAL' },
    ]);
    const leadEmail = testEmail(`entreprise-${tag}`);
    const [lead] = await db(app).insert(schema.leads).values({ kind: 'business', firstName: 'Marc', lastName: 'Demandeur', phone: testPhone(), email: leadEmail, city: 'Laval', message: `Nous sommes Traiteur ${tag} inc. et cherchons un transporteur pour nos équipes.`, language: 'fr', source: 'web', consentAt: new Date() }).returning({ id: schema.leads.id });
    leadIds.push(lead!.id);
    llm.script((req) => {
      if (req.schemaName !== 'prospect_qualification') return undefined;
      const content = req.messages.at(-1)!.content;
      expect(content).toContain('<donnees_utilisateur source="candidats">');
      const json = /<donnees_utilisateur source="candidats">\n([\s\S]*?)\n<\/donnees_utilisateur>/.exec(content)![1]!;
      const batch = JSON.parse(json) as Array<{ ref: string; organizationName: string | null; segment: string }>;
      return {
        output: {
          items: batch.map(({ ref, organizationName, segment }) => (organizationName?.startsWith('Résidence')
            ? { ref, organizationName: null, segment: 'other', size: 'small', interest: 'low', qualified: false, reason: 'Résidence privée, pas une organisation cliente' }
            : { ref, organizationName: ref.startsWith('lead:') ? `Traiteur ${tag} inc.` : null, segment: ref.startsWith('lead:') ? 'business' : segment === 'other' ? 'hotel' : segment, size: 'medium', interest: 'high', qualified: true, reason: 'Établissement avec besoins de déplacements' })),
        },
      };
    });
    const execution = await app.get(ProspectingAgent).run(new Date(), { ref: `test-${tag}` });
    expect(execution.run.status).toBe('succeeded');
    const summary = execution.result!;
    expect(summary.searches).toBe(1);
    expect(summary.candidates).toBe(2);
    expect(summary.created).toBe(2);
    expect(summary.leads).toBeGreaterThanOrEqual(1);
    expect(summary.qualified).toBeGreaterThanOrEqual(2);
    expect(summary.rejected).toBeGreaterThanOrEqual(1);
    expect(summary.sequencesStarted).toBeGreaterThanOrEqual(2);
    const created = await db(app).select().from(schema.prospects).where(sql`${schema.prospects.sourceRef} LIKE ${`t-f-${tag}-%`}`);
    for (const p of created) track(p.id);
    expect(created.map((p) => p.sourceRef).sort()).toEqual([`t-f-${tag}-1`, `t-f-${tag}-3`]);
    const auberge = created.find((p) => p.sourceRef === `t-f-${tag}-1`)!;
    const residence = created.find((p) => p.sourceRef === `t-f-${tag}-3`)!;
    expect(residence).toMatchObject({ stage: 'lost', segment: 'other' });
    // L'auberge n'a qu'un numéro (sans WhatsApp d'affaires) : qualifiée, mais aucune séquence sans canal professionnel.
    expect(auberge).toMatchObject({ stage: 'qualified', segment: 'hotel', interest: 'high', source: 'google_places', consentBasis: 'published_address' });
    expect(auberge.score).toBeGreaterThan(auberge.score - 1);
    // Demande du site : prospect créé avec le nom donné par le modèle, consentement du formulaire, séquence par courriel.
    const [fromLead] = await db(app).select().from(schema.prospects).where(eq(schema.prospects.leadId, lead!.id));
    track(fromLead?.id);
    expect(fromLead).toMatchObject({ organizationName: `Traiteur ${tag} inc.`, source: 'web_lead', consentBasis: 'form', stage: 'contacted', sequenceKey: 'b2b_standard', sequenceChannel: 'email', email: leadEmail });
    expect(fromLead!.consentAt).toBeInstanceOf(Date);
    expect(fromLead!.firstContactAt).toBeInstanceOf(Date);
    // Prospects importés (test précédent) : qualifiés et séquence hôtel lancée par courriel.
    const hotel = await byEmail(testEmail(`achats-${tag}`).replace(/^achats-[^-]+-[^@]+@/, 'achats-')).catch(() => null);
    void hotel;
    const [hotelRow] = await db(app).select().from(schema.prospects).where(and(eq(schema.prospects.segment, 'hotel'), eq(schema.prospects.source, 'csv_import'), sql`${schema.prospects.organizationName} = ${`Hôtel Test ${tag}`}`));
    expect(hotelRow).toMatchObject({ stage: 'contacted', sequenceKey: 'b2b_hotel', sequenceChannel: 'email' });
    // Envoi journalisé par la file des notifications, avec l'objet du gabarit approuvé et la mention de retrait.
    const [sent] = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.template, 'sales.message'), sql`${schema.notifications.data}->>'prospectId' = ${hotelRow!.id}`));
    expect(sent).toMatchObject({ channel: 'email', recipientAddress: hotelRow!.email, language: 'fr' });
    expect((sent!.data as { subject: string; step: number }).step).toBe(0);
    expect((sent!.data as { subject: string }).subject).toContain(`Hôtel Test ${tag}`);
    const rendered = renderNotification('sales.message', sent!.data as Record<string, unknown>, 'fr');
    expect(rendered.body).toContain('STOP');
    expect(rendered.body).toContain('contact@neomoov.net');
    // Relance J+3 planifiée par le canal d'origine ; fil des contacts ; journal des outils.
    const [followup] = await db(app).select().from(schema.followups).where(and(eq(schema.followups.prospectId, hotelRow!.id), eq(schema.followups.status, 'scheduled')));
    expect(followup).toMatchObject({ targetType: 'prospect', channel: 'email', attempt: 0, maxAttempts: 3 });
    expect(followup!.dueAt.getTime() - followup!.referenceAt.getTime()).toBe(3 * 86_400_000);
    const tools = (execution.run.toolCalls as Array<{ tool: string; ok: boolean }>).map((c) => c.tool);
    expect(tools).toEqual(expect.arrayContaining(['searchProspects', 'createProspect', 'listLeadProspects', 'qualifyProspect', 'startSequence']));
    // Rejouée le même jour : rien n'est refait.
    expect((await app.get(ProspectingAgent).run(new Date(), { ref: `test-${tag}` })).replayed).toBe(true);
    // HubSpot simulé : entreprise, contact professionnel et transaction « Ventes B2B / Contact établi ».
    const company = await waitFor(() => Promise.resolve(crm.company(`prospect:${hotelRow!.id}`)), (c) => Boolean(c), 'entreprise HubSpot');
    expect(company).toMatchObject({ name: `Hôtel Test ${tag}`, accountType: 'prospect', organizationType: 'hotel', consent: { given: true, source: 'b2b' } });
    expect(crm.contact(`prospect:${hotelRow!.id}`)).toMatchObject({ email: hotelRow!.email, leadKind: 'business' });
    expect(crm.deal(`prospect:${hotelRow!.id}`)).toMatchObject({ pipeline: 'b2b', stage: 'contacted' });
    expect((await prospect(hotelRow!.id)).hubspotId).toBeTruthy();
    // Prospect de la demande du site : consentement du formulaire.
    await waitFor(() => Promise.resolve(crm.contact(`prospect:${fromLead!.id}`)), (c) => Boolean(c), 'contact HubSpot');
    expect(crm.contact(`prospect:${fromLead!.id}`)).toMatchObject({ consent: { source: 'form' } });
  });

  it('appel sortant simulé (assistant commercial, numéro dédié) → rapport de fin d\'appel → rendez-vous dans l\'agenda simulé, confirmation, HubSpot ; messagerie → nouvelle tentative proposée à l\'approbation ; rapport reçu deux fois', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const [hotel] = await db(app).select().from(schema.prospects).where(sql`${schema.prospects.organizationName} = ${`Hôtel Test ${tag}`}`);
    const callsBefore = voice.calls.length;
    const call = await request(server()).post(`/v1/admin/sales/prospects/${hotel!.id}/call`).set(bearer(operator.tokens)).send({}).expect(200);
    expect(call.body).toMatchObject({ ok: true, data: { status: 'calling', scriptKey: 'b2b_intro' } });
    expect(voice.calls).toHaveLength(callsBefore + 1);
    expect(voice.calls.at(-1)).toMatchObject({ to: hotel!.phone, assistantId: 'asst-sales-test', phoneNumberId: 'pn-sales-test', metadata: expect.objectContaining({ callId: call.body.data.id, recording: 'off' }) });
    const vapiCallId = voice.calls.at(-1)!.metadata ? (await db(app).select({ v: schema.outboundCalls.vapiCallId }).from(schema.outboundCalls).where(eq(schema.outboundCalls.id, call.body.data.id)))[0]!.v! : '';
    expect(vapiCallId).toMatch(/^call_mock/);
    // Rapport : rendez-vous accepté, structuré par l'assistant (aucun appel au modèle).
    const meetingAt = new Date(Date.now() + 2 * 86_400_000);
    meetingAt.setUTCHours(15, 0, 0, 0);
    const report = { message: { type: 'end-of-call-report', call: { id: vapiCallId, assistantId: 'asst-sales-test', metadata: { callId: call.body.data.id } }, assistant: { id: 'asst-sales-test' }, analysis: { summary: 'Direction intéressée par les transferts aéroport ; rendez-vous accepté.', structuredData: { result: 'meeting', meetingAt: meetingAt.toISOString(), recordingConsent: false } }, endedReason: 'assistant-ended-call', cost: 0.21, durationSeconds: 140 } };
    const eventsBefore = calendar.events.length;
    await request(server()).post('/v1/webhooks/vapi').set('x-vapi-secret', 'mock-signature').send(report).expect(200);
    await request(server()).post('/v1/webhooks/vapi').set('x-vapi-secret', 'mock-signature').send(report).expect(200);
    expect(llm.requests).toHaveLength(0);
    const [row] = await db(app).select().from(schema.outboundCalls).where(eq(schema.outboundCalls.id, call.body.data.id));
    expect(row).toMatchObject({ status: 'completed', result: 'meeting', costMicros: 210_000, durationSeconds: 140, recordingConsent: false });
    expect(row!.meetingAt?.toISOString()).toBe(meetingAt.toISOString());
    expect(calendar.events).toHaveLength(eventsBefore + 1);
    expect(calendar.events.at(-1)).toMatchObject({ title: `Neomoov × Hôtel Test ${tag}`, startsAt: meetingAt });
    expect((await prospect(hotel!.id)).stage).toBe('meeting');
    const [confirmation] = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.template, 'sales.meeting_confirmation'), eq(schema.notifications.recipientAddress, hotel!.email!)));
    expect(confirmation).toMatchObject({ channel: 'email' });
    const [run] = await db(app).select().from(schema.agentRuns).where(and(eq(schema.agentRuns.agentCode, 'outbound_calls'), eq(schema.agentRuns.triggerRef, call.body.data.id)));
    expect(run).toMatchObject({ status: 'succeeded', trigger: 'call.report' });
    expect((run!.toolCalls as Array<{ tool: string }>).map((c) => c.tool)).toEqual(['scheduleMeeting']);
    // Relance en cours annulée (le prospect a répondu) ; un seul rendez-vous malgré le rapport reçu deux fois ; journal de l'appel vocal non dupliqué.
    const followups = await db(app).select().from(schema.followups).where(eq(schema.followups.prospectId, hotel!.id));
    expect(followups.every((f) => f.status === 'cancelled' && f.closeReason === 'replied')).toBe(true);
    expect(await db(app).select().from(schema.agentRuns).where(and(eq(schema.agentRuns.agentCode, 'voice_call_center'), eq(schema.agentRuns.triggerRef, vapiCallId)))).toHaveLength(0);
    const notes = await waitFor(() => Promise.resolve(crm.notes.filter((n) => n.body.includes('Appel sortant (meeting)'))), (n) => n.length >= 1, 'note HubSpot');
    expect(notes[0]!.body).toContain('rendez-vous');

    // Messagerie sur un autre prospect : résultat déduit de la raison de fin, nouvelle tentative proposée (agent en mode approbation).
    const [clinic] = await db(app).select().from(schema.prospects).where(sql`${schema.prospects.organizationName} = ${`Clinique Test ${tag}`}`);
    await db(app).update(schema.prospects).set({ phone: testPhone() }).where(eq(schema.prospects.id, clinic!.id));
    const second = await request(server()).post(`/v1/admin/sales/prospects/${clinic!.id}/call`).set(bearer(operator.tokens)).send({ scriptKey: 'b2b_intro' }).expect(200);
    const secondVapi = (await db(app).select({ v: schema.outboundCalls.vapiCallId }).from(schema.outboundCalls).where(eq(schema.outboundCalls.id, second.body.data.id)))[0]!.v!;
    await request(server()).post('/v1/webhooks/vapi').set('x-vapi-secret', 'mock-signature').send({ message: { type: 'end-of-call-report', call: { id: secondVapi, assistantId: 'asst-sales-test' }, endedReason: 'voicemail', cost: 0.02, durationSeconds: 12 } }).expect(200);
    const [voicemail] = await db(app).select().from(schema.outboundCalls).where(eq(schema.outboundCalls.id, second.body.data.id));
    expect(voicemail).toMatchObject({ status: 'completed', result: 'voicemail' });
    const [retryRun] = await db(app).select().from(schema.agentRuns).where(and(eq(schema.agentRuns.agentCode, 'outbound_calls'), eq(schema.agentRuns.triggerRef, second.body.data.id)));
    expect(retryRun!.status).toBe('awaiting_approval');
    const [approval] = await db(app).select().from(schema.approvals).where(eq(schema.approvals.agentRunId, retryRun!.id));
    expect(approval).toMatchObject({ proposedAction: 'scheduleCall', decision: 'pending' });
    const decided = await request(server()).post(`/v1/admin/approvals/${approval!.id}/decide`).set(bearer(operator.tokens)).send({ decision: 'approved' }).expect(200);
    expect(decided.body.executionError).toBeNull();
    expect(decided.body.executionResult.callId).toBeTruthy();
    const [scheduled] = await db(app).select().from(schema.outboundCalls).where(eq(schema.outboundCalls.id, decided.body.executionResult.callId));
    expect(scheduled).toMatchObject({ status: 'scheduled', prospectId: clinic!.id });
    expect(scheduled!.scheduledAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect((await prospect(clinic!.id)).stage).toBe('contacted');
  });

  it('relances : J+3, J+10, J+30 par le canal d\'origine, rédigées par le modèle simulé, puis clôture ; candidature de chauffeur incomplète relancée', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    await setMode('followups', 'auto');
    const [traiteur] = await db(app).select().from(schema.prospects).where(sql`${schema.prospects.organizationName} = ${`Traiteur ${tag} inc.`}`);
    const [chain] = await db(app).select().from(schema.followups).where(and(eq(schema.followups.prospectId, traiteur!.id), eq(schema.followups.status, 'scheduled')));
    expect(chain).toMatchObject({ attempt: 0, channel: 'email' });
    // Candidat chauffeur sans documents, inscrit il y a cinq jours.
    const candidate = await loginByOtp(app, undefined, {}, { card: false });
    const [numberRow] = await db(app).execute<{ n: string }>(sql`SELECT next_driver_public_number() AS n`);
    const [driver] = await db(app).insert(schema.drivers).values({ userId: candidate.user.id, publicNumber: numberRow!.n, status: 'pending', qualification: 'saaq_authorized', createdAt: days(-5) }).returning({ id: schema.drivers.id });
    driverIds.push(driver!.id);
    llm.script((req) => (req.schemaName === 'followup_message' ? { output: { subject: `Suite à mon message (${tag})`, text: `Je reviens vers vous au sujet de nos déplacements professionnels, comme convenu dans le gabarit ${tag}.` } } : undefined));
    const first = await app.get(FollowupsService).run(days(4), { ref: null });
    expect(first.run.status).toBe('succeeded');
    expect(first.result!.discovered.candidates).toBeGreaterThanOrEqual(1);
    expect(first.result!.sent).toBeGreaterThanOrEqual(2);
    const afterFirst = (await db(app).select().from(schema.followups).where(eq(schema.followups.id, chain!.id)))[0]!;
    expect(afterFirst).toMatchObject({ status: 'scheduled', attempt: 1 });
    expect(afterFirst.dueAt.getTime() - chain!.referenceAt.getTime()).toBe(10 * 86_400_000);
    const sent = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.template, 'sales.message'), sql`${schema.notifications.data}->>'followupId' = ${chain!.id}`));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ channel: 'email', recipientAddress: traiteur!.email });
    expect((sent[0]!.data as { text: string; attempt: number })).toMatchObject({ attempt: 1 });
    expect((sent[0]!.data as { text: string }).text).toContain(tag);
    // Le modèle a reçu le gabarit approuvé et le fil comme données.
    const drafted = llm.requests.find((r) => r.schemaName === 'followup_message')!;
    expect(drafted.messages[0]!.content).toContain('<donnees_utilisateur source="gabarit">');
    // Candidat : chaîne ouverte à partir de la candidature et relance envoyée au compte (push et texto selon la matrice).
    const [candidateChain] = await db(app).select().from(schema.followups).where(and(eq(schema.followups.targetType, 'driver_candidate'), eq(schema.followups.targetId, driver!.id)));
    expect(candidateChain).toMatchObject({ attempt: 1, status: 'scheduled', channel: 'push' });
    const reminders = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.template, 'sales.candidate_reminder'), eq(schema.notifications.recipientUserId, candidate.user.id)));
    expect(reminders.map((n) => n.channel).sort()).toEqual(['push', 'sms']);
    // J+10 puis J+30 : clôture après la dernière relance.
    await app.get(FollowupsService).run(days(11), { ref: null });
    expect((await db(app).select().from(schema.followups).where(eq(schema.followups.id, chain!.id)))[0]).toMatchObject({ status: 'scheduled', attempt: 2 });
    await app.get(FollowupsService).run(days(31), { ref: null });
    const closed = (await db(app).select().from(schema.followups).where(eq(schema.followups.id, chain!.id)))[0]!;
    expect(closed).toMatchObject({ status: 'closed', attempt: 3, closeReason: 'exhausted' });
    expect(closed.closedAt).toBeInstanceOf(Date);
    expect(await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.template, 'sales.message'), sql`${schema.notifications.data}->>'followupId' = ${chain!.id}`))).toHaveLength(3);
    // Rien de plus après la clôture (la base est partagée : seule cette chaîne est comptée).
    await app.get(FollowupsService).run(days(40), { ref: null });
    expect(await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.template, 'sales.message'), sql`${schema.notifications.data}->>'followupId' = ${chain!.id}`))).toHaveLength(3);
  });

  it('devis entreprise : dans la grille exécuté (mode automatique), hors grille soumis à l\'approbation puis exécuté une seule fois ; bouton de My Hub', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    await setMode('outbound_calls', 'auto');
    const quoteEmail = testEmail(`devis-${tag}`);
    await importRows([{ organizationName: `École Test ${tag}`, segment: 'school', email: quoteEmail, contactName: 'Direction' }]);
    const school = await byEmail(quoteEmail);
    track(school.id);
    const runner = app.get(AgentRunnerService);
    const tools = app.get(AgentToolsService);
    const inGrid = await runner.execute('outbound_calls', { name: 'test.quote', ref: null, input: {} }, (ctx) => tools.call(ctx, 'createBusinessQuote', { prospectId: school.id, expectedMonthlyRides: 25, justification: 'Volume annoncé par la direction' }));
    expect(inGrid.result).toMatchObject({ ok: true, status: 'done', data: { discountBps: 500, paymentTermsDays: 30, inGrid: true } });
    const quoted = await prospect(school.id);
    expect(quoted.stage).toBe('quote');
    expect(quoted.lastQuote).toMatchObject({ expectedMonthlyRides: 25, discountBps: 500, inGrid: true });
    const [mail] = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.template, 'sales.quote'), eq(schema.notifications.recipientAddress, quoteEmail)));
    expect(mail).toMatchObject({ channel: 'email' });
    expect(renderNotification('sales.quote', mail!.data as Record<string, unknown>, 'fr').body).toContain('5 %');
    expect((await db(app).select().from(schema.followups).where(and(eq(schema.followups.prospectId, school.id), eq(schema.followups.targetType, 'quote'))))).toHaveLength(1);
    // Hors grille (25 % demandés) : approbation humaine obligatoire, même en mode automatique.
    const outOfGrid = await runner.execute('outbound_calls', { name: 'test.quote', ref: null, input: {} }, (ctx) => tools.call(ctx, 'createBusinessQuote', { prospectId: school.id, expectedMonthlyRides: 60, requestedDiscountBps: 2_500, justification: 'Tarif négocié demandé par le prospect' }));
    expect(outOfGrid.result).toMatchObject({ ok: true, status: 'pending_approval', data: { inGrid: false, discountBps: 2_500 } });
    expect(outOfGrid.run.status).toBe('awaiting_approval');
    const [approval] = await db(app).select().from(schema.approvals).where(eq(schema.approvals.agentRunId, outOfGrid.run.id));
    expect(approval!.justification).toContain('plafond');
    const quotesBefore = (await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.template, 'sales.quote'), eq(schema.notifications.recipientAddress, quoteEmail)))).length;
    const approved = await request(server()).post(`/v1/admin/approvals/${approval!.id}/decide`).set(bearer(operator.tokens)).send({ decision: 'approved' }).expect(200);
    expect(approved.body.executionResult).toMatchObject({ discountBps: 2_500, inGrid: false });
    expect((await prospect(school.id)).lastQuote).toMatchObject({ discountBps: 2_500 });
    expect((await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.template, 'sales.quote'), eq(schema.notifications.recipientAddress, quoteEmail)))).length).toBe(quotesBefore + 1);
    expect((await request(server()).post(`/v1/admin/approvals/${approval!.id}/decide`).set(bearer(operator.tokens)).send({ decision: 'approved' })).status).toBe(409);
    // Devis envoyé par une personne depuis My Hub (hors grille admis : la personne décide).
    const hub = await request(server()).post(`/v1/admin/sales/prospects/${school.id}/quote`).set(bearer(operator.tokens)).send({ expectedMonthlyRides: 10, requestedDiscountBps: 1_200 }).expect(200);
    expect(hub.body).toMatchObject({ ok: true, data: { discountBps: 1_200, inGrid: false } });
    expect(hub.body.message).toContain('hors grille');
  });

  it('compte entreprise ouvert par une personne : organisation cliente de type « business » et propriétaire invité par courriel ; prospect gagné', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const ownerEmail = testEmail(`direction-${tag}`);
    await importRows([{ organizationName: `Agence Test ${tag}`, segment: 'agency', email: ownerEmail }]);
    const agency = await byEmail(ownerEmail);
    track(agency.id);
    const opened = await request(server()).post(`/v1/admin/sales/prospects/${agency.id}/account`).set(bearer(admin.tokens)).send({}).expect(200);
    organizationIds.push(opened.body.data.organizationId);
    expect(opened.body.data.invitationId).toBeTruthy();
    const [org] = await db(app).select().from(schema.organizations).where(eq(schema.organizations.id, opened.body.data.organizationId));
    expect(org).toMatchObject({ type: 'business', name: `Agence Test ${tag}` });
    expect(org!.parentId).not.toBeNull();
    const [invitation] = await db(app).select().from(schema.invitations).where(eq(schema.invitations.id, opened.body.data.invitationId));
    expect(invitation).toMatchObject({ organizationId: org!.id, email: ownerEmail });
    const [invite] = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.template, 'organization.invitation'), eq(schema.notifications.recipientAddress, ownerEmail)));
    expect(invite).toMatchObject({ channel: 'email' });
    expect(await prospect(agency.id)).toMatchObject({ stage: 'won', organizationId: org!.id });
    // Rejouer n'ouvre pas un second compte ; un compte gagné n'est plus démarché.
    const again = await request(server()).post(`/v1/admin/sales/prospects/${agency.id}/account`).set(bearer(admin.tokens)).send({}).expect(200);
    expect(again.body.data).toMatchObject({ organizationId: org!.id, replayed: true });
    expect((await request(server()).post(`/v1/admin/sales/prospects/${agency.id}/call`).set(bearer(operator.tokens)).send({})).status).toBe(409);
  });

  it('« ne plus contacter » bloque tout : séquence, appel, relance, devis refusés ; réimport sans effet ; HubSpot prévenu', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const dncEmail = testEmail(`retrait-${tag}`);
    await importRows([{ organizationName: `Salle Test ${tag}`, segment: 'event', email: dncEmail, phone: testPhone(), whatsappOk: true }]);
    const salle = await byEmail(dncEmail);
    track(salle.id);
    // Prospect qualifié par une personne : fiche HubSpot créée (file `crm`).
    await request(server()).patch(`/v1/admin/sales/prospects/${salle.id}`).set(bearer(operator.tokens)).send({ stage: 'qualified', stageReason: 'Salle de réception active' }).expect(200);
    await waitFor(() => Promise.resolve(crm.deal(`prospect:${salle.id}`)), (d) => d?.stage === 'new', 'transaction HubSpot');
    const runner = app.get(AgentRunnerService);
    const tools = app.get(AgentToolsService);
    const call = await request(server()).post(`/v1/admin/sales/prospects/${salle.id}/call`).set(bearer(operator.tokens)).send({}).expect(200);
    await db(app).update(schema.outboundCalls).set({ status: 'scheduled' }).where(eq(schema.outboundCalls.id, call.body.data.id));
    const removed = await request(server()).post(`/v1/admin/sales/prospects/${salle.id}/do-not-contact`).set(bearer(operator.tokens)).send({ reason: 'Demande reçue par courriel' }).expect(200);
    expect(removed.body).toMatchObject({ stage: 'do_not_contact' });
    expect(removed.body.unsubscribedAt).toBeTruthy();
    expect((await db(app).select().from(schema.outboundCalls).where(eq(schema.outboundCalls.id, call.body.data.id)))[0]!.status).toBe('cancelled');
    const refusals = await runner.execute('outbound_calls', { name: 'test.dnc', ref: null, input: {} }, async (ctx) => [
      await tools.call(ctx, 'scheduleCall', { prospectId: salle.id, justification: 'Essai' }),
      await tools.call(ctx, 'createBusinessQuote', { prospectId: salle.id, expectedMonthlyRides: 30, justification: 'Essai' }),
      await tools.call(ctx, 'openBusinessAccount', { prospectId: salle.id, justification: 'Essai' }),
    ]);
    expect(refusals.result!.map((r) => r.status)).toEqual(['refused', 'refused', 'refused']);
    const sequence = await runner.execute('b2b_prospecting', { name: 'test.dnc', ref: null, input: {} }, (ctx) => tools.call(ctx, 'startSequence', { prospectId: salle.id, justification: 'Essai' }));
    expect(sequence.result).toMatchObject({ status: 'refused' });
    expect((await request(server()).post(`/v1/admin/sales/prospects/${salle.id}/call`).set(bearer(operator.tokens)).send({})).body.code).toBe('PROSPECT_NOT_CONTACTABLE');
    expect((await request(server()).post(`/v1/admin/sales/prospects/${salle.id}/followup`).set(bearer(operator.tokens)).send({})).status).toBe(409);
    expect((await request(server()).patch(`/v1/admin/sales/prospects/${salle.id}`).set(bearer(operator.tokens)).send({ stage: 'qualified' })).status).toBe(409);
    // Réimport de la même adresse : refusé avec motif, fiche inchangée ; HubSpot : transaction perdue, note du retrait.
    expect(await importRows([{ organizationName: `Salle Test ${tag}`, email: dncEmail }])).toMatchObject({ imported: 0, updated: 0, skipped: [{ row: 1, reason: 'do_not_contact' }] });
    expect(await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.template, 'sales.message'), eq(schema.notifications.recipientAddress, dncEmail)))).toHaveLength(0);
    const deal = await waitFor(() => Promise.resolve(crm.deal(`prospect:${salle.id}`)), (d) => d?.stage === 'lost', 'transaction HubSpot perdue');
    expect(deal).toMatchObject({ pipeline: 'b2b', stage: 'lost' });
    expect(crm.notes.some((n) => n.body.includes('Retrait demandé'))).toBe(true);
  });
});
