/**
 * Identifiants des comptes des réseaux (chantier « Réseaux sociaux » du 3 octobre 2026, contrat entre les agents S1, S2
 * et Q4 : neomoov-outils/agents/S-COMMUN-reseaux.md). Les connecteurs de diffusion ne lisent JAMAIS l'environnement pour
 * un jeton de réseau : ils demandent au fournisseur `SOCIAL_CREDENTIALS` les identifiants de l'espace, à chaque usage
 * (un compte relié ou retiré dans My Hub vaut aussitôt), et lui signalent un identifiant refusé (`markInvalid`).
 *
 * Mode d'un espace : `direct` (API officielle du réseau, valeurs de `CREDENTIAL_FIELDS[espace]`) ou `manual` (relais
 * manuel : la plateforme prépare texte et image, un humain publie depuis My Hub). Le mode `aggregator` reste dans le
 * contrat mais n'est pas utilisé : décision du fondateur du 3 octobre 2026, connexions directes seulement, sans
 * agrégateur ; Snapchat et la chaîne WhatsApp sont en relais manuel uniquement. Implémentation par défaut : `EnvSocialCredentialsProvider` (variables d'environnement,
 * repli), fournie par `AdaptersModule` ; l'implémentation de S1 (table `social_accounts`, valeurs chiffrées par
 * `FieldCipher`, puis repli sur celle-ci) remplace la fabrique de `SOCIAL_CREDENTIALS` dans `adapters.module.ts`.
 */
import type { AppEnv } from '../../config/env.js';

export const SOCIAL_CREDENTIALS = Symbol('SOCIAL_CREDENTIALS');

export type SocialCredentialMode = 'direct' | 'aggregator' | 'manual';

export interface SocialCredentials {
  mode: SocialCredentialMode;
  /** Valeurs du mode (clés de `CREDENTIAL_FIELDS` ou `AGGREGATOR_FIELDS`) ; secrets compris, jamais journalisées ni rendues à l'écran. */
  values: Record<string, string>;
  /** Identifiant du compte chez le réseau (page, organisation, chaîne, canal, établissement). */
  accountId: string | null;
  accountName: string | null;
  /** Adresse publique du compte (page Contact de neomoov.net). */
  profileUrl: string | null;
  /** Échéance connue de l'autorisation (jeton de 60 jours de LinkedIn, par exemple) ; null : inconnue ou sans limite. */
  expiresAt: Date | null;
}

export interface SocialCredentialsProvider {
  /** Identifiants de l'espace, ou null si aucun compte n'est relié (connecteur « non configuré »). */
  get(space: string): Promise<SocialCredentials | null>;
  /** Identifiant refusé par le réseau (jeton révoqué ou expiré) : le compte est à reconnecter ; `reason` sans secret. */
  markInvalid(space: string, reason: string): Promise<void>;
}

export interface CredentialField {
  /** Clé dans `SocialCredentials.values`. */
  key: string;
  /** Variable d'environnement de repli (implémentation par défaut). */
  env: keyof AppEnv;
  label: string;
  /** Secret : chiffré au repos, jamais affiché (My Hub montre seulement « renseigné »). */
  secret: boolean;
  /** Obligatoire pour que le connecteur direct soit prêt (LinkedIn : voir `credentialsReady`). */
  required: boolean;
}

const f = (key: string, env: keyof AppEnv, label: string, secret: boolean, required = true): CredentialField => ({ key, env, label, secret, required });

/** Valeurs du mode direct, par espace (codes communs du chantier ; `google_business` en dernier, hors liste du fondateur). */
export const CREDENTIAL_FIELDS: Readonly<Record<string, readonly CredentialField[]>> = {
  site_blog: [f('url', 'WORDPRESS_URL', 'Adresse du site', false), f('user', 'WORDPRESS_USER', 'Utilisateur WordPress', false), f('appPassword', 'WORDPRESS_APP_PASSWORD', 'Mot de passe d\'application', true)],
  academy: [f('url', 'WORDPRESS_URL', 'Adresse du site', false), f('user', 'WORDPRESS_USER', 'Utilisateur WordPress', false), f('appPassword', 'WORDPRESS_APP_PASSWORD', 'Mot de passe d\'application', true)],
  facebook: [f('pageId', 'META_PAGE_ID', 'Identifiant de la page', false), f('pageToken', 'META_PAGE_TOKEN', 'Jeton de la page', true)],
  instagram: [f('pageId', 'META_PAGE_ID', 'Identifiant de la page Facebook', false), f('pageToken', 'META_PAGE_TOKEN', 'Jeton de la page', true), f('igUserId', 'META_IG_USER_ID', 'Identifiant du compte Instagram professionnel', false)],
  linkedin: [
    f('organizationId', 'LINKEDIN_ORGANIZATION_ID', 'Identifiant de la page entreprise', false),
    f('accessToken', 'LINKEDIN_ACCESS_TOKEN', 'Jeton d\'accès (60 jours)', true, false),
    f('accessTokenExpiresAt', 'LINKEDIN_ACCESS_TOKEN_EXPIRES_AT', 'Échéance du jeton d\'accès (AAAA-MM-JJ)', false, false),
    f('refreshToken', 'LINKEDIN_REFRESH_TOKEN', 'Jeton de rafraîchissement', true, false),
    f('clientId', 'LINKEDIN_CLIENT_ID', 'Client ID de l\'application', false, false),
    f('clientSecret', 'LINKEDIN_CLIENT_SECRET', 'Client Secret de l\'application', true, false),
  ],
  x: [f('clientId', 'X_CLIENT_ID', 'Client ID OAuth 2.0', false), f('clientSecret', 'X_CLIENT_SECRET', 'Client Secret OAuth 2.0', true, false), f('refreshToken', 'X_REFRESH_TOKEN', 'Jeton de rafraîchissement', true)],
  tiktok: [f('clientKey', 'TIKTOK_CLIENT_KEY', 'Client key', false), f('clientSecret', 'TIKTOK_CLIENT_SECRET', 'Client secret', true), f('refreshToken', 'TIKTOK_REFRESH_TOKEN', 'Jeton de rafraîchissement', true)],
  telegram: [f('botToken', 'TELEGRAM_BOT_TOKEN', 'Jeton du bot (BotFather)', true), f('channelId', 'TELEGRAM_CHANNEL_ID', 'Canal (@nom ou identifiant -100…)', false), f('discussionChatId', 'TELEGRAM_DISCUSSION_CHAT_ID', 'Groupe de discussion lié (facultatif)', false, false)],
  youtube: [f('clientId', 'YOUTUBE_CLIENT_ID', 'ID client OAuth Google', false), f('clientSecret', 'YOUTUBE_CLIENT_SECRET', 'Code secret du client', true), f('refreshToken', 'YOUTUBE_REFRESH_TOKEN', 'Jeton de rafraîchissement', true)],
  google_business: [
    f('clientId', 'GOOGLE_BUSINESS_CLIENT_ID', 'ID client OAuth Google', false), f('clientSecret', 'GOOGLE_BUSINESS_CLIENT_SECRET', 'Code secret du client', true),
    f('refreshToken', 'GOOGLE_BUSINESS_REFRESH_TOKEN', 'Jeton de rafraîchissement', true), f('accountId', 'GOOGLE_BUSINESS_ACCOUNT_ID', 'Compte (accounts/…)', false), f('locationId', 'GOOGLE_BUSINESS_LOCATION_ID', 'Établissement (locations/…)', false),
  ],
  newsletter: [f('apiKey', 'BREVO_API_KEY', 'Clé API Brevo', true), f('listId', 'BREVO_NEWSLETTER_LIST_ID', 'Liste des abonnés', false), f('senderEmail', 'BREVO_SENDER_EMAIL', 'Expéditeur vérifié', false)],
};

