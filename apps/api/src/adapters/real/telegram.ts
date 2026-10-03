/**
 * Canal Telegram réel (Bot API, 3 octobre 2026) : le bot, administrateur du canal avec le droit de publier, envoie
 * l'image (`sendPhoto`), la vidéo (`sendVideo`) ou le texte (`sendMessage`) ; légende de 1 024 caractères au plus,
 * sinon le texte suit en message séparé, en réponse (4 096 au plus). Commentaires : messages du groupe de discussion lié
 * au canal (identifiant `discussionChatId`), lus par `getUpdates` (le bot est membre du groupe, administrateur ou sans
 * mode « privacy »), réponses dans le fil. Mesures : la Bot API ne donne pas les vues d'un message (zéro). Le jeton du
 * bot fait partie de l'adresse de l'API : il n'apparaît jamais dans un message d'erreur ni dans `toJSON`.
 */
import { HttpStatus } from '@nestjs/common';
import type { ContentSpace } from '@neomoov/domain';
import { AppError } from '../../common/app-error.js';
import type { PublishedRef, SocialComment, SocialMetrics, SocialPublishInput, SocialPublishResult, SocialPublisher } from '../marketing.types.js';
import { cleanDetail, socialError } from './oauth.js';

const API = 'https://api.telegram.org';
/** Légende d'une photo ou d'une vidéo, et texte d'un message (règles de Telegram). */
export const TELEGRAM_CAPTION_MAX = 1_024;
export const TELEGRAM_TEXT_MAX = 4_096;

export interface TelegramOptions {
  botToken: string;
  /** Canal : `@nom` public ou identifiant numérique `-100…`. */
  channelId: string;
  /** Groupe de discussion lié au canal (commentaires) ; null : aucun commentaire lu. */
  discussionChatId: string | null;
  fetchImpl?: typeof fetch;
}

interface TgResponse<T> { ok: boolean; result?: T; error_code?: number; description?: string; parameters?: { retry_after?: number } }
interface TgChat { id: number; username?: string; type?: string; title?: string }
interface TgMessage {
  message_id: number;
  date: number;
  chat: TgChat;
  text?: string;
  caption?: string;
  from?: { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string };
  sender_chat?: TgChat;
  is_automatic_forward?: boolean;
  forward_origin?: { type?: string; message_id?: number };
  forward_from_message_id?: number;
  reply_to_message?: TgMessage;
  message_thread_id?: number;
}
interface TgUpdate { update_id: number; message?: TgMessage }

/** Adresse publique d'un message : canal public (`t.me/<nom>/<id>`) ou privé (`t.me/c/<id>/<id>`). */
export function telegramMessageUrl(chat: TgChat, messageId: number): string | null {
  if (chat.username) return `https://t.me/${chat.username}/${messageId}`;
  const id = String(chat.id);
  return id.startsWith('-100') ? `https://t.me/c/${id.slice(4)}/${messageId}` : null;
}

const sameChat = (chat: TgChat, ref: string) => String(chat.id) === ref || (ref.startsWith('@') && chat.username?.toLowerCase() === ref.slice(1).toLowerCase());
/** Publication du canal dont un message du groupe est le transfert automatique (racine du fil des commentaires). */
const originOf = (message: TgMessage | undefined): number | null => (message?.is_automatic_forward ? (message.forward_origin?.message_id ?? message.forward_from_message_id ?? null) : null);

export class TelegramPublisher implements SocialPublisher {
  readonly name = 'telegram';
  readonly configured = true;
  readonly space = 'telegram' as ContentSpace;
  readonly #token: string;
  readonly #fetch: typeof fetch;
  #offset = 0;
  /** Messages du groupe de discussion reçus (`getUpdates` les consomme : gardés en mémoire, 2 000 au plus). */
  readonly #discussion: TgMessage[] = [];
  /** Publication du canal vers la racine de son fil dans le groupe. */
  readonly #threads = new Map<number, number>();

  constructor(private readonly options: TelegramOptions) {
    this.#token = options.botToken;
    this.#fetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  toJSON() {
    return { name: this.name, space: this.space, channelId: this.options.channelId, discussion: Boolean(this.options.discussionChatId), configured: true };
  }

