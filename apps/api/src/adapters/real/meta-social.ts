/**
 * Messages et commentaires des réseaux Meta (boîte unifiée) par l'API Graph, sans SDK : Messenger et Instagram (messages
 * privés par l'API Send, commentaires Facebook et Instagram par les points `/comments` et `/replies`). Même application
 * Meta que WhatsApp : jeton de vérification et secret de signature partagés (`WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`) ;
 * jeton d'accès de la page (`META_PAGE_TOKEN`), page (`META_PAGE_ID`) et compte Instagram professionnel (`META_INSTAGRAM_ID`).
 */
import { timingSafeEqual } from 'node:crypto';
import { AppError } from '../../common/app-error.js';
import { parseMetaWebhook } from '../meta-webhook.js';
import type { SocialInboundComment, SocialInboundMessage, SocialProvider } from '../types.js';
import { whatsappSignature } from './whatsapp-cloud.js';

const GRAPH = 'https://graph.facebook.com/v20.0';

export class MetaSocialProvider implements SocialProvider {
  readonly name = 'meta';
  readonly #token: string;
  readonly #appSecret: string | null;

  constructor(
    token: string,
    private readonly pageId: string,
    private readonly instagramId: string | null,
    private readonly verifyToken: string | null,
    appSecret: string | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.#token = token;
    this.#appSecret = appSecret;
  }

  toJSON() {
    return { name: this.name, configured: true };
  }

  private async graph<T>(method: 'GET' | 'POST', path: string, payload?: Record<string, unknown>, query: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${GRAPH}/${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    url.searchParams.set('access_token', this.#token);
    const res = await this.fetchImpl(url, { method, headers: { 'content-type': 'application/json' }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
    const body = (await res.json().catch(() => ({}))) as T & { error?: { code?: number; message?: string } };
    if (!res.ok) throw new AppError('SOCIAL_PROVIDER_ERROR', `Appel refusé par Meta${body.error?.code ? ` (${body.error.code})` : ''}`, 502, { code: body.error?.code ?? null });
    return body;
  }

  verifyWebhook(query: Record<string, string | undefined>): string | null {
    if (!this.verifyToken || query['hub.mode'] !== 'subscribe' || query['hub.verify_token'] !== this.verifyToken) return null;
    return query['hub.challenge'] ?? null;
  }

  verifySignature(rawBody: string | Buffer, header: string | undefined): boolean {
    if (!this.#appSecret || !header) return false;
    const expected = Buffer.from(whatsappSignature(this.#appSecret, rawBody));
    const given = Buffer.from(header);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  parseWebhook(body: unknown) {
    return parseMetaWebhook(body, [this.pageId, ...(this.instagramId ? [this.instagramId] : [])]);
  }

  /** Rattrapage : conversations de la page (Messenger, puis Instagram) mises à jour depuis `since`, derniers messages des personnes. */
  async listInbound(since: Date): Promise<SocialInboundMessage[]> {
    const out: SocialInboundMessage[] = [];
    for (const platform of ['messenger', 'instagram'] as const) {
      if (platform === 'instagram' && !this.instagramId) continue;
      const data = await this.graph<{ data?: Array<{ updated_time?: string; messages?: { data?: Array<{ id?: string; message?: string; created_time?: string; from?: { id?: string; name?: string; username?: string } }> } }> }>(
        'GET', `${this.pageId}/conversations`, undefined, { platform, fields: 'updated_time,messages.limit(5){id,message,created_time,from}' },
      );
      for (const conversation of data.data ?? []) {
        if (conversation.updated_time && new Date(conversation.updated_time) <= since) continue;
        for (const m of conversation.messages?.data ?? []) {
          const senderId = m.from?.id;
          const receivedAt = m.created_time ? new Date(m.created_time) : new Date();
          if (!m.id || !senderId || !m.message || senderId === this.pageId || senderId === this.instagramId || receivedAt <= since) continue;
          out.push({ network: platform, senderId, senderName: m.from?.name ?? m.from?.username ?? null, messageId: m.id, text: m.message.slice(0, 4_000), receivedAt });
        }
      }
    }
    return out;
  }

  /** Rattrapage : commentaires des publications récentes de la page Facebook et du compte Instagram. */
  async listComments(since: Date): Promise<SocialInboundComment[]> {
    const out: SocialInboundComment[] = [];
    const feed = await this.graph<{ data?: Array<{ id?: string; comments?: { data?: Array<{ id?: string; message?: string; created_time?: string; from?: { id?: string; name?: string } }> } }> }>(
      'GET', `${this.pageId}/feed`, undefined, { fields: 'id,comments.limit(25){id,message,created_time,from}', since: String(Math.floor(since.getTime() / 1000)), limit: '25' },
    );
    for (const post of feed.data ?? []) {
      for (const c of post.comments?.data ?? []) {
        const receivedAt = c.created_time ? new Date(c.created_time) : new Date();
        if (!c.id || !c.message || !c.from?.id || c.from.id === this.pageId || receivedAt <= since) continue;
        out.push({ network: 'facebook', commentId: c.id, postId: post.id ?? null, authorId: c.from.id, authorName: c.from.name ?? null, text: c.message.slice(0, 4_000), receivedAt });
      }
    }
    if (this.instagramId) {
      const media = await this.graph<{ data?: Array<{ id?: string; comments?: { data?: Array<{ id?: string; text?: string; timestamp?: string; from?: { id?: string; username?: string } }> } }> }>(
        'GET', `${this.instagramId}/media`, undefined, { fields: 'id,comments.limit(25){id,text,timestamp,from}', limit: '10' },
      );
      for (const item of media.data ?? []) {
        for (const c of item.comments?.data ?? []) {
          const receivedAt = c.timestamp ? new Date(c.timestamp) : new Date();
          if (!c.id || !c.text || !c.from?.id || c.from.id === this.instagramId || receivedAt <= since) continue;
          out.push({ network: 'instagram', commentId: c.id, postId: item.id ?? null, authorId: c.from.id, authorName: c.from.username ?? null, text: c.text.slice(0, 4_000), receivedAt });
        }
      }
    }
    return out;
  }

  /** Message privé en réponse (fenêtre de 24 heures de Meta : type RESPONSE). */
  async reply(input: { network: 'messenger' | 'instagram'; threadId: string; text: string }): Promise<{ messageId: string }> {
    const body = await this.graph<{ message_id?: string }>('POST', 'me/messages', { recipient: { id: input.threadId }, messaging_type: 'RESPONSE', message: { text: input.text } });
    if (!body.message_id) throw new AppError('SOCIAL_SEND_FAILED', 'Message refusé par Meta', 502);
    return { messageId: body.message_id };
  }

  async replyComment(input: { network: 'facebook' | 'instagram'; commentId: string; text: string }): Promise<{ messageId: string }> {
    const path = input.network === 'instagram' ? `${input.commentId}/replies` : `${input.commentId}/comments`;
    const body = await this.graph<{ id?: string }>('POST', path, { message: input.text });
    if (!body.id) throw new AppError('SOCIAL_SEND_FAILED', 'Réponse au commentaire refusée par Meta', 502);
    return { messageId: body.id };
  }
}
