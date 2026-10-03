/**
 * Choix des connecteurs réels du marketing (phase 1 « entreprise autonome »). `MARKETING_PROVIDER=real` : chaque espace
 * reçoit un connecteur tiré des identifiants de son compte (contrat `SOCIAL_CREDENTIALS` du 3 octobre 2026, variables
 * d'environnement par défaut, table des comptes de My Hub ensuite) : WordPress (site et Academy), Brevo (infolettre),
 * Meta (Facebook, Instagram), X, Telegram, LinkedIn, YouTube, TikTok et la Fiche Google, en connexion directe ;
 * Snapchat et la chaîne WhatsApp en relais manuel (décision du fondateur : sans agrégateur). Un espace sans compte
 * refuse clairement et le calendrier l'ignore ; jamais de simulation silencieuse en mode réel. Les jetons renouvelés
 * (X, TikTok) sont écrits dans le compte, ou à défaut gardés par le magasin donné (base chiffrée, mémoire en test).
 */
import { HttpStatus } from '@nestjs/common';
import { CONTENT_SPACES, SPACE_RULES, type ContentSpace } from '@neomoov/domain';
import { AppError } from '../../common/app-error.js';
import type { AppEnv } from '../../config/env.js';
import { EnvSocialCredentialsProvider, type SocialCredentials, type SocialCredentialsProvider } from '../../modules/marketing/social-credentials.js';
import type { SearchConsoleProvider, SiteConnector, SocialPublisher, SocialPublishers, TtsProvider } from '../marketing.types.js';
import { BrevoNewsletterPublisher } from './brevo.js';
import { CredentialedPublisher, CredentialsTokenStore, type PublisherBuilder } from './credentialed.js';
import { GoogleBusinessPublisher } from './google-business.js';
import { LinkedInPublisher } from './linkedin.js';
import { MetaFacebookPublisher, MetaGraphClient, MetaInstagramPublisher } from './meta-graph.js';
import { MemoryTokenStore, type OAuthTokenStore, type TokenStoreBinding } from './oauth.js';
import { TelegramPublisher } from './telegram.js';
import { TikTokPublisher, type TikTokPrivacy } from './tiktok.js';
import { XPublisher } from './x.js';
import { YouTubePublisher, type YouTubePrivacy } from './youtube.js';
import { GoogleSearchConsoleProvider } from './search-console.js';
import { AzureTtsProvider, PiperTtsProvider } from './tts.js';
import { NoSearchConsoleProvider, WordPressConnector } from './wordpress.js';

/** Variables attendues par espace (clés à poser par le fondateur) ; documentées dans docs/marketing/connecteurs.md. */
export const SPACE_VARIABLES: Readonly<Record<string, readonly string[]>> = {
  site_blog: ['WORDPRESS_URL', 'WORDPRESS_USER', 'WORDPRESS_APP_PASSWORD'],
  academy: ['WORDPRESS_URL', 'WORDPRESS_USER', 'WORDPRESS_APP_PASSWORD'],
  google_business: ['GOOGLE_BUSINESS_CLIENT_ID', 'GOOGLE_BUSINESS_CLIENT_SECRET', 'GOOGLE_BUSINESS_REFRESH_TOKEN', 'GOOGLE_BUSINESS_ACCOUNT_ID', 'GOOGLE_BUSINESS_LOCATION_ID'],
  facebook: ['META_PAGE_ID', 'META_PAGE_TOKEN'],
  instagram: ['META_PAGE_ID', 'META_PAGE_TOKEN', 'META_IG_USER_ID'],
  linkedin: ['LINKEDIN_ORGANIZATION_ID', 'LINKEDIN_ACCESS_TOKEN (ou LINKEDIN_REFRESH_TOKEN avec LINKEDIN_CLIENT_ID et LINKEDIN_CLIENT_SECRET)'],
  tiktok: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REFRESH_TOKEN'],
  youtube: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'],
  x: ['X_CLIENT_ID', 'X_CLIENT_SECRET', 'X_REFRESH_TOKEN'],
  snapchat: ['relais manuel seulement, décision du fondateur'],
  newsletter: ['BREVO_API_KEY', 'BREVO_NEWSLETTER_LIST_ID', 'BREVO_SENDER_EMAIL'],
  telegram: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHANNEL_ID'],
  whatsapp_channel: ['relais manuel seulement, aucune API de publication'],
};

