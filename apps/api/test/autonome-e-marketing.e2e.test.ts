import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MockLlmProvider, MockLlmRequest, MockSearchConsoleProvider, MockSiteConnector, MockSocialPublisher, MockStorageProvider } from '../src/adapters/mock/index.js';
import { SEARCH_CONSOLE_PROVIDER, SITE_CONNECTOR, SOCIAL_PUBLISHERS, type SocialPublishers } from '../src/adapters/marketing.types.js';
import { LLM_PROVIDER, STORAGE_PROVIDER } from '../src/adapters/types.js';
import { SettingsService } from '../src/common/settings.service.js';
import { ContentAgent } from '../src/modules/marketing/content.agent.js';
import { MarketingJobsService } from '../src/modules/marketing/marketing-jobs.service.js';
import { PublishingService } from '../src/modules/marketing/publishing.service.js';
import { SeoAgent } from '../src/modules/marketing/seo.agent.js';
import { bearer, cleanupTestData, createStaffAndLogin, db, resetHttpLimits, startTestApp, type StaffSession } from './helpers.js';

/**
 * Phase 1 « entreprise autonome », agent E (marketing) : calendrier produit par l'agent contenu (modèle simulé) en lignes
 * `draft` (sensible ou bloqué : approbation humaine ; mode automatique : programmé tout de suite), approbation → `scheduled`,
 * publication par les connecteurs simulés → `published` avec identifiant externe, mesure → `measured`, échec de
 * connecteur → nouvelle tentative puis `failed`, commentaires simples et relais humain, tâche de référencement créée puis
 * appliquée sur le site simulé, droits d'accès. Les contenus de test sont retirés à la fin.
 */
const WEEK = '2031-03-10';
const SEO_WEEK = '2031-03-17';
const rand = () => Math.random().toString(36).slice(2, 8);

type Item = { id: string; space: string; status: string; sensitive: boolean; issues: Array<{ kind: string; blocking: boolean }>; scheduledAt: string | null; externalId: string | null; mediaStatus: string; metrics: { reach: number; history: unknown[] }; comments: Array<{ intent: string; outcome: string; replyBody: string | null }>; attempts: number; lastError: string | null };

const calendarScript = (extra: Array<Record<string, unknown>> = []) => (req: MockLlmRequest) => {
  if (req.kind !== 'structured' || req.schemaName !== 'content_calendar') return undefined;
  const base = { language: 'fr', caption: null, hashtags: ['Montréal', '#aéroport'], cta: 'reserve', sensitive: false, rationale: 'Semaine de l\'aéroport' };
  return {
    output: {
      summary: 'Fil conducteur : le transfert aéroport au prix tout compris.',
      items: [
        { ...base, space: 'facebook', format: 'post', title: null, body: 'Réservez votre transfert vers l\'aéroport au prix tout compris, affiché avant de confirmer.', visualHeadline: 'Aéroport, prix tout compris' },
        { ...base, space: 'facebook', format: 'post', title: null, body: 'Un chauffeur vous attend avec de l\'eau et un chargeur : le confort change la course.', visualHeadline: 'Le confort change la course' },
        { ...base, space: 'instagram', format: 'post', title: null, caption: 'Montréal en mode premium, 100 % électrique.', body: 'Montréal en mode premium.', hashtags: ['neomoov', 'montreal'], visualHeadline: 'Montréal en mode premium' },
        { ...base, space: 'instagram', format: 'reel', title: null, caption: 'Vingt secondes à bord d\'une Neo Premium.', body: 'Bienvenue à bord. Un véhicule électrique récent, un chauffeur professionnel, et un prix affiché avant de confirmer.', hashtags: ['neomoov'], visualHeadline: 'À bord d\'une Neo Premium' },
        { ...base, space: 'x', format: 'post', title: null, body: 'Transfert aéroport Montréal-Trudeau au prix tout compris : réservez au moins 2 heures à l\'avance.', hashtags: ['YUL'], visualHeadline: 'YUL au prix fixe' },
        { ...base, space: 'x', format: 'post', language: 'en', body: 'Montréal-Trudeau airport transfers at an all-inclusive price: book at least 2 hours ahead.', hashtags: ['YUL'], visualHeadline: 'YUL, fixed price' },
        // Sensible : incident évoqué ; bloqué : promesse de revenu et prix non décidé.
        { ...base, space: 'linkedin', format: 'post', title: null, body: 'Après l\'accident survenu la semaine dernière sur l\'autoroute, nos chauffeurs redoublent de prudence.', hashtags: [], cta: 'none', sensitive: true, visualHeadline: 'Prudence' },
        { ...base, space: 'linkedin', format: 'post', title: null, body: 'Gagnez 1 500 $ par semaine en conduisant pour nous, course aéroport à 55 $.', hashtags: [], cta: 'preregister', visualHeadline: 'Devenez chauffeur' },
        { ...base, space: 'site_blog', format: 'article', title: 'Aller à l\'aéroport Montréal-Trudeau sans stress', body: 'Partir tôt, choisir son terminal, réserver au moins 2 heures à l\'avance.\n\n## Le prix tout compris\n\nLe forfait Neo Premium depuis le centre-ville est à 48,20 $, prix affiché avant de confirmer.', hashtags: [], visualHeadline: 'Aéroport sans stress' },
        { ...base, space: 'site_blog', format: 'article', title: 'Nos véhicules électriques', body: 'Tesla, Hyundai, Kia : silence à bord et zéro émission.', hashtags: [], visualHeadline: 'Nos véhicules' },
        { ...base, space: 'newsletter', format: 'newsletter', title: 'Cette semaine chez Neomoov', body: 'Un sujet principal, deux brèves et un appel à l\'action.', hashtags: [], visualHeadline: 'Cette semaine' },
        { ...base, space: 'newsletter', format: 'newsletter', title: 'Le confort à bord', body: 'Eau, chargeurs, silence si vous le souhaitez.', hashtags: [], visualHeadline: 'Le confort à bord' },
        ...extra,
      ],
    },
  };
};

