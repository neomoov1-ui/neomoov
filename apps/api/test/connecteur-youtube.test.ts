import { describe, expect, it } from 'vitest';
import type { SocialPublishInput } from '../src/adapters/marketing.types.js';
import { secondsUntilPacificMidnight, youtubeDescription, YouTubePublisher, youtubeTags, youtubeTitle } from '../src/adapters/real/youtube.js';
import { clock, SocialServer, tokenReplies } from './social-server.js';

/**
 * Connecteur réel de YouTube (Data API v3, 3 octobre 2026) contre un serveur HTTP simulé : téléversement résumable par
 * morceaux (308 et en-tête `Range`), métadonnées et visibilité, commentaires et réponse, statistiques, jeton refusé
 * pendant le téléversement puis renouvelé, quota épuisé (403 traité en 429 jusqu'à minuit, heure du Pacifique), 400.
 */
const SESSION = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=session-1';
const video = Buffer.alloc(1_000, 7);
const input = (over: Partial<SocialPublishInput> = {}): SocialPublishInput => ({
  itemId: 'item-yt', space: 'youtube', format: 'short', language: 'fr', title: 'Aéroport <sans> stress', body: 'Script', caption: null, hashtags: ['#Montréal', '#YUL'],
  text: 'Trois conseils pour l\'aéroport.\n\nhttps://neomoov.net/reserver\n\n#Montréal #YUL', ctaUrl: 'https://neomoov.net/reserver', media: { key: 'k', contentType: 'video/mp4', body: video, url: null }, draft: false, ...over,
});

function setup(time = clock()) {
  const server = new SocialServer().on('POST', 'oauth2.googleapis.com/token', tokenReplies(['ya29.yt-1', 'ya29.yt-2', 'ya29.yt-3']));
  const publisher = new YouTubePublisher({ clientId: 'yt.apps.googleusercontent.com', clientSecret: 'GOCSPX-yt-secret', refreshToken: '1//yt-rafraichissement', privacyStatus: 'public', audited: true, chunkSize: 400, fetchImpl: server.fetch, now: time.now });
  return { server, publisher, time };
}

const resumableInit = { status: 200, headers: { location: SESSION } };