/** Nom affiché d'un espace (règles du domaine ; repli pour un espace pas encore au domaine). */
export const spaceLabel = (space: string): string =>
  (SPACE_RULES as Readonly<Record<string, { name: string } | undefined>>)[space]?.name ?? (space === 'telegram' ? 'Telegram' : space === 'whatsapp_channel' ? 'Chaîne WhatsApp' : space);

/** Espaces servis : ceux du domaine, plus Telegram et la chaîne WhatsApp (ajoutés au domaine par l'agent S2). */
export const PUBLISHER_SPACES: readonly ContentSpace[] = [...new Set<string>([...CONTENT_SPACES, 'telegram', 'whatsapp_channel'])] as ContentSpace[];

const notConfigured = (what: string, variables: readonly string[]) =>
  new AppError('PROVIDER_NOT_CONFIGURED', `${what} : connecteur non configuré ou non livré (${variables.join(', ')}).`, HttpStatus.NOT_IMPLEMENTED);

/** Espace sans clés (ou sans connecteur livré) en mode réel : refus explicite, jamais de simulation. */
export class NotConfiguredPublisher implements SocialPublisher {
  readonly name = 'not_configured';
  readonly configured = false;
  constructor(readonly space: ContentSpace) {}
  private reject<T>(): Promise<T> {
    return Promise.reject(notConfigured(spaceLabel(this.space), SPACE_VARIABLES[this.space] ?? []));
  }
  publish(): Promise<never> { return this.reject(); }
  metrics(): Promise<never> { return this.reject(); }
  comments(): Promise<never> { return this.reject(); }
  replyComment(): Promise<never> { return this.reject(); }
  toJSON() { return { name: this.name, space: this.space, configured: false }; }
}

export class NotConfiguredSite implements SiteConnector {
  readonly name = 'not_configured';
  readonly configured = false;
  private reject<T>(): Promise<T> {
    return Promise.reject(notConfigured('Site WordPress', SPACE_VARIABLES['site_blog'] ?? []));
  }
  pages(): Promise<never> { return this.reject(); }
  updateSeo(): Promise<never> { return this.reject(); }
  createDraft(): Promise<never> { return this.reject(); }
  mediaLibrary(): Promise<never> { return this.reject(); }
  toJSON() { return { name: this.name, configured: false }; }
}

export class NotConfiguredTts implements TtsProvider {
  readonly name = 'not_configured';
  readonly configured = false;
  synthesize(): Promise<never> {
    return Promise.reject(notConfigured('Voix de synthèse', ['TTS_ENGINE', 'PIPER_BIN et PIPER_MODEL, ou AZURE_SPEECH_KEY et AZURE_SPEECH_REGION']));
  }
  toJSON() { return { name: this.name, configured: false }; }
}

const wordpressReady = (env: AppEnv) => Boolean(env.WORDPRESS_URL && env.WORDPRESS_USER && env.WORDPRESS_APP_PASSWORD);

function wordpress(env: AppEnv, space: 'site_blog' | 'academy'): WordPressConnector {
  return new WordPressConnector({
    baseUrl: env.WORDPRESS_URL!, user: env.WORDPRESS_USER!, appPassword: env.WORDPRESS_APP_PASSWORD!, space,
    category: (space === 'academy' ? env.WORDPRESS_ACADEMY_CATEGORY : env.WORDPRESS_BLOG_CATEGORY) ?? null, seoMeta: env.WORDPRESS_SEO_META,
  });
}

