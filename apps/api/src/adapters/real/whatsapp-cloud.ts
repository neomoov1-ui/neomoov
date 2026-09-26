/**
 * WhatsApp Business réel par l'API Cloud de Meta (compte 13), par l'API Graph sans SDK : messages de session (texte)
 * et gabarits approuvés (hors fenêtre de 24 heures), vérification de l'abonnement au webhook (jeton de vérification)
 * et de chaque appel (`X-Hub-Signature-256`, HMAC-SHA256 du corps brut avec le secret de l'application).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../common/app-error.js';
import type { WhatsAppInbound, WhatsAppProvider } from '../types.js';

const GRAPH = 'https://graph.facebook.com/v20.0';

export function whatsappSignature(appSecret: string, rawBody: string | Buffer): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}

export class WhatsAppCloudProvider implements WhatsAppProvider {
  readonly name = 'meta-whatsapp';
  readonly #token: string;
  readonly #appSecret: string | null;

  constructor(
    token: string,
    private readonly phoneNumberId: string,
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

  private async post(payload: Record<string, unknown>): Promise<{ messageId: string }> {
    const res = await this.fetchImpl(`${GRAPH}/${encodeURIComponent(this.phoneNumberId)}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.#token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
    });
    const body = (await res.json().catch(() => ({}))) as { messages?: Array<{ id?: string }>; error?: { code?: number; message?: string } };
    const id = body.messages?.[0]?.id;
    if (!res.ok || !id) throw new AppError('WHATSAPP_SEND_FAILED', `Message WhatsApp refusé par Meta${body.error?.code ? ` (${body.error.code})` : ''}`, 502, { code: body.error?.code ?? null });
    return { messageId: id };
  }

  sendText(input: { to: string; text: string }): Promise<{ messageId: string }> {
    return this.post({ to: input.to.replace(/^\+/, ''), type: 'text', text: { body: input.text, preview_url: true } });
  }

  sendTemplate(input: { to: string; template: string; language: string; parameters: string[] }): Promise<{ messageId: string }> {
    return this.post({
      to: input.to.replace(/^\+/, ''), type: 'template',
      template: { name: input.template, language: { code: input.language }, components: input.parameters.length ? [{ type: 'body', parameters: input.parameters.map((text) => ({ type: 'text', text })) }] : [] },
    });
  }

  /** Abonnement du webhook : `hub.mode=subscribe` et le jeton de vérification convenu ; renvoie le défi à retourner. */
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

  /** Messages texte entrants (les autres types sont ignorés en V1) ; numéros rendus au format E.164. */
  parseInbound(body: unknown): WhatsAppInbound[] {
    const entries = (body as { entry?: Array<{ changes?: Array<{ value?: { messages?: Array<{ from?: string; id?: string; timestamp?: string; type?: string; text?: { body?: string } }> } }> }> })?.entry ?? [];
    const out: WhatsAppInbound[] = [];
    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        for (const m of change.value?.messages ?? []) {
          if (m.type !== 'text' || !m.from || !m.id || !m.text?.body) continue;
          out.push({ from: `+${m.from.replace(/^\+/, '')}`, text: m.text.body, messageId: m.id, timestamp: new Date(Number(m.timestamp ?? 0) * 1000 || Date.now()) });
        }
      }
    }
    return out;
  }
}
