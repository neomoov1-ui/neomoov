/**
 * Fiche Google (Business Profile) réelle (3 octobre 2026) : publications locales (`localPosts` de l'API My Business v4 :
 * texte de 1 500 caractères au plus, bouton RÉSERVER ou EN SAVOIR PLUS vers les adresses de `marketing.cta_urls`, photo
 * par l'adresse signée du stockage, que Google télécharge), avis lus et réponses (`reviews`, `updateReply`) branchés
 * comme les commentaires, mesures de la fiche (API Business Profile Performance : Google ne donne plus de mesures par
 * publication, la lecture porte sur la fiche entière depuis la publication). OAuth 2.0 du propriétaire ou gestionnaire
 * de la fiche, jeton de rafraîchissement, portée `business.manage` : docs/marketing/connecteurs.md.
 */
import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../common/app-error.js';
import type { CredentialStatus, PublishedRef, SocialComment, SocialMetrics, SocialPublishInput, SocialPublishResult, SocialPublisher } from '../marketing.types.js';
import { OAuthSession, SocialApi, type OAuthTokenStore } from './oauth.js';

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://mybusiness.googleapis.com/v4';
const PERFORMANCE = 'https://businessprofileperformance.googleapis.com/v1';
/** Longueur maximale du texte d'une publication de la fiche (règle de Google, comme `SPACE_RULES.google_business`). */
export const GOOGLE_POST_MAX = 1_500;

export interface GoogleBusinessOptions {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Identifiant numérique du compte (`accounts/<id>`) et de l'établissement (`locations/<id>`). */
  accountId: string;
  locationId: string;
  store?: OAuthTokenStore | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface LocalPost { name?: string; searchUrl?: string; state?: string; createTime?: string }
interface Review {
  name?: string;
  reviewer?: { displayName?: string; isAnonymous?: boolean };
  starRating?: string;
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: { comment?: string };
}
interface DailySeries { dailyMetric?: string; timeSeries?: { datedValues?: Array<{ value?: string | number }> } }

const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
const IMPRESSIONS = ['BUSINESS_IMPRESSIONS_DESKTOP_MAPS', 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', 'BUSINESS_IMPRESSIONS_MOBILE_MAPS', 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH'];
const INTERACTIONS = ['CALL_CLICKS', 'BUSINESS_DIRECTION_REQUESTS', 'BUSINESS_BOOKINGS', 'BUSINESS_CONVERSATIONS'];
const DAILY_METRICS = [...IMPRESSIONS, ...INTERACTIONS, 'WEBSITE_CLICKS'];

/** Message d'erreur des API Google (`{ error: { message, status } }`). */
export function googleErrorMessage(data: unknown): string | null {
  const error = (data as { error?: { message?: string; status?: string; errors?: Array<{ reason?: string }> } } | null)?.error;
  if (!error) return null;
  const reason = error.errors?.[0]?.reason ?? error.status;
  return `${error.message ?? 'erreur'}${reason ? ` (${reason})` : ''}`;
}

/** Texte de la publication : l'adresse de l'appel à l'action passe par le bouton, pas dans le texte. */
export function googlePostSummary(text: string, ctaUrl: string | null): string {
  const summary = ctaUrl ? text.split(ctaUrl).join('').replace(/\n{3,}/g, '\n\n').trim() : text.trim();
  return summary;
}

const dateParts = (date: Date, prefix: string): Array<[string, string]> => [
  [`${prefix}.year`, String(date.getUTCFullYear())],
  [`${prefix}.month`, String(date.getUTCMonth() + 1)],
  [`${prefix}.day`, String(date.getUTCDate())],
];

export class GoogleBusinessPublisher implements SocialPublisher {
  readonly name = 'google-business';
  readonly configured = true;
  readonly space = 'google_business' as const;
  private readonly api: SocialApi;
  /** Un avis n'est rendu qu'à une seule publication (la première qui le lit), pour une seule réponse. */
  private readonly reviewOwner = new Map<string, string>();

