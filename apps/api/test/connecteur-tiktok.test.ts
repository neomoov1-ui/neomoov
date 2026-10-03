import { describe, expect, it } from 'vitest';
import type { SocialPublishInput } from '../src/adapters/marketing.types.js';
import { MemoryTokenStore } from '../src/adapters/real/oauth.js';
import { tiktokChunks, TikTokPublisher, type TikTokOptions } from '../src/adapters/real/tiktok.js';
import { clock, SocialServer, tokenReplies } from './social-server.js';

/**
 * Connecteur réel de TikTok (Content Posting API, publication directe, 3 octobre 2026) contre un serveur HTTP simulé :
 * informations du créateur, initialisation, téléversement par morceaux sans jeton, suivi jusqu'à la mise en ligne,
 * repli en privé (`SELF_ONLY`) d'une application non auditée, envoi par adresse, mesures, jeton refusé puis renouvelé
 * (client_key, jeton de rafraîchissement remplacé), 429, 400. Aucune lecture des commentaires (API publique).
 */
const API = 'open.tiktokapis.com/v2';
const ok = { code: 'ok', message: '', log_id: 'log' };
const video = Buffer.alloc(1_000, 1);
const input = (over: Partial<SocialPublishInput> = {}): SocialPublishInput => ({
  itemId: 'item-tt', space: 'tiktok', format: 'short', language: 'fr', title: null, body: 'Script', caption: 'Une journée avec un chauffeur Neomoov', hashtags: ['#Montréal'],
  text: 'Une journée avec un chauffeur Neomoov\n\n#Montréal', ctaUrl: null, media: { key: 'k', contentType: 'video/mp4', body: video, url: 'https://stockage.example/video.mp4?signature=abc' }, draft: false, ...over,
});

function setup(options: Partial<TikTokOptions> = {}, time = clock()) {
  const store = new MemoryTokenStore();
  const server = new SocialServer().on('POST', `${API}/oauth/token/`, tokenReplies(['act.tt-1', 'act.tt-2'], { expiresIn: 86_400, rotate: true, extra: { refresh_expires_in: 31_536_000, open_id: 'open-1', scope: 'video.publish,video.upload' } }));
  const publisher = new TikTokPublisher({ clientKey: 'aw-client-key', clientSecret: 'tt-secret-client', refreshToken: 'rft.origine', privacyLevel: 'PUBLIC_TO_EVERYONE', audited: true, uploadMode: 'file', store, fetchImpl: server.fetch, now: time.now, pollMs: 1, chunkSize: 400, ...options });
  return { server, publisher, store, time };
}

