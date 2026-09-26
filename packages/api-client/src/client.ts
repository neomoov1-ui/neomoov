import { ApiError } from './errors.js';
import { adminResource, publicResource, staffAuthResource } from './admin-resources.js';
import { invoicingResource } from './invoicing-resources.js';
import { ledgersResource } from './ledger-resources.js';
import { authResource, configResource, driverResource, meResource, paymentsResource, placesResource, quotesResource, ridesResource } from './resources.js';
import type { HealthReport } from './types.js';

export type Language = 'fr-CA' | 'en';
export type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue | QueryValue[]>;
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Source des jetons. L'application décide où ils vivent (SecureStore sur mobile, cookie ou mémoire sur le web) ;
 * le client ne les stocke jamais lui-même.
 */
export interface TokenProvider {
  /** Jeton d'accès courant, ou null si personne n'est connecté. */
  getAccessToken(): string | null | undefined | Promise<string | null | undefined>;
  /** Rafraîchit la session ; renvoie le nouveau jeton d'accès, ou null si la session est perdue. */
  refresh?: () => Promise<string | null | undefined>;
}

export interface ApiClientOptions {
  /** Adresse de l'API sans le préfixe `/v1`, par exemple `https://api.neomoov.net`. */
  baseUrl: string;
  /** Implémentation de `fetch` (celle de la plateforme par défaut). */
  fetch?: typeof fetch;
  tokens?: TokenProvider;
  /** Langue envoyée dans `Accept-Language` (`fr-CA` ou `en`), fixe ou lue à chaque requête. */
  language?: Language | (() => Language);
  /** Délai maximal d'une requête, en millisecondes (15 000 par défaut). */
  timeoutMs?: number;
  /** En-têtes ajoutés à chaque requête (version de l'application, plateforme). */
  headers?: Record<string, string>;
  /** Appelé quand la session est définitivement perdue : 401 malgré un rafraîchissement. */
  onUnauthorized?: (error: ApiError) => void;
  /**
   * Générateur d'identifiant de corrélation (UUID par défaut) : un par appel, envoyé dans `X-Correlation-Id`, repris par
   * l'API dans ses journaux et ses tâches, et gardé par `ApiError` pour le signaler à l'assistance ou au suivi des erreurs.
   */
  correlationId?: () => string;
}

export interface RequestOptions {
  query?: Query | undefined;
  body?: unknown;
  headers?: Record<string, string> | undefined;
  signal?: AbortSignal | undefined;
  /** Joint le jeton d'accès s'il existe (vrai par défaut). */
  auth?: boolean | undefined;
  timeoutMs?: number | undefined;
  /** Clé d'idempotence des écritures rejouables (création de course, paiement). */
  idempotencyKey?: string | undefined;
}

const API_PREFIX = '/v1';
const DEFAULT_TIMEOUT_MS = 15_000;

