/**
 * YouTube réel (Data API v3, 3 octobre 2026) : téléversement résumable des vidéos courtes produites par
 * `visuals.service.ts` (titre, description, mots-clés, langue ; visibilité `YOUTUBE_PRIVACY_STATUS`, `public` par défaut :
 * tant que le projet Google n'a pas passé l'audit de YouTube, toute vidéo envoyée par l'API reste privée, quel que soit
 * ce réglage), commentaires (`commentThreads`) et réponses (`comments`), mesures (statistiques de la vidéo). OAuth 2.0
 * de la chaîne, jeton de rafraîchissement, portées `youtube.upload` et `youtube.force-ssl` : docs/marketing/connecteurs.md.
 */
import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../common/app-error.js';
import type { CredentialStatus, PublishedRef, SocialComment, SocialMetrics, SocialPublishInput, SocialPublishResult, SocialPublisher } from '../marketing.types.js';
import { GOOGLE_TOKEN_URL, googleErrorMessage } from './google-business.js';
import { OAuthSession, SocialApi, type OAuthTokenStore, storeBinding } from './oauth.js';

const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos';
const API = 'https://www.googleapis.com/youtube/v3';
export const YOUTUBE_PRIVACY = ['public', 'unlisted', 'private'] as const;
export type YouTubePrivacy = (typeof YOUTUBE_PRIVACY)[number];
/** Morceau du téléversement : multiple de 256 Kio (règle de Google). */
const CHUNK = 8 * 1024 * 1024;
/** Catégorie « Voyages et événements ». */
const DEFAULT_CATEGORY = '19';
const QUOTA_REASONS = new Set(['quotaExceeded', 'rateLimitExceeded', 'userRateLimitExceeded', 'uploadLimitExceeded']);

