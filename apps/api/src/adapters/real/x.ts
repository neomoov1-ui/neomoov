/**
 * X réel (API v2, 3 octobre 2026) : publication (`POST /2/tweets`) avec image (`POST /2/media/upload`), en français puis
 * en anglais quand le texte porte les deux langues (lignes éditoriales : la version anglaise part en réponse à la
 * française, sous une ligne `[EN]`), réponses aux publications lues par la recherche récente quand le niveau d'accès le
 * permet (formule Basic ou plus ; sinon aucune lecture, sans erreur), mesures (`public_metrics`, et `non_public_metrics`
 * si X les donne). OAuth 2.0 utilisateur avec PKCE ; le jeton de rafraîchissement change à chaque échange : le dernier
 * est gardé chiffré dans la base. Une limite atteinte (429) donne une nouvelle tentative au délai demandé par X.
 */
import { composeText } from '@neomoov/domain';
import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../common/app-error.js';
import type { CredentialStatus, PublishedRef, SocialComment, SocialMetrics, SocialPublishInput, SocialPublishResult, SocialPublisher } from '../marketing.types.js';
import { OAuthSession, SocialApi, type OAuthTokenStore } from './oauth.js';

const API = 'https://api.x.com/2';
export const X_TOKEN_URL = 'https://api.x.com/2/oauth2/token';
/** Longueur d'une publication (comptée par X : une adresse vaut 23 caractères ; borne simple ici, la règle du domaine contrôle avant). */
const MAX = 280;

export interface XOptions {
  clientId: string;
  /** Secret du client « confidentiel » (application Web) ; absent : client public, identifiant seul. */
  clientSecret: string | null;
  refreshToken: string;
  store?: OAuthTokenStore | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface XError { title?: string; detail?: string; errors?: Array<{ message?: string; detail?: string }> }
interface Tweet { id?: string; text?: string; author_id?: string; created_at?: string; public_metrics?: Record<string, number>; non_public_metrics?: Record<string, number> }

/** Message d'erreur de l'API X (`{ title, detail }` ou `{ errors: [...] }`). */
export function xErrorMessage(data: unknown): string | null {
  const body = data as XError | null;
  if (!body || typeof body !== 'object') return null;
  return body.detail ?? body.errors?.[0]?.message ?? body.errors?.[0]?.detail ?? body.title ?? null;
}

/** Ligne qui sépare la version française de la version anglaise d'un même texte. */
const LANGUAGE_SEPARATOR = /^[ \t]*(?:\[EN\]|EN ?:|English ?:)[ \t]*$/im;

/** Versions d'un texte bilingue : `[français, anglais]` si une ligne `[EN]` les sépare, sinon `[texte]`. */
export function splitLanguages(text: string): [string] | [string, string] {
  const match = LANGUAGE_SEPARATOR.exec(text);
  if (!match || match.index === undefined) return [text.trim()];
  const fr = text.slice(0, match.index).trim();
  const en = text.slice(match.index + match[0].length).trim();
  return fr && en ? [fr, en] : [text.trim()];
}

/** Publications à envoyer : une seule, ou la française puis l'anglaise (lien et mots-clics sur chacune). */
export function xPosts(input: SocialPublishInput): string[] {
  const versions = splitLanguages(input.body);
  if (versions.length === 1) return [input.text];
  return versions.map((body) => composeText({ space: 'x', title: input.title, body, caption: null, hashtags: input.hashtags, ctaUrl: input.ctaUrl }));
}

/** Longueur pondérée simple : une adresse compte 23 caractères, comme chez X. */
export function xLength(text: string): number {
  return text.replace(/https?:\/\/\S+/g, 'x'.repeat(23)).length;
}

export class XPublisher implements SocialPublisher {
  readonly name = 'x';
  readonly configured = true;
  readonly space = 'x' as const;
  private readonly api: SocialApi;
  /** Identifiant du compte (pour écarter ses propres réponses) ; lu une fois. */
  private me: string | null = null;
  /** Lecture refusée par le niveau d'accès (formule gratuite) : plus aucune lecture des réponses jusqu'au redémarrage. */
  private readDenied = false;

