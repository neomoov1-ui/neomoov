/**
 * Stockage objet compatible S3 (décision D49 : Supabase Storage, région Canada ; Cloudflare R2 possible), en REST avec
 * la signature AWS Signature Version 4, sans SDK : dépôt, lecture, suppression et adresse signée à durée limitée. Les
 * objets restent privés ; la clé secrète ne quitte jamais le processus et n'apparaît pas dans les journaux.
 */
import { createHash, createHmac } from 'node:crypto';
import { AppError } from '../../common/app-error.js';
import type { StorageProvider } from '../types.js';

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Adresse `endpoint/bucket/clé` (Supabase, R2) ; sinon `bucket.hôte/clé` (AWS). */
  pathStyle?: boolean;
}

const sha256Hex = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest();
/** Encodage RFC 3986 exigé par la signature (les « / » d'une clé restent tels quels dans le chemin). */
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const encodePath = (path: string) => path.split('/').map(encode).join('/');

export function amzDate(now: Date): { date: string; stamp: string } {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { date: stamp.slice(0, 8), stamp };
}

function signingKey(secret: string, date: string, region: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), 's3'), 'aws4_request');
}

/**
 * Signature d'une requête (en-tête Authorization). `headers` doit contenir `host`, `x-amz-date` et
 * `x-amz-content-sha256` ; tous les en-têtes fournis sont signés.
 */
export function signRequest(input: { method: string; path: string; query?: Record<string, string>; headers: Record<string, string>; payloadHash: string; region: string; accessKeyId: string; secretAccessKey: string; now: Date }): string {
  const { date, stamp } = amzDate(input.now);
  const names = Object.keys(input.headers).map((h) => h.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')]));
  const canonicalQuery = Object.entries(input.query ?? {}).map(([k, v]) => [encode(k), encode(v)] as const).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('&');
  const canonical = [input.method, encodePath(input.path), canonicalQuery, names.map((n) => `${n}:${lower[n]}\n`).join(''), names.join(';'), input.payloadHash].join('\n');
  const scope = `${date}/${input.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonical)].join('\n');
  const signature = createHmac('sha256', signingKey(input.secretAccessKey, date, input.region)).update(toSign).digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
}

/** Adresse signée (lecture) valable `expiresInSeconds` : seul l'en-tête `host` est signé, charge non signée. */
export function presignGet(input: { url: URL; region: string; accessKeyId: string; secretAccessKey: string; expiresInSeconds: number; now: Date }): string {
  const { date, stamp } = amzDate(input.now);
  const scope = `${date}/${input.region}/s3/aws4_request`;
  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${input.accessKeyId}/${scope}`,
    'X-Amz-Date': stamp,
    'X-Amz-Expires': String(Math.max(1, Math.min(604_800, Math.round(input.expiresInSeconds)))),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuery = Object.entries(query).map(([k, v]) => [encode(k), encode(v)] as const).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
  const path = decodeURIComponent(input.url.pathname);
  const canonical = ['GET', encodePath(path), canonicalQuery, `host:${input.url.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonical)].join('\n');
  const signature = createHmac('sha256', signingKey(input.secretAccessKey, date, input.region)).update(toSign).digest('hex');
  return `${input.url.origin}${encodePath(path)}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export class S3StorageProvider implements StorageProvider {
  readonly name = 's3';
  readonly #config: S3Config;

  constructor(config: S3Config, private readonly fetchImpl: typeof fetch = fetch) {
    this.#config = { ...config, endpoint: config.endpoint.replace(/\/+$/, ''), pathStyle: config.pathStyle ?? true };
  }

  /** Adresse de l'objet (sans signature). */
  objectUrl(key: string): URL {
    const base = new URL(this.#config.endpoint);
    const clean = key.replace(/^\/+/, '');
    if (this.#config.pathStyle) return new URL(`${base.origin}${base.pathname.replace(/\/+$/, '')}/${encodePath(this.#config.bucket)}/${encodePath(clean)}`);
    return new URL(`${base.protocol}//${this.#config.bucket}.${base.host}/${encodePath(clean)}`);
  }

  private async send(method: 'GET' | 'PUT' | 'DELETE', key: string, body?: { data: Buffer; contentType: string }): Promise<Response> {
    const url = this.objectUrl(key);
    const now = new Date();
    const payloadHash = sha256Hex(body?.data ?? '');
    const headers: Record<string, string> = { host: url.host, 'x-amz-date': amzDate(now).stamp, 'x-amz-content-sha256': payloadHash, ...(body ? { 'content-type': body.contentType } : {}) };
    const authorization = signRequest({ method, path: decodeURIComponent(url.pathname), headers, payloadHash, region: this.#config.region, accessKeyId: this.#config.accessKeyId, secretAccessKey: this.#config.secretAccessKey, now });
    const { host: _host, ...sent } = headers;
    try {
      return await this.fetchImpl(url, { method, headers: { ...sent, authorization }, ...(body ? { body: new Uint8Array(body.data) } : {}), signal: AbortSignal.timeout(30_000) });
    } catch (error) {
      throw new AppError('STORAGE_UNAVAILABLE', `Stockage objet injoignable (${error instanceof Error ? error.name : 'erreur'})`, 502);
    }
  }

  private async fail(res: Response, action: string): Promise<never> {
    const text = (await res.text().catch(() => '')).slice(0, 300);
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1] ?? String(res.status);
    throw new AppError('STORAGE_ERROR', `Stockage objet : ${action} refusé (${code})`, 502);
  }

  async putObject(input: { key: string; body: Buffer; contentType: string }): Promise<{ key: string }> {
    const res = await this.send('PUT', input.key, { data: input.body, contentType: input.contentType });
    if (!res.ok) await this.fail(res, 'dépôt');
    return { key: input.key };
  }

  async getObject(key: string): Promise<{ body: Buffer; contentType: string } | null> {
    const res = await this.send('GET', key);
    if (res.status === 404) return null;
    if (!res.ok) {
      // Supabase répond 400 « NoSuchKey » pour un objet absent.
      const text = await res.text().catch(() => '');
      if (/NoSuchKey|not.?found/i.test(text)) return null;
      throw new AppError('STORAGE_ERROR', `Stockage objet : lecture refusée (${res.status})`, 502);
    }
    return { body: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') ?? 'application/octet-stream' };
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    return presignGet({ url: this.objectUrl(key), region: this.#config.region, accessKeyId: this.#config.accessKeyId, secretAccessKey: this.#config.secretAccessKey, expiresInSeconds, now: new Date() });
  }

  async deleteObject(key: string): Promise<void> {
    const res = await this.send('DELETE', key);
    if (!res.ok && res.status !== 404) await this.fail(res, 'suppression');
  }
}
