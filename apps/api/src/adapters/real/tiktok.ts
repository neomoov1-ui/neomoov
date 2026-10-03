/**
 * TikTok réel (Content Posting API, publication directe, 3 octobre 2026) : informations du créateur
 * (`creator_info/query`), initialisation (`post/publish/video/init/`) par téléversement du fichier en morceaux
 * (`FILE_UPLOAD`, par défaut) ou par l'adresse signée du stockage (`PULL_FROM_URL`, domaine à faire vérifier chez
 * TikTok), suivi (`post/publish/status/fetch/`) jusqu'à la mise en ligne, mesures (`video/query`, portée `video.list`).
 * Visibilité `TIKTOK_PRIVACY_LEVEL` (`PUBLIC_TO_EVERYONE` par défaut) : tant que l'application n'a pas passé l'audit de
 * TikTok, seule `SELF_ONLY` (privée) est acceptée ; le connecteur s'y replie de lui-même. Contenu de marque déclaré
 * (« votre marque »). Pas de lecture des commentaires dans l'API publique : la diffusion n'en reçoit aucun.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../common/app-error.js';
import type { CredentialStatus, PublishedRef, SocialComment, SocialMetrics, SocialPublishInput, SocialPublishResult, SocialPublisher } from '../marketing.types.js';
import { chunkRanges, OAuthSession, SocialApi, type OAuthTokenStore } from './oauth.js';

const API = 'https://open.tiktokapis.com/v2';
export const TIKTOK_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
export const TIKTOK_PRIVACY_LEVELS = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'] as const;
export type TikTokPrivacy = (typeof TIKTOK_PRIVACY_LEVELS)[number];
/** Morceaux de 10 Mio (TikTok : de 5 à 64 Mio, le dernier absorbe le reste) ; une vidéo de moins de 64 Mio part d'un seul tenant. */
const CHUNK = 10 * 1024 * 1024;
const SINGLE_MAX = 64 * 1024 * 1024;
const RATE_CODES = new Set(['rate_limit_exceeded', 'spam_risk_too_many_posts', 'spam_risk_user_banned_from_posting', 'reached_active_user_cap']);

export interface TikTokOptions {
  clientKey: string;
  clientSecret: string;
  refreshToken: string;
  privacyLevel: TikTokPrivacy;
  /** `file` : téléversement du fichier ; `url` : TikTok télécharge l'adresse signée (domaine vérifié chez TikTok). */
  uploadMode: 'file' | 'url';
  store?: OAuthTokenStore | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Attente entre deux lectures de l'état (tests : 1 ms). */
  pollMs?: number;
  /** Taille des morceaux (tests). */
  chunkSize?: number;
}

interface TikTokEnvelope<T> { data?: T; error?: { code?: string; message?: string; log_id?: string } }
interface CreatorInfo { privacy_level_options?: string[]; max_video_post_duration_sec?: number; comment_disabled?: boolean; duet_disabled?: boolean; stitch_disabled?: boolean }
interface PublishStatus { status?: string; fail_reason?: string; publicaly_available_post_id?: Array<string | number> }

/** Message d'erreur de TikTok (`{ error: { code, message } }`). */
export function tiktokErrorMessage(data: unknown): string | null {
  const error = (data as TikTokEnvelope<unknown> | null)?.error;
  if (!error?.code || error.code === 'ok') return null;
  return `${error.message || error.code} (${error.code})`;
}

/** Plan du téléversement : un seul morceau jusqu'à 64 Mio, sinon des morceaux de 10 Mio (le dernier absorbe le reste). */
export function tiktokChunks(size: number, forced?: number): { chunkSize: number; count: number } {
  const chunk = forced ?? (size <= SINGLE_MAX ? size : CHUNK);
  if (chunk >= size) return { chunkSize: size, count: 1 };
  return { chunkSize: chunk, count: Math.max(1, Math.floor(size / chunk)) };
}

export class TikTokPublisher implements SocialPublisher {
  readonly name = 'tiktok';
  readonly configured = true;
  readonly space = 'tiktok' as const;
  private readonly api: SocialApi;

