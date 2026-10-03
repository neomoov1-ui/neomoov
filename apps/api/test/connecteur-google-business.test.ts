import { describe, expect, it } from 'vitest';
import type { SocialPublishInput } from '../src/adapters/marketing.types.js';
import { googlePostSummary, GoogleBusinessPublisher } from '../src/adapters/real/google-business.js';
import { clock, SocialServer, tokenReplies } from './social-server.js';

/**
 * Connecteur réel de la Fiche Google (Business Profile, 3 octobre 2026) contre un serveur HTTP simulé : publication
 * locale (bouton RÉSERVER, photo par adresse signée), mesures de la fiche, avis et réponse, jeton expiré puis
 * renouvelé, limite atteinte (429), requête refusée (400). Aucun secret dans les messages ni dans `toJSON`.
 */
const LOCATION = 'accounts/111/locations/222';
const input = (over: Partial<SocialPublishInput> = {}): SocialPublishInput => ({
  itemId: 'item-gbp', space: 'google_business', format: 'post', language: 'fr', title: null, body: 'Navette aéroport à prix fixe.', caption: null, hashtags: [],
  text: 'Navette aéroport à prix fixe.\n\nhttps://neomoov.net/reserver', ctaUrl: 'https://neomoov.net/reserver', cta: 'reserve',
  media: { key: 'k', contentType: 'image/png', body: Buffer.from([1, 2, 3]), url: 'https://stockage.example/visuel.png?signature=abc' }, draft: false, ...over,
});

function setup(time = clock()) {
  const server = new SocialServer().on('POST', 'oauth2.googleapis.com/token', tokenReplies(['ya29.acces-1', 'ya29.acces-2', 'ya29.acces-3']));
  const publisher = new GoogleBusinessPublisher({ clientId: 'client.apps.googleusercontent.com', clientSecret: 'GOCSPX-secret-client', refreshToken: '1//rafraichissement-secret', accountId: '111', locationId: '222', fetchImpl: server.fetch, now: time.now });
  return { server, publisher, time };
}

