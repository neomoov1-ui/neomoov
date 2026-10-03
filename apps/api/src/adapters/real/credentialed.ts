/**
 * Connecteurs de diffusion tirés des identifiants des comptes (contrat `SOCIAL_CREDENTIALS`, 3 octobre 2026) : un
 * connecteur par espace qui demande les identifiants au fournisseur à chaque usage (un compte relié ou retiré dans My Hub
 * vaut aussitôt), garde l'adaptateur construit tant que les valeurs ne changent pas (jetons d'accès en cache), signale
 * au fournisseur un identifiant refusé (`markInvalid`) et, en mode `manual`, refuse la publication par l'erreur typée
 * `SOCIAL_MANUAL_RELAY` (la diffusion la passe en relais manuel). Aucun adaptateur ne lit l'environnement pour un jeton
 * de réseau. Les jetons renouvelés sont écrits dans le compte (`update`) quand le fournisseur le permet.
 */
import { createHash } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import type { ContentSpace } from '@neomoov/domain';
import { AppError } from '../../common/app-error.js';
import { credentialsReady, TOKEN_FIELDS, type SocialCredentialMode, type SocialCredentials, type SocialCredentialsProvider } from '../../modules/marketing/social-credentials.js';
import type { CredentialStatus, PublishedRef, SocialComment, SocialMetrics, SocialPublishInput, SocialPublishResult, SocialPublisher } from '../marketing.types.js';
import type { OAuthProvider, OAuthTokenStore, StoredOAuthTokens } from './oauth.js';

/** Construit l'adaptateur d'un espace à partir des identifiants du compte (mode direct). */
export type PublisherBuilder = (credentials: SocialCredentials) => SocialPublisher;

/** Relecture des identifiants au plus toutes les minutes pour l'état « configuré » (lu sans attendre par le calendrier). */
const STALE_MS = 60_000;
const AUTH_ERRORS = new Set(['SOCIAL_AUTH_FAILED', 'SOCIAL_AUTH_EXPIRED']);

export function manualRelayError(label: string, reason: string): AppError {
  return new AppError('SOCIAL_MANUAL_RELAY', `${label} : publication à relayer à la main (${reason})`, HttpStatus.CONFLICT, { reason });
}

const parseDate = (value: string | undefined): number | null => {
  const at = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(at) ? at : null;
};

/**
 * Magasin des jetons renouvelés tenu par le fournisseur des identifiants (`update`) : le connecteur relit le compte
 * avant chaque échange et y écrit le nouveau jeton (un seul jeton valable chez X et TikTok, quel que soit le processus).
 */
export class CredentialsTokenStore implements OAuthTokenStore {
  static readonly ORIGIN = 'compte';

  constructor(private readonly provider: SocialCredentialsProvider, private readonly space: string) {}

  async load(): Promise<StoredOAuthTokens | null> {
    const credentials = await this.provider.get(this.space);
    const values = credentials?.values ?? {};
    if (!values['refreshToken']) return null;
    return {
      origin: CredentialsTokenStore.ORIGIN, refreshToken: values['refreshToken'], refreshExpiresAt: parseDate(values['refreshTokenExpiresAt']),
      accessToken: values['accessToken'] ?? null, accessExpiresAt: parseDate(values['accessTokenExpiresAt']),
    };
  }

  async save(_provider: OAuthProvider, tokens: StoredOAuthTokens): Promise<void> {
    await this.provider.update!(this.space, {
      refreshToken: tokens.refreshToken,
      ...(tokens.refreshExpiresAt ? { refreshTokenExpiresAt: new Date(tokens.refreshExpiresAt).toISOString() } : {}),
      ...(tokens.accessToken ? { accessToken: tokens.accessToken } : {}),
      ...(tokens.accessExpiresAt ? { accessTokenExpiresAt: new Date(tokens.accessExpiresAt).toISOString() } : {}),
    });
  }
}

export interface CredentialedOptions {
  label: string;
  /** Erreur d'un espace sans compte relié (message avec les variables attendues). */
  notConfigured: () => AppError;
  now?: () => number;
}

export class CredentialedPublisher implements SocialPublisher {
  #current: { key: string; publisher: SocialPublisher } | null = null;
  #mode: SocialCredentialMode | null = null;
  #expiresAt: Date | null = null;
  #checkedAt = Number.NEGATIVE_INFINITY;
  #resolving: Promise<SocialPublisher | null> | null = null;

  constructor(
    readonly space: ContentSpace,
    private readonly provider: SocialCredentialsProvider,
    private readonly build: PublisherBuilder | null,
    private readonly options: CredentialedOptions,
  ) {}

