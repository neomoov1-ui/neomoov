/**
 * Courriels transactionnels réels par Resend (compte 11), par l'API REST sans SDK : expéditeur du domaine vérifié
 * (`EMAIL_FROM`), pièces jointes en base64 (facture, relevé), clé d'idempotence quand l'appelant en donne une.
 */
import { AppError } from '../../common/app-error.js';
import type { EmailProvider } from '../types.js';

const API = 'https://api.resend.com/emails';

export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';
  readonly #apiKey: string;

  constructor(
    apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.#apiKey = apiKey;
  }

  toJSON() {
    return { name: this.name, configured: true };
  }

  async send(input: { to: string; from?: string; replyTo?: string; subject: string; html: string; text?: string; headers?: Record<string, string>; attachments?: Array<{ filename: string; content: Buffer; contentType: string }>; idempotencyKey?: string }): Promise<{ messageId: string }> {
    const res = await this.fetchImpl(API, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.#apiKey}`, 'content-type': 'application/json',
        ...(input.idempotencyKey ? { 'idempotency-key': input.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        // Expéditeur de la marque (étape 22) : son domaine doit être authentifié chez Resend, sinon `EMAIL_FROM`.
        from: input.from ?? this.from, to: [input.to], subject: input.subject, html: input.html, ...(input.text ? { text: input.text } : {}),
        // Boîte unifiée : réponse dans le fil du courriel reçu (In-Reply-To, References) et adresse de réponse (contact@).
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
        ...(input.headers && Object.keys(input.headers).length ? { headers: input.headers } : {}),
        ...(input.attachments?.length ? { attachments: input.attachments.map((a) => ({ filename: a.filename, content: a.content.toString('base64'), content_type: a.contentType })) } : {}),
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; name?: string; message?: string };
    if (!res.ok || !body.id) throw new AppError('EMAIL_SEND_FAILED', `Courriel refusé par Resend${body.name ? ` (${body.name})` : ''}`, 502, { code: body.name ?? null });
    return { messageId: body.id };
  }
}
