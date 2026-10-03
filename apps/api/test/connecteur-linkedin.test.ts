import { describe, expect, it } from 'vitest';
import type { SocialPublishInput } from '../src/adapters/marketing.types.js';
import { commentParent, linkedinCommentary, LinkedInPublisher, type LinkedInOptions } from '../src/adapters/real/linkedin.js';
import { clock, SocialServer, tokenReplies } from './social-server.js';

/**
 * Connecteur réel de LinkedIn (page entreprise, Community Management API, 3 octobre 2026) contre un serveur HTTP
 * simulé : image téléversée puis publication (en-têtes de version), texte au format « little text », commentaires et
 * réponse imbriquée, statistiques, jeton refusé puis renouvelé, 429, 422, échéance du jeton de 60 jours.
 */
const ORG = 'urn:li:organization:4242';
const SHARE = 'urn:li:share:7000';
const input = (over: Partial<SocialPublishInput> = {}): SocialPublishInput => ({
  itemId: 'item-li', space: 'linkedin', format: 'post', language: 'fr', title: 'Mobilité durable', body: 'Texte', caption: null, hashtags: ['#Montréal', '#mobilité_durable'],
  text: 'Nos véhicules (100 % électriques) roulent à Montréal.\n\nhttps://neomoov.net/entreprises\n\n#Montréal #mobilité_durable', ctaUrl: 'https://neomoov.net/entreprises', cta: 'reserve',
  media: { key: 'k', contentType: 'image/png', body: Buffer.from([1, 2, 3, 4]), url: null }, draft: false, ...over,
});

function setup(options: Partial<LinkedInOptions> = {}, time = clock()) {
  const server = new SocialServer().on('POST', 'www.linkedin.com/oauth/v2/accessToken', tokenReplies(['AQV-acces-1', 'AQV-acces-2'], { expiresIn: 5_184_000, extra: { refresh_token: 'AQX-rafraichissement-secret', refresh_token_expires_in: 2_592_000 } }));
  const publisher = new LinkedInPublisher({
    organizationId: '4242', accessToken: null, accessExpiresAt: null, refreshToken: 'AQX-rafraichissement-secret', clientId: 'client-li', clientSecret: 'secret-client-li', version: '202606',
    fetchImpl: server.fetch, now: time.now, ...options,
  });
  return { server, publisher, time };
}

