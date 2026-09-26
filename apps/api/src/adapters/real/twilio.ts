/**
 * Textos réels par Twilio (décision D50 : Twilio remplace Telnyx, un seul fournisseur pour les textos et la voix), par
 * l'API REST sans SDK. Le suivi de livraison arrive par le webhook de statut (`StatusCallback`), dont la signature
 * `X-Twilio-Signature` est vérifiée en temps constant (HMAC-SHA1 de l'adresse et des paramètres triés).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../common/app-error.js';
import type { SmsDeliveryStatus, SmsProvider } from '../types.js';

const API = 'https://api.twilio.com/2010-04-01';

/** Signature Twilio : adresse complète suivie des paramètres POST triés par nom (nom puis valeur), HMAC-SHA1 en base64. */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params).sort().reduce((acc, key) => acc + key + params[key], url);
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}

export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio';
  readonly #authToken: string;

  constructor(
    private readonly accountSid: string,
    authToken: string,
    private readonly from: string,
    private readonly statusCallbackUrl: string | null = null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.#authToken = authToken;
  }

  toJSON() {
    return { name: this.name, configured: true };
  }

  async send(input: { to: string; body: string; idempotencyKey?: string }): Promise<{ messageId: string }> {
    const form = new URLSearchParams({ To: input.to, From: this.from, Body: input.body });
    if (this.statusCallbackUrl) form.set('StatusCallback', this.statusCallbackUrl);
    const res = await this.fetchImpl(`${API}/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`, {
      method: 'POST',
      headers: { authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.#authToken}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const body = (await res.json().catch(() => ({}))) as { sid?: string; code?: number; message?: string };
    if (!res.ok || !body.sid) throw new AppError('SMS_SEND_FAILED', `Texto refusé par Twilio${body.code ? ` (${body.code})` : ''}`, 502, { code: body.code ?? null });
    return { messageId: body.sid };
  }

  verifyStatusWebhook(input: { url: string; params: Record<string, string>; signature: string }): boolean {
    const expected = Buffer.from(twilioSignature(this.#authToken, input.url, input.params));
    const given = Buffer.from(input.signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  parseInbound(params: Record<string, string>): { from: string; to: string; body: string; messageId: string } | null {
    const { From: from, To: to, Body: body, MessageSid: messageId } = params;
    return from && to && body !== undefined && messageId ? { from, to, body, messageId } : null;
  }

  parseStatus(params: Record<string, string>): SmsDeliveryStatus | null {
    const messageId = params['MessageSid'] ?? params['SmsSid'];
    const status = params['MessageStatus'] ?? params['SmsStatus'];
    if (!messageId || !status) return null;
    const final = status === 'delivered' ? 'delivered' : status === 'failed' || status === 'undelivered' ? 'failed' : 'pending';
    return { messageId, status: final, errorCode: params['ErrorCode'] ?? null };
  }
}
