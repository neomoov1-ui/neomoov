/**
 * Socle des connecteurs de diffusion à jeton OAuth 2.0 (Fiche Google, YouTube, LinkedIn, X, TikTok ; 3 octobre 2026) :
 * échange du jeton de rafraîchissement contre un jeton d'accès, gardé en mémoire jusqu'à une minute de son échéance (un
 * seul échange à la fois) ; chez X et TikTok, le jeton de rafraîchissement change à chaque échange : le dernier est gardé
 * chiffré dans la base (`OAuthTokenStore`, `oauth-store.ts`) pour survivre à un redémarrage et servir l'API comme le
 * worker. Appels HTTP avec erreurs typées (`AppError`) qui alimentent les nouvelles tentatives de la diffusion : jeton
 * refusé (401, un nouvel échange puis un seul nouvel essai), limite atteinte (429, délai rendu dans `details`), requête
 * refusée (400, 422), droits manquants (403), panne (5xx). Aucun jeton dans les messages, les détails ni `toJSON`.
 */
import { createHash } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../common/app-error.js';
import type { CredentialStatus } from '../marketing.types.js';

export const OAUTH_PROVIDERS = ['google-business', 'youtube', 'linkedin', 'x', 'tiktok'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

/** État conservé d'une autorisation (chiffré par le magasin de la base). */
export interface StoredOAuthTokens {
  /** Empreinte du jeton de rafraîchissement posé dans l'environnement : une nouvelle autorisation remplace l'état gardé. */
  origin: string;
  refreshToken: string;
  refreshExpiresAt: number | null;
  accessToken: string | null;
  accessExpiresAt: number | null;
}

export interface OAuthTokenStore {
  load(provider: OAuthProvider): Promise<StoredOAuthTokens | null>;
  save(provider: OAuthProvider, tokens: StoredOAuthTokens): Promise<void>;
}

/** Magasin en mémoire (tests, poste sans `ENCRYPTION_KEY`) : un redémarrage repart du jeton de l'environnement. */
export class MemoryTokenStore implements OAuthTokenStore {
  readonly #tokens = new Map<OAuthProvider, StoredOAuthTokens>();
  async load(provider: OAuthProvider): Promise<StoredOAuthTokens | null> {
    const stored = this.#tokens.get(provider);
    return stored ? { ...stored } : null;
  }
  async save(provider: OAuthProvider, tokens: StoredOAuthTokens): Promise<void> {
    this.#tokens.set(provider, { ...tokens });
  }
  toJSON() {
    return { name: 'memory', providers: [...this.#tokens.keys()] };
  }
}

/** Empreinte courte (non réversible) d'un jeton, pour reconnaître l'autorisation d'origine sans la garder en clair. */
export function tokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

export interface OAuthSessionOptions {
  provider: OAuthProvider;
  /** Nom affiché dans les messages (« LinkedIn »). */
  label: string;
  tokenUrl: string;
  clientId: string | null;
  clientSecret: string | null;
  refreshToken: string | null;
  /** Jeton d'accès posé à la main (LinkedIn sans jeton de rafraîchissement) et son échéance si elle est connue. */
  accessToken?: string | null;
  accessExpiresAt?: number | null;
  /** Identifiants du client : dans le corps (Google, LinkedIn), en Basic (X), `client_key` (TikTok). */
  clientAuth: 'body' | 'basic' | 'tiktok';
  /** Jeton de rafraîchissement remplacé à chaque échange (X, TikTok) : le dernier est gardé dans le magasin. */
  rotates?: boolean;
  store?: OAuthTokenStore | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  refresh_token?: string;
  /** LinkedIn. */
  refresh_token_expires_in?: number | string;
  /** TikTok. */
  refresh_expires_in?: number | string;
  error?: string | { code?: string; message?: string };
  error_description?: string;
}

const seconds = (value: number | string | undefined): number | null => {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
};

/** Texte d'erreur sans retour à la ligne, borné ; jamais un jeton (les réponses des fournisseurs n'en renvoient pas en erreur). */
export function cleanDetail(detail: string | null | undefined, max = 200): string {
  return (detail ?? '').replace(/\s+/g, ' ').trim().slice(0, max) || 'sans détail';
}

/**
 * Session OAuth d'un réseau : jeton d'accès en cache, échange du jeton de rafraîchissement, conservation du jeton renouvelé.
 * Les secrets restent dans des champs privés ; `toJSON` n'en montre aucun.
 */
export class OAuthSession {
  readonly #options: OAuthSessionOptions;
  readonly #fetch: typeof fetch;
  readonly #origin: string | null;
  #access: { value: string; expiresAt: number | null } | null;
  #refresh: { value: string; expiresAt: number | null } | null;
  #pending: Promise<string> | null = null;
  #loaded = false;
  #problem: string | null = null;

  constructor(options: OAuthSessionOptions) {
    this.#options = options;
    this.#fetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.#access = options.accessToken ? { value: options.accessToken, expiresAt: options.accessExpiresAt ?? null } : null;
    this.#refresh = options.refreshToken ? { value: options.refreshToken, expiresAt: null } : null;
    this.#origin = options.refreshToken ? tokenFingerprint(options.refreshToken) : null;
  }

  get provider(): OAuthProvider {
    return this.#options.provider;
  }

  get label(): string {
    return this.#options.label;
  }

  /** Jeton de rafraîchissement présent : le jeton d'accès se renouvelle seul. */
  get renewable(): boolean {
    return this.#refresh !== null;
  }

  toJSON() {
    return { provider: this.#options.provider, renewable: this.renewable, rotates: Boolean(this.#options.rotates) };
  }

  private now(): number {
    return this.#options.now?.() ?? Date.now();
  }

  private fresh(token: { expiresAt: number | null } | null): boolean {
    return token !== null && (token.expiresAt === null || token.expiresAt > this.now() + 60_000);
  }

  /** Jeton d'accès valable encore une minute au moins ; sinon un échange (un seul à la fois pour la session). */
  async accessToken(): Promise<string> {
    if (!this.#loaded) await this.adoptStored();
    // Un jeton renouvelé a toujours une échéance ; un jeton posé à la main sans échéance connue sert jusqu'à son refus (401).
    if (this.#access && this.fresh(this.#access) && (this.#access.expiresAt !== null || !this.#refresh)) return this.#access.value;
    if (!this.#refresh) {
      throw new AppError('SOCIAL_AUTH_EXPIRED', `${this.label} : jeton d'accès expiré et aucun jeton de rafraîchissement, nouvelle autorisation à faire (docs/marketing/connecteurs.md)`, HttpStatus.BAD_GATEWAY, { provider: this.provider });
    }
    this.#pending ??= this.refresh(false).finally(() => {
      this.#pending = null;
    });
    return this.#pending;
  }

  /** Jeton refusé par l'API (401) : vrai si un nouvel échange est possible (le prochain appel l'obtient). */
  invalidate(): boolean {
    if (!this.#refresh) return false;
    this.#access = null;
    return true;
  }

  /** État de l'autorisation (échange tenté si le jeton d'accès est échu, pour révéler un jeton révoqué). */
  async credentials(): Promise<CredentialStatus> {
    let problem: string | null = null;
    try {
      await this.accessToken();
    } catch (error) {
      problem = error instanceof Error ? cleanDetail(error.message, 300) : 'échange du jeton impossible';
    }
    const renewBy = this.#refresh ? this.#refresh.expiresAt : (this.#access?.expiresAt ?? null);
    return { renewable: this.renewable, renewBy: renewBy ? new Date(renewBy) : null, problem: problem ?? this.#problem };
  }

  /** Reprend l'état gardé par le magasin s'il vient de la même autorisation (jeton renouvelé par un autre processus). */
  private async adoptStored(): Promise<void> {
    this.#loaded = true;
    const store = this.#options.store;
    if (!store || !this.#origin) return;
    const stored = await store.load(this.provider).catch(() => null);
    if (!stored || stored.origin !== this.#origin || !stored.refreshToken) return;
    this.#refresh = { value: stored.refreshToken, expiresAt: stored.refreshExpiresAt };
    if (stored.accessToken && stored.accessExpiresAt && (!this.#access?.expiresAt || stored.accessExpiresAt > this.#access.expiresAt)) {
      this.#access = { value: stored.accessToken, expiresAt: stored.accessExpiresAt };
    }
  }

  private async refresh(retried: boolean): Promise<string> {
    if (this.#options.rotates) {
      // Un autre processus (API ou worker) a pu renouveler le jeton : on part du dernier gardé.
      await this.adoptStored();
      if (this.#access && this.#access.expiresAt !== null && this.fresh(this.#access)) return this.#access.value;
    }
    const used = this.#refresh!.value;
    const { ok, body, status } = await this.exchange(used);
    if (!ok || !body.access_token) {
      if (!retried && this.#options.rotates && this.#options.store) {
        // Jeton déjà consommé par l'autre processus : relecture du magasin, puis un seul nouvel essai.
        await this.adoptStored();
        if (this.#refresh && this.#refresh.value !== used) return this.refresh(true);
      }
      const code = typeof body.error === 'string' ? body.error : (body.error?.code ?? `HTTP ${status}`);
      const detail = body.error_description ?? (typeof body.error === 'object' ? body.error?.message : undefined);
      throw new AppError('SOCIAL_AUTH_FAILED', `${this.label} : jeton de rafraîchissement refusé (${cleanDetail(code, 60)}${detail ? ` : ${cleanDetail(detail, 120)}` : ''}), nouvelle autorisation à faire si cela dure`, HttpStatus.BAD_GATEWAY, { provider: this.provider, error: cleanDetail(code, 60) });
    }
    const now = this.now();
    this.#access = { value: body.access_token, expiresAt: now + (seconds(body.expires_in) ?? 3_600) * 1_000 };
    const refreshTtl = seconds(body.refresh_token_expires_in) ?? seconds(body.refresh_expires_in);
    this.#refresh = {
      value: body.refresh_token || this.#refresh!.value,
      expiresAt: refreshTtl ? now + refreshTtl * 1_000 : body.refresh_token && body.refresh_token !== used ? null : this.#refresh!.expiresAt,
    };
    if (this.#options.store && this.#origin) {
      try {
        await this.#options.store.save(this.provider, { origin: this.#origin, refreshToken: this.#refresh.value, refreshExpiresAt: this.#refresh.expiresAt, accessToken: this.#access.value, accessExpiresAt: this.#access.expiresAt });
        this.#problem = null;
      } catch (error) {
        // Le jeton reste valable pour ce processus ; l'alerte quotidienne signale qu'un redémarrage le perdrait.
        this.#problem = `${this.label} : jeton renouvelé non conservé dans la base (${error instanceof Error ? cleanDetail(error.message, 120) : 'erreur'})`;
      }
    }
    return this.#access.value;
  }

  private async exchange(refreshToken: string): Promise<{ ok: boolean; status: number; body: TokenResponse }> {
    const { clientAuth, clientId, clientSecret } = this.#options;
    const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
    const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
    if (clientAuth === 'tiktok') {
      form.set('client_key', clientId ?? '');
      form.set('client_secret', clientSecret ?? '');
    } else if (clientAuth === 'basic' && clientSecret) {
      headers['authorization'] = `Basic ${Buffer.from(`${clientId ?? ''}:${clientSecret}`).toString('base64')}`;
      form.set('client_id', clientId ?? '');
    } else {
      form.set('client_id', clientId ?? '');
      if (clientSecret) form.set('client_secret', clientSecret);
    }
    let response: Response;
    try {
      response = await this.#fetch(this.#options.tokenUrl, { method: 'POST', headers, body: form.toString(), signal: AbortSignal.timeout(this.#options.timeoutMs ?? 15_000) });
    } catch (error) {
      throw new AppError('SOCIAL_PROVIDER_ERROR', `${this.label} : serveur d'autorisation injoignable (${error instanceof Error ? cleanDetail(error.message, 120) : 'erreur'})`, HttpStatus.BAD_GATEWAY);
    }
    if (response.status === 429) throw socialError(this.label, 429, this.#options.tokenUrl, 'trop de demandes de jeton', response.headers);
    const body = (await response.json().catch(() => ({}))) as TokenResponse;
    return { ok: response.ok, status: response.status, body };
  }
}

/** Délai demandé par le réseau avant un nouvel essai : `Retry-After` (secondes ou date), sinon `x-rate-limit-reset` (X, époque en secondes). */
export function retryAfterSeconds(headers: Headers, now = Date.now()): number | null {
  const retry = headers.get('retry-after');
  if (retry) {
    const n = Number(retry);
    if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
    const at = Date.parse(retry);
    if (Number.isFinite(at)) return Math.max(0, Math.ceil((at - now) / 1_000));
  }
  const reset = Number(headers.get('x-rate-limit-reset') ?? headers.get('x-ratelimit-reset') ?? Number.NaN);
  if (Number.isFinite(reset) && reset > 1_000_000_000) return Math.max(0, Math.ceil(reset - now / 1_000));
  return null;
}

/** Chemin d'une adresse, sans les paramètres (jamais de valeur sensible dans un message). */
export function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url.split('?')[0] ?? url;
  }
}

/** Erreur typée d'un appel refusé : les codes guident la diffusion (nouvel essai espacé, au délai demandé pour un 429). */
export function socialError(label: string, status: number, url: string, detail: string | null | undefined, headers?: Headers): AppError {
  const message = `${label} ${status} sur ${pathOf(url)} : ${cleanDetail(detail)}`;
  if (status === 429) return new AppError('SOCIAL_RATE_LIMITED', message, HttpStatus.SERVICE_UNAVAILABLE, { retryAfterSeconds: headers ? retryAfterSeconds(headers) : null });
  if (status === 401) return new AppError('SOCIAL_AUTH_FAILED', message, HttpStatus.BAD_GATEWAY);
  if (status === 403) return new AppError('SOCIAL_FORBIDDEN', message, HttpStatus.BAD_GATEWAY);
  if (status === 400 || status === 409 || status === 413 || status === 422) return new AppError('SOCIAL_VALIDATION_ERROR', message, HttpStatus.UNPROCESSABLE_ENTITY);
  return new AppError('SOCIAL_PROVIDER_ERROR', message, HttpStatus.BAD_GATEWAY);
}

export interface ApiRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  json?: unknown;
  form?: URLSearchParams;
  formData?: FormData;
  raw?: { body: Buffer; contentType: string };
  headers?: Record<string, string>;
  /** Statuts acceptés en plus des 2xx (308 du téléversement résumable de YouTube). */
  accept?: readonly number[];
  /** Appel sans le jeton (adresse de téléversement déjà signée par le réseau). */
  anonymous?: boolean;
  timeoutMs?: number;
}

export interface ApiResponse<T> {
  status: number;
  headers: Headers;
  data: T;
}

export interface SocialApiOptions {
  label: string;
  session: OAuthSession;
  fetchImpl?: typeof fetch;
  /** En-têtes ajoutés à chaque appel (version de l'API LinkedIn). */
  headers?: Record<string, string>;
  /** Message d'erreur du réseau dans le corps de sa réponse. */
  errorMessage?: (data: unknown) => string | null | undefined;
  /** Limite atteinte signalée autrement que par un 429 (quota quotidien de YouTube en 403, plafond de TikTok). */
  rateLimited?: (status: number, data: unknown) => boolean;
  timeoutMs?: number;
}

/** Client HTTP d'un réseau : jeton Bearer, un nouvel échange après un 401, erreurs typées. */
export class SocialApi {
  readonly #fetch: typeof fetch;

  constructor(private readonly options: SocialApiOptions) {
    this.#fetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  get session(): OAuthSession {
    return this.options.session;
  }

  toJSON() {
    return { label: this.options.label, session: this.options.session.toJSON() };
  }

  async call<T>(url: string, request: ApiRequest = {}): Promise<ApiResponse<T>> {
    for (let attempt = 0; ; attempt += 1) {
      const headers: Record<string, string> = { accept: 'application/json', ...this.options.headers, ...request.headers };
      if (!request.anonymous) headers['authorization'] = `Bearer ${await this.options.session.accessToken()}`;
      let body: string | Uint8Array | FormData | undefined;
      if (request.json !== undefined) {
        headers['content-type'] = 'application/json; charset=UTF-8';
        body = JSON.stringify(request.json);
      } else if (request.form) {
        headers['content-type'] = 'application/x-www-form-urlencoded';
        body = request.form.toString();
      } else if (request.formData) {
        body = request.formData;
      } else if (request.raw) {
        headers['content-type'] = request.raw.contentType;
        body = new Uint8Array(request.raw.body);
      }
      let response: Response;
      try {
        response = await this.#fetch(url, { method: request.method ?? 'GET', headers, ...(body !== undefined ? { body } : {}), signal: AbortSignal.timeout(request.timeoutMs ?? this.options.timeoutMs ?? 60_000) });
      } catch (error) {
        throw new AppError('SOCIAL_PROVIDER_ERROR', `${this.options.label} injoignable sur ${pathOf(url)} : ${error instanceof Error ? cleanDetail(error.message, 120) : 'erreur'}`, HttpStatus.BAD_GATEWAY);
      }
      // Jeton refusé avant son échéance (révoqué, ou horloge décalée) : un nouvel échange, puis un seul nouvel essai.
      if (response.status === 401 && attempt === 0 && !request.anonymous && this.options.session.invalidate()) {
        await response.body?.cancel().catch(() => undefined);
        continue;
      }
      const text = await response.text();
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      if (response.ok || request.accept?.includes(response.status)) return { status: response.status, headers: response.headers, data: data as T };
      const detail = this.options.errorMessage?.(data) ?? (typeof data === 'string' ? data : text);
      const status = response.status !== 429 && this.options.rateLimited?.(response.status, data) ? 429 : response.status;
      throw socialError(this.options.label, status, url, detail, response.headers);
    }
  }
}

/** Morceaux d'un téléversement : `[début, fin incluse]`, taille `size` (le dernier peut être plus court). */
export function chunkRanges(total: number, size: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (let start = 0; start < total; start += size) ranges.push([start, Math.min(start + size, total) - 1]);
  return ranges;
}
