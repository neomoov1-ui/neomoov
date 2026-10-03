import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, gte, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MockSocialPublisher } from '../src/adapters/mock/index.js';
import { SOCIAL_PUBLISHERS, type PublishedRef, type SocialComment, type SocialPublishers } from '../src/adapters/marketing.types.js';
import { DomainEventsService, type DomainEvents } from '../src/common/domain-events.js';
import { PublishingService } from '../src/modules/marketing/publishing.service.js';
import { cleanupTestData, db, startTestApp } from './helpers.js';

/**
 * Avis de la Fiche Google dans la passe des commentaires de la diffusion (3 octobre 2026) : un avis 5 sur 5 qui remercie
 * reçoit la réponse automatique ; un avis noté 2 sur 5, même poli, ne reçoit jamais de réponse automatique et part vers
 * la relation client sous le réseau `gbp` (relais humain de la boîte unifiée), jamais vers le connecteur Meta.
 * Connecteur simulé (aucun appel réseau) ; la publication, les commentaires et les conversations d'essai sont retirés.
 */
describe('avis de la Fiche Google dans la passe des commentaires', () => {
  let app: NestExpressApplication | null = null;
  const started = new Date();
  const suffix = Math.random().toString(36).slice(2, 8);
  let itemId: string | null = null;
  const addresses: string[] = [];

  beforeAll(async () => {
    app = await startTestApp();
    if (!app) return;
    const database = db(app);
    await database.insert(schema.agents).values({ code: 'publishing', name: 'Marketing : diffusion', mode: 'approval', model: 'claude-opus-5-5', effort: 'low', tools: [], thresholds: {} }).onConflictDoNothing();
    await database.update(schema.agents).set({ mode: 'approval', active: true }).where(eq(schema.agents.code, 'publishing'));
    const [row] = await database.insert(schema.contentItems).values({
      weekOf: '2031-04-07', space: 'google_business', format: 'post', body: 'Essai des avis de la fiche', cta: 'reserve', status: 'published',
      externalId: `accounts/1/locations/2/localPosts/essai-${suffix}`, publishedAt: new Date(Date.now() - 3_600_000),
    }).returning({ id: schema.contentItems.id });
    itemId = row!.id;
  });

  afterAll(async () => {
    if (app) {
      const database = db(app);
      if (itemId) await database.delete(schema.contentItems).where(eq(schema.contentItems.id, itemId));
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      if (addresses.length) {
        const conversations = await database.select({ id: schema.conversations.id }).from(schema.conversations).where(inArray(schema.conversations.address, addresses));
        const ids = conversations.map((c) => c.id);
        if (ids.length) {
          const messages = await database.select({ externalId: schema.conversationMessages.externalId }).from(schema.conversationMessages).where(inArray(schema.conversationMessages.conversationId, ids));
          const refs = messages.map((m) => m.externalId).filter((e): e is string => Boolean(e));
          await database.update(schema.conversationMessages).set({ agentRunId: null }).where(inArray(schema.conversationMessages.conversationId, ids));
          if (refs.length) await database.delete(schema.agentRuns).where(and(eq(schema.agentRuns.agentCode, 'customer_relations'), inArray(schema.agentRuns.triggerRef, refs)));
          await database.delete(schema.conversations).where(inArray(schema.conversations.id, ids));
        }
      }
      await database.delete(schema.agentRuns).where(and(eq(schema.agentRuns.agentCode, 'publishing'), gte(schema.agentRuns.startedAt, started)));
      await cleanupTestData(app);
    }
    await app?.close();
  });

  it('5 sur 5 : réponse automatique ; 2 sur 5 : relayé sous le réseau gbp, jamais de réponse automatique', async ({ skip }) => {
    if (!app || !itemId) return skip('DATABASE_URL absente');
    const gbp = app.get<SocialPublishers>(SOCIAL_PUBLISHERS).get('google_business') as MockSocialPublisher;
    const postedAt = new Date(Date.now() - 1_800_000);
    const reviews: SocialComment[] = [
      { externalId: `avis5-${suffix}`, author: 'Julie', text: 'Avis 5/5 : Super service, merci !', postedAt, rating: 5 },
      { externalId: `avis2-${suffix}`, author: null, text: 'Avis 2/5 : Merci mais le chauffeur était en retard', postedAt, rating: 2 },
    ];
    const replies: Array<{ id: string; text: string }> = [];
    gbp.comments = async (ref: PublishedRef) => (ref.itemId === itemId ? reviews : []);
    gbp.replyComment = async (_ref: PublishedRef, id: string, text: string) => {
      replies.push({ id, text });
      return { externalId: `${id}/reply` };
    };
    const forwarded: Array<DomainEvents['conversation.inbound']> = [];
    const off = app.get(DomainEventsService).on('conversation.inbound', (p) => {
      if (p.metadata?.['contentItemId'] === itemId) {
        forwarded.push(p);
        if (p.address) addresses.push(p.address);
      }
    });
    const report = await app.get(PublishingService).commentsPass(new Date()).finally(off);
    expect(report).toMatchObject({ replied: 1, forwarded: 1, escalated: 0 });
    expect(replies).toEqual([{ id: `avis5-${suffix}`, text: 'Merci beaucoup ! Au plaisir de vous accueillir à bord.' }]);
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]).toMatchObject({ channel: 'social', kind: 'comment', network: 'gbp', threadRef: `avis2-${suffix}`, externalId: `social:google_business:comment:avis2-${suffix}` });
    const rows = await db(app).select().from(schema.contentComments).where(eq(schema.contentComments.contentItemId, itemId));
    expect(Object.fromEntries(rows.map((r) => [r.externalId, r.outcome]))).toEqual({ [`avis5-${suffix}`]: 'replied', [`avis2-${suffix}`]: 'forwarded' });
  });
});
