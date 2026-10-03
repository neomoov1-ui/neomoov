import 'reflect-metadata';
import { schema } from '@neomoov/db';
import { VISUAL_SIZES, zonedInstant } from '@neomoov/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, inArray, like } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MockSocialPublisher } from '../src/adapters/mock/index.js';
import { SOCIAL_PUBLISHERS, type SocialPublishers } from '../src/adapters/marketing.types.js';
import { SettingsService } from '../src/common/settings.service.js';
import { PublicationsService } from '../src/modules/marketing/publications.service.js';
import { PublishingService } from '../src/modules/marketing/publishing.service.js';
import { bearer, cleanupTestData, createStaffAndLogin, db, resetHttpLimits, startTestApp, type StaffSession } from './helpers.js';

/**
 * Chantier « Réseaux sociaux » du 3 octobre 2026, agent S2 : composer vers trois réseaux dont un en relais manuel (chaîne
 * WhatsApp), visuels différents à la taille de chaque réseau, publication par les connecteurs simulés, vue « À relayer »
 * (texte, fichier, lien, marquer publié), import d'un lot JSON rejouable, approbation et programmation en lot sur
 * plusieurs jours (bloqué et sensible laissés de côté), droits, commentaires et messages par réseau. Données retirées à la fin.
 */
const rand = () => Math.random().toString(36).slice(2, 8);

type Visual = { template: string; width: number; height: number; fingerprint: string | null; photoIndex: number | null };
type Item = { id: string; space: string; language: string; status: string; delivery: 'auto' | 'manual'; scheduledAt: string | null; externalId: string | null; externalUrl: string | null; mediaStatus: string; issues: Array<{ kind: string; blocking: boolean }>; sensitive: boolean; visual: Visual | null; body: string; hashtags: string[]; awaitsRelay?: boolean; notice?: string | null };
type Group = { id: string; campaign: string | null; ref: string | null; items: Item[]; counts: Record<string, number> };

const BODY = 'Votre vol part tôt demain ? Réservez votre trajet vers l\'aéroport Montréal-Trudeau au moins 2 heures à l\'avance : chauffeur professionnel vérifié, véhicule 100 % électrique récent et prix tout compris affiché avant de confirmer.';
const SHORT = 'Vers Montréal-Trudeau en véhicule 100 % électrique, prix tout compris affiché avant de confirmer.';

