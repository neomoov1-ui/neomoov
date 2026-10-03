import { describe, expect, it } from 'vitest';
import type { SocialPublishInput } from '../src/adapters/marketing.types.js';
import { telegramMessageUrl, TelegramPublisher } from '../src/adapters/real/telegram.js';
import { SocialServer } from './social-server.js';

/**
 * Connecteur réel du canal Telegram (Bot API, 3 octobre 2026) contre un serveur HTTP simulé : photo avec légende, texte
 * long à la suite, vidéo, texte seul, adresse publique du message, commentaires lus dans le groupe de discussion lié
 * (transfert automatique de la publication, réponses et fils), réponse du bot, limite atteinte (429, `retry_after`),
 * jeton refusé (401) et droits manquants (403) : jamais le jeton du bot dans un message.
 */
const TOKEN = '7000000001:AAH-jeton-secret-du-bot';
const ok = (result: unknown) => ({ json: { ok: true, result } });
const channel = { id: -1001234567890, username: 'neomoov', type: 'channel' };
const group = { id: -1009876543210, type: 'supergroup', title: 'Neomoov, discussion' };
const input = (over: Partial<SocialPublishInput> = {}): SocialPublishInput => ({
  itemId: 'item-tg', space: 'telegram' as never, format: 'post', language: 'fr', title: null, body: 'Texte', caption: null, hashtags: ['#Montréal'],
  text: 'Navette aéroport à prix fixe.\n\nhttps://neomoov.net/reserver\n\n#Montréal', ctaUrl: 'https://neomoov.net/reserver',
  media: { key: 'k', contentType: 'image/png', body: Buffer.from([1, 2, 3]), url: null }, draft: false, ...over,
});

function setup(discussionChatId: string | null = String(group.id)) {
  const server = new SocialServer();
  const publisher = new TelegramPublisher({ botToken: TOKEN, channelId: '@neomoov', discussionChatId, fetchImpl: server.fetch });
  return { server, publisher };
}

