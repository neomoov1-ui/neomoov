/**
 * Facebook et Instagram réels (phase 1 « entreprise autonome ») par l'API Graph de Meta : page Facebook (`META_PAGE_ID`,
 * jeton de page `META_PAGE_TOKEN`) et compte Instagram professionnel rattaché (`META_IG_USER_ID`). Publications (texte,
 * photo, vidéo ou Reel), mesures (insights), commentaires et réponses. Un média est fourni par une adresse signée du
 * stockage (Meta le télécharge). Le jeton ne quitte jamais l'objet. Droits à demander : docs/marketing/connecteurs.md.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { AppError } from '../../common/app-error.js';
import type { PublishedRef, SocialComment, SocialMetrics, SocialPublishInput, SocialPublishResult, SocialPublisher } from '../marketing.types.js';

export interface MetaGraphOptions {
  pageId: string;
  pageToken: string;
  igUserId: string | null;
  /** Version de l'API Graph (`META_GRAPH_VERSION`, v21.0 par défaut). */
  version: string;
  fetchImpl?: typeof fetch;
  /** Délai entre deux lectures de l'état d'un conteneur Instagram (vidéo en traitement). */
  pollMs?: number;
}

interface GraphError { error?: { message?: string; code?: number; type?: string } }
interface GraphInsights { data?: Array<{ name: string; values?: Array<{ value?: number | Record<string, number> }> }> }
interface GraphComments { data?: Array<{ id: string; message?: string; text?: string; created_time?: string; timestamp?: string; from?: { name?: string }; username?: string }> }

const insightValue = (insights: GraphInsights, name: string): number => {
  const value = insights.data?.find((d) => d.name === name)?.values?.[0]?.value;
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') return Object.values(value).reduce((sum, v) => sum + v, 0);
  return 0;
};

export class MetaGraphClient {
  private readonly fetchImpl: typeof fetch;
  readonly base: string;

  constructor(private readonly options: MetaGraphOptions) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.base = `https://graph.facebook.com/${options.version}`;
  }

  async call<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}, method: 'GET' | 'POST' = 'GET'): Promise<T> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value !== undefined) search.set(key, String(value));
    search.set('access_token', this.options.pageToken);
    const url = `${this.base}/${path.replace(/^\//, '')}${method === 'GET' ? `?${search}` : ''}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, { method, ...(method === 'POST' ? { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: search.toString() } : {}), signal: AbortSignal.timeout(60_000) });
    } catch (error) {
      throw new AppError('SOCIAL_PROVIDER_ERROR', `Meta injoignable : ${error instanceof Error ? error.message : String(error)}`, 502);
    }
    const text = await response.text();
    let data: T & GraphError;
    try {
      data = (text ? JSON.parse(text) : {}) as T & GraphError;
    } catch {
      throw new AppError('SOCIAL_PROVIDER_ERROR', `Meta ${response.status} : réponse illisible`, 502);
    }
    if (!response.ok || data.error) throw new AppError('SOCIAL_PROVIDER_ERROR', `Meta ${response.status} sur ${path} : ${data.error?.message ?? text.slice(0, 200)} (code ${data.error?.code ?? '?'})`, 502);
    return data;
  }

  get pageId() {
    return this.options.pageId;
  }
  get igUserId() {
    return this.options.igUserId;
  }
  get pollMs() {
    return this.options.pollMs ?? 5_000;
  }
}

function sinceUnix(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export class MetaFacebookPublisher implements SocialPublisher {
  readonly name = 'meta';
  readonly configured = true;
  readonly space = 'facebook' as const;

  constructor(private readonly client: MetaGraphClient) {}

  toJSON() {
    return { name: this.name, space: this.space, pageId: this.client.pageId, configured: true };
  }

  async publish(input: SocialPublishInput): Promise<SocialPublishResult> {
    const page = this.client.pageId;
    let id: string;
    if (input.media?.url && input.media.contentType.startsWith('video/')) {
      const data = await this.client.call<{ id: string }>(`${page}/videos`, { file_url: input.media.url, description: input.text, published: !input.draft }, 'POST');
      id = data.id;
    } else if (input.media?.url) {
      const data = await this.client.call<{ id: string; post_id?: string }>(`${page}/photos`, { url: input.media.url, caption: input.text, published: !input.draft }, 'POST');
      id = data.post_id ?? data.id;
    } else {
      const data = await this.client.call<{ id: string }>(`${page}/feed`, { message: input.text, link: input.ctaUrl ?? undefined, published: !input.draft }, 'POST');
      id = data.id;
    }
    return { externalId: id, url: `https://www.facebook.com/${id}`, draft: input.draft };
  }

  async metrics(ref: PublishedRef): Promise<SocialMetrics> {
    const insights = await this.client.call<GraphInsights>(`${ref.externalId}/insights`, { metric: 'post_impressions_unique,post_engaged_users,post_clicks' });
    return { reach: insightValue(insights, 'post_impressions_unique'), interactions: insightValue(insights, 'post_engaged_users'), clicks: insightValue(insights, 'post_clicks'), collectedAt: new Date() };
  }

  async comments(ref: PublishedRef, since: Date): Promise<SocialComment[]> {
    const data = await this.client.call<GraphComments>(`${ref.externalId}/comments`, { since: sinceUnix(since), fields: 'id,from,message,created_time', limit: 50 });
    return (data.data ?? []).map((c) => ({ externalId: c.id, author: c.from?.name ?? null, text: c.message ?? '', postedAt: new Date(c.created_time ?? Date.now()) }));
  }

  async replyComment(_ref: PublishedRef, commentExternalId: string, text: string): Promise<{ externalId: string }> {
    const data = await this.client.call<{ id: string }>(`${commentExternalId}/comments`, { message: text }, 'POST');
    return { externalId: data.id };
  }
}