describe('LinkedIn réel', () => {
  it('publie texte et image (téléversement, en-têtes de version), lit les commentaires, répond, mesure', async () => {
    const { server, publisher } = setup();
    server
      .on('POST', '/rest/images?action=initializeUpload', { json: { value: { uploadUrl: 'https://www.linkedin.com/dms-uploader/televersement-signe', image: 'urn:li:image:C4E' } } })
      .on('PUT', 'dms-uploader/televersement-signe', { status: 201 })
      .on('POST', '/rest/posts', { status: 201, headers: { 'x-restli-id': SHARE } })
      .on('GET', `/rest/socialActions/${encodeURIComponent(SHARE)}/comments`, { json: { elements: [
        { commentUrn: `urn:li:comment:(urn:li:activity:7000,9001)`, actor: 'urn:li:person:abc', message: { text: 'Bravo, quelles sont vos heures ?' }, created: { time: Date.parse('2026-10-02T09:00:00Z') } },
        { commentUrn: `urn:li:comment:(urn:li:activity:7000,9002)`, actor: ORG, message: { text: 'Merci !' }, created: { time: Date.parse('2026-10-02T10:00:00Z') } },
        { id: '9003', object: 'urn:li:activity:7000', actor: 'urn:li:person:def', message: { text: 'Ancien' }, created: { time: Date.parse('2026-09-01T10:00:00Z') } },
      ] } })
      .on('POST', `/rest/socialActions/${encodeURIComponent('urn:li:comment:(urn:li:activity:7000,9001)')}/comments`, { status: 201, json: { commentUrn: 'urn:li:comment:(urn:li:activity:7000,9010)' } })
      .on('GET', '/rest/organizationalEntityShareStatistics', { json: { elements: [{ totalShareStatistics: { uniqueImpressionsCount: 800, impressionCount: 1000, clickCount: 25, likeCount: 30, commentCount: 4, shareCount: 2 } }] } });

    expect(await publisher.publish(input())).toEqual({ externalId: SHARE, url: `https://www.linkedin.com/feed/update/${SHARE}/`, draft: false });
    const init = server.to('initializeUpload')[0]!;
    expect(init.headers).toMatchObject({ 'linkedin-version': '202606', 'x-restli-protocol-version': '2.0.0', authorization: 'Bearer AQV-acces-1' });
    expect(JSON.parse(init.body!)).toEqual({ initializeUploadRequest: { owner: ORG } });
    expect(server.to('dms-uploader', 'PUT')[0]).toMatchObject({ bytes: 4, headers: { 'content-type': 'image/png' } });
    const post = JSON.parse(server.to('/rest/posts')[0]!.body!) as Record<string, unknown>;
    expect(post).toEqual({
      author: ORG, commentary: 'Nos véhicules \\(100 % électriques\\) roulent à Montréal.\n\nhttps://neomoov.net/entreprises\n\n{hashtag|\\#|Montréal} {hashtag|\\#|mobilité_durable}', visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] }, lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false,
      content: { media: { id: 'urn:li:image:C4E', title: 'Mobilité durable' } },
    });
    // Sans image : publication texte seule, sans téléversement.
    await publisher.publish(input({ media: null }));
    expect(server.to('initializeUpload')).toHaveLength(1);
    expect(JSON.parse(server.to('/rest/posts')[1]!.body!)).not.toHaveProperty('content');

    const ref = { itemId: 'item-li', externalId: SHARE, externalUrl: null };
    const comments = await publisher.comments(ref, new Date('2026-10-01T00:00:00Z'));
    expect(comments).toEqual([{ externalId: 'urn:li:comment:(urn:li:activity:7000,9001)', author: 'urn:li:person:abc', text: 'Bravo, quelles sont vos heures ?', postedAt: new Date('2026-10-02T09:00:00Z') }]);
    expect(await publisher.replyComment(ref, comments[0]!.externalId, 'Nous sommes disponibles 24 h sur 24.')).toEqual({ externalId: 'urn:li:comment:(urn:li:activity:7000,9010)' });
    expect(JSON.parse(server.to('/comments', 'POST')[0]!.body!)).toEqual({ actor: ORG, object: 'urn:li:activity:7000', parentComment: 'urn:li:comment:(urn:li:activity:7000,9001)', message: { text: 'Nous sommes disponibles 24 h sur 24.' } });

    expect(await publisher.metrics(ref)).toMatchObject({ reach: 800, interactions: 36, clicks: 25 });
    const stats = server.to('organizationalEntityShareStatistics')[0]!.url;
    expect(stats).toContain(`organizationalEntity=${encodeURIComponent(ORG)}`);
    expect(stats).toContain(`shares=List(${encodeURIComponent(SHARE)})`);
    expect(JSON.stringify(publisher)).not.toMatch(/secret|AQV|AQX/);
  });

  it('jeton refusé (401) puis renouvelé par le jeton de rafraîchissement ; échéance du jeton de rafraîchissement connue', async () => {
    const { server, publisher } = setup();
    server.on('POST', '/rest/posts', { status: 401, json: { status: 401, serviceErrorCode: 65601, code: 'REVOKED_ACCESS_TOKEN', message: 'The token used in the request has been revoked by the user' } }, { status: 201, headers: { 'x-restli-id': SHARE } });
    expect(await publisher.publish(input({ media: null }))).toMatchObject({ externalId: SHARE });
    expect(server.to('/rest/posts').map((c) => c.headers['authorization'])).toEqual(['Bearer AQV-acces-1', 'Bearer AQV-acces-2']);
    const exchange = server.to('accessToken')[0]!;
    expect(exchange.form).toMatchObject({ grant_type: 'refresh_token', client_id: 'client-li', client_secret: 'secret-client-li' });
    const status = await publisher.credentials();
    expect(status.renewable).toBe(true);
    expect(status.renewBy?.toISOString()).toBe('2026-11-02T12:00:00.000Z');
  });

  it('jeton de 60 jours sans rafraîchissement : refusé (401) donne SOCIAL_AUTH_FAILED ; échéance par la variable ou par introspection', async () => {
    const server = new SocialServer()
      .on('POST', '/rest/posts', { status: 401, json: { message: 'Expired token', serviceErrorCode: 65601 } })
      .on('POST', 'introspectToken', { json: { active: true, expires_at: Date.parse('2026-10-08T00:00:00Z') / 1_000, status: 'active' } });
    const manual = new LinkedInPublisher({ organizationId: '4242', accessToken: 'AQV-manuel-secret', accessExpiresAt: Date.parse('2026-11-30'), refreshToken: null, clientId: null, clientSecret: null, version: '202606', fetchImpl: server.fetch, now: clock().now });
    const error = await manual.publish(input({ media: null })).catch((e: Error) => e);
    expect(error).toMatchObject({ code: 'SOCIAL_AUTH_FAILED' });
    expect((error as Error).message).toContain('Expired token (65601)');
    expect(server.to('/rest/posts')).toHaveLength(1);
    expect(await manual.credentials()).toMatchObject({ renewable: false, renewBy: new Date('2026-11-30') });
    const introspected = new LinkedInPublisher({ organizationId: '4242', accessToken: 'AQV-manuel-secret', accessExpiresAt: null, refreshToken: null, clientId: 'client-li', clientSecret: 'secret-client-li', version: '202606', fetchImpl: server.fetch });
    expect(await introspected.credentials()).toMatchObject({ renewable: false, renewBy: new Date('2026-10-08T00:00:00Z'), problem: null });
    expect(server.to('introspectToken')[0]!.form).toMatchObject({ client_id: 'client-li', token: 'AQV-manuel-secret' });
  });

  it('limite atteinte (429) et requête refusée (422) : erreurs typées', async () => {
    const { server, publisher } = setup();
    server.on('POST', '/rest/posts', { status: 429, headers: { 'retry-after': '60' }, json: { message: 'Resource level throttle limit reached', status: 429 } }, { status: 422, json: { message: 'ERROR :: /commentary :: is too long', status: 422 } });
    await expect(publisher.publish(input({ media: null }))).rejects.toMatchObject({ code: 'SOCIAL_RATE_LIMITED', details: { retryAfterSeconds: 60 } });
    await expect(publisher.publish(input({ media: null }))).rejects.toMatchObject({ code: 'SOCIAL_VALIDATION_ERROR', status: 422, message: expect.stringContaining('is too long') });
  });

  it('format « little text » et publication visée par un commentaire', () => {
    expect(linkedinCommentary('A_b (c) [d] {e} <f> @g *h* ~i \\ j | #tag C#')).toBe('A\\_b \\(c\\) \\[d\\] \\{e\\} \\<f\\> \\@g \\*h\\* \\~i \\\\ j \\| {hashtag|\\#|tag} C\\#');
    expect(commentParent('urn:li:comment:(urn:li:ugcPost:123,456)')).toBe('urn:li:ugcPost:123');
    expect(commentParent('n importe quoi')).toBeNull();
  });
});
