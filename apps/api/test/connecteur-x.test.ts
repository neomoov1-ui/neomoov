import { describe, expect, it } from 'vitest';
import type { SocialPublishInput } from '../src/adapters/marketing.types.js';
import { MemoryTokenStore, tokenFingerprint } from '../src/adapters/real/oauth.js';
import { splitLanguages, xLength, XPublisher, xPosts } from '../src/adapters/real/x.js';
import { clock, SocialServer, tokenReplies } from './social-server.js';

/**
 * Connecteur réel de X (API v2, 3 octobre 2026) contre un serveur HTTP simulé : image puis publication, version anglaise
 * en réponse à la française, réponses lues par la recherche (ou aucune si le niveau d'accès l'interdit), mesures, jeton
 * de rafraîchissement remplacé à chaque échange et gardé dans le magasin (repris par un autre processus), jeton refusé
 * puis renouvelé, 429 au délai de `x-rate-limit-reset`, 400.
 */
const input = (over: Partial<SocialPublishInput> = {}): SocialPublishInput => ({
  itemId: 'item-x', space: 'x', format: 'post', language: 'fr', title: null, body: 'Trafic fluide vers YUL ce matin.', caption: null, hashtags: ['#YUL'],
  text: 'Trafic fluide vers YUL ce matin.\n\nhttps://neomoov.net/reserver\n\n#YUL', ctaUrl: 'https://neomoov.net/reserver', media: null, draft: false, ...over,
});

function setup(store = new MemoryTokenStore(), time = clock()) {
  const server = new SocialServer().on('POST', 'api.x.com/2/oauth2/token', tokenReplies(['x-acces-1', 'x-acces-2', 'x-acces-3'], { expiresIn: 7_200, rotate: true }));
  const publisher = new XPublisher({ clientId: 'x-client', clientSecret: 'x-secret-client', refreshToken: 'rt-origine', store, fetchImpl: server.fetch, now: time.now });
  return { server, publisher, store, time };
}