  /** Appel de la Bot API ; une erreur ne montre que la méthode, jamais l'adresse (qui porte le jeton). */
  private async call<T>(method: string, body: Record<string, unknown> | FormData): Promise<T> {
    let response: Response;
    try {
      response = await this.#fetch(`${API}/bot${this.#token}/${method}`, {
        method: 'POST', ...(body instanceof FormData ? { body } : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      throw new AppError('SOCIAL_PROVIDER_ERROR', `Telegram injoignable (${method}) : ${cleanDetail(error instanceof Error ? error.message.split(this.#token).join('***') : 'erreur', 120)}`, HttpStatus.BAD_GATEWAY);
    }
    const data = (await response.json().catch(() => ({ ok: false, description: `HTTP ${response.status}` }))) as TgResponse<T>;
    if (response.ok && data.ok) return data.result as T;
    const status = data.error_code ?? response.status;
    const detail = cleanDetail(data.description).split(this.#token).join('***');
    if (status === 429) throw new AppError('SOCIAL_RATE_LIMITED', `Telegram 429 sur ${method} : ${detail}`, HttpStatus.SERVICE_UNAVAILABLE, { retryAfterSeconds: data.parameters?.retry_after ?? null });
    throw socialError('Telegram', status, `${API}/${method}`, detail);
  }

  private file(media: NonNullable<SocialPublishInput['media']>): Blob {
    return new Blob([new Uint8Array(media.body)], { type: media.contentType });
  }

  /** Image ou vidéo avec sa légende (texte à la suite, en réponse, s'il dépasse 1 024 caractères) ; texte seul sinon. */
  async publish(input: SocialPublishInput): Promise<SocialPublishResult> {
    const text = input.text.trim();
    if (text.length > TELEGRAM_TEXT_MAX) throw new AppError('SOCIAL_VALIDATION_ERROR', `Telegram : ${text.length} caractères, ${TELEGRAM_TEXT_MAX} au plus`, HttpStatus.UNPROCESSABLE_ENTITY);
    const chat = this.options.channelId;
    const media = input.media && /^(image|video)\//.test(input.media.contentType) ? input.media : null;
    let first: TgMessage;
    if (media) {
      const video = media.contentType.startsWith('video/');
      const form = new FormData();
      form.set('chat_id', chat);
      form.set(video ? 'video' : 'photo', this.file(media), `neomoov.${video ? 'mp4' : media.contentType.includes('jpeg') ? 'jpg' : 'png'}`);
      if (text && text.length <= TELEGRAM_CAPTION_MAX) form.set('caption', text);
      if (video) form.set('supports_streaming', 'true');
      first = await this.call<TgMessage>(video ? 'sendVideo' : 'sendPhoto', form);
      if (text.length > TELEGRAM_CAPTION_MAX) await this.call<TgMessage>('sendMessage', { chat_id: chat, text, reply_parameters: { message_id: first.message_id } });
    } else {
      if (!text) throw new AppError('SOCIAL_VALIDATION_ERROR', 'Telegram : texte vide', HttpStatus.UNPROCESSABLE_ENTITY);
      first = await this.call<TgMessage>('sendMessage', { chat_id: chat, text });
    }
    return { externalId: String(first.message_id), url: telegramMessageUrl(first.chat, first.message_id), draft: false };
  }

  /** La Bot API ne donne ni les vues ni les réactions d'un message de canal : mesures nulles. */
  async metrics(): Promise<SocialMetrics> {
    return { reach: 0, interactions: 0, clicks: 0, collectedAt: new Date(), raw: { unavailable: 'bot_api' } };
  }

  /** Nouvelles mises à jour du bot : messages du groupe de discussion gardés, racines des fils notées. */
  private async poll(): Promise<void> {
    const group = this.options.discussionChatId!;
    for (let round = 0; round < 5; round += 1) {
      const updates = await this.call<TgUpdate[]>('getUpdates', { offset: this.#offset, timeout: 0, limit: 100, allowed_updates: ['message'] });
      for (const update of updates) {
        this.#offset = Math.max(this.#offset, update.update_id + 1);
        const message = update.message;
        if (!message || !sameChat(message.chat, group)) continue;
        const origin = originOf(message);
        if (origin) this.#threads.set(origin, message.message_id);
        else this.#discussion.push(message);
        const parentOrigin = originOf(message.reply_to_message);
        if (parentOrigin && message.reply_to_message) this.#threads.set(parentOrigin, message.reply_to_message.message_id);
      }
      if (updates.length < 100) break;
    }
    if (this.#discussion.length > 2_000) this.#discussion.splice(0, this.#discussion.length - 2_000);
  }

  /** Commentaires de la publication (fil du groupe de discussion lié) reçus depuis `since`, hors ceux des bots et du canal. */
  async comments(ref: PublishedRef, since: Date): Promise<SocialComment[]> {
    if (!this.options.discussionChatId) return [];
    await this.poll();
    const root = this.#threads.get(Number(ref.externalId));
    if (!root) return [];
    return this.#discussion
      .filter((m) => (m.reply_to_message?.message_id === root || m.message_thread_id === root) && !m.from?.is_bot && !m.sender_chat && m.date * 1_000 > since.getTime() && (m.text ?? m.caption))
      .map((m) => ({
        externalId: String(m.message_id),
        author: m.from ? (m.from.username ? `@${m.from.username}` : [m.from.first_name, m.from.last_name].filter(Boolean).join(' ') || null) : null,
        text: (m.text ?? m.caption ?? '').slice(0, 4_000),
        postedAt: new Date(m.date * 1_000),
      }));
  }

  /** Réponse du bot dans le fil du groupe de discussion, sous le commentaire. */
  async replyComment(_ref: PublishedRef, commentExternalId: string, text: string): Promise<{ externalId: string }> {
    if (!this.options.discussionChatId) throw new AppError('SOCIAL_UNSUPPORTED', 'Telegram : aucun groupe de discussion lié au canal', HttpStatus.NOT_IMPLEMENTED);
    const sent = await this.call<TgMessage>('sendMessage', { chat_id: this.options.discussionChatId, text: text.slice(0, TELEGRAM_TEXT_MAX), reply_parameters: { message_id: Number(commentExternalId) } });
    return { externalId: String(sent.message_id) };
  }
}