describe('Fiche Google réelle', () => {
  it('publie (bouton RÉSERVER, photo, texte sans l\'adresse), mesure la fiche, lit les avis et y répond', async () => {
    const { server, publisher } = setup();
    server
      .on('POST', `${LOCATION}/localPosts`, { json: { name: `${LOCATION}/localPosts/333`, searchUrl: 'https://local.google.com/place?id=1&use=posts', state: 'LIVE', createTime: '2026-10-01T15:00:00Z' } })
      .on('GET', `/v4/${LOCATION}/localPosts/333`, { json: { name: `${LOCATION}/localPosts/333`, createTime: '2026-10-01T15:00:00Z', state: 'LIVE' } })
      .on('GET', 'fetchMultiDailyMetricsTimeSeries', { json: { multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: [
        { dailyMetric: 'BUSINESS_IMPRESSIONS_MOBILE_MAPS', timeSeries: { datedValues: [{ value: '120' }, { value: '30' }] } },
        { dailyMetric: 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', timeSeries: { datedValues: [{ value: '50' }, {}] } },
        { dailyMetric: 'CALL_CLICKS', timeSeries: { datedValues: [{ value: '2' }] } },
        { dailyMetric: 'BUSINESS_DIRECTION_REQUESTS', timeSeries: { datedValues: [{ value: '3' }] } },
        { dailyMetric: 'WEBSITE_CLICKS', timeSeries: { datedValues: [{ value: '9' }] } },
      ] }] } })
      .on('GET', `${LOCATION}/reviews`, { json: { reviews: [
        { name: `${LOCATION}/reviews/r1`, reviewer: { displayName: 'Julie' }, starRating: 'FIVE', comment: 'Super chauffeur, merci !', createTime: '2026-10-02T10:00:00Z' },
        { name: `${LOCATION}/reviews/r2`, reviewer: { isAnonymous: true }, starRating: 'TWO', comment: 'Merci mais retard', createTime: '2026-10-02T11:00:00Z' },
        { name: `${LOCATION}/reviews/r3`, reviewer: { displayName: 'Ancien' }, starRating: 'FOUR', createTime: '2026-09-20T10:00:00Z' },
        { name: `${LOCATION}/reviews/r4`, reviewer: { displayName: 'Déjà' }, starRating: 'FIVE', comment: 'Top', createTime: '2026-10-02T12:00:00Z', reviewReply: { comment: 'Merci' } },
      ] } })
      .on('PUT', `${LOCATION}/reviews/r1/reply`, { json: { comment: 'Merci beaucoup !', updateTime: '2026-10-03T12:00:00Z' } });

    const result = await publisher.publish(input());
    expect(result).toEqual({ externalId: `${LOCATION}/localPosts/333`, url: 'https://local.google.com/place?id=1&use=posts', draft: false });
    const exchange = server.to('oauth2.googleapis.com/token')[0]!;
    expect(exchange.form).toEqual({ grant_type: 'refresh_token', refresh_token: '1//rafraichissement-secret', client_id: 'client.apps.googleusercontent.com', client_secret: 'GOCSPX-secret-client' });
    const post = server.to('/localPosts', 'POST')[0]!;
    expect(post.headers['authorization']).toBe('Bearer ya29.acces-1');
    expect(JSON.parse(post.body!)).toEqual({
      languageCode: 'fr', summary: 'Navette aéroport à prix fixe.', topicType: 'STANDARD',
      callToAction: { actionType: 'BOOK', url: 'https://neomoov.net/reserver' }, media: [{ mediaFormat: 'PHOTO', sourceUrl: 'https://stockage.example/visuel.png?signature=abc' }],
    });
    // Appel à l'action Academy : EN SAVOIR PLUS ; vidéo : pas de photo.
    await publisher.publish(input({ cta: 'academy', ctaUrl: 'https://neomoov.net/academy', text: 'Formation', media: { key: 'v', contentType: 'video/mp4', body: Buffer.alloc(1), url: 'https://s/v.mp4' } }));
    expect(JSON.parse(server.to('/localPosts', 'POST')[1]!.body!)).toMatchObject({ callToAction: { actionType: 'LEARN_MORE', url: 'https://neomoov.net/academy' } });
    expect(JSON.parse(server.to('/localPosts', 'POST')[1]!.body!)).not.toHaveProperty('media');

    const ref = { itemId: 'item-gbp', externalId: `${LOCATION}/localPosts/333`, externalUrl: null };
    const metrics = await publisher.metrics(ref);
    expect(metrics).toMatchObject({ reach: 200, interactions: 5, clicks: 9, raw: { scope: 'location', from: '2026-10-01', to: '2026-10-03' } });
    const query = server.to('fetchMultiDailyMetricsTimeSeries')[0]!.url;
    expect(query).toContain('businessprofileperformance.googleapis.com/v1/locations/222:fetchMultiDailyMetricsTimeSeries');
    expect(query).toContain('dailyMetrics=WEBSITE_CLICKS');
    expect(query).toContain('dailyRange.startDate.day=1');

    const comments = await publisher.comments(ref, new Date('2026-10-01T00:00:00Z'));
    expect(comments).toEqual([
      { externalId: 'r1', author: 'Julie', text: 'Avis 5/5 : Super chauffeur, merci !', postedAt: new Date('2026-10-02T10:00:00Z'), rating: 5 },
      { externalId: 'r2', author: null, text: 'Avis 2/5 : Merci mais retard', postedAt: new Date('2026-10-02T11:00:00Z'), rating: 2 },
    ]);
    // Un avis n'appartient qu'à une publication : une autre publication ne le reçoit pas une seconde fois.
    expect(await publisher.comments({ ...ref, itemId: 'autre-item' }, new Date('2026-10-01T00:00:00Z'))).toEqual([]);
    expect(await publisher.comments(ref, new Date('2026-10-01T00:00:00Z'))).toHaveLength(2);

    expect(await publisher.replyComment(ref, 'r1', 'Merci beaucoup !')).toEqual({ externalId: 'r1/reply' });
    expect(server.to('/reply', 'PUT')[0]!.url).toBe(`https://mybusiness.googleapis.com/v4/${LOCATION}/reviews/r1/reply`);
    expect(JSON.parse(server.to('/reply', 'PUT')[0]!.body!)).toEqual({ comment: 'Merci beaucoup !' });
    // La ressource complète est aussi acceptée.
    expect(await publisher.replyComment(ref, `${LOCATION}/reviews/r1`, 'Merci')).toEqual({ externalId: 'r1/reply' });
    await expect(publisher.replyComment(ref, '../../autre/chose', 'x')).rejects.toMatchObject({ code: 'SOCIAL_VALIDATION_ERROR' });

    // Un seul échange de jeton pour toute la série (jeton en cache jusqu'à son échéance).
    expect(server.to('oauth2.googleapis.com/token')).toHaveLength(1);
    expect(JSON.stringify(publisher)).not.toMatch(/secret|ya29/);
    expect(googlePostSummary('Texte\n\nhttps://x.y/r\n\n#a', 'https://x.y/r')).toBe('Texte\n\n#a');
  });

  it('jeton expiré : refusé (401) puis renouvelé, et renouvelé à l\'échéance sans attendre de refus', async () => {
    const { server, publisher, time } = setup();
    server.on('POST', '/localPosts', { status: 401, json: { error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED' } } }, { json: { name: `${LOCATION}/localPosts/9`, state: 'LIVE' } });
    expect(await publisher.publish(input())).toMatchObject({ externalId: `${LOCATION}/localPosts/9` });
    const posts = server.to('/localPosts', 'POST');
    expect(posts.map((c) => c.headers['authorization'])).toEqual(['Bearer ya29.acces-1', 'Bearer ya29.acces-2']);
    expect(server.to('oauth2.googleapis.com/token')).toHaveLength(2);
    time.advance(3_600_000);
    await publisher.publish(input());
    expect(server.to('oauth2.googleapis.com/token')).toHaveLength(3);
    expect(server.to('/localPosts', 'POST').at(-1)!.headers['authorization']).toBe('Bearer ya29.acces-3');
  });

  it('jeton de rafraîchissement révoqué : SOCIAL_AUTH_FAILED sans secret dans le message', async () => {
    const server = new SocialServer().on('POST', 'oauth2.googleapis.com/token', { status: 400, json: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } });
    const publisher = new GoogleBusinessPublisher({ clientId: 'c', clientSecret: 'GOCSPX-secret', refreshToken: '1//revoque-secret', accountId: '111', locationId: '222', fetchImpl: server.fetch });
    const error = await publisher.publish(input()).catch((e: Error) => e);
    expect(error).toMatchObject({ code: 'SOCIAL_AUTH_FAILED', status: 502 });
    expect((error as Error).message).toContain('invalid_grant');
    expect((error as Error).message).not.toMatch(/secret|revoque/);
    expect(await publisher.credentials()).toMatchObject({ renewable: true, problem: expect.stringContaining('invalid_grant') });
  });

  it('limite atteinte (429) : SOCIAL_RATE_LIMITED avec le délai demandé ; requête refusée (400) : SOCIAL_VALIDATION_ERROR', async () => {
    const { server, publisher } = setup();
    server.on('POST', '/localPosts',
      { status: 429, headers: { 'retry-after': '120' }, json: { error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } } },
      { status: 400, json: { error: { code: 400, message: 'Request contains an invalid argument.', status: 'INVALID_ARGUMENT' } } });
    await expect(publisher.publish(input())).rejects.toMatchObject({ code: 'SOCIAL_RATE_LIMITED', status: 503, details: { retryAfterSeconds: 120 } });
    const invalid = await publisher.publish(input()).catch((e: Error) => e);
    expect(invalid).toMatchObject({ code: 'SOCIAL_VALIDATION_ERROR', status: 422 });
    expect((invalid as Error).message).toContain('Request contains an invalid argument. (INVALID_ARGUMENT)');
    expect((invalid as Error).message).not.toContain('signature=');
    // Contrôle local avant tout appel : texte trop long.
    const calls = server.calls.length;
    await expect(publisher.publish(input({ text: 'x'.repeat(1_501), ctaUrl: null }))).rejects.toMatchObject({ code: 'SOCIAL_VALIDATION_ERROR' });
    expect(server.calls).toHaveLength(calls);
  });
});
