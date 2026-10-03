/**
 * Choix des connecteurs réels du marketing (phase 1 « entreprise autonome ») selon les variables d'environnement.
 * `MARKETING_PROVIDER=real` : WordPress (site et Academy), Brevo (infolettre), Meta (Facebook, Instagram), et depuis le
 * 3 octobre 2026 Fiche Google, LinkedIn, YouTube, X et TikTok, chacun dès que ses clés sont présentes ; Snapchat est
 * reporté par décision. Un espace sans clés reçoit un connecteur « non configuré » qui refuse clairement et le
 * calendrier l'ignore. Jamais de simulation silencieuse en mode réel. Les jetons OAuth renouvelés (X, TikTok) sont
 * gardés par le magasin donné (base chiffrée en service, mémoire en test).
 */
import { HttpStatus } from '@nestjs/common';
import { CONTENT_SPACES, SPACE_RULES, type ContentSpace } from '@neomoov/domain';
import { AppError } from '../../common/app-error.js';
import type { AppEnv } from '../../config/env.js';
import type { SearchConsoleProvider, SiteConnector, SocialPublisher, SocialPublishers, TtsProvider } from '../marketing.types.js';
import { BrevoNewsletterPublisher } from './brevo.js';
import { GoogleBusinessPublisher } from './google-business.js';
import { LinkedInPublisher } from './linkedin.js';
import { MetaFacebookPublisher, MetaGraphClient, MetaInstagramPublisher } from './meta-graph.js';
import { MemoryTokenStore, type OAuthTokenStore } from './oauth.js';
import { TikTokPublisher } from './tiktok.js';
import { XPublisher } from './x.js';
import { YouTubePublisher } from './youtube.js';
import { GoogleSearchConsoleProvider } from './search-console.js';
import { AzureTtsProvider, PiperTtsProvider } from './tts.js';
import { NoSearchConsoleProvider, WordPressConnector } from './wordpress.js';

/** Variables attendues par espace (clés à poser par le fondateur) ; documentées dans docs/marketing/connecteurs.md. */
export const SPACE_VARIABLES: Readonly<Record<ContentSpace, readonly string[]>> = {
  site_blog: ['WORDPRESS_URL', 'WORDPRESS_USER', 'WORDPRESS_APP_PASSWORD'],
  academy: ['WORDPRESS_URL', 'WORDPRESS_USER', 'WORDPRESS_APP_PASSWORD'],
  google_business: ['GOOGLE_BUSINESS_CLIENT_ID', 'GOOGLE_BUSINESS_CLIENT_SECRET', 'GOOGLE_BUSINESS_REFRESH_TOKEN', 'GOOGLE_BUSINESS_ACCOUNT_ID', 'GOOGLE_BUSINESS_LOCATION_ID'],
  facebook: ['META_PAGE_ID', 'META_PAGE_TOKEN'],
  instagram: ['META_PAGE_ID', 'META_PAGE_TOKEN', 'META_IG_USER_ID'],
  linkedin: ['LINKEDIN_ORGANIZATION_ID', 'LINKEDIN_ACCESS_TOKEN (ou LINKEDIN_REFRESH_TOKEN avec LINKEDIN_CLIENT_ID et LINKEDIN_CLIENT_SECRET)'],
  tiktok: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REFRESH_TOKEN'],
  youtube: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'],
  x: ['X_CLIENT_ID', 'X_CLIENT_SECRET', 'X_REFRESH_TOKEN'],
  snapchat: ['SNAPCHAT_ACCESS_TOKEN', 'SNAPCHAT_PROFILE_ID'],
  newsletter: ['BREVO_API_KEY', 'BREVO_NEWSLETTER_LIST_ID', 'BREVO_SENDER_EMAIL'],
};

const notConfigured = (what: string, variables: readonly string[]) =>
  new AppError('PROVIDER_NOT_CONFIGURED', `${what} : connecteur non configuré ou non livré (${variables.join(', ')}).`, HttpStatus.NOT_IMPLEMENTED);