describe('phase 1 autonome, agent E : calendrier de contenu, diffusion, mesures, commentaires, référencement (intégration, connecteurs simulés)', () => {
  let app: NestExpressApplication | null = null;
  let llm: MockLlmProvider;
  let publishers: SocialPublishers;
  let site: MockSiteConnector;
  let operator: StaffSession;
  let readonly: StaffSession;
  const server = () => app!.getHttpServer();
  const createdItems = new Set<string>();
  const createdTasks = new Set<string>();
  const runIds = new Set<string>();
  const mock = (space: string) => publishers.get(space as never) as MockSocialPublisher;

  beforeAll(async () => {
    app = await startTestApp();
    if (!app) return;
    llm = app.get<MockLlmProvider>(LLM_PROVIDER);
    publishers = app.get<SocialPublishers>(SOCIAL_PUBLISHERS);
    site = app.get<MockSiteConnector>(SITE_CONNECTOR);
    const database = db(app);
    // Agents et prompts de la phase 1 (données de départ) : présents sur une base déjà amorcée, créés sinon.
    const agents = [
      { code: 'content', name: 'Marketing : contenu', mode: 'approval' as const, effort: 'high', systemPromptKey: 'content.v1', tools: ['queryMetrics'] },
      { code: 'publishing', name: 'Marketing : diffusion', mode: 'approval' as const, effort: 'low', systemPromptKey: null, tools: [] },
      { code: 'seo', name: 'Marketing : référencement', mode: 'approval' as const, effort: 'high', systemPromptKey: 'seo.v1', tools: [] },
    ];
    for (const a of agents) {
      await database.insert(schema.agents).values({ code: a.code, name: a.name, mode: a.mode, model: 'claude-opus-5-5', effort: a.effort, tools: a.tools, thresholds: {} }).onConflictDoNothing();
      if (a.systemPromptKey) {
        await database.insert(schema.agentPrompts).values({ key: a.systemPromptKey, agentCode: a.code, version: 1, body: `Prompt de test de l'agent ${a.code}.`, sha256: '0'.repeat(64) }).onConflictDoNothing();
        await database.update(schema.agents).set({ systemPromptKey: a.systemPromptKey, mode: 'approval', active: true }).where(eq(schema.agents.code, a.code));
      } else {
        await database.update(schema.agents).set({ mode: 'approval', active: true }).where(eq(schema.agents.code, a.code));
      }
    }
    // Lignes éditoriales par réglage (ce fichier ne dépend pas de docs/) ; cache des réglages vidé.
    const LINES = 'Lignes éditoriales de test : vouvoiement, prix décidés seulement.';
    const [setting] = await database.select({ key: schema.settings.key }).from(schema.settings).where(and(eq(schema.settings.key, 'marketing.editorial_lines_override'), eq(schema.settings.scope, 'global'))).limit(1);
    if (setting) await database.update(schema.settings).set({ value: LINES as unknown as object }).where(and(eq(schema.settings.key, 'marketing.editorial_lines_override'), eq(schema.settings.scope, 'global')));
    else await database.insert(schema.settings).values({ key: 'marketing.editorial_lines_override', scope: 'global', value: LINES as unknown as object, description: 'Lignes éditoriales (test)' });
    app.get(SettingsService).invalidate();
    operator = await createStaffAndLogin(app, ['operator']);
    readonly = await createStaffAndLogin(app, ['readonly']);
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
      await database.update(schema.settings).set({ value: '' as unknown as object }).where(and(eq(schema.settings.key, 'marketing.editorial_lines_override'), eq(schema.settings.scope, 'global')));
      const weekItems = await database.select({ id: schema.contentItems.id }).from(schema.contentItems).where(inArray(schema.contentItems.weekOf, [WEEK, SEO_WEEK]));
      for (const row of weekItems) createdItems.add(row.id);
      if (createdItems.size) await database.delete(schema.contentItems).where(inArray(schema.contentItems.id, [...createdItems]));
      const tasks = await database.select({ id: schema.seoTasks.id }).from(schema.seoTasks).where(inArray(schema.seoTasks.weekOf, [WEEK, SEO_WEEK, '2031-03-24']));
      for (const row of tasks) createdTasks.add(row.id);
      if (createdTasks.size) await database.delete(schema.seoTasks).where(inArray(schema.seoTasks.id, [...createdTasks]));
      const runs = await database.select({ id: schema.agentRuns.id }).from(schema.agentRuns).where(and(inArray(schema.agentRuns.agentCode, ['content', 'publishing', 'seo'])));
      for (const run of runs) runIds.add(run.id);
      if (runIds.size) await database.delete(schema.agentRuns).where(inArray(schema.agentRuns.id, [...runIds]));
      await database.update(schema.agents).set({ mode: 'approval' }).where(inArray(schema.agents.code, ['content', 'publishing', 'seo']));
      await cleanupTestData(app);
    }
    await app?.close();
  });

  const list = async (week = WEEK): Promise<Item[]> => (await request(server()).get('/v1/admin/marketing/content').query({ week }).set(bearer(operator.tokens)).expect(200)).body as Item[];

  it('calendrier de la semaine : lignes draft par espace, créneaux attribués, sensible ou bloqué signalé, semaine produite une seule fois', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    llm.script(calendarScript());
    const first = (await request(server()).post('/v1/admin/marketing/content/plan').set(bearer(operator.tokens)).send({ weekStart: WEEK }).expect(200)).body as { run: { id: string; status: string; agentCode: string; toolCalls: Array<{ tool: string }> }; replayed: boolean; created: number; autoApproved: number };
    runIds.add(first.run.id);
    expect((first.run as { error: string | null }).error).toBeNull();
    expect(first).toMatchObject({ replayed: false, created: 12, autoApproved: 0 });
    expect(first.run).toMatchObject({ agentCode: 'content', status: 'succeeded' });
    expect(first.run.toolCalls.map((c) => c.tool)).toEqual(['queryMetrics']);
    // Le modèle reçoit les lignes éditoriales et les preuves de la semaine balisées comme des données.
    const prompt = llm.requests.find((r) => r.schemaName === 'content_calendar')!.messages[0]!.content;
    expect(prompt).toContain('Lignes éditoriales de test');
    expect(prompt).toContain('<donnees_utilisateur source="indicateurs">');

    const items = await list();
    for (const i of items) createdItems.add(i.id);
    expect(items).toHaveLength(12);
    expect(items.every((i) => i.status === 'draft' && i.scheduledAt)).toBe(true);
    expect(new Set(items.map((i) => i.space))).toEqual(new Set(['facebook', 'instagram', 'x', 'linkedin', 'site_blog', 'newsletter']));
    // Deux contenus Facebook : deux créneaux différents de la semaine.
    const facebook = items.filter((i) => i.space === 'facebook');
    expect(new Set(facebook.map((i) => i.scheduledAt)).size).toBe(2);
    expect(facebook[0]!.scheduledAt!.slice(0, 10) >= WEEK).toBe(true);
    // Sensible (accident) et bloqué (promesse de revenu, prix non décidé) : approbation humaine obligatoire.
    const linkedin = items.filter((i) => i.space === 'linkedin');
    expect(linkedin.every((i) => i.sensitive)).toBe(true);
    expect(linkedin.find((i) => i.issues.some((x) => x.kind === 'sensitive_topic'))).toBeTruthy();
    const blocked = linkedin.find((i) => i.issues.some((x) => x.kind === 'revenue_promise'))!;
    expect(blocked.issues.map((x) => x.kind)).toEqual(expect.arrayContaining(['revenue_promise', 'undecided_price']));
    expect(blocked.issues.every((x) => x.blocking)).toBe(true);
    // Les mots-clics sont normalisés (# ajouté), le prix décidé 48,20 $ est admis.
    expect(items.find((i) => i.space === 'site_blog' && i.issues.length === 0)).toBeTruthy();

    // Même semaine : rejeu idempotent, aucun contenu ajouté.
    const again = (await request(server()).post('/v1/admin/marketing/content/plan').set(bearer(operator.tokens)).send({ weekStart: WEEK }).expect(200)).body as { replayed: boolean; created: number };
    expect(again).toMatchObject({ replayed: true, created: 0 });
    expect(await list()).toHaveLength(12);
    // Lecture seule : liste permise, action refusée.
    await request(server()).get('/v1/admin/marketing/content').query({ week: WEEK }).set(bearer(readonly.tokens)).expect(200);
    await request(server()).post(`/v1/admin/marketing/content/${items[0]!.id}/approve`).set(bearer(readonly.tokens)).expect(403);
  });

  it('approbation → scheduled ; publication par les connecteurs simulés → published avec identifiant externe ; média des réseaux à image ; mesure → measured', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const items = await list();
    const facebook = items.find((i) => i.space === 'facebook')!;
    const instagram = items.find((i) => i.space === 'instagram' && i.mediaStatus === 'pending')!;
    const blocked = items.find((i) => i.issues.some((x) => x.kind === 'revenue_promise'))!;

    // Un contenu sensible ou bloqué ne peut être approuvé que par un humain, qui voit les écarts.
    const approvedBlocked = await request(server()).post(`/v1/admin/marketing/content/${blocked.id}/approve`).set(bearer(operator.tokens)).expect(200);
    expect(approvedBlocked.body).toMatchObject({ status: 'scheduled', sensitive: true });
    const rejected = await request(server()).post(`/v1/admin/marketing/content/${blocked.id}/reject`).set(bearer(operator.tokens)).send({ reason: 'Promesse de revenu et prix non décidé' }).expect(200);
    expect(rejected.body).toMatchObject({ status: 'rejected', rejectedReason: 'Promesse de revenu et prix non décidé', scheduledAt: null });
    expect((await request(server()).post(`/v1/admin/marketing/content/${blocked.id}/reject`).set(bearer(operator.tokens)).send({ reason: 'Déjà refusé' })).status).toBe(409);

    // Modification avant publication : règles réappliquées (un prix non décidé bloque), puis retour à un texte conforme.
    const edited = await request(server()).patch(`/v1/admin/marketing/content/${facebook.id}`).set(bearer(operator.tokens)).send({ body: 'Course aéroport à 60 $ seulement.' }).expect(200);
    expect(edited.body.issues.map((x: { kind: string }) => x.kind)).toContain('undecided_price');
    expect(edited.body.sensitive).toBe(true);
    await request(server()).patch(`/v1/admin/marketing/content/${facebook.id}`).set(bearer(operator.tokens)).send({ body: 'Réservez votre transfert vers l\'aéroport au prix tout compris, affiché avant de confirmer.', hashtags: ['Montréal', 'YUL'] }).expect(200);

    for (const id of [facebook.id, instagram.id]) {
      const approved = (await request(server()).post(`/v1/admin/marketing/content/${id}/approve`).set(bearer(operator.tokens)).expect(200)).body as Item;
      expect(approved.status).toBe('scheduled');
      expect(approved.scheduledAt).toBeTruthy();
    }
    // Un contenu programmé ne s'approuve pas deux fois.
    expect((await request(server()).post(`/v1/admin/marketing/content/${facebook.id}/approve`).set(bearer(operator.tokens))).status).toBe(409);

    // Publication immédiate (My Hub) : exécution de l'agent de diffusion, identifiant externe, première mesure due à J+1.
    const published = (await request(server()).post(`/v1/admin/marketing/content/${facebook.id}/publish`).set(bearer(operator.tokens)).expect(200)).body as Item & { externalUrl: string; publishedAt: string; measureDueAt: string };
    expect(published).toMatchObject({ status: 'published', attempts: 1, lastError: null });
    expect(published.externalId).toBeTruthy();
    expect(published.externalUrl).toContain('mock.social/facebook');
    expect(new Date(published.measureDueAt).getTime() - new Date(published.publishedAt).getTime()).toBe(86_400_000);
    const sent = mock('facebook').published.get(published.externalId!)!;
    expect(sent.text).toContain('https://neomoov.net/reserver');
    expect(sent.text).toContain('#Montréal #YUL');
    expect(sent.text).not.toContain('60 $');
    const [run] = await db(app).select().from(schema.agentRuns).where(and(eq(schema.agentRuns.agentCode, 'publishing'), eq(schema.agentRuns.triggerRef, `publish:${facebook.id}:1`)));
    runIds.add(run!.id);
    expect(run).toMatchObject({ status: 'succeeded', trigger: 'content.publish' });
    expect((run!.toolCalls as Array<{ tool: string; ok: boolean }>)[0]).toMatchObject({ tool: 'socialPublish', ok: true });
    expect((await request(server()).post(`/v1/admin/marketing/content/${facebook.id}/publish`).set(bearer(operator.tokens))).status).toBe(409);

    // Passe de diffusion : le contenu Instagram, dont le créneau est passé, part avec son média (gabarit HTML rendu plus tard, sans navigateur).
    const publishing = app.get(PublishingService);
    const far = new Date('2031-03-20T12:00:00Z');
    const report = await publishing.publishDue(far);
    expect(report.published).toBeGreaterThanOrEqual(1);
    const ig = (await request(server()).get(`/v1/admin/marketing/content/${instagram.id}`).set(bearer(operator.tokens)).expect(200)).body as Item & { mediaKind: string };
    expect(ig).toMatchObject({ status: 'published', mediaStatus: 'html', mediaKind: 'html' });
    expect(mock('instagram').published.get(ig.externalId!)!.media?.contentType).toContain('text/html');
    const storage = app.get<MockStorageProvider>(STORAGE_PROVIDER);
    expect(storage.objects.has(`marketing/${instagram.id}/visual.html`)).toBe(true);
    const media = await request(server()).get(`/v1/admin/marketing/content/${instagram.id}/media`).set(bearer(operator.tokens)).expect(200);
    expect(media.headers['content-type']).toContain('text/html');
    expect(media.text).toContain('Montréal en mode premium');

    // Mesures : J+1 puis J+7, la dernière clôt en measured.
    expect(await publishing.measureDue(new Date(far.getTime() + 86_400_000 + 1_000))).toBeGreaterThanOrEqual(1);
    let measured = (await request(server()).get(`/v1/admin/marketing/content/${instagram.id}`).set(bearer(operator.tokens)).expect(200)).body as Item & { measureCount: number };
    expect(measured).toMatchObject({ status: 'published', measureCount: 1 });
    expect(measured.metrics.reach).toBeGreaterThan(0);
    expect(measured.metrics.history).toHaveLength(1);
    expect(await publishing.measureDue(new Date(far.getTime() + 7 * 86_400_000 + 1_000))).toBeGreaterThanOrEqual(1);
    measured = (await request(server()).get(`/v1/admin/marketing/content/${instagram.id}`).set(bearer(operator.tokens)).expect(200)).body as Item & { measureCount: number };
    expect(measured).toMatchObject({ status: 'measured', measureCount: 2 });
    expect(measured.metrics.history).toHaveLength(2);
  });

  it('échec de connecteur : nouvelle tentative espacée, puis failed après le nombre maximal, alerte au personnel ; réapprobation possible', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const items = await list();
    const x = items.filter((i) => i.space === 'x' && i.status === 'draft');
    const target = x[0]!;
    await request(server()).post(`/v1/admin/marketing/content/${target.id}/approve`).set(bearer(operator.tokens)).expect(200);
    const publishing = app.get(PublishingService);
    // Les créneaux sont dans la semaine de test (2031) : les passes se font à des instants de cette semaine.
    const t0 = new Date('2031-03-20T12:00:00Z').getTime();
    mock('x').failures = 2;
    const failed = await publishing.publishItem(target.id, new Date(t0)) as Item & { nextAttemptAt: string };
    expect(failed).toMatchObject({ status: 'scheduled', attempts: 1 });
    expect(failed.lastError).toContain('panne simulée');
    expect(new Date(failed.nextAttemptAt).getTime()).toBe(t0 + 5 * 60_000);
    const [run] = await db(app).select().from(schema.agentRuns).where(and(eq(schema.agentRuns.agentCode, 'publishing'), eq(schema.agentRuns.triggerRef, `publish:${target.id}:1`)));
    runIds.add(run!.id);
    expect(run).toMatchObject({ status: 'failed' });
    expect(run!.error).toContain('panne simulée');
    // Avant le délai : rien ; après le délai : nouvelle tentative, encore en panne ; la troisième réussit.
    expect((await publishing.publishDue(new Date(t0 + 60_000))).retried).toBe(0);
    const second = await publishing.publishDue(new Date(t0 + 6 * 60_000));
    expect(second.retried).toBeGreaterThanOrEqual(1);
    const third = await publishing.publishDue(new Date(t0 + 60 * 60_000));
    expect(third.published).toBeGreaterThanOrEqual(1);
    expect((await request(server()).get(`/v1/admin/marketing/content/${target.id}`).set(bearer(operator.tokens)).expect(200)).body).toMatchObject({ status: 'published', attempts: 3, lastError: null });

    // Panne durable : trois tentatives, puis failed et alerte au personnel ; une réapprobation remet le compteur à zéro.
    const other = x[1]!;
    await request(server()).post(`/v1/admin/marketing/content/${other.id}/approve`).set(bearer(operator.tokens)).expect(200);
    mock('x').failures = 3;
    const t1 = t0 + 2 * 3_600_000;
    await publishing.publishItem(other.id, new Date(t1));
    await publishing.publishDue(new Date(t1 + 10 * 60_000));
    await publishing.publishDue(new Date(t1 + 60 * 60_000));
    const dead = (await request(server()).get(`/v1/admin/marketing/content/${other.id}`).set(bearer(operator.tokens)).expect(200)).body as Item;
    expect(dead).toMatchObject({ status: 'failed', attempts: 3 });
    const alerts = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.template, 'alert.agent_escalation'), eq(schema.notifications.recipientUserId, operator.userId)));
    expect(alerts.some((a) => (a.data as { contentItemId?: string }).contentItemId === other.id)).toBe(true);
    const reapproved = (await request(server()).post(`/v1/admin/marketing/content/${other.id}/approve`).set(bearer(operator.tokens)).expect(200)).body as Item;
    expect(reapproved).toMatchObject({ status: 'scheduled', attempts: 0, lastError: null });
    mock('x').failures = 0;
  });

  it('commentaires : réponse automatique aux commentaires simples (merci, horaires, réservation), relais humain pour le reste et le ton négatif', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const items = await list();
    const facebook = items.find((i) => i.space === 'facebook' && i.externalId)!;
    const fb = mock('facebook');
    fb.addComment(facebook.externalId!, { text: 'Merci, super service !', author: 'Client content' });
    fb.addComment(facebook.externalId!, { text: 'Vous êtes ouverts la nuit ?', author: 'Noctambule' });
    fb.addComment(facebook.externalId!, { text: 'How much to book a ride to the airport?', author: 'Traveller' });
    fb.addComment(facebook.externalId!, { text: 'Est-ce que vos chauffeurs acceptent les chiens ?', author: 'Maître' });
    fb.addComment(facebook.externalId!, { text: 'Arnaque, je veux un remboursement !', author: 'Mécontent' });
    const alertsBefore = (await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.template, 'alert.agent_escalation'), eq(schema.notifications.recipientUserId, operator.userId)))).length;
    // La publication Facebook date de ce test (maintenant) : la fenêtre de relecture de 7 jours la couvre.
    const report = await app.get(PublishingService).commentsPass(new Date(Date.now() + 60_000));
    expect(report).toMatchObject({ replied: 3, escalated: 2, forwarded: 0 });
    expect(fb.replies).toHaveLength(3);
    expect(fb.replies.map((r) => r.text)).toEqual(expect.arrayContaining([expect.stringContaining('Merci beaucoup'), expect.stringContaining('neomoov.net/reserver'), expect.stringContaining('7 jours sur 7')]));
    const detail = (await request(server()).get(`/v1/admin/marketing/content/${facebook.id}`).set(bearer(operator.tokens)).expect(200)).body as Item;
    expect(detail.comments).toHaveLength(5);
    expect(detail.comments.filter((c) => c.outcome === 'replied').every((c) => c.replyBody)).toBe(true);
    expect(detail.comments.find((c) => c.intent === 'other')).toMatchObject({ outcome: 'escalated', replyBody: null });
    const alertsAfter = (await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.template, 'alert.agent_escalation'), eq(schema.notifications.recipientUserId, operator.userId)))).length;
    expect(alertsAfter - alertsBefore).toBe(2);
    // Relecture : rien de nouveau, aucun doublon.
    expect(await app.get(PublishingService).commentsPass(new Date(Date.now() + 120_000))).toMatchObject({ replied: 0, escalated: 0 });
    expect(fb.replies).toHaveLength(3);
  });

  it('mode automatique de l\'agent contenu : les contenus sûrs sont programmés tout de suite, les sensibles attendent un humain', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    await db(app).update(schema.agents).set({ mode: 'auto' }).where(eq(schema.agents.code, 'content'));
    try {
      llm.script(calendarScript());
      const result = (await app.get(ContentAgent).planWeek({ weekStart: SEO_WEEK, now: new Date('2031-03-14T14:00:00Z') }));
      runIds.add(result.run!.id);
      expect(result).toMatchObject({ replayed: false, created: 12, autoApproved: 10 });
      const items = await list(SEO_WEEK);
      for (const i of items) createdItems.add(i.id);
      expect(items.filter((i) => i.status === 'scheduled')).toHaveLength(10);
      expect(items.filter((i) => i.status === 'draft').every((i) => i.space === 'linkedin' && i.sensitive)).toBe(true);
      // La passe hebdomadaire : le vendredi (14 mars 2031) à partir de 9 h (heure de Montréal), le calendrier de la semaine
      // suivante, déjà produite ici (rejeu, rien) ; le jeudi, ou le vendredi avant 9 h, rien.
      const jobs = app.get(MarketingJobsService);
      expect(await jobs.contentDue(new Date('2031-03-13T14:30:00Z'))).toBeNull();
      expect(await jobs.contentDue(new Date('2031-03-14T12:00:00Z'))).toBeNull();
      expect(await jobs.contentDue(new Date('2031-03-14T14:30:00Z'))).toBeNull();
      expect(llm.requests.filter((r) => r.schemaName === 'content_calendar')).toHaveLength(1);
    } finally {
      await db(app).update(schema.agents).set({ mode: 'approval' }).where(eq(schema.agents.code, 'content'));
    }
  });

  it('référencement : constats des pages du site simulé, tâches proposées (modèle et contrôles), approbation qui applique les balises et crée un brouillon, passe du lundi', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    llm.script((req) => (req.schemaName === 'seo_plan' ? {
      output: {
        summary: 'Deux corrections de balises, un article.',
        tasks: [
          { action: 'fix_title', targetRef: '31', keyword: 'chauffeur privé Montréal', justification: 'Titre de 8 caractères', proposal: { title: 'Réserver un chauffeur privé à Montréal | Neomoov', description: null, question: null, answer: null, outline: [], body: null, linkFrom: null, linkTo: null, anchor: null } },
          { action: 'fix_description', targetRef: '31', keyword: null, justification: 'Description absente', proposal: { title: null, description: 'Réservez votre chauffeur privé à Montréal en deux minutes : prix tout compris affiché avant de confirmer, véhicule électrique, chauffeur vérifié.', question: null, answer: null, outline: [], body: null, linkFrom: null, linkTo: null, anchor: null } },
          { action: 'new_article', targetRef: null, keyword: 'chauffeur électrique Montréal', justification: 'Aucune page ne couvre ce mot-clé', proposal: { title: 'Pourquoi choisir un chauffeur électrique à Montréal', description: 'Silence, confort et zéro émission.', question: null, answer: null, outline: ['Le confort', 'L\'environnement'], body: 'Un véhicule électrique récent, un chauffeur professionnel.', linkFrom: null, linkTo: null, anchor: null } },
          { action: 'fix_title', targetRef: 'page-inconnue', keyword: null, justification: 'Hors liste', proposal: { title: 'X', description: null, question: null, answer: null, outline: [], body: null, linkFrom: null, linkTo: null, anchor: null } },
        ],
      },
    } : undefined));
    const planned = (await request(server()).post('/v1/admin/marketing/seo/plan').set(bearer(operator.tokens)).send({ weekStart: SEO_WEEK }).expect(200)).body as { run: { id: string; status: string }; replayed: boolean; created: number; applied: number };
    runIds.add(planned.run.id);
    expect(planned).toMatchObject({ replayed: false, applied: 0 });
    expect(planned.created).toBeGreaterThanOrEqual(5);
    expect(planned.created).toBeLessThanOrEqual(10);
    const prompt = llm.requests.find((r) => r.schemaName === 'seo_plan')!.messages[0]!.content;
    expect(prompt).toContain('<donnees_utilisateur source="pages">');
    expect(prompt).toContain('search_console');
    const tasks = (await request(server()).get('/v1/admin/marketing/seo/tasks').query({ status: 'proposed' }).set(bearer(operator.tokens)).expect(200)).body as Array<{ id: string; action: string; targetRef: string | null; weekOf: string; status: string; proposal: Record<string, unknown>; metricsBefore: { impressions: number } | null; keyword: string | null }>;
    const mine = tasks.filter((t) => t.weekOf === SEO_WEEK);
    for (const t of mine) createdTasks.add(t.id);
    expect(mine.find((t) => t.action === 'fix_title' && t.targetRef === 'page-inconnue')).toBeUndefined();
    const title = mine.find((t) => t.action === 'fix_title' && t.targetRef === '31')!;
    expect(title.proposal['title']).toContain('chauffeur privé');
    // Constat non repris par le modèle : tâche sans texte (lien interne de la page « Réserver »), mesure avant tirée de la Search Console simulée.
    const link = mine.find((t) => t.action === 'internal_link' && t.targetRef === '31')!;
    expect(link).toBeTruthy();
    const article = mine.find((t) => t.action === 'new_article' && t.keyword === 'chauffeur électrique Montréal')!;
    expect(article.metricsBefore).toMatchObject({ impressions: expect.any(Number) });

    const applied = (await request(server()).post(`/v1/admin/marketing/seo/tasks/${title.id}/approve`).set(bearer(operator.tokens)).expect(200)).body as { status: string; externalId: string; appliedAt: string; measureDueAt: string };
    expect(applied).toMatchObject({ status: 'applied', externalId: '31' });
    expect(site.seoUpdates.at(-1)).toMatchObject({ ref: '31', patch: { title: 'Réserver un chauffeur privé à Montréal | Neomoov' } });
    expect(site.pagesStore.get('31')!.metaTitle).toContain('Neomoov');
    const drafted = (await request(server()).post(`/v1/admin/marketing/seo/tasks/${article.id}/approve`).set(bearer(operator.tokens)).expect(200)).body as { status: string; externalId: string; externalUrl: string };
    expect(drafted.status).toBe('applied');
    expect(site.drafts.find((d) => d.externalId === drafted.externalId)).toMatchObject({ kind: 'post', title: 'Pourquoi choisir un chauffeur électrique à Montréal' });
    // Un lien interne approuvé reste une modification humaine ; un refus exige un motif.
    expect((await request(server()).post(`/v1/admin/marketing/seo/tasks/${link.id}/approve`).set(bearer(operator.tokens)).expect(200)).body.status).toBe('approved');
    expect((await request(server()).post(`/v1/admin/marketing/seo/tasks/${article.id}/reject`).set(bearer(operator.tokens)).send({ reason: 'Trop tard' })).status).toBe(409);
    const description = mine.find((t) => t.action === 'fix_description' && t.targetRef === '31')!;
    expect((await request(server()).post(`/v1/admin/marketing/seo/tasks/${description.id}/reject`).set(bearer(operator.tokens)).send({ reason: 'Description à réécrire' }).expect(200)).body).toMatchObject({ status: 'rejected', decisionNote: 'Description à réécrire' });
    // Rejeu de la même semaine : rien de nouveau ; les tâches ouvertes ne sont pas reproposées à la semaine suivante.
    expect((await request(server()).post('/v1/admin/marketing/seo/plan').set(bearer(operator.tokens)).send({ weekStart: SEO_WEEK }).expect(200)).body).toMatchObject({ replayed: true, created: 0 });
    const next = await app.get(SeoAgent).planWeek({ weekStart: '2031-03-24', now: new Date('2031-03-24T12:00:00Z') });
    runIds.add(next.run!.id);
    const later = (await request(server()).get('/v1/admin/marketing/seo/tasks').set(bearer(operator.tokens)).expect(200)).body as Array<{ id: string; weekOf: string; action: string; targetRef: string | null }>;
    const nextWeek = later.filter((t) => t.weekOf === '2031-03-24');
    for (const t of nextWeek) createdTasks.add(t.id);
    expect(nextWeek.find((t) => t.action === 'fix_title' && t.targetRef === '31')).toBeUndefined();
    // Search Console simulée consultée par page ; la mesure après application attend `seo.measure_days`.
    expect(app.get<MockSearchConsoleProvider>(SEARCH_CONSOLE_PROVIDER).calls.at(-1)).toMatchObject({ byPage: true });
    expect(await app.get(SettingsService).number('seo.measure_days', 0)).toBe(28);
    // Passe du lundi 6 h (heure de Montréal) : avant, rien.
    expect(await app.get(MarketingJobsService).seoDue(new Date('2031-03-31T09:00:00Z'))).toBeNull();
  });

  it('espaces : onze connecteurs simulés configurés, créneaux et formats ; passe complète sans erreur', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const spaces = (await request(server()).get('/v1/admin/marketing/spaces').set(bearer(operator.tokens)).expect(200)).body as Array<{ space: string; configured: boolean; provider: string; slots: unknown[]; formats: string[] }>;
    expect(spaces).toHaveLength(11);
    expect(spaces.every((s) => s.configured && s.provider === 'mock' && s.slots.length > 0 && s.formats.length > 0)).toBe(true);
    const report = await app.get(MarketingJobsService).tick(new Date('2031-03-18T20:00:00Z'));
    expect(report.content).toBeNull();
    expect(report.seo).toBeNull();
    expect(report.publishing.failed).toBe(0);
  });
});
