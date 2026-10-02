/**
 * Administration de Vapi par l'API REST (compte 12), pour le script `vapi:setup` : assistants (création, mise à jour)
 * et numéros importés (rattachement d'un assistant). Sans SDK. La clé privée n'apparaît ni dans les journaux ni dans
 * `toJSON` ; les erreurs de Vapi (validation, 4xx) sont rendues avec leur message pour corriger la configuration.
 */
import { AppError } from '../../common/app-error.js';

const API = 'https://api.vapi.ai';

export interface VapiAssistantSummary {
  id: string;
  name?: string | null;
}

export interface VapiPhoneNumberSummary {
  id: string;
  number?: string | null;
  name?: string | null;
  provider?: string | null;
  assistantId?: string | null;
}

export class VapiAdminClient {
  readonly #apiKey: string;

  constructor(
    apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly base: string = API,
  ) {
    this.#apiKey = apiKey;
  }

  toJSON() {
    return { name: 'vapi-admin', configured: true };
  }

  private async request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.#apiKey}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const detail = (json as { message?: string | string[] } | null)?.message;
      const message = Array.isArray(detail) ? detail.join(' ; ') : typeof detail === 'string' ? detail : text.slice(0, 300);
      throw new AppError('VAPI_REQUEST_FAILED', `Vapi a refusé ${method} ${path} (${res.status})${message ? ` : ${message}` : ''}`, 502, { status: res.status, message });
    }
    return json as T;
  }

  listAssistants(): Promise<VapiAssistantSummary[]> {
    return this.request<VapiAssistantSummary[]>('GET', '/assistant?limit=100');
  }

  createAssistant(body: Record<string, unknown>): Promise<VapiAssistantSummary> {
    return this.request<VapiAssistantSummary>('POST', '/assistant', body);
  }

  updateAssistant(id: string, body: Record<string, unknown>): Promise<VapiAssistantSummary> {
    return this.request<VapiAssistantSummary>('PATCH', `/assistant/${encodeURIComponent(id)}`, body);
  }

  listPhoneNumbers(): Promise<VapiPhoneNumberSummary[]> {
    return this.request<VapiPhoneNumberSummary[]>('GET', '/phone-number?limit=100');
  }

  updatePhoneNumber(id: string, body: Record<string, unknown>): Promise<VapiPhoneNumberSummary> {
    return this.request<VapiPhoneNumberSummary>('PATCH', `/phone-number/${encodeURIComponent(id)}`, body);
  }
}
