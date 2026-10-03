/**
 * LinkedIn réel (page entreprise, Community Management API, 3 octobre 2026) : publication texte et image (`/rest/posts`,
 * image téléversée par `/rest/images?action=initializeUpload`), commentaires et réponses (`socialActions`), mesures
 * (`organizationalEntityShareStatistics`). En-têtes `LinkedIn-Version` (`LINKEDIN_API_VERSION`) et
 * `X-Restli-Protocol-Version: 2.0.0`. Jeton d'accès de 60 jours posé à la main, ou renouvelé par le jeton de
 * rafraîchissement (un an) quand LinkedIn en donne un ; la passe quotidienne de la diffusion alerte le personnel avant
 * l'échéance (date connue par `LINKEDIN_ACCESS_TOKEN_EXPIRES_AT`, l'échange ou l'introspection du jeton).
 */
import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../common/app-error.js';
import type { CredentialStatus, PublishedRef, SocialComment, SocialMetrics, SocialPublishInput, SocialPublishResult, SocialPublisher } from '../marketing.types.js';
import { cleanDetail, OAuthSession, SocialApi, type OAuthTokenStore } from './oauth.js';

const REST = 'https://api.linkedin.com/rest';
export const LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const INTROSPECT_URL = 'https://www.linkedin.com/oauth/v2/introspectToken';

