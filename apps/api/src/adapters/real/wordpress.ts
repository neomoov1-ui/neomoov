/**
 * Connecteur WordPress réel (neomoov.net et neomoov.net/academy, phase 1 « entreprise autonome ») : API REST du site
 * authentifiée par mot de passe d'application (`WORDPRESS_URL`, `WORDPRESS_USER`, `WORDPRESS_APP_PASSWORD`). Publie
 * les articles (brouillon ou en ligne selon l'état du contenu, catégorie du blogue ou de l'Academy, visuel en image à
 * la une), lit les commentaires et y répond, lit les pages et leurs balises (champs `_neomoov_seo_title` et
 * `_neomoov_seo_desc` posés par l'outil de publication du site, ou Yoast), corrige les balises et crée des brouillons
 * (jamais publiés par la plateforme), lit la médiathèque (photos réelles, D46). Le secret ne quitte jamais l'objet.
 */
import type { ContentSpace, SitePage } from '@neomoov/domain';
import { AppError } from '../../common/app-error.js';
import type { PublishedRef, SearchConsoleProvider, SiteConnector, SiteMediaItem, SocialComment, SocialMetrics, SocialPublishInput, SocialPublishResult, SocialPublisher } from '../marketing.types.js';

export interface WordPressOptions {
  baseUrl: string;
  user: string;
  appPassword: string;
  /** Espace servi par ce connecteur (le site et l'Academy partagent le même WordPress). */
  space: 'site_blog' | 'academy';
  /** Identifiant (slug) de la catégorie des articles de cet espace ; null : sans catégorie. */
  category: string | null;
  /** Champs des balises : `neomoov` (`_neomoov_seo_title`, `_neomoov_seo_desc`, outil du site) ou `yoast`. */
  seoMeta: 'neomoov' | 'yoast';
  fetchImpl?: typeof fetch;
}

const SEO_FIELDS = {
  neomoov: { title: '_neomoov_seo_title', description: '_neomoov_seo_desc' },
  yoast: { title: '_yoast_wpseo_title', description: '_yoast_wpseo_metadesc' },
} as const;

interface WpRendered { rendered?: string }
interface WpPost {
  id: number;
  link?: string;
  title?: WpRendered;
  content?: WpRendered;
  excerpt?: WpRendered;
  meta?: Record<string, unknown>;
  yoast_head_json?: { title?: string; description?: string };
}
interface WpComment { id: number; author_name?: string; content?: WpRendered; date_gmt?: string }
interface WpMedia { id: number; source_url?: string; alt_text?: string; mime_type?: string }

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', rsquo: '’', lsquo: '‘', hellip: '…', laquo: '«', raquo: '»', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç' };