describe('publication multiréseau (agent S2) : composer, visuels par réseau, relais manuel, import et programmation en lot', () => {
  let app: NestExpressApplication | null = null;
  let operator: StaffSession;
  let readonly: StaffSession;
  let publishing: PublishingService;
  let publishers: SocialPublishers;
  const server = () => app!.getHttpServer();
  const groups = new Set<string>();
  const campaign = `essai-s2-${rand()}`;

  beforeAll(async () => {
    app = await startTestApp({ MARKETING_PROVIDER: 'mock' });
    if (!app) return;
    publishing = app.get(PublishingService);
    publishers = app.get<SocialPublishers>(SOCIAL_PUBLISHERS);
    const database = db(app);
    for (const a of [{ code: 'content', name: 'Marketing : contenu', effort: 'high' }, { code: 'publishing', name: 'Marketing : diffusion', effort: 'low' }]) {
      await database.insert(schema.agents).values({ code: a.code, name: a.name, mode: 'approval', model: 'claude-opus-5-5', effort: a.effort, tools: [], thresholds: {} }).onConflictDoNothing();
    }
    await database.update(schema.agents).set({ mode: 'approval', active: true }).where(inArray(schema.agents.code, ['content', 'publishing']));
    app.get(SettingsService).invalidate();
    operator = await createStaffAndLogin(app, ['operator']);
    readonly = await createStaffAndLogin(app, ['readonly']);
  });

  beforeEach(async () => {
    if (app) await resetHttpLimits(app);
  });

  afterAll(async () => {
    if (app) {
      const database = db(app);
      const ids = [...groups];
      const fromCampaign = await database.select({ id: schema.contentGroups.id }).from(schema.contentGroups).where(eq(schema.contentGroups.campaign, campaign));
      for (const g of fromCampaign) ids.push(g.id);
      if (ids.length) {
        const items = await database.select({ id: schema.contentItems.id }).from(schema.contentItems).where(inArray(schema.contentItems.groupId, ids));
        for (const item of items) await database.delete(schema.agentRuns).where(and(eq(schema.agentRuns.agentCode, 'publishing'), like(schema.agentRuns.triggerRef, `publish:${item.id}:%`)));
        await database.delete(schema.contentGroups).where(inArray(schema.contentGroups.id, ids));
      }
      await cleanupTestData(app);
    }
    await app?.close();
  });

  const compose = async (body: Record<string, unknown>, session = operator, status = 201) => (await request(server()).post('/v1/admin/marketing/publications').set(bearer(session.tokens)).send(body).expect(status)).body as Group;
  const prepareAll = async (group: Group) => {
    for (const item of group.items) await publishing.prepareMedia(item.id);
    return (await request(server()).get(`/v1/admin/marketing/publications/${group.id}`).set(bearer(operator.tokens)).expect(200)).body as Group;
  };

  it('composer vers Facebook, X et la chaîne WhatsApp : un contenu par réseau, relais manuel pour WhatsApp, images différentes aux bonnes tailles, publication par les connecteurs', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const group = await compose({ title: 'Montréal-Trudeau sans stress', body: BODY, short: SHORT, cta: 'reserve', hashtags: ['Neomoov', 'Montréal', 'YUL', 'Aéroport'], spaces: ['facebook', 'x', 'whatsapp_channel'], photoHints: ['aéroport'], schedule: { mode: 'now' } });
    groups.add(group.id);
    expect(group.items.map((i) => i.space).sort()).toEqual(['facebook', 'whatsapp_channel', 'x']);
    expect(group.items.every((i) => i.status === 'scheduled')).toBe(true);
    const by = (space: string) => group.items.find((i) => i.space === space)!;
    expect(by('facebook').delivery).toBe('auto');
    expect(by('x').delivery).toBe('auto');
    expect(by('whatsapp_channel').delivery).toBe('manual');
    // Texte adapté : version courte et trois mots-clics sur X, aucun mot-clic sur la chaîne WhatsApp.
    expect(by('x').body).toBe(SHORT);
    expect(by('x').hashtags).toHaveLength(3);
    expect(by('whatsapp_channel').hashtags).toEqual([]);
    expect(group.counts).toMatchObject({ scheduled: 2, relay: 1 });

    const ready = await prepareAll(group);
    const sizes = ready.items.map((i) => `${i.space}:${i.visual!.width}x${i.visual!.height}`).sort();
    expect(sizes).toEqual(['facebook:1080x1350', 'whatsapp_channel:1080x1080', 'x:1600x900']);
    const fingerprints = ready.items.map((i) => i.visual!.fingerprint);
    expect(fingerprints.every(Boolean)).toBe(true);
    expect(new Set(fingerprints).size).toBe(3);
    expect(new Set(ready.items.map((i) => i.visual!.template)).size).toBe(3);

    // Passe de diffusion : Facebook et X publiés par les connecteurs simulés, la chaîne WhatsApp reste à relayer.
    await publishing.publishDue(new Date(Date.now() + 60_000));
    const after = (await request(server()).get(`/v1/admin/marketing/publications/${group.id}`).set(bearer(operator.tokens)).expect(200)).body as Group;
    const status = (space: string) => after.items.find((i) => i.space === space)!;
    expect(status('facebook')).toMatchObject({ status: 'published' });
    expect(status('x')).toMatchObject({ status: 'published' });
    expect(status('facebook').externalId).toBeTruthy();
    expect(status('whatsapp_channel')).toMatchObject({ status: 'scheduled', delivery: 'manual', externalId: null });
    expect((publishers.get('x') as MockSocialPublisher).published.get(status('x').externalId!)?.text).toContain(SHORT);
    // Récapitulatif du jour au personnel (une fois par jour) : la tâche de la chaîne WhatsApp y est comptée.
    const evening = zonedInstant(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' }), '23:00', 'America/Toronto');
    expect(await app.get(PublicationsService).relayDigest(evening)).toBeGreaterThanOrEqual(1);
    expect(await app.get(PublicationsService).relayDigest(evening)).toBe(0);
    // Publication directe d'un contenu en relais manuel : refusée.
    await request(server()).post(`/v1/admin/marketing/content/${status('whatsapp_channel').id}/publish`).set(bearer(operator.tokens)).send({}).expect(409);
  });

  it('À relayer : tâche du jour avec texte prêt à copier, fichier à télécharger et lien direct ; marquée publiée avec son lien', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const list = (await request(server()).get('/v1/admin/marketing/relay').set(bearer(operator.tokens)).expect(200)).body as { date: string; tasks: Array<{ item: Item; text: string; link: string; fileName: string | null; late: boolean }>; doneToday: number };
    const task = list.tasks.find((t) => groups.has((t.item as unknown as { groupId: string }).groupId) && t.item.space === 'whatsapp_channel')!;
    expect(task).toBeTruthy();
    expect(task.text).toContain('Montréal-Trudeau');
    expect(task.link).toBe('https://web.whatsapp.com/');
    const file = await request(server()).get(`/v1/admin/marketing/content/${task.item.id}/download`).set(bearer(operator.tokens)).expect(200);
    expect(file.headers['content-disposition']).toMatch(/attachment; filename="neomoov-whatsapp-channel-1080x1080\.(png|html)"/);
    const done = (await request(server()).post(`/v1/admin/marketing/content/${task.item.id}/relayed`).set(bearer(operator.tokens)).send({ url: 'https://whatsapp.com/channel/essai' }).expect(200)).body as Item & { relayedAt: string };
    expect(done).toMatchObject({ status: 'published', externalUrl: 'https://whatsapp.com/channel/essai' });
    expect(done.relayedAt).toBeTruthy();
    await request(server()).post(`/v1/admin/marketing/content/${task.item.id}/relayed`).set(bearer(operator.tokens)).send({}).expect(409);
    const again = (await request(server()).get('/v1/admin/marketing/relay').set(bearer(operator.tokens)).expect(200)).body as typeof list;
    expect(again.tasks.find((t) => t.item.id === task.item.id)).toBeUndefined();
    expect(again.doneToday).toBeGreaterThanOrEqual(1);

    // Refus du connecteur avec un code de relais manuel (approbation LinkedIn en attente) : tâche à relayer, pas un échec ;
    // mention du connecteur (vidéo privée) gardée sur le contenu publié.
    const group = await compose({ title: 'Mobilité électrique à Montréal', body: BODY, short: SHORT, spaces: ['linkedin', 'tiktok'], schedule: { mode: 'draft' } });
    groups.add(group.id);
    const linkedin = group.items.find((i) => i.space === 'linkedin')!;
    const tiktok = group.items.find((i) => i.space === 'tiktok')!;
    await db(app!).update(schema.contentItems).set({ status: 'failed', scheduledAt: new Date(Date.now() - 60_000), lastError: 'SOCIAL_APPROVAL_PENDING : LinkedIn refuse la publication (Community Management API non approuvée)' }).where(eq(schema.contentItems.id, linkedin.id));
    await db(app!).update(schema.contentItems).set({ status: 'published', publishNotice: 'Vidéo envoyée en privé : audit TikTok non accordé' }).where(eq(schema.contentItems.id, tiktok.id));
    const view = (await request(server()).get(`/v1/admin/marketing/publications/${group.id}`).set(bearer(operator.tokens)).expect(200)).body as Group;
    expect(view.counts).toMatchObject({ relay: 1, failed: 0, published: 1 });
    expect(view.items.find((i) => i.space === 'linkedin')!.awaitsRelay).toBe(true);
    expect(view.items.find((i) => i.space === 'tiktok')!.notice).toContain('privé');
    const pending = (await request(server()).get('/v1/admin/marketing/relay').set(bearer(operator.tokens)).expect(200)).body as typeof list;
    expect(pending.tasks.find((t) => t.item.id === linkedin.id)).toMatchObject({ late: true, link: 'https://www.linkedin.com/feed/' });
    const relayedLinkedin = (await request(server()).post(`/v1/admin/marketing/content/${linkedin.id}/relayed`).set(bearer(operator.tokens)).send({}).expect(200)).body as Item;
    expect(relayedLinkedin).toMatchObject({ status: 'published', delivery: 'manual' });
  });

  it('tous les réseaux : dix contenus, dix images toutes différentes (empreintes), tailles exactes, brouillons', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const group = await compose({ title: 'Nos véhicules 100 % électriques', body: BODY, short: SHORT, cta: 'reserve', hashtags: ['Neomoov'], spaces: 'all', schedule: { mode: 'draft' } });
    groups.add(group.id);
    expect(group.items).toHaveLength(10);
    expect(group.items.every((i) => i.status === 'draft')).toBe(true);
    const ready = await prepareAll(group);
    for (const item of ready.items) {
      const sizes = VISUAL_SIZES[item.space as keyof typeof VISUAL_SIZES];
      expect([sizes.feed, sizes.vertical].filter(Boolean).map((s) => `${s!.width}x${s!.height}`)).toContain(`${item.visual!.width}x${item.visual!.height}`);
    }
    const fingerprints = ready.items.map((i) => i.visual!.fingerprint);
    expect(fingerprints.every(Boolean)).toBe(true);
    expect(new Set(fingerprints).size).toBe(10);
    expect(new Set(ready.items.map((i) => i.visual!.template)).size).toBeGreaterThanOrEqual(5);
    const youtube = ready.items.find((i) => i.space === 'youtube')!;
    expect(youtube.visual).toMatchObject({ width: 1080, height: 1920 });
    expect((youtube.visual as unknown as { thumbnailKey: string | null }).thumbnailKey).toBeTruthy();
    // Après l'aperçu : diffusion aux prochains créneaux de chaque réseau ; Snapchat et la chaîne WhatsApp en relais manuel.
    const published = (await request(server()).post(`/v1/admin/marketing/publications/${group.id}/publish`).set(bearer(operator.tokens)).send({ schedule: { mode: 'slots' } }).expect(200)).body as Group;
    expect(published.items.every((i) => i.status === 'scheduled' && i.scheduledAt! > new Date().toISOString())).toBe(true);
    expect(published.items.filter((i) => i.delivery === 'manual').map((i) => i.space).sort()).toEqual(['snapchat', 'whatsapp_channel']);
    await request(server()).post(`/v1/admin/marketing/publications/${group.id}/publish`).set(bearer(operator.tokens)).send({ schedule: { mode: 'now' } }).expect(409);
  }, 240_000);

  it('import d\'un lot JSON de trois publications : brouillons groupés, règles appliquées, rejouable sans doublon ; approbation et programmation en lot sur plusieurs jours', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const lot = {
      version: 1, campaign, title: 'Essai de l\'agent S2', startDate: '2031-04-07',
      defaults: { spaces: ['facebook', 'telegram', 'snapchat'], cta: 'reserve', hashtags: ['Neomoov'] },
      publications: [
        { ref: 'P01', title: 'L\'aéroport sans stress', body: BODY, short: SHORT, day: 1, imageText: 'Direction YUL' },
        { ref: 'P02', title: 'Devenir chauffeur Neomoov', body: 'Vous êtes chauffeur professionnel à Montréal ? Découvrez la préinscription et la formation Neomoov Chauffeur Pro.', short: 'Chauffeurs professionnels : la préinscription est ouverte.', cta: 'preregister', variants: { facebook: { body: 'Gagnez 1 500 $ par semaine en conduisant pour nous.' } } },
        { ref: 'P03', title: 'Sécurité à bord', body: 'Nos chauffeurs sont vérifiés et formés ; la sécurité de chaque course est suivie en direct par notre équipe.', short: 'Chauffeurs vérifiés, course suivie en direct.', sensitive: true, spaces: ['telegram'] },
      ],
    };
    const first = (await request(server()).post('/v1/admin/marketing/publications/import').set(bearer(operator.tokens)).send(lot).expect(200)).body as { created: number; existing: number; items: number; blocked: number; groups: Array<{ id: string; ref: string; items: number; blocked: number }> };
    for (const g of first.groups) groups.add(g.id);
    expect(first).toMatchObject({ created: 3, existing: 0, items: 7, blocked: 1 });
    const second = (await request(server()).post('/v1/admin/marketing/publications/import').set(bearer(operator.tokens)).send(lot).expect(200)).body as typeof first;
    expect(second).toMatchObject({ created: 0, existing: 3, items: 0 });
    expect(second.groups.map((g) => g.id)).toEqual(first.groups.map((g) => g.id));
    // Un lot mal formé est refusé en entier, rien n'est créé.
    await request(server()).post('/v1/admin/marketing/publications/import').set(bearer(operator.tokens)).send({ ...lot, publications: [{ ref: 'X1', title: 'Titre' }] }).expect(400);

    const listed = (await request(server()).get('/v1/admin/marketing/publications').query({ campaign }).set(bearer(operator.tokens)).expect(200)).body as Group[];
    expect(listed.map((g) => g.ref)).toEqual(['P01', 'P02', 'P03']);
    expect(listed[0]!.items.find((i) => i.space === 'snapchat')!.delivery).toBe('manual');

    const scheduled = (await request(server()).post('/v1/admin/marketing/publications/schedule').set(bearer(operator.tokens)).send({ campaign, days: 3 }).expect(200)).body as { approved: number; relay: number; skipped: Array<{ itemId: string; space: string; reason: string }>; firstAt: string; lastAt: string };
    // Approuvés : P01 (3 réseaux) et P02 sans Facebook (bloqué) ; P03 sensible laissé de côté.
    expect(scheduled.approved).toBe(5);
    expect(scheduled.relay).toBe(2);
    expect(scheduled.skipped.map((s) => s.space).sort()).toEqual(['facebook', 'telegram']);
    expect(scheduled.skipped.find((s) => s.space === 'facebook')!.reason).toContain('Règle bloquante');
    const after = (await request(server()).get('/v1/admin/marketing/publications').query({ campaign }).set(bearer(operator.tokens)).expect(200)).body as Group[];
    const day = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
    expect(new Set(after[0]!.items.map((i) => day(i.scheduledAt!)))).toEqual(new Set(['2031-04-07']));
    expect(after[1]!.items.filter((i) => i.status === 'scheduled').every((i) => day(i.scheduledAt!) === '2031-04-08')).toBe(true);
    expect(after[2]!.items.every((i) => i.status === 'draft')).toBe(true);
  });

  it('droits : lecture seule ne compose ni n\'importe ; commentaires et messages par réseau (Telegram compris)', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    await compose({ title: 'Titre valable', body: BODY, short: SHORT, spaces: ['x'], schedule: { mode: 'draft' } }, readonly, 403);
    await request(server()).post('/v1/admin/marketing/publications/schedule').set(bearer(readonly.tokens)).send({ campaign }).expect(403);
    await request(server()).get('/v1/admin/marketing/relay').set(bearer(readonly.tokens)).expect(200);
    const summary = (await request(server()).get('/v1/admin/marketing/social/summary').set(bearer(operator.tokens)).expect(200)).body as { networks: Array<{ network: string; unread: number }>; total: { unread: number } };
    expect(summary.networks.map((n) => n.network)).toEqual(expect.arrayContaining(['facebook', 'instagram', 'linkedin', 'x', 'tiktok', 'youtube', 'telegram']));
    expect(summary.total.unread).toBe(summary.networks.reduce((n, x) => n + x.unread, 0));
  });
});