  constructor(private readonly options: GoogleBusinessOptions) {
    const session = new OAuthSession({
      provider: 'google-business', label: 'Fiche Google', tokenUrl: GOOGLE_TOKEN_URL, clientId: options.clientId, clientSecret: options.clientSecret, refreshToken: options.refreshToken,
      clientAuth: 'body', store: options.store ?? null, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}), ...(options.now ? { now: options.now } : {}),
    });
    this.api = new SocialApi({
 label: 'Fiche Google', session, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}), ...(options.now ? { now: options.now } : {}), errorMessage: googleErrorMessage });
  }

  toJSON() {
    return { name: this.name, space: this.space, locationId: this.options.locationId, configured: true };
  }

  private get location(): string {
    return `accounts/${this.options.accountId}/locations/${this.options.locationId}`;
  }

  private now(): Date {
    return new Date(this.options.now?.() ?? Date.now());
  }

  async publish(input: SocialPublishInput): Promise<SocialPublishResult> {
    const summary = googlePostSummary(input.text, input.ctaUrl);
    if (!summary) throw new AppError('SOCIAL_VALIDATION_ERROR', 'Fiche Google : texte vide', HttpStatus.UNPROCESSABLE_ENTITY);
    if (summary.length > GOOGLE_POST_MAX) throw new AppError('SOCIAL_VALIDATION_ERROR', `Fiche Google : ${summary.length} caractères, ${GOOGLE_POST_MAX} au plus`, HttpStatus.UNPROCESSABLE_ENTITY);
    const post: Record<string, unknown> = { languageCode: input.language === 'en' ? 'en' : 'fr', summary, topicType: 'STANDARD' };
    if (input.ctaUrl && input.cta !== 'none') post['callToAction'] = { actionType: input.cta === 'reserve' ? 'BOOK' : 'LEARN_MORE', url: input.ctaUrl };
    if (input.media?.url && input.media.contentType.startsWith('image/')) post['media'] = [{ mediaFormat: 'PHOTO', sourceUrl: input.media.url }];
    const { data } = await this.api.call<LocalPost>(`${API}/${this.location}/localPosts`, { method: 'POST', json: post });
    if (!data?.name) throw new AppError('SOCIAL_PROVIDER_ERROR', 'Fiche Google : publication sans identifiant', HttpStatus.BAD_GATEWAY);
    if (data.state === 'REJECTED') throw new AppError('SOCIAL_VALIDATION_ERROR', 'Fiche Google : publication refusée par Google (règles des publications)', HttpStatus.UNPROCESSABLE_ENTITY);
    return { externalId: data.name, url: data.searchUrl ?? null, draft: false };
  }

  /**
   * Mesures de la fiche entière (impressions dans la recherche et Maps, appels, itinéraires, réservations, clics vers le
   * site) du jour de la publication à aujourd'hui : Google ne mesure plus une publication seule. Les chiffres de deux
   * publications proches se recouvrent ; les données de Google arrivent avec deux ou trois jours de retard.
   */
  async metrics(ref: PublishedRef): Promise<SocialMetrics> {
    const { data: post } = await this.api.call<LocalPost>(`${API}/${ref.externalId}`);
    const end = this.now();
    const start = post?.createTime ? new Date(post.createTime) : end;
    const query = new URLSearchParams([...DAILY_METRICS.map((m): [string, string] => ['dailyMetrics', m]), ...dateParts(start, 'dailyRange.startDate'), ...dateParts(end, 'dailyRange.endDate')]);
    const { data } = await this.api.call<{ multiDailyMetricTimeSeries?: Array<{ dailyMetricTimeSeries?: DailySeries[] }> }>(`${PERFORMANCE}/locations/${this.options.locationId}:fetchMultiDailyMetricsTimeSeries?${query}`);
    const totals = new Map<string, number>();
    for (const group of data?.multiDailyMetricTimeSeries ?? []) {
      for (const series of group.dailyMetricTimeSeries ?? []) {
        const sum = (series.timeSeries?.datedValues ?? []).reduce((n, v) => n + (Number(v.value ?? 0) || 0), 0);
        if (series.dailyMetric) totals.set(series.dailyMetric, (totals.get(series.dailyMetric) ?? 0) + sum);
      }
    }
    const total = (names: string[]) => names.reduce((n, name) => n + (totals.get(name) ?? 0), 0);
    return {
      reach: total(IMPRESSIONS), interactions: total(INTERACTIONS), clicks: totals.get('WEBSITE_CLICKS') ?? 0, collectedAt: end,
      raw: { scope: 'location', state: post?.state ?? null, from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) },
    };
  }

  /** Avis de la fiche reçus depuis `since`, sans réponse encore ; la note est gardée (3 ou moins : jamais de réponse automatique). */
  async comments(ref: PublishedRef, since: Date): Promise<SocialComment[]> {
    const { data } = await this.api.call<{ reviews?: Review[] }>(`${API}/${this.location}/reviews?pageSize=50&orderBy=${encodeURIComponent('updateTime desc')}`);
    if (this.reviewOwner.size > 5_000) this.reviewOwner.clear();
    const out: SocialComment[] = [];
    for (const review of data?.reviews ?? []) {
      const postedAt = new Date(review.createTime ?? review.updateTime ?? 0);
      if (!review.name || review.reviewReply || postedAt <= since) continue;
      const owner = this.reviewOwner.get(review.name) ?? ref.itemId;
      this.reviewOwner.set(review.name, owner);
      if (owner !== ref.itemId) continue;
      const rating = STARS[review.starRating ?? ''] ?? null;
      const comment = review.comment?.trim();
      const text = `Avis ${rating ?? '?'}/5${comment ? ` : ${comment}` : ', sans commentaire'}`;
      out.push({ externalId: review.name, author: review.reviewer?.isAnonymous ? null : (review.reviewer?.displayName ?? null), text: text.slice(0, 4_000), postedAt, rating });
    }
    return out;
  }

  /** Réponse publique à un avis (`updateReply` : une seule réponse par avis, remplacée si elle existe). */
  async replyComment(_ref: PublishedRef, commentExternalId: string, text: string): Promise<{ externalId: string }> {
    if (!/^accounts\/[^/]+\/locations\/[^/]+\/reviews\/[^/]+$/.test(commentExternalId)) throw new AppError('SOCIAL_VALIDATION_ERROR', 'Fiche Google : identifiant d\'avis invalide', HttpStatus.UNPROCESSABLE_ENTITY);
    await this.api.call<{ comment?: string }>(`${API}/${commentExternalId}/reply`, { method: 'PUT', json: { comment: text.slice(0, 4_096) } });
    return { externalId: `${commentExternalId}/reply` };
  }

  credentials(): Promise<CredentialStatus> {
    return this.api.session.credentials();
  }
}