export interface LinkedInOptions {
  /** Identifiant numérique de la page entreprise (`urn:li:organization:<id>`). */
  organizationId: string;
  accessToken: string | null;
  /** Échéance du jeton d'accès posé à la main (millisecondes), si elle est connue. */
  accessExpiresAt: number | null;
  refreshToken: string | null;
  clientId: string | null;
  clientSecret: string | null;
  /** Version mensuelle de l'API (`AAAAMM`). */
  version: string;
  store?: OAuthTokenStore | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface LinkedInComment {
  id?: string;
  commentUrn?: string;
  $URN?: string;
  actor?: string;
  object?: string;
  message?: { text?: string };
  created?: { time?: number };
}
interface ShareStatistics { uniqueImpressionsCount?: number; impressionCount?: number; clickCount?: number; likeCount?: number; commentCount?: number; shareCount?: number }

/** Message d'erreur de l'API LinkedIn (`{ message, serviceErrorCode, status }`). */
export function linkedinErrorMessage(data: unknown): string | null {
  const body = data as { message?: string; serviceErrorCode?: number; code?: string } | null;
  if (!body || typeof body !== 'object' || !body.message) return null;
  return `${body.message}${body.serviceErrorCode ? ` (${body.serviceErrorCode})` : body.code ? ` (${body.code})` : ''}`;
}

const RESERVED = /[\\|{}@[\]()<>*_~#]/g;

/**
 * Texte au format « little text » de LinkedIn : caractères réservés échappés (sinon la publication est refusée ou
 * tronquée), mots-clics en début de mot écrits en modèle `{hashtag|\#|mot}` pour rester cliquables.
 */
export function linkedinCommentary(text: string): string {
  const out: string[] = [];
  let last = 0;
  for (const match of text.matchAll(/(^|\s)#([\p{L}\p{N}_]+)/gu)) {
    const start = (match.index ?? 0) + match[1]!.length;
    out.push(text.slice(last, start).replace(RESERVED, (c) => `\\${c}`), `{hashtag|\\#|${match[2]!}}`);
    last = start + 1 + match[2]!.length;
  }
  out.push(text.slice(last).replace(RESERVED, (c) => `\\${c}`));
  return out.join('');
}

/** Publication visée par un commentaire `urn:li:comment:(<publication>,<id>)` (objet d'une réponse imbriquée). */
export function commentParent(commentUrn: string): string | null {
  return /^urn:li:comment:\((.+),[^,()]+\)$/.exec(commentUrn)?.[1] ?? null;
}

export class LinkedInPublisher implements SocialPublisher {
  readonly name = 'linkedin';
  readonly configured = true;
  readonly space = 'linkedin' as const;
  private readonly api: SocialApi;
  readonly #accessToken: string | null;
  readonly #fetch: typeof fetch;

  constructor(private readonly options: LinkedInOptions) {
    this.#accessToken = options.accessToken;
    this.#fetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
    const session = new OAuthSession({
      provider: 'linkedin', label: 'LinkedIn', tokenUrl: LINKEDIN_TOKEN_URL, clientId: options.clientId, clientSecret: options.clientSecret, refreshToken: options.refreshToken,
      accessToken: options.accessToken, accessExpiresAt: options.accessExpiresAt, clientAuth: 'body', store: options.store ?? null,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}), ...(options.now ? { now: options.now } : {}),
    });
    this.api = new SocialApi({
      label: 'LinkedIn', session, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}), ...(options.now ? { now: options.now } : {}), errorMessage: linkedinErrorMessage,
      headers: { 'LinkedIn-Version': options.version, 'X-Restli-Protocol-Version': '2.0.0' },
    });
  }

  toJSON() {
    return { name: this.name, space: this.space, organizationId: this.options.organizationId, version: this.options.version, configured: true };
  }

  private get organization(): string {
    return `urn:li:organization:${this.options.organizationId}`;
  }

  /** Image téléversée chez LinkedIn (adresse de téléversement fournie par `initializeUpload`) : son URN. */
  private async uploadImage(media: NonNullable<SocialPublishInput['media']>): Promise<string> {
    const { data } = await this.api.call<{ value?: { uploadUrl?: string; image?: string } }>(`${REST}/images?action=initializeUpload`, { method: 'POST', json: { initializeUploadRequest: { owner: this.organization } } });
    const uploadUrl = data?.value?.uploadUrl;
    const image = data?.value?.image;
    if (!uploadUrl || !image) throw new AppError('SOCIAL_PROVIDER_ERROR', 'LinkedIn : adresse de téléversement de l\'image absente', HttpStatus.BAD_GATEWAY);
    await this.api.call(uploadUrl, { method: 'PUT', raw: { body: media.body, contentType: media.contentType }, timeoutMs: 120_000 });
    return image;
  }

  async publish(input: SocialPublishInput): Promise<SocialPublishResult> {
    const commentary = linkedinCommentary(input.text);
    if (input.text.length > 3_000) throw new AppError('SOCIAL_VALIDATION_ERROR', `LinkedIn : ${input.text.length} caractères, 3 000 au plus`, HttpStatus.UNPROCESSABLE_ENTITY);
    // Vidéo : téléversement en plusieurs parties non livré ; la publication part en texte seul.
    const image = input.media && input.media.contentType.startsWith('image/') ? await this.uploadImage(input.media) : null;
    const post = {
      author: this.organization,
      commentary,
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: input.draft ? 'DRAFT' : 'PUBLISHED',
      isReshareDisabledByAuthor: false,
      ...(image ? { content: { media: { id: image, ...(input.title ? { title: input.title.slice(0, 200) } : {}) } } } : {}),
    };
    const response = await this.api.call<{ id?: string }>(`${REST}/posts`, { method: 'POST', json: post });
    const id = response.headers.get('x-restli-id') ?? response.data?.id;
    if (!id) throw new AppError('SOCIAL_PROVIDER_ERROR', 'LinkedIn : publication sans identifiant', HttpStatus.BAD_GATEWAY);
    return { externalId: id, url: `https://www.linkedin.com/feed/update/${id}/`, draft: input.draft };
  }

  /** Statistiques de la publication pour la page : impressions uniques (portée), réactions, commentaires et partages, clics. */
  async metrics(ref: PublishedRef): Promise<SocialMetrics> {
    const kind = ref.externalId.startsWith('urn:li:ugcPost:') ? 'ugcPosts' : 'shares';
    const url = `${REST}/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(this.organization)}&${kind}=List(${encodeURIComponent(ref.externalId)})`;
    const { data } = await this.api.call<{ elements?: Array<{ totalShareStatistics?: ShareStatistics }> }>(url);
    const stats = data?.elements?.[0]?.totalShareStatistics ?? {};
    return {
      reach: stats.uniqueImpressionsCount ?? stats.impressionCount ?? 0, interactions: (stats.likeCount ?? 0) + (stats.commentCount ?? 0) + (stats.shareCount ?? 0), clicks: stats.clickCount ?? 0,
      collectedAt: new Date(), raw: { impressions: stats.impressionCount ?? null },
    };
  }

  async comments(ref: PublishedRef, since: Date): Promise<SocialComment[]> {
    const { data } = await this.api.call<{ elements?: LinkedInComment[] }>(`${REST}/socialActions/${encodeURIComponent(ref.externalId)}/comments?count=50`);
    const out: SocialComment[] = [];
    for (const c of data?.elements ?? []) {
      const urn = c.commentUrn ?? c.$URN ?? (c.id ? `urn:li:comment:(${c.object ?? ref.externalId},${c.id})` : null);
      const postedAt = new Date(c.created?.time ?? 0);
      if (!urn || !c.message?.text || c.actor === this.organization || postedAt <= since) continue;
      // L'API ne donne que l'URN de l'auteur (nom réservé aux partenaires) : la boîte unifiée l'affiche tel quel.
      out.push({ externalId: urn, author: c.actor ?? null, text: c.message.text.slice(0, 4_000), postedAt });
    }
    return out;
  }

  /** Réponse de la page sous le commentaire (commentaire imbriqué). */
  async replyComment(ref: PublishedRef, commentExternalId: string, text: string): Promise<{ externalId: string }> {
    const object = commentParent(commentExternalId) ?? ref.externalId;
    const response = await this.api.call<{ commentUrn?: string; $URN?: string; id?: string }>(`${REST}/socialActions/${encodeURIComponent(commentExternalId)}/comments`, {
      method: 'POST', json: { actor: this.organization, object, parentComment: commentExternalId, message: { text: text.slice(0, 1_250) } },
    });
    const id = response.data?.commentUrn ?? response.data?.$URN ?? response.headers.get('x-restli-id') ?? response.data?.id;
    if (!id) throw new AppError('SOCIAL_PROVIDER_ERROR', 'LinkedIn : réponse sans identifiant', HttpStatus.BAD_GATEWAY);
    return { externalId: id };
  }

  /**
   * Échéance de l'autorisation : celle du jeton de rafraîchissement (rendue par l'échange), sinon celle du jeton d'accès
   * (variable `LINKEDIN_ACCESS_TOKEN_EXPIRES_AT`, ou introspection du jeton avec les identifiants de l'application).
   */
  async credentials(): Promise<CredentialStatus> {
    const status = await this.api.session.credentials();
    if (status.renewable || status.renewBy || !this.options.clientId || !this.options.clientSecret || !this.#accessToken) return status;
    try {
      const form = new URLSearchParams({ client_id: this.options.clientId, client_secret: this.options.clientSecret, token: this.#accessToken });
      const response = await this.#fetch(INTROSPECT_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString(), signal: AbortSignal.timeout(15_000) });
      const body = (await response.json().catch(() => ({}))) as { active?: boolean; expires_at?: number; status?: string };
      if (!response.ok) return { ...status, problem: `LinkedIn : introspection du jeton refusée (HTTP ${response.status})` };
      if (body.active === false) return { ...status, renewBy: body.expires_at ? new Date(body.expires_at * 1_000) : new Date(), problem: `LinkedIn : jeton ${cleanDetail(body.status ?? 'inactif', 40)}, nouvelle autorisation à faire` };
      return { ...status, renewBy: body.expires_at ? new Date(body.expires_at * 1_000) : null };
    } catch (error) {
      return { ...status, problem: `LinkedIn : introspection impossible (${error instanceof Error ? cleanDetail(error.message, 80) : 'erreur'})` };
    }
  }
}