const creator = (levels = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY']) => ({ json: { data: { privacy_level_options: levels, comment_disabled: false, duet_disabled: true, stitch_disabled: false, max_video_post_duration_sec: 600 }, error: ok } });

describe('TikTok réel', () => {
  it('publie par téléversement en morceaux (sans jeton sur l\'adresse signée), suit la publication, mesure', async () => {
    const { server, publisher, store } = setup();
    server
      .on('POST', '/post/publish/creator_info/query/', creator())
      .on('POST', '/post/publish/video/init/', { json: { data: { publish_id: 'v_pub_1', upload_url: 'https://open-upload.tiktokapis.com/video/?upload_id=1&upload_token=signe' }, error: ok } })
      .on('PUT', 'open-upload.tiktokapis.com', { status: 206 }, { status: 201 })
      .on('POST', '/post/publish/status/fetch/', { json: { data: { status: 'PROCESSING_UPLOAD' }, error: ok } }, { text: '{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7300000000000000001]},"error":{"code":"ok","message":"","log_id":"l"}}' })
      .on('POST', '/video/query/', { json: { data: { videos: [{ id: '7300000000000000001', view_count: 5_000, like_count: 300, comment_count: 12, share_count: 8 }] }, error: ok } });

    const result = await publisher.publish(input());
    // Identifiant int64 (19 chiffres) gardé exact, sans arrondi de JSON.parse.
    expect(result).toEqual({ externalId: '7300000000000000001', url: 'https://www.tiktok.com/video/7300000000000000001', draft: false, notice: null });
    const exchange = server.to('/oauth/token/')[0]!;
    expect(exchange.form).toEqual({ grant_type: 'refresh_token', refresh_token: 'rft.origine', client_key: 'aw-client-key', client_secret: 'tt-secret-client' });
    expect(await store.load('tiktok')).toMatchObject({ refreshToken: 'rt-tourne-1' });
    const init = JSON.parse(server.to('/video/init/')[0]!.body!) as Record<string, unknown>;
    expect(init).toEqual({
      post_info: { title: 'Une journée avec un chauffeur Neomoov\n\n#Montréal', privacy_level: 'PUBLIC_TO_EVERYONE', disable_comment: false, disable_duet: true, disable_stitch: false, video_cover_timestamp_ms: 1_000, brand_content_toggle: false, brand_organic_toggle: true },
      source_info: { source: 'FILE_UPLOAD', video_size: 1_000, chunk_size: 400, total_chunk_count: 2 },
    });
    // Deux morceaux : le dernier absorbe le reste ; jamais le jeton sur l'adresse de téléversement.
    const puts = server.to('open-upload.tiktokapis.com', 'PUT');
    expect(puts.map((c) => [c.headers['content-range'], c.bytes, c.headers['authorization']])).toEqual([['bytes 0-399/1000', 400, undefined], ['bytes 400-999/1000', 600, undefined]]);
    expect(server.to('/creator_info/query/')[0]!.headers['authorization']).toBe('Bearer act.tt-1');

    const ref = { itemId: 'item-tt', externalId: result.externalId, externalUrl: result.url };
    expect(await publisher.metrics(ref)).toMatchObject({ reach: 5_000, interactions: 320, clicks: 0 });
    const query = server.to('/video/query/')[0]!;
    expect(query.url).toContain('fields=id,view_count,like_count,comment_count,share_count');
    expect(JSON.parse(query.body!)).toEqual({ filters: { video_ids: ['7300000000000000001'] } });
    expect(await publisher.comments()).toEqual([]);
    await expect(publisher.replyComment()).rejects.toMatchObject({ code: 'SOCIAL_UNSUPPORTED' });
    expect(JSON.stringify(publisher)).not.toMatch(/secret|act\.|rft/);
  });

  it('application réglée comme non auditée : SELF_ONLY d\'emblée, avec la mention', async () => {
    const { server, publisher } = setup({ audited: false });
    server
      .on('POST', '/post/publish/creator_info/query/', creator())
      .on('POST', '/post/publish/video/init/', { json: { data: { publish_id: 'v_pub_9', upload_url: 'https://open-upload.tiktokapis.com/x' }, error: ok } })
      .on('PUT', 'open-upload.tiktokapis.com', { status: 201 })
      .on('POST', '/post/publish/status/fetch/', { json: { data: { status: 'PUBLISH_COMPLETE' }, error: ok } });
    expect(await publisher.publish(input())).toEqual({ externalId: 'publish:v_pub_9', url: null, draft: true, notice: expect.stringContaining('application pas encore auditée par TikTok') });
    expect(JSON.parse(server.to('/video/init/')[0]!.body!)).toMatchObject({ post_info: { privacy_level: 'SELF_ONLY' } });
    expect(server.to('/video/init/')).toHaveLength(1);
  });

  it('application non auditée : repli en SELF_ONLY, publication privée sans identifiant public ; mesures nulles', async () => {
    const { server, publisher } = setup({ uploadMode: 'url' });
    server
      .on('POST', '/post/publish/creator_info/query/', creator())
      .on('POST', '/post/publish/video/init/',
        { status: 403, json: { error: { code: 'unaudited_client_can_only_post_to_private_accounts', message: 'Please review our integration guidelines', log_id: 'l' } } },
        { json: { data: { publish_id: 'v_pub_2' }, error: ok } })
      .on('POST', '/post/publish/status/fetch/', { json: { data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: [] }, error: ok } });
    const result = await publisher.publish(input());
    expect(result).toEqual({ externalId: 'publish:v_pub_2', url: null, draft: true, notice: 'TikTok : publication privée (SELF_ONLY) au lieu de PUBLIC_TO_EVERYONE (refus de TikTok ou visibilité non offerte au compte)' });
    const [first, second] = server.to('/video/init/').map((c) => JSON.parse(c.body!) as { post_info: { privacy_level: string }; source_info: Record<string, unknown> });
    expect(first!.post_info.privacy_level).toBe('PUBLIC_TO_EVERYONE');
    expect(second!.post_info.privacy_level).toBe('SELF_ONLY');
    expect(second!.source_info).toEqual({ source: 'PULL_FROM_URL', video_url: 'https://stockage.example/video.mp4?signature=abc' });
    expect(server.to('open-upload', 'PUT')).toHaveLength(0);
    expect(await publisher.metrics({ itemId: 'i', externalId: result.externalId, externalUrl: null })).toMatchObject({ reach: 0, interactions: 0, raw: { private: true } });
  });

  it('jeton refusé (401) puis renouvelé ; limite atteinte (429) ; paramètres refusés (400) ; une image est refusée', async () => {
    const { server, publisher } = setup();
    server
      .on('POST', '/post/publish/creator_info/query/',
        { status: 401, json: { error: { code: 'access_token_invalid', message: 'The access token is invalid or not found in the request.', log_id: 'l' } } },
        creator(),
        { status: 429, json: { error: { code: 'rate_limit_exceeded', message: 'Too many requests', log_id: 'l' } } },
        creator())
      .on('POST', '/post/publish/video/init/', { status: 400, json: { error: { code: 'invalid_params', message: 'chunk_size is invalid', log_id: 'l' } } });
    // 401 sur la première lecture : nouvel échange, puis le 400 de l'initialisation.
    const invalid = await publisher.publish(input()).catch((e: Error) => e);
    expect(invalid).toMatchObject({ code: 'SOCIAL_VALIDATION_ERROR', status: 422 });
    expect((invalid as Error).message).toContain('chunk_size is invalid (invalid_params)');
    expect(server.to('/creator_info/query/').map((c) => c.headers['authorization'])).toEqual(['Bearer act.tt-1', 'Bearer act.tt-2']);
    await expect(publisher.publish(input())).rejects.toMatchObject({ code: 'SOCIAL_RATE_LIMITED', status: 503 });
    await expect(publisher.publish(input({ media: { key: 'k', contentType: 'image/png', body: Buffer.alloc(2), url: null } }))).rejects.toMatchObject({ code: 'SOCIAL_MEDIA_REQUIRED' });
  });

  it('enveloppe en erreur sous un statut 200 ; publication refusée par TikTok ; plan des morceaux', async () => {
    const { server, publisher } = setup();
    server
      .on('POST', '/post/publish/creator_info/query/', { json: { data: {}, error: { code: 'spam_risk_too_many_posts', message: 'Daily post cap reached', log_id: 'l' } } }, creator())
      .on('POST', '/post/publish/video/init/', { json: { data: { publish_id: 'v3', upload_url: 'https://open-upload.tiktokapis.com/x' }, error: ok } })
      .on('PUT', 'open-upload.tiktokapis.com', { status: 201 })
      .on('POST', '/post/publish/status/fetch/', { json: { data: { status: 'FAILED', fail_reason: 'duration_check_failed' }, error: ok } });
    await expect(publisher.publish(input())).rejects.toMatchObject({ code: 'SOCIAL_RATE_LIMITED' });
    await expect(publisher.publish(input())).rejects.toMatchObject({ code: 'SOCIAL_VALIDATION_ERROR', message: expect.stringContaining('duration_check_failed') });
    expect(tiktokChunks(30 * 1024 * 1024)).toEqual({ chunkSize: 30 * 1024 * 1024, count: 1 });
    expect(tiktokChunks(100 * 1024 * 1024)).toEqual({ chunkSize: 10 * 1024 * 1024, count: 10 });
    expect(tiktokChunks(105 * 1024 * 1024)).toEqual({ chunkSize: 10 * 1024 * 1024, count: 10 });
  });
});