/** Espace sans clés (ou sans connecteur livré) en mode réel : refus explicite, jamais de simulation. */
export class NotConfiguredPublisher implements SocialPublisher {
  readonly name = 'not_configured';
  readonly configured = false;
  constructor(readonly space: ContentSpace) {}
  private reject<T>(): Promise<T> {
    return Promise.reject(notConfigured(SPACE_RULES[this.space].name, SPACE_VARIABLES[this.space]));
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
    return Promise.reject(notConfigured('Site WordPress', SPACE_VARIABLES.site_blog));
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
  /** Magasin des jetons OAuth renouvelés (X, TikTok) ; absent : en mémoire. */
  tokenStore?: OAuthTokenStore | null;
  /** Serveur HTTP simulé des tests. */
  fetchImpl?: typeof fetch;
}

/** Identifiant numérique seul, que le fondateur colle la ressource entière (`accounts/1/locations/2`) ou le nombre. */
const lastSegment = (value: string) => value.split('/').filter(Boolean).at(-1) ?? value;

export const realSocialPublishers = (env: AppEnv, options: RealPublishersOptions = {}): SocialPublishers => {
  const map = new Map<ContentSpace, SocialPublisher>(CONTENT_SPACES.map((space) => [space, new NotConfiguredPublisher(space)]));
  if (wordpressReady(env)) {
    map.set('site_blog', wordpress(env, 'site_blog'));
    map.set('academy', wordpress(env, 'academy'));
  }
  if (env.BREVO_API_KEY && env.BREVO_NEWSLETTER_LIST_ID && env.BREVO_SENDER_EMAIL) {
    map.set('newsletter', new BrevoNewsletterPublisher({ apiKey: env.BREVO_API_KEY, listId: env.BREVO_NEWSLETTER_LIST_ID, senderEmail: env.BREVO_SENDER_EMAIL, senderName: env.BREVO_SENDER_NAME ?? 'Neomoov' }));
  }
  if (env.META_PAGE_ID && env.META_PAGE_TOKEN) {
    const client = new MetaGraphClient({ pageId: env.META_PAGE_ID, pageToken: env.META_PAGE_TOKEN, igUserId: env.META_IG_USER_ID ?? null, version: env.META_GRAPH_VERSION });
    map.set('facebook', new MetaFacebookPublisher(client));
    if (env.META_IG_USER_ID) map.set('instagram', new MetaInstagramPublisher(client));
  }
  const common = { store: options.tokenStore ?? new MemoryTokenStore(), ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) };
  if (env.GOOGLE_BUSINESS_CLIENT_ID && env.GOOGLE_BUSINESS_CLIENT_SECRET && env.GOOGLE_BUSINESS_REFRESH_TOKEN && env.GOOGLE_BUSINESS_ACCOUNT_ID && env.GOOGLE_BUSINESS_LOCATION_ID) {
    map.set('google_business', new GoogleBusinessPublisher({
      clientId: env.GOOGLE_BUSINESS_CLIENT_ID, clientSecret: env.GOOGLE_BUSINESS_CLIENT_SECRET, refreshToken: env.GOOGLE_BUSINESS_REFRESH_TOKEN,
      accountId: lastSegment(env.GOOGLE_BUSINESS_ACCOUNT_ID), locationId: lastSegment(env.GOOGLE_BUSINESS_LOCATION_ID), ...common,
    }));
  }
  const linkedinRefresh = env.LINKEDIN_REFRESH_TOKEN && env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET ? env.LINKEDIN_REFRESH_TOKEN : null;
  if (env.LINKEDIN_ORGANIZATION_ID && (env.LINKEDIN_ACCESS_TOKEN || linkedinRefresh)) {
    map.set('linkedin', new LinkedInPublisher({
      organizationId: lastSegment(env.LINKEDIN_ORGANIZATION_ID.replace(/^urn:li:organization:/, '')), accessToken: env.LINKEDIN_ACCESS_TOKEN ?? null,
      accessExpiresAt: env.LINKEDIN_ACCESS_TOKEN_EXPIRES_AT ? Date.parse(env.LINKEDIN_ACCESS_TOKEN_EXPIRES_AT) : null, refreshToken: linkedinRefresh,
      clientId: env.LINKEDIN_CLIENT_ID ?? null, clientSecret: env.LINKEDIN_CLIENT_SECRET ?? null, version: env.LINKEDIN_API_VERSION, ...common,
    }));
  }
  if (env.YOUTUBE_CLIENT_ID && env.YOUTUBE_CLIENT_SECRET && env.YOUTUBE_REFRESH_TOKEN) {
    map.set('youtube', new YouTubePublisher({ clientId: env.YOUTUBE_CLIENT_ID, clientSecret: env.YOUTUBE_CLIENT_SECRET, refreshToken: env.YOUTUBE_REFRESH_TOKEN, privacyStatus: env.YOUTUBE_PRIVACY_STATUS, ...common }));
  }
  if (env.X_CLIENT_ID && env.X_REFRESH_TOKEN) {
    map.set('x', new XPublisher({ clientId: env.X_CLIENT_ID, clientSecret: env.X_CLIENT_SECRET ?? null, refreshToken: env.X_REFRESH_TOKEN, ...common }));
  }
  if (env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET && env.TIKTOK_REFRESH_TOKEN) {
    map.set('tiktok', new TikTokPublisher({
      clientKey: env.TIKTOK_CLIENT_KEY, clientSecret: env.TIKTOK_CLIENT_SECRET, refreshToken: env.TIKTOK_REFRESH_TOKEN, privacyLevel: env.TIKTOK_PRIVACY_LEVEL, uploadMode: env.TIKTOK_UPLOAD_MODE, ...common,
    }));
  }
  return map;
};

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