  /** Nom de l'adaptateur en service (`manual` en relais manuel, `not_configured` sans compte). */
  get name(): string {
    if (this.#current) return this.#current.publisher.name;
    return this.#mode === 'manual' ? 'manual' : 'not_configured';
  }

  /** Mode du compte lu en dernier (null : aucun compte). */
  get mode(): SocialCredentialMode | null {
    return this.#mode;
  }

  /** Compte relié et prêt (ou relais manuel) : état de la dernière lecture, relue en arrière-plan au plus toutes les minutes. */
  get configured(): boolean {
    if (this.now() - this.#checkedAt > STALE_MS) void this.resolve().catch(() => null);
    return this.#current !== null || this.#mode === 'manual';
  }

  toJSON() {
    return { name: this.name, space: this.space, mode: this.#mode, configured: this.#current !== null || this.#mode === 'manual' };
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  /** Empreinte des valeurs : les jetons renouvelés par le connecteur lui-même (compte tenu par le fournisseur) n'y entrent pas. */
  private key(credentials: SocialCredentials): string {
    const managed = Boolean(this.provider.update && credentials.values['refreshToken']);
    const entries = Object.entries(credentials.values).filter(([k]) => !(managed && TOKEN_FIELDS.includes(k))).sort(([a], [b]) => a.localeCompare(b));
    return createHash('sha256').update(JSON.stringify([credentials.mode, entries, managed ? null : credentials.expiresAt?.toISOString() ?? null])).digest('hex');
  }

  /** Identifiants relus et adaptateur prêt (reconstruit si les valeurs ont changé) ; null : aucun compte ou relais manuel. */
  resolve(): Promise<SocialPublisher | null> {
    this.#resolving ??= (async () => {
      try {
        const credentials = await this.provider.get(this.space);
        this.#checkedAt = this.now();
        this.#mode = credentials?.mode ?? null;
        this.#expiresAt = credentials?.expiresAt ?? null;
        if (!credentials || credentials.mode !== 'direct' || !this.build || !credentialsReady(this.space, credentials)) {
          this.#current = null;
          return null;
        }
        const key = this.key(credentials);
        if (this.#current?.key !== key) this.#current = { key, publisher: this.build(credentials) };
        return this.#current.publisher;
      } finally {
        this.#resolving = null;
      }
    })();
    return this.#resolving;
  }

  private async target(): Promise<SocialPublisher> {
    const publisher = await this.resolve();
    if (publisher) return publisher;
    if (this.#mode === 'manual') throw manualRelayError(this.options.label, 'compte en relais manuel');
    if (this.#mode === 'aggregator') throw manualRelayError(this.options.label, 'mode agrégateur non pris en charge, connexions directes seulement');
    throw this.options.notConfigured();
  }

  /** Identifiant refusé (jeton révoqué, expiré, ou refusé après un nouvel échange) : compte à reconnecter. */
  private async run<T>(fn: (publisher: SocialPublisher) => Promise<T>): Promise<T> {
    const publisher = await this.target();
    try {
      return await fn(publisher);
    } catch (error) {
      if (error instanceof AppError && AUTH_ERRORS.has(error.code)) {
        await this.provider.markInvalid(this.space, error.message.slice(0, 300)).catch(() => undefined);
        this.#current = null;
        this.#checkedAt = Number.NEGATIVE_INFINITY;
      }
      throw error;
    }
  }

  publish(input: SocialPublishInput): Promise<SocialPublishResult> {
    return this.run((p) => p.publish(input));
  }

  async metrics(ref: PublishedRef): Promise<SocialMetrics> {
    await this.resolve();
    if (this.#mode === 'manual') return { reach: 0, interactions: 0, clicks: 0, collectedAt: new Date(), raw: { manual: true } };
    return this.run((p) => p.metrics(ref));
  }

  async comments(ref: PublishedRef, since: Date): Promise<SocialComment[]> {
    await this.resolve();
    if (this.#mode === 'manual') return [];
    return this.run((p) => p.comments(ref, since));
  }

  replyComment(ref: PublishedRef, commentExternalId: string, text: string): Promise<{ externalId: string }> {
    return this.run((p) => p.replyComment(ref, commentExternalId, text));
  }

  /** État de l'autorisation de l'adaptateur ; l'échéance connue du compte complète celle de l'adaptateur. */
  async credentials(): Promise<CredentialStatus> {
    const publisher = await this.resolve().catch(() => null);
    if (!publisher?.credentials) return { renewable: false, renewBy: this.#mode === 'direct' ? this.#expiresAt : null, problem: null };
    try {
      const status = await publisher.credentials();
      return { ...status, renewBy: status.renewBy ?? (status.renewable ? null : this.#expiresAt) };
    } catch (error) {
      return { renewable: false, renewBy: null, problem: error instanceof Error ? error.message.slice(0, 300) : String(error) };
    }
  }
}