  constructor(private readonly options: TikTokOptions) {
    const session = new OAuthSession({
      provider: 'tiktok', label: 'TikTok', tokenUrl: TIKTOK_TOKEN_URL, clientId: options.clientKey, clientSecret: options.clientSecret, refreshToken: options.refreshToken, clientAuth: 'tiktok', rotates: true,
      store: options.store ?? null, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}), ...(options.now ? { now: options.now } : {}),
    });
    this.api = new SocialApi({
      label: 'TikTok', session, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}), errorMessage: tiktokErrorMessage,
      rateLimited: (_status, data) => RATE_CODES.has((data as TikTokEnvelope<unknown> | null)?.error?.code ?? ''),
    });
  }

  toJSON() {
    return { name: this.name, space: this.space, privacyLevel: this.options.privacyLevel, uploadMode: this.options.uploadMode, configured: true };
  }

  /** Appel JSON de TikTok : une enveloppe `error.code` différente de `ok` est une erreur, même sous un statut 200. */
  private async post<T>(path: string, json: unknown): Promise<T> {
    const { data } = await this.api.call<TikTokEnvelope<T>>(`${API}${path}`, { method: 'POST', json });
    const code = data?.error?.code;
    if (code && code !== 'ok') throw new AppError(RATE_CODES.has(code) ? 'SOCIAL_RATE_LIMITED' : 'SOCIAL_PROVIDER_ERROR', `TikTok sur ${path} : ${tiktokErrorMessage(data)}`, RATE_CODES.has(code) ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.BAD_GATEWAY, RATE_CODES.has(code) ? { retryAfterSeconds: null } : undefined);
    return (data?.data ?? {}) as T;
  }

  /** Visibilité demandée si le créateur l'autorise, sinon privée (`SELF_ONLY`). */
  private privacy(info: CreatorInfo): TikTokPrivacy {
    const options = info.privacy_level_options ?? [];
    if (!options.length || options.includes(this.options.privacyLevel)) return this.options.privacyLevel;
    return 'SELF_ONLY';
  }

  async publish(input: SocialPublishInput): Promise<SocialPublishResult> {
    const media = input.media;
    if (!media || !media.contentType.startsWith('video/')) throw new AppError('SOCIAL_MEDIA_REQUIRED', 'TikTok exige une vidéo MP4 (montage ffmpeg sur le serveur)', HttpStatus.UNPROCESSABLE_ENTITY);
    if (this.options.uploadMode === 'url' && !media.url) throw new AppError('SOCIAL_MEDIA_REQUIRED', 'TikTok : adresse signée de la vidéo absente (stockage)', HttpStatus.UNPROCESSABLE_ENTITY);
    const info = await this.post<CreatorInfo>('/post/publish/creator_info/query/', {});
    let privacy = input.draft ? 'SELF_ONLY' : this.privacy(info);
    const plan = tiktokChunks(media.body.length, this.options.chunkSize);
    const init = (level: TikTokPrivacy) => this.post<{ publish_id?: string; upload_url?: string }>('/post/publish/video/init/', {
      post_info: {
        title: input.text.slice(0, 2_200), privacy_level: level, disable_comment: Boolean(info.comment_disabled), disable_duet: Boolean(info.duet_disabled), disable_stitch: Boolean(info.stitch_disabled),
        video_cover_timestamp_ms: 1_000, brand_content_toggle: false, brand_organic_toggle: true,
      },
      source_info: this.options.uploadMode === 'url'
        ? { source: 'PULL_FROM_URL', video_url: media.url }
        : { source: 'FILE_UPLOAD', video_size: media.body.length, chunk_size: plan.chunkSize, total_chunk_count: plan.count },
    });
    let started: { publish_id?: string; upload_url?: string };
    try {
      started = await init(privacy);
    } catch (error) {
      // Application non auditée : TikTok n'accepte que la visibilité privée ; nouvel essai en SELF_ONLY.
      if (privacy === 'SELF_ONLY' || !(error instanceof AppError) || !/unaudited_client/.test(error.message)) throw error;
      privacy = 'SELF_ONLY';
      started = await init(privacy);
    }
    if (!started.publish_id) throw new AppError('SOCIAL_PROVIDER_ERROR', 'TikTok : publication sans identifiant', HttpStatus.BAD_GATEWAY);
    if (this.options.uploadMode === 'file') {
      if (!started.upload_url) throw new AppError('SOCIAL_PROVIDER_ERROR', 'TikTok : adresse de téléversement absente', HttpStatus.BAD_GATEWAY);
      await this.upload(started.upload_url, media.body, media.contentType, plan);
    }
    const status = await this.waitPublished(started.publish_id);
    const postId = status.publicaly_available_post_id?.[0];
    return { externalId: postId ? String(postId) : `publish:${started.publish_id}`, url: postId ? `https://www.tiktok.com/video/${postId}` : null, draft: privacy === 'SELF_ONLY' };
  }

  /** Envoi des morceaux (`Content-Range`) vers l'adresse fournie par TikTok, sans le jeton (adresse déjà signée). */
  private async upload(url: string, body: Buffer, contentType: string, plan: { chunkSize: number; count: number }): Promise<void> {
    const ranges = chunkRanges(body.length, plan.chunkSize).slice(0, plan.count);
    // Le dernier morceau absorbe le reste (règle de TikTok).
    if (ranges.length) ranges[ranges.length - 1] = [ranges[ranges.length - 1]![0], body.length - 1];
    for (const [start, end] of ranges) {
      await this.api.call(url, { method: 'PUT', anonymous: true, raw: { body: body.subarray(start, end + 1), contentType }, headers: { 'Content-Range': `bytes ${start}-${end}/${body.length}` }, timeoutMs: 300_000 });
    }
  }

  /** État de la publication jusqu'à `PUBLISH_COMPLETE` (ou l'échec) ; une vidéo encore en traitement est rendue sans identifiant public. */
  private async waitPublished(publishId: string): Promise<PublishStatus> {
    let last: PublishStatus = {};
    for (let attempt = 0; attempt < 30; attempt += 1) {
      last = await this.post<PublishStatus>('/post/publish/status/fetch/', { publish_id: publishId });
      if (last.status === 'PUBLISH_COMPLETE') return last;
      if (last.status === 'FAILED') throw new AppError('SOCIAL_VALIDATION_ERROR', `TikTok : publication refusée (${last.fail_reason ?? 'sans motif'})`, HttpStatus.UNPROCESSABLE_ENTITY);
      await sleep(this.options.pollMs ?? 5_000);
    }
    return last;
  }

  /** Identifiant public de la vidéo : déjà connu, ou lu dans l'état de la publication (vidéo privée : aucun). */
  private async videoId(externalId: string): Promise<string | null> {
    if (!externalId.startsWith('publish:')) return externalId;
    const status = await this.post<PublishStatus>('/post/publish/status/fetch/', { publish_id: externalId.slice('publish:'.length) });
    const id = status.publicaly_available_post_id?.[0];
    return id ? String(id) : null;
  }

  /** Vues (portée), j'aime, commentaires et partages (interactions) ; une vidéo privée n'a pas de mesures publiques. */
  async metrics(ref: PublishedRef): Promise<SocialMetrics> {
    const id = await this.videoId(ref.externalId);
    if (!id) return { reach: 0, interactions: 0, clicks: 0, collectedAt: new Date(), raw: { private: true } };
    const data = await this.post<{ videos?: Array<{ view_count?: number; like_count?: number; comment_count?: number; share_count?: number }> }>('/video/query/?fields=id,view_count,like_count,comment_count,share_count', { filters: { video_ids: [id] } });
    const video = data.videos?.[0];
    if (!video) throw AppError.notFound('SOCIAL_POST_NOT_FOUND', 'TikTok : vidéo introuvable');
    return { reach: video.view_count ?? 0, interactions: (video.like_count ?? 0) + (video.comment_count ?? 0) + (video.share_count ?? 0), clicks: 0, collectedAt: new Date() };
  }

  /** L'API publique de TikTok ne donne pas les commentaires : aucun n'est lu (réponses dans l'application TikTok). */
  async comments(): Promise<SocialComment[]> {
    return [];
  }

  async replyComment(): Promise<{ externalId: string }> {
    throw new AppError('SOCIAL_UNSUPPORTED', 'TikTok : réponse aux commentaires non offerte par l\'API (à faire dans l\'application)', HttpStatus.NOT_IMPLEMENTED);
  }

  credentials(): Promise<CredentialStatus> {
    return this.api.session.credentials();
  }
}