export interface RealPublishersOptions {
  /** Identifiants des comptes (contrat `SOCIAL_CREDENTIALS`) ; absent : variables d'environnement. */
  credentials?: SocialCredentialsProvider;
  /** Magasin des jetons OAuth renouvelés quand le fournisseur ne sait pas les écrire (`update`) ; absent : en mémoire. */
  tokenStore?: OAuthTokenStore | null;
  /** Serveur HTTP simulé et horloge des tests. */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** Identifiant numérique seul, que le fondateur colle la ressource entière (`accounts/1/locations/2`) ou le nombre. */
const lastSegment = (value: string) => value.split('/').filter(Boolean).at(-1) ?? value;
const dateValue = (value: string | undefined): number | null => {
  const at = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(at) ? at : null;
};

/**
 * Adaptateurs de chaque espace, construits à partir des valeurs du compte (clés de `CREDENTIAL_FIELDS`) ; les réglages
 * non secrets (catégories WordPress, version de l'API Graph ou de LinkedIn, visibilité YouTube et TikTok) restent dans
 * l'environnement.
 */
function builders(env: AppEnv, credentials: SocialCredentialsProvider, options: RealPublishersOptions): Partial<Record<string, PublisherBuilder>> {
  const fetchImpl = options.fetchImpl ? { fetchImpl: options.fetchImpl } : {};
  const clock = options.now ? { now: options.now } : {};
  const fallbackStore = options.tokenStore ?? new MemoryTokenStore();
  // Jetons renouvelés écrits dans le compte quand le fournisseur le permet (relus avant chaque échange), sinon magasin chiffré.
  const tokens = (space: string): TokenStoreBinding =>
    credentials.update ? { store: new CredentialsTokenStore(credentials, space), storeOrigin: CredentialsTokenStore.ORIGIN, reloadBeforeRefresh: true } : { store: fallbackStore };
  const wordpress = (space: 'site_blog' | 'academy') => ({ values: v }: SocialCredentials) => new WordPressConnector({
    baseUrl: v['url']!, user: v['user']!, appPassword: v['appPassword']!, space,
    category: (space === 'academy' ? env.WORDPRESS_ACADEMY_CATEGORY : env.WORDPRESS_BLOG_CATEGORY) ?? null, seoMeta: env.WORDPRESS_SEO_META, ...fetchImpl,
  });
  const meta = (v: Record<string, string>) => new MetaGraphClient({ pageId: v['pageId']!, pageToken: v['pageToken']!, igUserId: v['igUserId'] ?? null, version: env.META_GRAPH_VERSION, ...fetchImpl });
  return {
    site_blog: wordpress('site_blog'),
    academy: wordpress('academy'),
    newsletter: ({ values: v }) => new BrevoNewsletterPublisher({ apiKey: v['apiKey']!, listId: Number(v['listId']) || 0, senderEmail: v['senderEmail']!, senderName: env.BREVO_SENDER_NAME ?? 'Neomoov', ...fetchImpl }),
    facebook: ({ values: v }) => new MetaFacebookPublisher(meta(v)),
    instagram: ({ values: v }) => new MetaInstagramPublisher(meta(v)),
    x: ({ values: v }) => new XPublisher({ clientId: v['clientId']!, clientSecret: v['clientSecret'] ?? null, refreshToken: v['refreshToken']!, ...tokens('x'), ...fetchImpl, ...clock }),
    telegram: ({ values: v }) => new TelegramPublisher({ botToken: v['botToken']!, channelId: v['channelId']!, discussionChatId: v['discussionChatId'] ?? null, ...fetchImpl }),
    linkedin: ({ values: v, expiresAt }) => new LinkedInPublisher({
      organizationId: lastSegment(v['organizationId']!.replace(/^urn:li:organization:/, '')), accessToken: v['accessToken'] ?? null,
      accessExpiresAt: dateValue(v['accessTokenExpiresAt']) ?? expiresAt?.getTime() ?? null,
      refreshToken: v['refreshToken'] && v['clientId'] && v['clientSecret'] ? v['refreshToken'] : null, clientId: v['clientId'] ?? null, clientSecret: v['clientSecret'] ?? null,
      version: env.LINKEDIN_API_VERSION, ...tokens('linkedin'), ...fetchImpl, ...clock,
    }),
    youtube: ({ values: v }) => new YouTubePublisher({
      clientId: v['clientId']!, clientSecret: v['clientSecret']!, refreshToken: v['refreshToken']!, privacyStatus: env.YOUTUBE_PRIVACY_STATUS as YouTubePrivacy, audited: env.YOUTUBE_API_AUDITED || v['appApproved'] === 'on', ...tokens('youtube'), ...fetchImpl, ...clock,
    }),
    tiktok: ({ values: v }) => new TikTokPublisher({
      clientKey: v['clientKey']!, clientSecret: v['clientSecret']!, refreshToken: v['refreshToken']!, privacyLevel: env.TIKTOK_PRIVACY_LEVEL as TikTokPrivacy, audited: env.TIKTOK_APP_AUDITED || v['appApproved'] === 'on', uploadMode: env.TIKTOK_UPLOAD_MODE,
      ...tokens('tiktok'), ...fetchImpl, ...clock,
    }),
    google_business: ({ values: v }) => new GoogleBusinessPublisher({
      clientId: v['clientId']!, clientSecret: v['clientSecret']!, refreshToken: v['refreshToken']!, accountId: lastSegment(v['accountId']!), locationId: lastSegment(v['locationId']!),
      ...tokens('google-business'), ...fetchImpl, ...clock,
    }),
  };
}

/** Un connecteur par espace, tiré des identifiants du compte à chaque usage. */
export const realSocialPublishers = (env: AppEnv, options: RealPublishersOptions = {}): SocialPublishers => {
  const credentials = options.credentials ?? new EnvSocialCredentialsProvider(env);
  const build = builders(env, credentials, options);
  return new Map<ContentSpace, SocialPublisher>(PUBLISHER_SPACES.map((space) => [space, new CredentialedPublisher(space, credentials, build[space] ?? null, {
    label: spaceLabel(space), notConfigured: () => notConfigured(spaceLabel(space), SPACE_VARIABLES[space] ?? []), ...(options.now ? { now: options.now } : {}),
  })]));
};

/** Relit les identifiants de tous les connecteurs (démarrage, puis passe marketing) : état « configuré » à jour. */
export async function refreshPublishers(publishers: SocialPublishers): Promise<void> {
  await Promise.all([...publishers.values()].map((p) => (p instanceof CredentialedPublisher ? p.resolve().catch(() => null) : null)));
}

export const realSiteConnector = (env: AppEnv): SiteConnector => (wordpressReady(env) ? wordpress(env, 'site_blog') : new NotConfiguredSite());

export const realTts = (env: AppEnv): TtsProvider => {
  const engine = env.TTS_ENGINE ?? (env.PIPER_BIN ? 'piper' : env.AZURE_SPEECH_KEY ? 'azure' : null);
  if (engine === 'piper' && env.PIPER_BIN && env.PIPER_MODEL) return new PiperTtsProvider({ bin: env.PIPER_BIN, model: env.PIPER_MODEL, modelEn: env.PIPER_MODEL_EN ?? null });
  if (engine === 'azure' && env.AZURE_SPEECH_KEY && env.AZURE_SPEECH_REGION) return new AzureTtsProvider({ key: env.AZURE_SPEECH_KEY, region: env.AZURE_SPEECH_REGION });
  return new NotConfiguredTts();
};

/** Search Console : compte de service autorisé sur la propriété ; sans clés, aucune donnée (jamais de chiffres simulés). */
export const realSearchConsole = (env: AppEnv): SearchConsoleProvider =>
  env.SEARCH_CONSOLE_SITE_URL && env.SEARCH_CONSOLE_CLIENT_EMAIL && env.SEARCH_CONSOLE_PRIVATE_KEY
    ? new GoogleSearchConsoleProvider({ siteUrl: env.SEARCH_CONSOLE_SITE_URL, clientEmail: env.SEARCH_CONSOLE_CLIENT_EMAIL, privateKey: env.SEARCH_CONSOLE_PRIVATE_KEY })
    : new NoSearchConsoleProvider();