/** Texte brut d'un fragment HTML (balises retirées, entités courantes décodées, espaces normalisés). */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match)
    .replace(/\s+/g, ' ')
    .trim();
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Texte de l'agent (paragraphes séparés par une ligne vide, `## ` pour un sous-titre, `- ` pour une liste) en HTML WordPress. */
export function textToHtml(text: string): string {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return blocks
    .map((block) => {
      if (/^##\s+/.test(block)) return `<h2>${escapeHtml(block.replace(/^##\s+/, ''))}</h2>`;
      const lines = block.split('\n');
      if (lines.every((l) => /^-\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${escapeHtml(l.replace(/^-\s+/, ''))}</li>`).join('')}</ul>`;
      return `<p>${lines.map(escapeHtml).join('<br>')}</p>`;
    })
    .join('\n');
}

const headingTexts = (html: string, tag: 'h1' | 'h2' | 'h3'): string[] => [...html.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi'))].map((m) => stripHtml(m[1] ?? '')).filter(Boolean);

export class WordPressConnector implements SocialPublisher, SiteConnector {
  readonly name = 'wordpress';
  readonly configured = true;
  readonly space: ContentSpace;
  private readonly baseUrl: string;
  private readonly host: string;
  private readonly authorization: string;
  private readonly fetchImpl: typeof fetch;
  private categoryCache: number | null | undefined;
  private readonly kinds = new Map<string, 'page' | 'post'>();

  constructor(private readonly options: WordPressOptions) {
    this.space = options.space;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.host = new URL(this.baseUrl).host;
    this.authorization = `Basic ${Buffer.from(`${options.user}:${options.appPassword}`).toString('base64')}`;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  toJSON() {
    return { name: this.name, space: this.space, site: this.host, configured: true };
  }

  private async request<T>(path: string, init: { method?: string; body?: unknown; raw?: { body: Buffer; contentType: string; filename: string } } = {}): Promise<{ data: T; headers: Headers }> {
    const headers: Record<string, string> = { authorization: this.authorization, accept: 'application/json' };
    let body: BodyInit | undefined;
    if (init.raw) {
      headers['content-type'] = init.raw.contentType;
      headers['content-disposition'] = `attachment; filename="${init.raw.filename.replace(/[^\w.-]/g, '_')}"`;
      body = new Uint8Array(init.raw.body);
    } else if (init.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(init.body);
    }
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/wp-json${path}`, { method: init.method ?? 'GET', headers, body, signal: AbortSignal.timeout(30_000) });
    } catch (error) {
      throw new AppError('SITE_PROVIDER_ERROR', `WordPress injoignable : ${error instanceof Error ? error.message : String(error)}`, 502);
    }
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!response.ok) {
      const message = (data as { message?: string } | null)?.message ?? text.slice(0, 200);
      throw new AppError('SITE_PROVIDER_ERROR', `WordPress ${response.status} sur ${path} : ${message}`, 502);
    }
    return { data: data as T, headers: response.headers };
  }

  private async categoryId(): Promise<number | null> {
    if (this.categoryCache !== undefined) return this.categoryCache;
    if (!this.options.category) return (this.categoryCache = null);
    const { data } = await this.request<Array<{ id: number }>>(`/wp/v2/categories?slug=${encodeURIComponent(this.options.category)}&_fields=id`);
    this.categoryCache = data[0]?.id ?? null;
    return this.categoryCache;
  }

  // Diffusion ---------------------------------------------------------------------------------------------------------

  async publish(input: SocialPublishInput): Promise<SocialPublishResult> {
    let featured: number | null = null;
    if (input.media && input.media.contentType.startsWith('image/')) {
      const ext = input.media.contentType === 'image/png' ? 'png' : 'jpg';
      const { data } = await this.request<WpMedia>('/wp/v2/media', { method: 'POST', raw: { body: input.media.body, contentType: input.media.contentType, filename: `neomoov-${input.itemId}.${ext}` } });
      featured = data.id;
    }
    const category = await this.categoryId();
    const fields = SEO_FIELDS[this.options.seoMeta];
    const title = input.title ?? input.text.split('\n')[0]!.slice(0, 120);
    const { data } = await this.request<WpPost>('/wp/v2/posts', {
      method: 'POST',
      body: {
        title, content: textToHtml(input.body), excerpt: input.caption ?? '', status: input.draft ? 'draft' : 'publish',
        ...(category ? { categories: [category] } : {}), ...(featured ? { featured_media: featured } : {}),
        meta: { [fields.title]: title.slice(0, 70), [fields.description]: (input.caption ?? stripHtml(input.body)).slice(0, 155) },
      },
    });
    return { externalId: String(data.id), url: data.link ?? null, draft: input.draft };
  }

  async metrics(ref: PublishedRef): Promise<SocialMetrics> {
    const { headers } = await this.request<unknown[]>(`/wp/v2/comments?post=${encodeURIComponent(ref.externalId)}&per_page=1&_fields=id`);
    const comments = Number(headers.get('x-wp-total') ?? 0);
    // Portée et clics d'un article : la Search Console (tâches de référencement) ; ici, l'engagement visible sur le site.
    return { reach: 0, interactions: comments, clicks: 0, collectedAt: new Date(), raw: { comments } };
  }

  async comments(ref: PublishedRef, since: Date): Promise<SocialComment[]> {
    const { data } = await this.request<WpComment[]>(`/wp/v2/comments?post=${encodeURIComponent(ref.externalId)}&after=${encodeURIComponent(since.toISOString())}&per_page=50&orderby=date&order=asc&_fields=id,author_name,content,date_gmt`);
    return data.map((c) => ({ externalId: String(c.id), author: c.author_name ?? null, text: stripHtml(c.content?.rendered ?? ''), postedAt: new Date(`${c.date_gmt ?? new Date().toISOString().slice(0, 19)}Z`) }));
  }

  async replyComment(ref: PublishedRef, commentExternalId: string, text: string): Promise<{ externalId: string }> {
    const { data } = await this.request<WpComment>('/wp/v2/comments', { method: 'POST', body: { post: Number(ref.externalId), parent: Number(commentExternalId), content: text } });
    return { externalId: String(data.id) };
  }

  // Site : pages, balises, brouillons, médiathèque -----------------------------------------------------------------

  private toPage(kind: 'page' | 'post', post: WpPost): SitePage {
    const fields = SEO_FIELDS[this.options.seoMeta];
    const html = post.content?.rendered ?? '';
    const meta = post.meta ?? {};
    const metaTitle = (typeof meta[fields.title] === 'string' && (meta[fields.title] as string).trim()) || post.yoast_head_json?.title?.trim() || null;
    const metaDescription = (typeof meta[fields.description] === 'string' && (meta[fields.description] as string).trim()) || post.yoast_head_json?.description?.trim() || null;
    const links = [...html.matchAll(/<a\s[^>]*href="([^"]+)"/gi)].map((m) => m[1] ?? '').filter((href) => href.startsWith('/') || href.includes(this.host));
    this.kinds.set(String(post.id), kind);
    return {
      id: String(post.id), kind, url: post.link ?? `${this.baseUrl}/?p=${post.id}`, title: stripHtml(post.title?.rendered ?? ''), metaTitle, metaDescription,
      h1: headingTexts(html, 'h1')[0] ?? null, headings: [...headingTexts(html, 'h2'), ...headingTexts(html, 'h3')], internalLinks: links.length, wordCount: stripHtml(html).split(/\s+/).filter(Boolean).length,
    };
  }

  async pages(): Promise<SitePage[]> {
    const fields = '_fields=id,link,title,content,excerpt,meta,yoast_head_json';
    const [pages, posts] = await Promise.all([
      this.request<WpPost[]>(`/wp/v2/pages?per_page=100&status=publish&${fields}`),
      this.request<WpPost[]>(`/wp/v2/posts?per_page=100&status=publish&${fields}`),
    ]);
    return [...pages.data.map((p) => this.toPage('page', p)), ...posts.data.map((p) => this.toPage('post', p))];
  }

  private async kindOf(ref: string): Promise<'page' | 'post'> {
    const known = this.kinds.get(ref);
    if (known) return known;
    try {
      await this.request<WpPost>(`/wp/v2/pages/${encodeURIComponent(ref)}?_fields=id`);
      this.kinds.set(ref, 'page');
      return 'page';
    } catch {
      this.kinds.set(ref, 'post');
      return 'post';
    }
  }

  async updateSeo(ref: string, patch: { title?: string | null; description?: string | null }): Promise<void> {
    const fields = SEO_FIELDS[this.options.seoMeta];
    const meta: Record<string, string> = {};
    if (patch.title !== undefined) meta[fields.title] = patch.title ?? '';
    if (patch.description !== undefined) meta[fields.description] = patch.description ?? '';
    const kind = await this.kindOf(ref);
    await this.request<WpPost>(`/wp/v2/${kind}s/${encodeURIComponent(ref)}`, { method: 'POST', body: { meta } });
  }

  async createDraft(input: { kind: 'page' | 'post'; title: string; content: string; excerpt?: string | null; category?: string | null }): Promise<{ externalId: string; url: string | null }> {
    const body: Record<string, unknown> = { title: input.title, content: textToHtml(input.content), status: 'draft', ...(input.excerpt ? { excerpt: input.excerpt } : {}) };
    if (input.kind === 'post') {
      const category = await this.categoryId();
      if (category) body['categories'] = [category];
    }
    const { data } = await this.request<WpPost>(`/wp/v2/${input.kind}s`, { method: 'POST', body });
    this.kinds.set(String(data.id), input.kind);
    return { externalId: String(data.id), url: data.link ?? null };
  }

  async mediaLibrary(limit: number): Promise<SiteMediaItem[]> {
    const { data } = await this.request<WpMedia[]>(`/wp/v2/media?per_page=${Math.min(100, Math.max(1, limit))}&media_type=image&orderby=date&order=desc&_fields=id,source_url,alt_text,mime_type`);
    return data.filter((m) => m.source_url).map((m) => ({ id: String(m.id), url: m.source_url!, alt: m.alt_text?.trim() || null, mimeType: m.mime_type ?? 'image/jpeg' }));
  }
}

/** Search Console absente en mode réel : aucune donnée (jamais de chiffres simulés), signalé par `configured`. */
export class NoSearchConsoleProvider implements SearchConsoleProvider {
  readonly name = 'none';
  readonly configured = false;
  async query() {
    return [];
  }
}
