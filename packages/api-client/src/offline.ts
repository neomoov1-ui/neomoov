/**
 * File hors ligne (prompt 10, tâche 1) : une écriture sans conséquence immédiate (évaluation, message) faite sans
 * réseau est gardée puis rejouée au retour de la connexion, dans l'ordre. Seules les pannes réseau (`status` 0) sont
 * mises en file ; une erreur de l'API (400, 409…) est rendue à l'appelant, rien n'est retenté. Chaque écriture porte
 * une clé d'idempotence stable : un rejeu après une réponse perdue ne crée pas de doublon.
 */
import type { ApiClient, HttpMethod } from './client.js';
import { ApiError } from './errors.js';

/** Stockage persistant de l'application (SecureStore ou AsyncStorage sur mobile, localStorage sur le web). */
export interface OfflineStorage {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
}

export interface QueuedWrite {
  id: string;
  method: Exclude<HttpMethod, 'GET'>;
  path: string;
  body?: unknown;
  idempotencyKey: string;
  queuedAt: string;
  attempts: number;
}

export type EnqueueResult<T> = { status: 'sent'; result: T } | { status: 'queued'; write: QueuedWrite };

const DEFAULT_KEY = 'neomoov.offline-queue';

function randomId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export class OfflineQueue {
  private flushing: Promise<{ sent: number; remaining: number; dropped: number }> | null = null;

  constructor(
    private readonly client: ApiClient,
    private readonly storage: OfflineStorage,
    private readonly options: { key?: string; maxItems?: number; maxAttempts?: number } = {},
  ) {}

  private get key(): string {
    return this.options.key ?? DEFAULT_KEY;
  }

  async pending(): Promise<QueuedWrite[]> {
    const raw = await this.storage.getItem(this.key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as QueuedWrite[]) : [];
    } catch {
      return [];
    }
  }

  private async save(items: QueuedWrite[]): Promise<void> {
    await this.storage.setItem(this.key, JSON.stringify(items));
  }

  /** Envoie tout de suite ; sur panne réseau, garde l'écriture pour plus tard au lieu d'échouer. */
  async send<T>(method: QueuedWrite['method'], path: string, body?: unknown): Promise<EnqueueResult<T>> {
    const idempotencyKey = randomId();
    try {
      const result = await this.client.request<T>(method, path, { body, idempotencyKey });
      return { status: 'sent', result };
    } catch (error) {
      if (!(error instanceof ApiError) || !error.isNetwork) throw error;
      const write: QueuedWrite = { id: randomId(), method, path, body, idempotencyKey, queuedAt: new Date().toISOString(), attempts: 1 };
      const items = [...(await this.pending()), write].slice(-(this.options.maxItems ?? 100));
      await this.save(items);
      return { status: 'queued', write };
    }
  }

  /**
   * Rejoue la file dans l'ordre. S'arrête à la première panne réseau ou erreur serveur (5xx, passagère) ; une écriture
   * refusée par l'API (4xx) ou tentée trop souvent est abandonnée pour ne pas bloquer les suivantes.
   */
  flush(): Promise<{ sent: number; remaining: number; dropped: number }> {
    this.flushing ??= this.flushOnce().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async flushOnce(): Promise<{ sent: number; remaining: number; dropped: number }> {
    const items = await this.pending();
    let sent = 0;
    let dropped = 0;
    const maxAttempts = this.options.maxAttempts ?? 20;
    while (items.length) {
      const write = items[0]!;
      try {
        await this.client.request(write.method, write.path, { body: write.body, idempotencyKey: write.idempotencyKey });
        items.shift();
        sent += 1;
      } catch (error) {
        if (error instanceof ApiError && (error.isNetwork || error.status >= 500)) {
          write.attempts += 1;
          if (write.attempts > maxAttempts) {
            items.shift();
            dropped += 1;
            continue;
          }
          break;
        }
        // Refus définitif de l'API (course close, validation) : l'écriture ne passera pas en la rejouant telle quelle.
        items.shift();
        dropped += 1;
      }
    }
    await this.save(items);
    return { sent, remaining: items.length, dropped };
  }
}
