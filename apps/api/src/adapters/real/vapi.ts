/**
 * Agent vocal réel par Vapi (compte 12, numéro Twilio importé), par l'API REST sans SDK : appels sortants (rappel d'un
 * client, alerte SOS au fondateur) et vérification des messages du serveur : Vapi envoie le secret convenu dans
 * l'en-tête `x-vapi-secret` (comparé en temps constant), puis le message JSON (`tool-calls`, `end-of-call-report`…).
 */
import { timingSafeEqual } from 'node:crypto';
import { AppError } from '../../common/app-error.js';
import type { VoiceProvider } from '../types.js';

const API = 'https://api.vapi.ai';

export class VapiVoiceProvider implements VoiceProvider {
  readonly name = 'vapi';
  readonly #apiKey: string;
  readonly #webhookSecret: string | null;

  constructor(
    apiKey: string,
    webhookSecret: string | null,
    private readonly phoneNumberId: string | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.#apiKey = apiKey;
    this.#webhookSecret = webhookSecret;
  }

  toJSON() {
    return { name: this.name, configured: true };
  }

  async startOutboundCall(input: { to: string; assistantId: string; metadata?: Record<string, string> }): Promise<{ callId: string }> {
    if (!this.phoneNumberId) throw new AppError('VOICE_NOT_CONFIGURED', 'Numéro Vapi absent (VAPI_PHONE_NUMBER_ID)', 501);
    const res = await this.fetchImpl(`${API}/call`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.#apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ assistantId: input.assistantId, phoneNumberId: this.phoneNumberId, customer: { number: input.to }, ...(input.metadata ? { metadata: input.metadata } : {}) }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok || !body.id) throw new AppError('VOICE_CALL_FAILED', 'Appel refusé par Vapi', 502);
    return { callId: body.id };
  }

  async verifyWebhook(rawBody: string | Buffer, signature: string): Promise<{ type: string; payload: unknown }> {
    if (!this.#webhookSecret) throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Secret du webhook Vapi absent (VAPI_WEBHOOK_SECRET)', 400);
    const expected = Buffer.from(this.#webhookSecret);
    const given = Buffer.from(signature ?? '');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Signature de webhook invalide', 400);
    const body = JSON.parse(rawBody.toString()) as { message?: { type?: string } };
    return { type: body.message?.type ?? 'unknown', payload: body.message ?? body };
  }
}