describe('Telegram réel (canal)', () => {
  it('photo avec légende, texte long à la suite en réponse, vidéo, texte seul ; adresse publique du message', async () => {
    const { server, publisher } = setup();
    let id = 40;
    const sent = () => ok({ message_id: ++id, date: 1_790_000_000, chat: channel });
    server.on('POST', `/bot${TOKEN}/sendPhoto`, sent).on('POST', `/bot${TOKEN}/sendMessage`, sent).on('POST', `/bot${TOKEN}/sendVideo`, sent);

    expect(await publisher.publish(input())).toEqual({ externalId: '41', url: 'https://t.me/neomoov/41', draft: false });
    expect(server.to('sendPhoto')[0]!.form).toEqual({ chat_id: '@neomoov', photo: 'fichier:image/png:3', caption: input().text });

    const long = 'a'.repeat(1_500);
    expect(await publisher.publish(input({ text: long }))).toMatchObject({ externalId: '42' });
    expect(server.to('sendPhoto')[1]!.form).not.toHaveProperty('caption');
    expect(JSON.parse(server.to('sendMessage')[0]!.body!)).toEqual({ chat_id: '@neomoov', text: long, reply_parameters: { message_id: 42 } });

    await publisher.publish(input({ format: 'short', media: { key: 'v', contentType: 'video/mp4', body: Buffer.alloc(10), url: null } }));
    expect(server.to('sendVideo')[0]!.form).toMatchObject({ chat_id: '@neomoov', video: 'fichier:video/mp4:10', supports_streaming: 'true' });

    expect(await publisher.publish(input({ media: null }))).toMatchObject({ externalId: '45', url: 'https://t.me/neomoov/45' });
    expect(JSON.parse(server.to('sendMessage').at(-1)!.body!)).toEqual({ chat_id: '@neomoov', text: input().text });

    await expect(publisher.publish(input({ text: 'x'.repeat(4_097) }))).rejects.toMatchObject({ code: 'SOCIAL_VALIDATION_ERROR' });
    expect(telegramMessageUrl({ id: -1001234567890 }, 7)).toBe('https://t.me/c/1234567890/7');
    expect(telegramMessageUrl({ id: 12345 }, 7)).toBeNull();
    expect(await publisher.metrics()).toMatchObject({ reach: 0, interactions: 0, clicks: 0 });
    expect(JSON.stringify(publisher)).not.toContain('jeton-secret');
  });

  it('commentaires : fil du groupe de discussion lié (transfert automatique), hors bots et autres fils ; réponse du bot dans le fil', async () => {
    const { server, publisher } = setup();
    const at = (iso: string) => Math.floor(Date.parse(iso) / 1_000);
    server
      .on('POST', `/bot${TOKEN}/getUpdates`, ok([
        { update_id: 100, message: { message_id: 900, date: at('2026-10-03T10:00:00Z'), chat: group, is_automatic_forward: true, sender_chat: channel, forward_origin: { type: 'channel', chat: channel, message_id: 55 }, text: 'Publication' } },
        { update_id: 101, message: { message_id: 901, date: at('2026-10-03T10:05:00Z'), chat: group, from: { id: 1, first_name: 'Julie', last_name: 'T.' }, reply_to_message: { message_id: 900, date: at('2026-10-03T10:00:00Z'), chat: group, is_automatic_forward: true }, text: 'Vous êtes ouverts la nuit ?' } },
        { update_id: 102, message: { message_id: 902, date: at('2026-10-03T10:06:00Z'), chat: group, from: { id: 2, is_bot: true, first_name: 'Neomoov' }, reply_to_message: { message_id: 901, date: 0, chat: group }, message_thread_id: 900, text: 'Oui, 24 h sur 24.' } },
        { update_id: 103, message: { message_id: 903, date: at('2026-10-03T10:07:00Z'), chat: group, from: { id: 3, username: 'marc_mtl' }, reply_to_message: { message_id: 901, date: 0, chat: group }, message_thread_id: 900, text: 'Merci !' } },
        { update_id: 104, message: { message_id: 50, date: at('2026-10-03T10:08:00Z'), chat: { id: 42, type: 'private' }, from: { id: 4, first_name: 'Autre' }, text: 'Message privé au bot' } },
        { update_id: 105, message: { message_id: 904, date: at('2026-10-03T10:09:00Z'), chat: group, from: { id: 5, first_name: 'Ailleurs' }, reply_to_message: { message_id: 800, date: 0, chat: group, is_automatic_forward: true, forward_origin: { type: 'channel', message_id: 54 } }, text: 'Sur une autre publication' } },
      ]), ok([]))
      .on('POST', `/bot${TOKEN}/sendMessage`, ok({ message_id: 905, date: at('2026-10-03T10:10:00Z'), chat: group }));
    const ref = { itemId: 'item-tg', externalId: '55', externalUrl: 'https://t.me/neomoov/55' };
    const comments = await publisher.comments(ref, new Date('2026-10-03T09:00:00Z'));
    expect(comments).toEqual([
      { externalId: '901', author: 'Julie T.', text: 'Vous êtes ouverts la nuit ?', postedAt: new Date('2026-10-03T10:05:00Z') },
      { externalId: '903', author: '@marc_mtl', text: 'Merci !', postedAt: new Date('2026-10-03T10:07:00Z') },
    ]);
    expect(JSON.parse(server.to('getUpdates')[0]!.body!)).toMatchObject({ offset: 0, allowed_updates: ['message'] });
    // Lecture suivante : à partir de la dernière mise à jour vue (les commentaires restent en mémoire).
    expect(await publisher.comments(ref, new Date('2026-10-03T10:06:00Z'))).toHaveLength(1);
    expect(JSON.parse(server.to('getUpdates')[1]!.body!)).toMatchObject({ offset: 106 });
    expect(await publisher.comments({ ...ref, externalId: '54' }, new Date('2026-10-03T09:00:00Z'))).toMatchObject([{ externalId: '904' }]);
    expect(await publisher.replyComment(ref, '901', 'Oui, 24 h sur 24.')).toEqual({ externalId: '905' });
    expect(JSON.parse(server.to('sendMessage')[0]!.body!)).toEqual({ chat_id: String(group.id), text: 'Oui, 24 h sur 24.', reply_parameters: { message_id: 901 } });
    // Sans groupe de discussion : aucun commentaire, réponse impossible.
    const alone = setup(null);
    expect(await alone.publisher.comments(ref, new Date(0))).toEqual([]);
    await expect(alone.publisher.replyComment(ref, '1', 'x')).rejects.toMatchObject({ code: 'SOCIAL_UNSUPPORTED' });
  });

  it('429 au délai de retry_after ; 401 et 403 typés ; jamais le jeton dans le message', async () => {
    const { server, publisher } = setup();
    server.on('POST', `/bot${TOKEN}/sendPhoto`,
      { status: 429, json: { ok: false, error_code: 429, description: 'Too Many Requests: retry after 35', parameters: { retry_after: 35 } } },
      { status: 401, json: { ok: false, error_code: 401, description: 'Unauthorized' } },
      { status: 403, json: { ok: false, error_code: 403, description: 'Forbidden: bot is not a member of the channel chat' } },
      { status: 400, json: { ok: false, error_code: 400, description: 'Bad Request: chat not found' } });
    await expect(publisher.publish(input())).rejects.toMatchObject({ code: 'SOCIAL_RATE_LIMITED', status: 503, details: { retryAfterSeconds: 35 } });
    const unauthorized = await publisher.publish(input()).catch((e: Error) => e);
    expect(unauthorized).toMatchObject({ code: 'SOCIAL_AUTH_FAILED' });
    expect((unauthorized as Error).message).toBe('Telegram 401 sur api.telegram.org/sendPhoto : Unauthorized');
    await expect(publisher.publish(input())).rejects.toMatchObject({ code: 'SOCIAL_FORBIDDEN', message: expect.stringContaining('bot is not a member') });
    const invalid = await publisher.publish(input()).catch((e: Error) => e);
    expect(invalid).toMatchObject({ code: 'SOCIAL_VALIDATION_ERROR' });
    expect((invalid as Error).message).not.toContain('jeton-secret');
    const offline = new TelegramPublisher({ botToken: TOKEN, channelId: '@neomoov', discussionChatId: null, fetchImpl: (async () => { throw new Error(`connect ECONNREFUSED https://api.telegram.org/bot${TOKEN}/sendPhoto`); }) as typeof fetch });
    const down = await offline.publish(input()).catch((e: Error) => e);
    expect(down).toMatchObject({ code: 'SOCIAL_PROVIDER_ERROR' });
    expect((down as Error).message).not.toContain('jeton-secret');
  });
});