describe('X réel', () => {
  it('publie l\'image puis la version française, et l\'anglaise en réponse ; jeton renouvelé gardé dans le magasin', async () => {
    const { server, publisher, store } = setup();
    let n = 0;
    server
      .on('POST', '/2/media/upload', { json: { data: { id: 'media-1', media_key: '3_media-1' } } })
      .on('POST', '/2/tweets', () => ({ status: 201, json: { data: { id: `tw${++n}`, text: '…' } } }));
    const bilingual = input({ body: 'Trafic fluide vers YUL ce matin.\n[EN]\nTraffic is light to YUL this morning.', media: { key: 'k', contentType: 'image/png', body: Buffer.from([9, 9]), url: null } });
    expect(await publisher.publish(bilingual)).toEqual({ externalId: 'tw1', url: 'https://x.com/i/web/status/tw1', draft: false });
    const exchange = server.to('oauth2/token')[0]!;
    expect(exchange.headers['authorization']).toBe(`Basic ${Buffer.from('x-client:x-secret-client').toString('base64')}`);
    expect(exchange.form).toEqual({ grant_type: 'refresh_token', refresh_token: 'rt-origine', client_id: 'x-client' });
    expect(server.to('/2/media/upload')[0]!.form).toEqual({ media: 'fichier:image/png:2', media_category: 'tweet_image', media_type: 'image/png' });
    const [fr, en] = server.to('/2/tweets').map((c) => JSON.parse(c.body!) as Record<string, unknown>);
    expect(fr).toEqual({ text: 'Trafic fluide vers YUL ce matin.\n\nhttps://neomoov.net/reserver\n\n#YUL', media: { media_ids: ['media-1'] } });
    expect(en).toEqual({ text: 'Traffic is light to YUL this morning.\n\nhttps://neomoov.net/reserver\n\n#YUL', reply: { in_reply_to_tweet_id: 'tw1' } });
    // Le jeton de rafraîchissement remplacé est gardé (chiffré en service) avec l'empreinte de l'autorisation d'origine.
    expect(await store.load('x')).toMatchObject({ origin: tokenFingerprint('rt-origine'), refreshToken: 'rt-tourne-1', accessToken: 'x-acces-1' });
    expect(JSON.stringify(publisher)).not.toMatch(/secret|acces|rt-/);
  });

  it('un autre processus (ou un redémarrage) reprend le dernier jeton gardé, pas celui de l\'environnement', async () => {
    const time = clock();
    const { server, publisher, store } = setup(new MemoryTokenStore(), time);
    server.on('POST', '/2/tweets', { status: 201, json: { data: { id: 'tw1' } } });
    await publisher.publish(input());
    time.advance(3 * 3_600_000);
    // Second processus : même variable d'environnement (rt-origine, déjà consommé chez X), même magasin.
    const other = new XPublisher({ clientId: 'x-client', clientSecret: 'x-secret-client', refreshToken: 'rt-origine', store, fetchImpl: server.fetch, now: time.now });
    await other.publish(input());
    expect(server.to('oauth2/token').map((c) => c.form!['refresh_token'])).toEqual(['rt-origine', 'rt-tourne-1']);
    expect(await store.load('x')).toMatchObject({ refreshToken: 'rt-tourne-2' });
    // Nouvelle autorisation du fondateur (autre jeton dans l'environnement) : l'état gardé de l'ancienne est ignoré.
    const fresh = new XPublisher({ clientId: 'x-client', clientSecret: null, refreshToken: 'rt-nouvelle-autorisation', store, fetchImpl: server.fetch, now: time.now });
    await fresh.publish(input());
    const last = server.to('oauth2/token').at(-1)!;
    expect(last.form).toMatchObject({ refresh_token: 'rt-nouvelle-autorisation', client_id: 'x-client' });
    expect(last.headers['authorization']).toBeUndefined();
  });

  it('jeton consommé par l\'autre processus pendant l\'échange : relecture du magasin et un seul nouvel essai', async () => {
    const store = new MemoryTokenStore();
    const time = clock();
    await store.save('x', { origin: tokenFingerprint('rt-origine'), refreshToken: 'rt-ancien', refreshExpiresAt: null, accessToken: null, accessExpiresAt: null });
    // Serveur simulé : l'autre processus a déjà renouvelé ; le magasin contient le nouveau jeton au moment de l'échec.
    const routes = new SocialServer()
      .on('POST', 'oauth2/token', (call) => {
        if (call.form?.['refresh_token'] === 'rt-ancien') {
          void store.save('x', { origin: tokenFingerprint('rt-origine'), refreshToken: 'rt-par-le-worker', refreshExpiresAt: null, accessToken: null, accessExpiresAt: null });
          return { status: 400, json: { error: 'invalid_request', error_description: 'Value passed for the token was invalid.' } };
        }
        return { json: { access_token: 'x-acces-w', expires_in: 7_200, refresh_token: 'rt-suivant' } };
      })
      .on('POST', '/2/tweets', { status: 201, json: { data: { id: 'tw1' } } });
    const publisher = new XPublisher({ clientId: 'x-client', clientSecret: 'x-secret-client', refreshToken: 'rt-origine', store, fetchImpl: routes.fetch, now: time.now });
    expect(await publisher.publish(input())).toMatchObject({ externalId: 'tw1' });
    expect(routes.to('oauth2/token').map((c) => c.form!['refresh_token'])).toEqual(['rt-ancien', 'rt-par-le-worker']);
    expect(routes.to('/2/tweets')[0]!.headers['authorization']).toBe('Bearer x-acces-w');
  });

  it('jeton refusé (401) puis renouvelé ; 429 au délai de x-rate-limit-reset ; 400 : requête refusée', async () => {
    const { server, publisher, time } = setup();
    server.on('POST', '/2/tweets',
      { status: 401, json: { title: 'Unauthorized', type: 'about:blank', status: 401, detail: 'Unauthorized' } },
      { status: 201, json: { data: { id: 'tw-ok' } } },
      { status: 429, headers: { 'x-rate-limit-reset': String(Math.floor(time.now() / 1_000) + 900) }, json: { title: 'Too Many Requests', detail: 'Too Many Requests' } },
      { status: 400, json: { errors: [{ message: 'Your Tweet text is too long.' }], title: 'Invalid Request', detail: 'One or more parameters to your request was invalid.' } });
    expect(await publisher.publish(input())).toMatchObject({ externalId: 'tw-ok' });
    expect(server.to('/2/tweets').map((c) => c.headers['authorization'])).toEqual(['Bearer x-acces-1', 'Bearer x-acces-2']);
    await expect(publisher.publish(input())).rejects.toMatchObject({ code: 'SOCIAL_RATE_LIMITED', status: 503, details: { retryAfterSeconds: 900 } });
    await expect(publisher.publish(input())).rejects.toMatchObject({ code: 'SOCIAL_VALIDATION_ERROR', message: expect.stringContaining('One or more parameters') });
    // Contrôle local : plus de 280 caractères, aucun appel.
    const calls = server.calls.length;
    await expect(publisher.publish(input({ text: 'a'.repeat(281) }))).rejects.toMatchObject({ code: 'SOCIAL_VALIDATION_ERROR' });
    expect(server.calls).toHaveLength(calls);
  });

  it('réponses lues par la recherche (hors celles du compte) et réponse ; niveau d\'accès insuffisant : aucune lecture, sans erreur ; mesures', async () => {
    const { server, publisher } = setup();
    server
      .on('GET', '/2/users/me', { json: { data: { id: 'moi', username: 'neomoov' } } })
      .on('GET', '/2/tweets/search/recent', { json: {
        data: [
          { id: 'r1', text: '@neomoov quels sont vos horaires ?', author_id: 'u1', created_at: '2026-10-03T09:00:00.000Z' },
          { id: 'r2', text: 'Traffic is light to YUL this morning.', author_id: 'moi', created_at: '2026-10-03T09:01:00.000Z' },
        ],
        includes: { users: [{ id: 'u1', username: 'julie_mtl' }] },
      } }, { status: 403, json: { title: 'Client Forbidden', detail: 'When authenticating requests to the Twitter API v2 endpoints, you must use keys and tokens from a Twitter developer App that is attached to a Project.', reason: 'client-not-enrolled' } })
      .on('POST', '/2/tweets', { status: 201, json: { data: { id: 'rep1' } } })
      .on('GET', '/2/tweets/tw1?tweet.fields=public_metrics,non_public_metrics', { status: 403, json: { title: 'Forbidden', detail: 'Sorry, you are not authorized to see non public metrics.' } })
      .on('GET', '/2/tweets/tw1?tweet.fields=public_metrics', { json: { data: { id: 'tw1', public_metrics: { impression_count: 700, like_count: 10, retweet_count: 2, reply_count: 1, quote_count: 0, bookmark_count: 3 } } } });
    const ref = { itemId: 'item-x', externalId: 'tw1', externalUrl: null };
    const since = new Date('2026-10-03T08:00:00Z');
    expect(await publisher.comments(ref, since)).toEqual([{ externalId: 'r1', author: '@julie_mtl', text: '@neomoov quels sont vos horaires ?', postedAt: new Date('2026-10-03T09:00:00Z') }]);
    const search = new URL(server.to('/2/tweets/search/recent')[0]!.url);
    expect(search.searchParams.get('query')).toBe('conversation_id:tw1 is:reply');
    expect(await publisher.replyComment(ref, 'r1', 'Nous roulons 24 h sur 24.')).toEqual({ externalId: 'rep1' });
    expect(JSON.parse(server.to('/2/tweets', 'POST')[0]!.body!)).toEqual({ text: 'Nous roulons 24 h sur 24.', reply: { in_reply_to_tweet_id: 'r1' } });
    expect(await publisher.comments(ref, since)).toEqual([]);
    expect(await publisher.comments(ref, since)).toEqual([]);
    expect(server.to('/2/tweets/search/recent')).toHaveLength(2);
    expect(await publisher.metrics(ref)).toMatchObject({ reach: 700, interactions: 16, clicks: 0 });
  });

  it('versions linguistiques et longueur comptée comme X', () => {
    expect(splitLanguages('Bonjour\nEN :\nHello')).toEqual(['Bonjour', 'Hello']);
    expect(splitLanguages('Bonjour sans anglais')).toEqual(['Bonjour sans anglais']);
    expect(splitLanguages('[EN]\nHello seul')).toEqual(['[EN]\nHello seul']);
    expect(xPosts(input())).toEqual([input().text]);
    expect(xLength(`a https://neomoov.net/${'x'.repeat(100)}`)).toBe(25);
  });
});
