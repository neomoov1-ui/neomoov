/**
 * Google Search Console réelle (phase 1 « entreprise autonome ») : compte de service autorisé sur la propriété du site
 * (`SEARCH_CONSOLE_SITE_URL`, `SEARCH_CONSOLE_CLIENT_EMAIL`, `SEARCH_CONSOLE_PRIVATE_KEY`), jeton OAuth obtenu par
 * assertion JWT signée (RS256, sans bibliothèque), requêtes `searchAnalytics/query`. La clé privée ne quitte jamais l'objet.
 */
import { createSign } from 'node:crypto';
import type { SearchStat } from '@neomoov/domain';
import { AppError } from '../../common/app-error.js';
import type { SearchConsoleProvider } from '../marketing.types.js';

export interface SearchConsoleOptions {
  siteUrl: string;
  clientEmail: string;
  privateKey: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const API = 'https://searchconsole.googleapis.com/webmasters/v3/sites';

const base64url = (value: string | Buffer): string => Buffer.from(value).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** Assertion JWT d'un compte de service Google (RS256), valable une heure. */
export function serviceAccountAssertion(clientEmail: string, privateKey: string, nowSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({ iss: clientEmail, scope: SCOPE, aud: TOKEN_URL, iat: nowSeconds, exp: nowSeconds + 3600 }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  // Une clé collée dans une variable d'environnement garde souvent des « \n » littéraux.
  const signature = signer.sign(privateKey.replace(/\\n/g, '\n'));
  return `${header}.${claims}.${base64url(signature)}`;
}

export class GoogleSearchConsoleProvider implements SearchConsoleProvider {
  readonly name = 'google';
  readonly configured = true;
  private readonly fetchImpl: typeof fetch;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly options: SearchConsoleOptions) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  toJSON() {
    return { name: this.name, siteUrl: this.options.siteUrl, configured: true };
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now() + 60_000) return this.token.value;
    const assertion = serviceAccountAssertion(this.options.clientEmail, this.options.privateKey, Math.floor(this.now() / 1000));
    const response = await this.fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(), signal: AbortSignal.timeout(30_000) });
    const data = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
    if (!response.ok || !data.access_token) throw new AppError('SEARCH_CONSOLE_ERROR', `Jeton Google refusé : ${data.error_description ?? data.error ?? response.status}`, 502);
    this.token = { value: data.access_token, expiresAt: this.now() + (data.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  async query(input: { from: string; to: string; byPage: boolean; rowLimit?: number }): Promise<SearchStat[]> {
    const token = await this.accessToken();
    let response: Response;
    try {
      response = await this.fetchImpl(`${API}/${encodeURIComponent(this.options.siteUrl)}/searchAnalytics/query`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ startDate: input.from, endDate: input.to, dimensions: input.byPage ? ['page', 'query'] : ['query'], rowLimit: input.rowLimit ?? 500 }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      throw new AppError('SEARCH_CONSOLE_ERROR', `Search Console injoignable : ${error instanceof Error ? error.message : String(error)}`, 502);
    }
    const data = (await response.json().catch(() => ({}))) as { rows?: Array<{ keys: string[]; clicks: number; impressions: number; position: number }>; error?: { message?: string } };
    if (!response.ok) throw new AppError('SEARCH_CONSOLE_ERROR', `Search Console ${response.status} : ${data.error?.message ?? ''}`, 502);
    return (data.rows ?? []).map((row) => ({
      page: input.byPage ? (row.keys[0] ?? null) : null,
      query: input.byPage ? (row.keys[1] ?? '') : (row.keys[0] ?? ''),
      clicks: Math.round(row.clicks), impressions: Math.round(row.impressions), position: row.position,
    }));
  }
}