export class MetaInstagramPublisher implements SocialPublisher {
  readonly name = 'meta';
  readonly configured = true;
  readonly space = 'instagram' as const;

  constructor(private readonly client: MetaGraphClient) {}

  toJSON() {
    return { name: this.name, space: this.space, igUserId: this.client.igUserId, configured: true };
  }

  private get user(): string {
    if (!this.client.igUserId) throw new AppError('PROVIDER_NOT_CONFIGURED', 'Instagram : META_IG_USER_ID absent', 501);
    return this.client.igUserId;
  }

  async publish(input: SocialPublishInput): Promise<SocialPublishResult> {
    if (!input.media?.url) throw new AppError('SOCIAL_MEDIA_REQUIRED', 'Instagram exige une image ou une vidéo accessible par adresse', 422);
    const user = this.user;
    const video = input.media.contentType.startsWith('video/');
    const params: Record<string, string> = { caption: input.text };
    if (video) {
      params['video_url'] = input.media.url;
      params['media_type'] = input.format === 'story' ? 'STORIES' : 'REELS';
    } else {
      params['image_url'] = input.media.url;
      if (input.format === 'story') params['media_type'] = 'STORIES';
    }
    const container = await this.client.call<{ id: string }>(`${user}/media`, params, 'POST');
    if (video) {
      // Une vidéo est traitée par Meta avant de pouvoir être publiée : état lu jusqu'à FINISHED (ou erreur).
      for (let attempt = 0; attempt < 24; attempt += 1) {
        const status = await this.client.call<{ status_code?: string }>(container.id, { fields: 'status_code' });
        if (status.status_code === 'FINISHED') break;
        if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') throw new AppError('SOCIAL_PROVIDER_ERROR', `Instagram : conteneur vidéo en ${status.status_code}`, 502);
        await sleep(this.client.pollMs);
      }
    }
    const published = await this.client.call<{ id: string }>(`${user}/media_publish`, { creation_id: container.id }, 'POST');
    const detail = await this.client.call<{ permalink?: string }>(published.id, { fields: 'permalink' }).catch(() => ({ permalink: undefined }));
    return { externalId: published.id, url: detail.permalink ?? null, draft: false };
  }

  async metrics(ref: PublishedRef): Promise<SocialMetrics> {
    const insights = await this.client.call<GraphInsights>(`${ref.externalId}/insights`, { metric: 'reach,total_interactions' });
    return { reach: insightValue(insights, 'reach'), interactions: insightValue(insights, 'total_interactions'), clicks: 0, collectedAt: new Date() };
  }

  async comments(ref: PublishedRef, since: Date): Promise<SocialComment[]> {
    const data = await this.client.call<GraphComments>(`${ref.externalId}/comments`, { fields: 'id,username,text,timestamp', limit: 50 });
    return (data.data ?? [])
      .map((c) => ({ externalId: c.id, author: c.username ?? null, text: c.text ?? '', postedAt: new Date(c.timestamp ?? Date.now()) }))
      .filter((c) => c.postedAt > since);
  }

  async replyComment(_ref: PublishedRef, commentExternalId: string, text: string): Promise<{ externalId: string }> {
    const data = await this.client.call<{ id: string }>(`${commentExternalId}/replies`, { message: text }, 'POST');
    return { externalId: data.id };
  }
}