  constructor(private readonly options: XOptions) {
    const session = new OAuthSession({
      provider: 'x', label: 'X', tokenUrl: X_TOKEN_URL, clientId: options.clientId, clientSecret: options.clientSecret, refreshToken: options.refreshToken, clientAuth: 'basic', rotates: true,
      store: options.store ?? null, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}), ...(options.now ? { now: options.now } : {}),
    });
    this.api = new SocialApi({ label: 'X', session, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}), errorMessage: xErrorMessage });
  }

  toJSON() {
    return { name: this.name, space: this.space, configured: true, readDenied: this.readDenied };
  }

  /** Image téléversée (envoi simple, `media.write`) : son identifiant ; une vidéo n'est pas jointe (envoi en plusieurs parties non livré). */
  private async uploadImage(media: NonNullable<SocialPublishInput['media']>): Promise<string> {
    const form = new FormData();
    const extension = media.contentType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
    form.set('media', new Blob([new Uint8Array(media.body)], { type: media.contentType }), `neomoov.${extension}`);
    form.set('media_category', 'tweet_image');
    form.set('media_type', media.contentType);
    const { data } = await this.api.call<{ data?: { id?: string } }>(`${API}/media/upload`, { method: 'POST', formData: form, timeoutMs: 120_000 });
    const id = data?.data?.id;
    if (!id) throw new AppError('SOCIAL_PROVIDER_ERROR', 'X : image téléversée sans identifiant', HttpStatus.BAD_GATEWAY);
    return id;
  }

  private async tweet(text: string, options: { mediaId?: string | null; replyTo?: string | null }): Promise<string> {
    const { data } = await this.api.call<{ data?: { id?: string } }>(`${API}/tweets`, {
      method: 'POST',
      json: { text, ...(options.mediaId ? { media: { media_ids: [options.mediaId] } } : {}), ...(options.replyTo ? { reply: { in_reply_to_tweet_id: options.replyTo } } : {}) },
    });
    const id = data?.data?.id;
    if (!id) throw new AppError('SOCIAL_PROVIDER_ERROR', 'X : publication sans identifiant', HttpStatus.BAD_GATEWAY);
    return id;
  }

  /** Publication française (avec l'image), puis la version anglaise en réponse si le texte porte les deux langues. */
  async publish(input: SocialPublishInput): Promise<SocialPublishResult> {
    const posts = xPosts(input);
    const tooLong = posts.find((p) => xLength(p) > MAX);
    if (tooLong) throw new AppError('SOCIAL_VALIDATION_ERROR', `X : ${xLength(tooLong)} caractères, ${MAX} au plus par publication`, HttpStatus.UNPROCESSABLE_ENTITY);
    const mediaId = input.media && input.media.contentType.startsWith('image/') ? await this.uploadImage(input.media) : null;
    const first = await this.tweet(posts[0]!, { mediaId });
    let previous = first;
    for (const text of posts.slice(1)) previous = await this.tweet(text, { replyTo: previous });
    return { externalId: first, url: `https://x.com/i/web/status/${first}`, draft: false };
  }

  /** Impressions (portée), j'aime, partages, réponses, citations et signets (interactions), clics sur le lien si X les donne. */
  async metrics(ref: PublishedRef): Promise<SocialMetrics> {
    const url = (fields: string) => `${API}/tweets/${encodeURIComponent(ref.externalId)}?tweet.fields=${fields}`;
    let tweet: Tweet | undefined;
    try {
      tweet = (await this.api.call<{ data?: Tweet }>(url('public_metrics,non_public_metrics'))).data?.data;
    } catch (error) {
      // Mesures privées refusées (publication de plus de 30 jours, ou niveau d'accès) : mesures publiques seules.
      if (!(error instanceof AppError) || !['SOCIAL_FORBIDDEN', 'SOCIAL_VALIDATION_ERROR'].includes(error.code)) throw error;
      tweet = (await this.api.call<{ data?: Tweet }>(url('public_metrics'))).data?.data;
    }
    if (!tweet) throw AppError.notFound('SOCIAL_POST_NOT_FOUND', 'X : publication introuvable');
    const p = tweet.public_metrics ?? {};
    const n = (key: string) => Number(p[key] ?? 0) || 0;
    return {
      reach: n('impression_count') || Number(tweet.non_public_metrics?.['impression_count'] ?? 0), interactions: n('like_count') + n('retweet_count') + n('reply_count') + n('quote_count') + n('bookmark_count'),
      clicks: Number(tweet.non_public_metrics?.['url_link_clicks'] ?? 0) || 0, collectedAt: new Date(),
    };
  }

  /** Réponses à la publication (recherche récente, sept jours), hors celles du compte ; niveau d'accès insuffisant : aucune. */
  async comments(ref: PublishedRef, since: Date): Promise<SocialComment[]> {
    if (this.readDenied) return [];
    try {
      if (!this.me) this.me = (await this.api.call<{ data?: { id?: string } }>(`${API}/users/me`)).data?.data?.id ?? null;
      const query = `conversation_id:${ref.externalId} is:reply`;
      const params = new URLSearchParams({ query, max_results: '50', 'tweet.fields': 'author_id,created_at', expansions: 'author_id', 'user.fields': 'username' });
      if (since.getTime() > Date.now() - 6.9 * 86_400_000) params.set('start_time', since.toISOString().replace(/\.\d{3}Z$/, 'Z'));
      const { data } = await this.api.call<{ data?: Tweet[]; includes?: { users?: Array<{ id?: string; username?: string }> } }>(`${API}/tweets/search/recent?${params}`);
      const users = new Map((data?.includes?.users ?? []).map((u) => [u.id, u.username]));
      return (data?.data ?? [])
        .filter((t) => t.id && t.text && t.author_id !== this.me && new Date(t.created_at ?? 0) > since)
        .map((t) => ({ externalId: t.id!, author: t.author_id ? (users.get(t.author_id) ? `@${users.get(t.author_id)}` : null) : null, text: t.text!.slice(0, 4_000), postedAt: new Date(t.created_at ?? 0) }));
    } catch (error) {
      if (error instanceof AppError && error.code === 'SOCIAL_FORBIDDEN') {
        this.readDenied = true;
        return [];
      }
      throw error;
    }
  }

  async replyComment(_ref: PublishedRef, commentExternalId: string, text: string): Promise<{ externalId: string }> {
    if (xLength(text) > MAX) throw new AppError('SOCIAL_VALIDATION_ERROR', `X : réponse de ${xLength(text)} caractères, ${MAX} au plus`, HttpStatus.UNPROCESSABLE_ENTITY);
    return { externalId: await this.tweet(text, { replyTo: commentExternalId }) };
  }

  credentials(): Promise<CredentialStatus> {
    return this.api.session.credentials();
  }
}
