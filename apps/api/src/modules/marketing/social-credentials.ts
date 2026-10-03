/**
 * Identifiants des comptes des réseaux (chantier « Réseaux sociaux » du 3 octobre 2026, contrat entre les agents S1, S2
 * et Q4 : neomoov-outils/agents/S-COMMUN-reseaux.md). Les connecteurs de diffusion ne lisent JAMAIS l'environnement pour
 * un jeton de réseau : ils demandent au fournisseur `SOCIAL_CREDENTIALS` les identifiants de l'espace, à chaque usage
 * (un compte relié ou retiré dans My Hub vaut aussitôt), et lui signalent un identifiant refusé (`markInvalid`).
 *
 * Mode d'un espace : `direct` (API officielle du réseau) ou `manual` (relais manuel : la plateforme prépare texte et
 * image, un humain publie depuis My Hub). Le mode `aggregator` reste dans le contrat mais n'est pas utilisé (décision du
 * fondateur du 3 octobre 2026 : connexions directes seulement). Implémentation fournie par `AdaptersModule` : la table
 * `social_accounts` (`SocialAccountsRegistry`, valeurs chiffrées par `FieldCipher`), avec repli sur les variables
 * d'environnement (`EnvSocialCredentialsProvider`, ci-dessous) pour un espace jamais relié dans My Hub.
 *
 * Clés de `values` par espace (communes aux connecteurs) : blogue `url`, `user`, `appPassword` ; Facebook `pageId`,
 * `pageToken` ; Instagram `pageId`, `pageToken`, `igUserId` ; LinkedIn `organizationId`, `accessToken`,
 * `accessTokenExpiresAt`, `refreshToken`, `clientId`, `clientSecret` ; X `clientId`, `clientSecret`, `accessToken`,
 * `accessTokenExpiresAt`, `refreshToken` ; TikTok `clientKey`, `clientSecret`, `accessToken`, `accessTokenExpiresAt`,
 * `refreshToken`, `openId` ; YouTube `clientId`, `clientSecret`, `accessToken`, `accessTokenExpiresAt`, `refreshToken`,
 * `channelId` ; Telegram `botToken`, `channelId`.
 */
import type { AppEnv } from '../../config/env.js';

export const SOCIAL_CREDENTIALS = Symbol('SOCIAL_CREDENTIALS');

export type SocialCredentialMode = 'direct' | 'aggregator' | 'manual';

export interface SocialCredentials {
  mode: SocialCredentialMode;
  /** Valeurs du mode (clés ci-dessus) ; secrets compris, jamais journalisées ni rendues à l'écran. */
  values: Record<string, string>;
  /** Identifiant du compte chez le réseau (page, organisation, chaîne, canal). */
  accountId: string | null;
  accountName: string | null;
  /** Adresse publique du compte (page Contact de neomoov.net). */
  profileUrl: string | null;
  /** Échéance connue de l'autorisation ; null : inconnue ou sans limite. */
  expiresAt: Date | null;
}

export interface SocialCredentialsProvider {
  /** Identifiants de l'espace, ou null si aucun compte n'est relié (connecteur « non configuré »). */
  get(space: string): Promise<SocialCredentials | null>;
  /** Identifiant refusé par le réseau (jeton révoqué ou expiré) : le compte est à reconnecter ; `reason` sans secret. */
  markInvalid(space: string, reason: string): Promise<void>;
}

/** Espaces sans API de publication ouverte : toujours en relais manuel. */
export const MANUAL_ONLY_SPACES: readonly string[] = ['whatsapp_channel', 'snapchat'];

/**
 * Repli sur les variables d'environnement du serveur : mode `direct` si les variables de l'espace sont posées, `manual`
 * pour la chaîne WhatsApp et Snapchat, sinon aucun compte (null). Un identifiant signalé refusé n'est plus rendu
 * jusqu'au redémarrage.
 */
export class EnvSocialCredentialsProvider implements SocialCredentialsProvider {
  readonly #env: AppEnv;
  readonly #invalid = new Map<string, string>();

  constructor(env: AppEnv) {
    this.#env = env;
  }

  toJSON() {
    return { name: 'env', invalid: [...this.#invalid.keys()] };
  }

  private values(space: string): Record<string, string> | null {
    const e = this.#env;
    const pick = (entries: Array<[string, string | number | undefined]>, required: string[]): Record<string, string> | null => {
      const out: Record<string, string> = {};
      for (const [key, value] of entries) if (value !== undefined && value !== null && String(value).trim()) out[key] = String(value).trim();
      return required.every((key) => out[key]) ? out : null;
    };
    switch (space) {
      case 'site_blog':
        return pick([['url', e.WORDPRESS_URL], ['user', e.WORDPRESS_USER], ['appPassword', e.WORDPRESS_APP_PASSWORD]], ['url', 'user', 'appPassword']);
      case 'facebook':
        return pick([['pageId', e.META_PAGE_ID], ['pageToken', e.META_PAGE_TOKEN]], ['pageId', 'pageToken']);
      case 'instagram':
        return pick([['pageId', e.META_PAGE_ID], ['pageToken', e.META_PAGE_TOKEN], ['igUserId', e.META_IG_USER_ID ?? e.META_INSTAGRAM_ID]], ['pageId', 'pageToken', 'igUserId']);
      case 'linkedin':
        return pick([['organizationId', e.LINKEDIN_ORGANIZATION_ID], ['accessToken', e.LINKEDIN_ACCESS_TOKEN], ['clientId', e.LINKEDIN_CLIENT_ID], ['clientSecret', e.LINKEDIN_CLIENT_SECRET]], ['organizationId', 'accessToken']);
      case 'youtube':
        return pick([['clientId', e.GOOGLE_SOCIAL_CLIENT_ID ?? e.YOUTUBE_CLIENT_ID], ['clientSecret', e.GOOGLE_SOCIAL_CLIENT_SECRET ?? e.YOUTUBE_CLIENT_SECRET], ['refreshToken', e.YOUTUBE_REFRESH_TOKEN]], ['clientId', 'clientSecret', 'refreshToken']);
      default:
        return null;
    }
  }

  async get(space: string): Promise<SocialCredentials | null> {
    if (MANUAL_ONLY_SPACES.includes(space)) return { mode: 'manual', values: {}, accountId: null, accountName: null, profileUrl: null, expiresAt: null };
    if (this.#invalid.has(space)) return null;
    const values = this.values(space);
    if (!values) return null;
    const accountId = values['organizationId'] ?? values['igUserId'] ?? values['pageId'] ?? (space === 'site_blog' ? (values['url'] ?? null) : null);
    return { mode: 'direct', values, accountId, accountName: null, profileUrl: space === 'site_blog' ? (values['url'] ?? null) : null, expiresAt: null };
  }

  async markInvalid(space: string, reason: string): Promise<void> {
    this.#invalid.set(space, reason.slice(0, 300));
  }
}