function randomId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Client HTTP de l'API Neomoov, partagé par le web et les deux applications mobiles.
 * Il ajoute le préfixe `/v1`, la langue, le jeton d'accès, un identifiant de corrélation et un délai maximal ;
 * il rejoue une fois la requête après rafraîchissement du jeton sur 401 ; il convertit toute réponse d'erreur
 * en `ApiError` avec le code stable de l'API.
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  /** Rafraîchissement en cours, partagé par toutes les requêtes qui reçoivent 401 en même temps. */
  private refreshing: Promise<string | null | undefined> | null = null;

  constructor(private readonly options: ApiClientOptions) {
    const impl = options.fetch ?? globalThis.fetch;
    if (typeof impl !== 'function') throw new Error('fetch indisponible : fournir options.fetch');
    // Le `fetch` des navigateurs exige d'être appelé sur l'objet global (sinon « Illegal invocation ») : jamais comme
    // méthode du client.
    this.fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => impl.call(globalThis, input, init)) as typeof fetch;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
  }

  /** Adresse complète d'un chemin de l'API : `/health` devient `<base>/v1/health`. */
  url(path: string, query?: Query): string {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    const params = new URLSearchParams();
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        const values = Array.isArray(value) ? value : [value];
        for (const item of values) if (item !== null && item !== undefined) params.append(key, String(item));
      }
    }
    const qs = params.toString();
    return `${this.baseUrl}${API_PREFIX}${normalized}${qs ? `?${qs}` : ''}`;
  }

  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, options);
  }

  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, { ...options, body });
  }

  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PUT', path, { ...options, body });
  }

  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PATCH', path, { ...options, body });
  }

  delete<T = void>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, options);
  }

  readonly auth = authResource(this);
  readonly config = configResource(this);
  readonly me = meResource(this);
  readonly places = placesResource(this);
  readonly quotes = quotesResource(this);
  readonly rides = ridesResource(this);
  readonly driver = driverResource(this);
  readonly payments = paymentsResource(this);
  readonly staffAuth = staffAuthResource(this);
  readonly admin = adminResource(this);
  /** Registres de la redevance et des taxes, exports comptables et de géolocalisation (étape 9). */
  readonly ledgers = ledgersResource(this);
  readonly public = publicResource(this);
  /** Facturation certifiée (étape 9) : factures, PDF, vérification publique, SEV. */
  readonly invoicing = invoicingResource(this);

  /** Santé de l'API : base, Redis, files (`GET /v1/health`). */
  readonly health = {
    get: (options?: RequestOptions): Promise<HealthReport> => this.get<HealthReport>('/health', options),
  };

  async request<T>(method: HttpMethod, path: string, requestOptions: RequestOptions = {}): Promise<T> {
    // Un identifiant de corrélation par appel, le même pour la nouvelle tentative après rafraîchissement du jeton.
    const correlationId = requestOptions.headers?.['x-correlation-id'] ?? this.options.headers?.['x-correlation-id'] ?? (this.options.correlationId ?? randomId)();
    const options: RequestOptions = { ...requestOptions, headers: { ...requestOptions.headers, 'x-correlation-id': correlationId } };
    const useAuth = options.auth !== false;
    const token = useAuth ? await this.options.tokens?.getAccessToken() : undefined;
    const first = await this.send(method, path, options, token ?? undefined);
    if (first.status !== 401 || !useAuth || !this.options.tokens?.refresh) return this.unwrap<T>(first);

    let renewed: string | null | undefined;
    try {
      renewed = await this.refreshOnce(this.options.tokens.refresh);
    } catch (error) {
      // Panne réseau pendant le rafraîchissement : la session n'est pas perdue, l'appelant réessaiera.
      if (error instanceof ApiError && error.isNetwork) throw error;
      renewed = null;
    }
    if (!renewed) return this.unauthorized(first);
    const second = await this.send(method, path, options, renewed);
    if (second.status === 401) return this.unauthorized(second);
    return this.unwrap<T>(second);
  }

  /** Un seul rafraîchissement à la fois : N requêtes parallèles en 401 attendent la même promesse (rotation des jetons). */
  private refreshOnce(refresh: NonNullable<TokenProvider['refresh']>): Promise<string | null | undefined> {
    if (!this.refreshing) {
      this.refreshing = Promise.resolve()
        .then(refresh)
        .finally(() => {
          this.refreshing = null;
        });
    }
    return this.refreshing;
  }

  private async unauthorized(response: Response): Promise<never> {
    const error = await this.toError(response);
    this.options.onUnauthorized?.(error);
    throw error;
  }

  private async send(method: HttpMethod, path: string, options: RequestOptions, token?: string): Promise<Response> {
    const headers: Record<string, string> = { accept: 'application/json', ...this.options.headers, ...options.headers };
    const language = typeof this.options.language === 'function' ? this.options.language() : this.options.language;
    if (language) headers['accept-language'] = language;
    if (token) headers['authorization'] = `Bearer ${token}`;
    headers['x-correlation-id'] ??= (this.options.correlationId ?? randomId)();
    if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

    const init: RequestInit = { method, headers };
    if (typeof FormData !== 'undefined' && options.body instanceof FormData) {
      // Formulaire (téléversement de documents) : le navigateur ou React Native fixe lui-même la frontière multipart.
      init.body = options.body;
    } else if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }

    const controller = new AbortController();
    init.signal = controller.signal;
    const timeoutMs = options.timeoutMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      return await this.fetchImpl(this.url(path, options.query), init);
    } catch (cause) {
      const correlationId = headers['x-correlation-id'];
      if (timedOut) throw new ApiError(0, 'TIMEOUT', `Délai de ${timeoutMs} ms dépassé (${method} ${path})`, undefined, correlationId);
      if (options.signal?.aborted) throw new ApiError(0, 'ABORTED', `Requête annulée (${method} ${path})`, undefined, correlationId);
      const message = cause instanceof Error && cause.message ? cause.message : 'Erreur réseau';
      throw new ApiError(0, 'NETWORK_ERROR', message, undefined, correlationId);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  private async unwrap<T>(response: Response): Promise<T> {
    if (!response.ok) throw await this.toError(response);
    if (response.status === 204) return undefined as T;
    const type = response.headers.get('content-type') ?? '';
    if (type.includes('json')) return (await response.json()) as T;
    return (await response.text()) as unknown as T;
  }

  private async toError(response: Response): Promise<ApiError> {
    const correlationId = response.headers.get('x-correlation-id') ?? undefined;
    let body: unknown;
    try {
      const text = await response.text();
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    return ApiError.fromBody(response.status, body, correlationId);
  }
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  return new ApiClient(options);
}