/** Espaces sans connexion directe (aucune API de publication ouverte) : toujours en relais manuel. */
export const MANUAL_ONLY_SPACES: readonly string[] = ['whatsapp_channel', 'snapchat'];

/** Valeurs suffisantes pour le mode : champs obligatoires présents (LinkedIn : jeton d'accès, ou jeton de rafraîchissement avec l'application). */
export function credentialsReady(space: string, credentials: SocialCredentials | null): boolean {
  if (!credentials) return false;
  if (credentials.mode === 'manual') return true;
  if (credentials.mode !== 'direct') return false;
  const has = (key: string) => Boolean(credentials.values[key]?.trim());
  const fields = CREDENTIAL_FIELDS[space];
  if (!fields) return false;
  if (!fields.filter((field) => field.required).every((field) => has(field.key))) return false;
  if (space === 'linkedin') return has('accessToken') || (has('refreshToken') && has('clientId') && has('clientSecret'));
  return true;
}

const accountIdOf = (space: string, values: Record<string, string>): string | null =>
  values['organizationId'] ?? values['igUserId'] ?? values['pageId'] ?? values['channelId'] ?? values['locationId'] ?? (space === 'site_blog' || space === 'academy' ? (values['url'] ?? null) : null);

/** Adresse publique quand les valeurs la donnent (canal Telegram public `@nom`, page LinkedIn) ; sinon null (S1 la garde en base). */
function profileUrlOf(space: string, values: Record<string, string>): string | null {
  if (space === 'telegram' && values['channelId']?.startsWith('@')) return `https://t.me/${values['channelId'].slice(1)}`;
  if (space === 'linkedin' && values['organizationId']) return `https://www.linkedin.com/company/${values['organizationId'].replace(/^urn:li:organization:/, '')}/`;
  if (space === 'facebook' && values['pageId']) return `https://www.facebook.com/${values['pageId']}`;
  if ((space === 'site_blog' || space === 'academy') && values['url']) return values['url'];
  return null;
}

/**
 * Implémentation par défaut : les variables d'environnement du serveur. Mode `direct` si les variables de l'espace sont
 * posées, `manual` pour la chaîne WhatsApp et Snapchat, sinon aucun compte (null). Un identifiant signalé refusé n'est plus rendu
 * jusqu'au redémarrage (après correction des variables par `env-set.sh … --recreate api worker`).
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

  private value(name: keyof AppEnv): string | null {
    const raw = this.#env[name];
    if (raw === undefined || raw === null || raw === '') return null;
    return String(raw).trim() || null;
  }

  private collect(fields: readonly CredentialField[]): Record<string, string> {
    const values: Record<string, string> = {};
    for (const field of fields) {
      const v = this.value(field.env);
      if (v) values[field.key] = v;
    }
    return values;
  }

  async get(space: string): Promise<SocialCredentials | null> {
    if (MANUAL_ONLY_SPACES.includes(space)) return { mode: 'manual', values: {}, accountId: null, accountName: null, profileUrl: null, expiresAt: null };
    if (this.#invalid.has(space)) return null;
    const fields = CREDENTIAL_FIELDS[space];
    if (fields) {
      const values = this.collect(fields);
      const direct: SocialCredentials = {
        mode: 'direct', values, accountId: accountIdOf(space, values), accountName: null, profileUrl: profileUrlOf(space, values),
        expiresAt: values['accessTokenExpiresAt'] && !values['refreshToken'] ? new Date(values['accessTokenExpiresAt']) : null,
      };
      if (credentialsReady(space, direct)) return direct;
    }
    return null;
  }

  async markInvalid(space: string, reason: string): Promise<void> {
    this.#invalid.set(space, reason.slice(0, 300));
  }
}
