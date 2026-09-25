/**
 * File hors ligne (prompt 10, tâche 1) : une écriture sans conséquence immédiate (évaluation, message) faite sans
 * réseau est gardée puis rejouée au retour de la connexion, dans l'ordre. Seule une requête qui n'a pas pu partir
 * (`NETWORK_ERROR`) est mise en file : après un délai dépassé, l'API a pu la traiter, la rejouer créerait un doublon ;
 * l'erreur est alors rendue à l'appelant. Au rejeu, une panne réseau, une erreur serveur (5xx) ou un refus passager
 * (401 pendant un rafraîchissement, 408, 429) arrête la passe et garde l'écriture ; un refus définitif (autre 4xx)
 * l'abandonne pour ne pas bloquer les suivantes. Chaque écriture garde sa clé d'idempotence pour les routes qui la
 * prennent en charge.
 */
import type { ApiClient, HttpMethod } from './client.js';
import { ApiError } from './errors.js';

/** Stockage persistant de l'application (SecureStore sur mobile, localStorage sur le web). */
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

export interface FlushReport {
  sent: number;
  remaining: number;
  dropped: number;
}

const DEFAULT_KEY = 'neomoov.offline-queue';

function randomId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Échec passager : la même écriture passera plus tard telle quelle. */
function retryable(error: unknown): boolean {
  return error instanceof ApiError && (error.isNetwork || error.status >= 500 || error.status === 401 || error.status === 408 || error.status === 429);
}

export class OfflineQueue {
  private chain: Promise<unknown> = Promise.resolve();
  private flushing: Promise<FlushReport> | null = null;

  constructor(
    private readonly client: ApiClient,
    private readonly storage: OfflineStorage,
    private readonly options: { key?: string; maxItems?: number; maxAttempts?: number } = {},
  ) {}

  private get key(): string {
    return this.options.key ?? DEFAULT_KEY;
  }

  /** Lectures et écritures du stockage une à la fois : une écriture ajoutée pendant un rejeu n'est jamais écrasée. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
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

  /** Vide la file (déconnexion, suppression du compte) : rien ne sera rejoué pour un autre utilisateur. */
  clear(): Promise<void> {
    return this.exclusive(() => this.save([]));
  }

  /** Envoie tout de suite ; si la requête n'a pas pu partir faute de réseau, la garde pour plus tard au lieu d'échouer. */
  async send<T>(method: QueuedWrite['method'], path: string, body?: unknown): Promise<EnqueueResult<T>> {
    const idempotencyKey = randomId();
    try {
      const result = await this.client.request<T>(method, path, { body, idempotencyKey });
      return { status: 'sent', result };
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'NETWORK_ERROR') throw error;
      const write: QueuedWrite = { id: randomId(), method, path, body, idempotencyKey, queuedAt: new Date().toISOString(), attempts: 1 };
      await this.exclusive(async () => this.save([...(await this.pending()), write].slice(-(this.options.maxItems ?? 100))));
      return { status: 'queued', write };
    }
  }

  /** Rejoue la file dans l'ordre (une seule passe à la fois). */
  flush(): Promise<FlushReport> {
    this.flushing ??= this.flushOnce().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async flushOnce(): Promise<FlushReport> {
    const snapshot = await this.exclusive(() => this.pending());
    const done = new Set<string>();
    const attempts = new Map<string, number>();
    const maxAttempts = this.options.maxAttempts ?? 20;
    let sent = 0;
    let dropped = 0;
    for (const write of snapshot) {
      try {
        await this.client.request(write.method, write.path, { body: write.body, idempotencyKey: write.idempotencyKey });
        done.add(write.id);
        sent += 1;
      } catch (error) {
        if (retryable(error)) {
          const next = write.attempts + 1;
          if (next <= maxAttempts) {
            attempts.set(write.id, next);
            break;
          }
        }
        done.add(write.id);
        dropped += 1;
      }
    }
    // Fusion avec l'état courant : ce qui a été ajouté pendant la passe reste en file.
    const remaining = await this.exclusive(async () => {
      const items = (await this.pending()).filter((w) => !done.has(w.id)).map((w) => (attempts.has(w.id) ? { ...w, attempts: attempts.get(w.id)! } : w));
      await this.save(items);
      return items.length;
    });
    return { sent, remaining, dropped };
  }
}