describe('YouTube réel', () => {
  it('téléverse par morceaux (reprise au premier octet manquant), publie en Short public, lit les commentaires, répond, mesure', async () => {
    const { server, publisher } = setup();
    server
      .on('POST', 'upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', resumableInit)
      .on('PUT', 'upload_id=session-1',
        { status: 308, headers: { range: 'bytes=0-399' } },
        // YouTube n'a gardé qu'une partie du deuxième morceau : la suite repart de l'octet 700.
        { status: 308, headers: { range: 'bytes=0-699' } },
        { status: 308, headers: { range: 'bytes=0-899' } },
        { status: 200, json: { id: 'vid123', status: { uploadStatus: 'uploaded', privacyStatus: 'public' } } })
      .on('GET', '/youtube/v3/commentThreads', { json: { items: [
        { snippet: { channelId: 'UCnous', topLevelComment: { id: 'c1', snippet: { authorDisplayName: 'Marc', authorChannelId: { value: 'UCmarc' }, textOriginal: 'Merci pour les conseils', publishedAt: '2026-10-02T10:00:00Z' } } } },
        { snippet: { channelId: 'UCnous', topLevelComment: { id: 'c2', snippet: { authorDisplayName: 'Neomoov', authorChannelId: { value: 'UCnous' }, textOriginal: 'Notre propre commentaire', publishedAt: '2026-10-02T11:00:00Z' } } } },
      ] } })
      .on('POST', '/youtube/v3/comments?part=snippet', { json: { id: 'c1.reponse' } })
      .on('GET', '/youtube/v3/videos?part=statistics', { json: { items: [{ statistics: { viewCount: '1500', likeCount: '40', commentCount: '6' } }] } });

    expect(await publisher.publish(input())).toEqual({ externalId: 'vid123', url: 'https://www.youtube.com/shorts/vid123', draft: false, notice: null });
    const init = server.to('uploadType=resumable&part=')[0]!;
    expect(init.headers).toMatchObject({ authorization: 'Bearer ya29.yt-1', 'x-upload-content-length': '1000', 'x-upload-content-type': 'video/mp4' });
    expect(JSON.parse(init.body!)).toEqual({
      snippet: { title: 'Aéroport sans stress', description: 'Trois conseils pour l\'aéroport.\n\nhttps://neomoov.net/reserver\n\n#Montréal #YUL\n\n#Shorts', tags: ['Montréal', 'YUL'], categoryId: '19', defaultLanguage: 'fr-CA', defaultAudioLanguage: 'fr-CA' },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false, embeddable: true },
    });
    expect(server.to('upload_id=session-1', 'PUT').map((c) => [c.headers['content-range'], c.bytes])).toEqual([
      ['bytes 0-399/1000', 400], ['bytes 400-799/1000', 400], ['bytes 700-999/1000', 300], ['bytes 900-999/1000', 100],
    ]);

    const ref = { itemId: 'item-yt', externalId: 'vid123', externalUrl: null };
    expect(await publisher.comments(ref, new Date('2026-10-01T00:00:00Z'))).toEqual([{ externalId: 'c1', author: 'Marc', text: 'Merci pour les conseils', postedAt: new Date('2026-10-02T10:00:00Z') }]);
    expect(await publisher.replyComment(ref, 'c1', 'Merci beaucoup !')).toEqual({ externalId: 'c1.reponse' });
    expect(JSON.parse(server.to('/comments?part=snippet')[0]!.body!)).toEqual({ snippet: { parentId: 'c1', textOriginal: 'Merci beaucoup !' } });
    expect(await publisher.metrics(ref)).toMatchObject({ reach: 1500, interactions: 46, clicks: 0 });
    expect(JSON.stringify(publisher)).not.toMatch(/secret|ya29|1\/\//);
  });

  it('une image ne part pas sur YouTube ; brouillon : vidéo privée', async () => {
    const { server, publisher } = setup();
    await expect(publisher.publish(input({ media: { key: 'k', contentType: 'image/png', body: Buffer.alloc(3), url: null } }))).rejects.toMatchObject({ code: 'SOCIAL_MEDIA_REQUIRED', status: 422 });
    expect(server.calls).toHaveLength(0);
    server.on('POST', 'uploadType=resumable&part=', resumableInit).on('PUT', 'upload_id=session-1', { status: 201, json: { id: 'vid9', status: { uploadStatus: 'uploaded' } } });
    const draftPublisher = new YouTubePublisher({ clientId: 'c', clientSecret: 's', refreshToken: 'r', privacyStatus: 'unlisted', fetchImpl: server.fetch });
    expect(await draftPublisher.publish(input({ format: 'video', draft: true }))).toEqual({ externalId: 'vid9', url: 'https://www.youtube.com/watch?v=vid9', draft: true, notice: null });
    expect(JSON.parse(server.to('uploadType=resumable&part=')[0]!.body!)).toMatchObject({ status: { privacyStatus: 'private' } });
  });

  it('projet non audité : téléversement en privé avec la mention ; audité mais gardé privé par YouTube : mention aussi', async () => {
    const server = new SocialServer()
      .on('POST', 'oauth2.googleapis.com/token', tokenReplies(['ya29.a']))
      .on('POST', 'uploadType=resumable&part=', resumableInit)
      .on('PUT', 'upload_id=session-1', { status: 200, json: { id: 'vidP', status: { uploadStatus: 'uploaded', privacyStatus: 'private' } } });
    const pending = new YouTubePublisher({ clientId: 'c', clientSecret: 's', refreshToken: 'r', privacyStatus: 'public', fetchImpl: server.fetch });
    expect(await pending.publish(input())).toEqual({ externalId: 'vidP', url: 'https://www.youtube.com/shorts/vidP', draft: true, notice: expect.stringContaining('projet Google pas encore audité') });
    expect(JSON.parse(server.to('uploadType=resumable&part=')[0]!.body!)).toMatchObject({ status: { privacyStatus: 'private' } });
    const audited = new YouTubePublisher({ clientId: 'c', clientSecret: 's', refreshToken: 'r', privacyStatus: 'public', audited: true, fetchImpl: server.fetch });
    expect(await audited.publish(input())).toMatchObject({ draft: true, notice: 'YouTube : vidéo gardée en private par YouTube (public demandé) : vérifier l\'audit du projet' });
    expect(JSON.parse(server.to('uploadType=resumable&part=')[1]!.body!)).toMatchObject({ status: { privacyStatus: 'public' } });
  });

  it('jeton refusé (401) au milieu du téléversement : renouvelé, le morceau repart avec le nouveau jeton', async () => {
    const { server, publisher } = setup();
    server
      .on('POST', 'uploadType=resumable&part=', resumableInit)
      .on('PUT', 'upload_id=session-1',
        { status: 308, headers: { range: 'bytes=0-399' } },
        { status: 401, json: { error: { code: 401, message: 'Invalid Credentials', errors: [{ reason: 'authError' }] } } },
        { status: 308, headers: { range: 'bytes=0-799' } },
        { status: 200, json: { id: 'vid401' } });
    expect(await publisher.publish(input())).toMatchObject({ externalId: 'vid401' });
    const puts = server.to('upload_id=session-1', 'PUT');
    expect(puts.map((c) => c.headers['authorization'])).toEqual(['Bearer ya29.yt-1', 'Bearer ya29.yt-1', 'Bearer ya29.yt-2', 'Bearer ya29.yt-2']);
    expect(puts[1]!.headers['content-range']).toBe(puts[2]!.headers['content-range']);
    expect(server.to('oauth2.googleapis.com/token')).toHaveLength(2);
  });

  it('quota épuisé (403 quotaExceeded) : limite atteinte jusqu\'à minuit, heure du Pacifique ; 400 : requête refusée', async () => {
    const { server, publisher } = setup();
    server.on('POST', 'uploadType=resumable&part=',
      { status: 403, json: { error: { code: 403, message: 'The request cannot be completed because you have exceeded your quota.', errors: [{ reason: 'quotaExceeded' }] } } },
      { status: 400, json: { error: { code: 400, message: 'Invalid video title', errors: [{ reason: 'invalidTitle' }] } } },
      { status: 403, json: { error: { code: 403, message: 'Forbidden', errors: [{ reason: 'forbidden' }] } } });
    // 12 h UTC le 3 octobre : 5 h, heure du Pacifique (été), donc 19 heures avant minuit.
    await expect(publisher.publish(input())).rejects.toMatchObject({ code: 'SOCIAL_RATE_LIMITED', details: { retryAfterSeconds: 19 * 3_600 } });
    await expect(publisher.publish(input())).rejects.toMatchObject({ code: 'SOCIAL_VALIDATION_ERROR', message: expect.stringContaining('Invalid video title (invalidTitle)') });
    await expect(publisher.publish(input())).rejects.toMatchObject({ code: 'SOCIAL_FORBIDDEN' });
  });

  it('titre, description et mots-clés aux règles de YouTube', () => {
    expect(youtubeTitle({ title: null, body: '\n  Première ligne <b>\nSuite' })).toBe('Première ligne b');
    expect(youtubeTitle({ title: 'x'.repeat(120), body: '' })).toHaveLength(100);
    expect(youtubeDescription('Déjà #shorts', 'short')).toBe('Déjà #shorts');
    expect(Buffer.byteLength(youtubeDescription('é'.repeat(4_000), 'video'))).toBeLessThanOrEqual(5_000);
    expect(youtubeTags(Array.from({ length: 60 }, (_, i) => `#motcle${i}`)).join(',').length).toBeLessThanOrEqual(500);
    expect(secondsUntilPacificMidnight(new Date('2026-12-01T08:00:00Z'))).toBe(24 * 3_600);
  });
});