export interface YouTubeOptions {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  privacyStatus: YouTubePrivacy;
  /** Projet Google audité par YouTube (`YOUTUBE_API_AUDITED`) ; sinon toute vidéo part en privé, avec la mention. */
  audited?: boolean;
  categoryId?: string;
  /** Taille des morceaux (tests) ; 8 Mio par défaut. */
  chunkSize?: number;
  store?: OAuthTokenStore | null;
  storeOrigin?: string;
  reloadBeforeRefresh?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface VideoResource { id?: string; status?: { uploadStatus?: string; privacyStatus?: string; rejectionReason?: string } }
interface CommentThread {
  snippet?: {
    channelId?: string;
    topLevelComment?: { id?: string; snippet?: { authorDisplayName?: string; authorChannelId?: { value?: string }; textOriginal?: string; textDisplay?: string; publishedAt?: string } };
  };
}

/** Titre de la vidéo : 100 caractères au plus, sans chevrons (refusés par YouTube). */
export function youtubeTitle(input: Pick<SocialPublishInput, 'title' | 'body'>): string {
  const raw = (input.title?.trim() || input.body.split('\n').find((l) => l.trim())?.trim() || 'Neomoov').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  return raw.length > 100 ? `${raw.slice(0, 99).trimEnd()}…` : raw;
}

/** Description : 5 000 octets au plus, sans chevrons ; `#Shorts` ajouté aux vidéos courtes. */
export function youtubeDescription(text: string, format: SocialPublishInput['format']): string {
  let description = text.replace(/[<>]/g, '').trim();
  if (format === 'short' && !/#shorts\b/i.test(description)) description = `${description}\n\n#Shorts`;
  while (Buffer.byteLength(description, 'utf8') > 5_000) description = description.slice(0, -50);
  return description;
}

/** Mots-clés : mots-clics sans `#`, 500 caractères au plus en tout. */
export function youtubeTags(hashtags: readonly string[]): string[] {
  const tags: string[] = [];
  let length = 0;
  for (const tag of hashtags.map((h) => h.replace(/^#+/, '').trim()).filter(Boolean)) {
    if (length + tag.length + 1 > 500) break;
    tags.push(tag);
    length += tag.length + 1;
  }
  return tags;
}

/** Secondes jusqu'à minuit, heure du Pacifique (remise à zéro du quota quotidien de YouTube). */
export function secondsUntilPacificMidnight(now: Date): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(now).map((p) => [p.type, p.value]));
  const elapsed = (Number(parts['hour']) % 24) * 3_600 + Number(parts['minute']) * 60 + Number(parts['second']);
  return Math.max(60, 86_400 - elapsed);
}

const quotaReason = (data: unknown): string | undefined => (data as { error?: { errors?: Array<{ reason?: string }> } } | null)?.error?.errors?.[0]?.reason;

export class YouTubePublisher implements SocialPublisher {
  readonly name = 'youtube';
  readonly configured = true;
  readonly space = 'youtube' as const;
  private readonly api: SocialApi;

  constructor(private readonly options: YouTubeOptions) {
    const session = new OAuthSession({
      provider: 'youtube', label: 'YouTube', tokenUrl: GOOGLE_TOKEN_URL, clientId: options.clientId, clientSecret: options.clientSecret, refreshToken: options.refreshToken,
      clientAuth: 'body', ...storeBinding(options), ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}), ...(options.now ? { now: options.now } : {}),
    });
    this.api = new SocialApi({
      label: 'YouTube', session, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}), ...(options.now ? { now: options.now } : {}), errorMessage: googleErrorMessage,
      // Quota quotidien épuisé : YouTube répond 403 ; traité comme une limite atteinte (nouvel essai après minuit, heure du Pacifique).
      rateLimited: (status, data) => status === 403 && QUOTA_REASONS.has(quotaReason(data) ?? ''),
    });
  }

  toJSON() {
    return { name: this.name, space: this.space, privacyStatus: this.options.privacyStatus, audited: Boolean(this.options.audited), configured: true };
  }

  /** Le délai d'un quota épuisé n'est pas donné par YouTube : il court jusqu'à minuit, heure du Pacifique. */
  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof AppError && error.code === 'SOCIAL_RATE_LIMITED' && !(error.details as { retryAfterSeconds?: number | null } | undefined)?.retryAfterSeconds) {
        throw new AppError(error.code, error.message, error.status, { retryAfterSeconds: secondsUntilPacificMidnight(new Date(this.options.now?.() ?? Date.now())) });
      }
      throw error;
    }
  }

  async publish(input: SocialPublishInput): Promise<SocialPublishResult> {
    const media = input.media;
    if (!media || !media.contentType.startsWith('video/')) throw new AppError('SOCIAL_MEDIA_REQUIRED', 'YouTube exige une vidéo MP4 (montage ffmpeg sur le serveur)', HttpStatus.UNPROCESSABLE_ENTITY);
    // Projet non audité : YouTube verrouille toute vidéo envoyée par l'API en privé ; on l'envoie privée d'emblée.
    const requested: YouTubePrivacy = input.draft ? 'private' : this.options.audited ? this.options.privacyStatus : 'private';
    const language = input.language === 'en' ? 'en-CA' : 'fr-CA';
    const metadata = {
      snippet: { title: youtubeTitle(input), description: youtubeDescription(input.text, input.format), tags: youtubeTags(input.hashtags), categoryId: this.options.categoryId ?? DEFAULT_CATEGORY, defaultLanguage: language, defaultAudioLanguage: language },
      status: { privacyStatus: requested, selfDeclaredMadeForKids: false, embeddable: true },
    };
    return this.guard(async () => {
      const init = await this.api.call(`${UPLOAD}?uploadType=resumable&part=snippet,status`, {
        method: 'POST', json: metadata, headers: { 'X-Upload-Content-Length': String(media.body.length), 'X-Upload-Content-Type': media.contentType },
      });
      const location = init.headers.get('location');
      if (!location) throw new AppError('SOCIAL_PROVIDER_ERROR', 'YouTube : adresse de téléversement absente', HttpStatus.BAD_GATEWAY);
      const video = await this.upload(location, media.body, media.contentType);
      if (video.status?.uploadStatus === 'rejected' || video.status?.uploadStatus === 'failed') {
        throw new AppError('SOCIAL_VALIDATION_ERROR', `YouTube : vidéo ${video.status.uploadStatus} (${video.status.rejectionReason ?? 'sans motif'})`, HttpStatus.UNPROCESSABLE_ENTITY);
      }
      const id = video.id!;
      const privacy = video.status?.privacyStatus ?? requested;
      const notice = input.draft ? null
        : !this.options.audited ? 'YouTube : vidéo téléversée en privé, projet Google pas encore audité par YouTube (la rendre publique dans YouTube Studio, ou attendre l\'audit)'
        : privacy !== requested ? `YouTube : vidéo gardée en ${privacy} par YouTube (${requested} demandé) : vérifier l'audit du projet` : null;
      return { externalId: id, url: input.format === 'short' ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`, draft: privacy === 'private', notice };
    });
  }

  /** Téléversement résumable par morceaux : 308 tant qu'il en manque (en-tête `Range` : octets reçus), puis la ressource vidéo. */
  private async upload(location: string, body: Buffer, contentType: string): Promise<VideoResource> {
    const total = body.length;
    const chunk = this.options.chunkSize ?? CHUNK;
    let offset = 0;
    for (let round = 0; round < Math.ceil(total / chunk) * 3 + 3; round += 1) {
      const end = Math.min(offset + chunk, total) - 1;
      const response = await this.api.call<VideoResource>(location, {
        method: 'PUT', raw: { body: body.subarray(offset, end + 1), contentType }, headers: { 'Content-Range': `bytes ${offset}-${end}/${total}` }, accept: [308], timeoutMs: 300_000,
      });
      if (response.status !== 308) {
        if (!response.data?.id) throw new AppError('SOCIAL_PROVIDER_ERROR', 'YouTube : téléversement terminé sans identifiant de vidéo', HttpStatus.BAD_GATEWAY);
        return response.data;
      }
      // Octets reçus par YouTube : la suite part du premier octet manquant (sans en-tête, rien n'a été gardé).
      const received = /bytes=0-(\d+)/.exec(response.headers.get('range') ?? '');
      offset = received ? Number(received[1]) + 1 : 0;
    }
    throw new AppError('SOCIAL_PROVIDER_ERROR', 'YouTube : téléversement interrompu (trop de reprises)', HttpStatus.BAD_GATEWAY);
  }

  /** Vues (portée), mentions « J'aime » et commentaires (interactions) ; YouTube ne compte pas de clics dans cette API. */
  async metrics(ref: PublishedRef): Promise<SocialMetrics> {
    const { data } = await this.guard(() => this.api.call<{ items?: Array<{ statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }> }>(`${API}/videos?part=statistics&id=${encodeURIComponent(ref.externalId)}`));
    const stats = data?.items?.[0]?.statistics;
    if (!stats) throw AppError.notFound('SOCIAL_POST_NOT_FOUND', 'YouTube : vidéo introuvable (supprimée ou privée)');
    const n = (v: string | undefined) => Number(v ?? 0) || 0;
    return { reach: n(stats.viewCount), interactions: n(stats.likeCount) + n(stats.commentCount), clicks: 0, collectedAt: new Date() };
  }

  /** Commentaires de premier niveau reçus depuis `since`, hors ceux de la chaîne elle-même. */
  async comments(ref: PublishedRef, since: Date): Promise<SocialComment[]> {
    const { data } = await this.guard(() => this.api.call<{ items?: CommentThread[] }>(`${API}/commentThreads?part=snippet&videoId=${encodeURIComponent(ref.externalId)}&maxResults=50&order=time&textFormat=plainText`));
    const out: SocialComment[] = [];
    for (const thread of data?.items ?? []) {
      const top = thread.snippet?.topLevelComment;
      const text = top?.snippet?.textOriginal ?? top?.snippet?.textDisplay;
      const postedAt = new Date(top?.snippet?.publishedAt ?? 0);
      if (!top?.id || !text || postedAt <= since) continue;
      if (thread.snippet?.channelId && top.snippet?.authorChannelId?.value === thread.snippet.channelId) continue;
      out.push({ externalId: top.id, author: top.snippet?.authorDisplayName ?? null, text: text.slice(0, 4_000), postedAt });
    }
    return out;
  }

  async replyComment(_ref: PublishedRef, commentExternalId: string, text: string): Promise<{ externalId: string }> {
    const { data } = await this.guard(() => this.api.call<{ id?: string }>(`${API}/comments?part=snippet`, { method: 'POST', json: { snippet: { parentId: commentExternalId, textOriginal: text.slice(0, 10_000) } } }));
    if (!data?.id) throw new AppError('SOCIAL_PROVIDER_ERROR', 'YouTube : réponse sans identifiant', HttpStatus.BAD_GATEWAY);
    return { externalId: data.id };
  }

  credentials(): Promise<CredentialStatus> {
    return this.api.session.credentials();
  }
}
