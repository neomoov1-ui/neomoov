/**
 * Notifications push réelles par le service Expo (applications Expo, iOS et Android), par l'API HTTP sans SDK : envoi
 * par lots de 100 jetons, un ticket par jeton, puis reçus de livraison (`getReceipts`) consultés plus tard. Un jeton
 * `DeviceNotRegistered` est signalé pour que l'appareil soit retiré.
 */
import { AppError } from '../../common/app-error.js';
import type { PushProvider, PushReceipt, PushTicket } from '../types.js';

const API = 'https://exp.host/--/api/v2/push';
const BATCH = 100;

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

export class ExpoPushProvider implements PushProvider {
  readonly name = 'expo-push';
  readonly #accessToken: string | null;

  constructor(
    accessToken: string | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.#accessToken = accessToken;
  }

  toJSON() {
    return { name: this.name, configured: true };
  }

  private headers(): Record<string, string> {
    return { accept: 'application/json', 'content-type': 'application/json', ...(this.#accessToken ? { authorization: `Bearer ${this.#accessToken}` } : {}) };
  }

  async send(input: { tokens: string[]; title: string; body: string; data?: Record<string, string>; sound?: boolean }): Promise<{ tickets: PushTicket[] }> {
    const tickets: PushTicket[] = [];
    for (let i = 0; i < input.tokens.length; i += BATCH) {
      const batch = input.tokens.slice(i, i + BATCH);
      const res = await this.fetchImpl(`${API}/send`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(batch.map((to) => ({ to, title: input.title, body: input.body, ...(input.data ? { data: input.data } : {}), sound: input.sound === false ? null : 'default', priority: 'high' }))),
      });
      const body = (await res.json().catch(() => ({}))) as { data?: ExpoTicket[]; errors?: Array<{ code?: string; message?: string }> };
      if (!res.ok || !Array.isArray(body.data)) throw new AppError('PUSH_SEND_FAILED', `Envoi push refusé par Expo${body.errors?.[0]?.code ? ` (${body.errors[0].code})` : ''}`, 502);
      body.data.forEach((ticket, index) => {
        tickets.push({
          token: batch[index]!, status: ticket.status, ...(ticket.id ? { ticketId: ticket.id } : {}),
          ...(ticket.status === 'error' ? { detail: ticket.details?.error ?? ticket.message ?? 'error' } : {}),
        });
      });
    }
    return { tickets };
  }

  async receipts(ticketIds: string[]): Promise<PushReceipt[]> {
    const receipts: PushReceipt[] = [];
    for (let i = 0; i < ticketIds.length; i += 300) {
      const ids = ticketIds.slice(i, i + 300);
      const res = await this.fetchImpl(`${API}/getReceipts`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ ids }) });
      const body = (await res.json().catch(() => ({}))) as { data?: Record<string, ExpoTicket> };
      if (!res.ok || !body.data) throw new AppError('PUSH_RECEIPTS_FAILED', 'Reçus push indisponibles chez Expo', 502);
      for (const [ticketId, r] of Object.entries(body.data)) {
        receipts.push({ ticketId, status: r.status, ...(r.status === 'error' ? { detail: r.details?.error ?? r.message ?? 'error' } : {}) });
      }
    }
    return receipts;
  }
}
