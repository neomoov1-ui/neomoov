/**
 * Choix des connecteurs réels du marketing (phase 1 « entreprise autonome ») selon les variables d'environnement.
 * `MARKETING_PROVIDER=real` : WordPress (site et Academy), Brevo (infolettre), Meta (Facebook, Instagram) quand leurs
 * clés sont présentes ; LinkedIn, TikTok, YouTube, X, Fiche Google et Snapchat ne sont pas livrés (interfaces et
 * variables prévues, droits à demander dans docs/marketing/connecteurs.md) : un connecteur « non configuré » refuse
 * clairement et le calendrier ignore l'espace. Jamais de simulation silencieuse en mode réel.
 */
import { HttpStatus } from '@nestjs/common';
import { CONTENT_SPACES, SPACE_RULES, type ContentSpace } from '@neomoov/domain';
import { AppError } from '../../common/app-error.js';
import type { AppEnv } from '../../config/env.js';
import type { SearchConsoleProvider, SiteConnector, SocialPublisher, SocialPublishers, TtsProvider } from '../marketing.types.js';
import { BrevoNewsletterPublisher } from './brevo.js';
import { MetaFacebookPublisher, MetaGraphClient, MetaInstagramPublisher } from './meta-graph.js';
import { GoogleSearchConsoleProvider } from './search-console.js';
import { AzureTtsProvider, PiperTtsProvider } from './tts.js';
import { NoSearchConsoleProvider, WordPressConnector } from './wordpress.js';

/** Variables attendues par espace (clés à poser par le fondateur) ; documentées dans docs/marketing/connecteurs.md. */
export const SPACE_VARIABLES: Readonly<Record<ContentSpace, readonly string[]>> = {
  site_blog: ['WORDPRESS_URL', 'WORDPRESS_USER', 'WORDPRESS_APP_PASSWORD'],
  academy: ['WORDPRESS_URL', 'WORDPRESS_USER', 'WORDPRESS_APP_PASSWORD'],
  google_business: ['GBP_CLIENT_ID', 'GBP_CLIENT_SECRET', 'GBP_REFRESH_TOKEN', 'GBP_LOCATION_ID'],
  facebook: ['META_PAGE_ID', 'META_PAGE_TOKEN'],
  instagram: ['META_PAGE_ID', 'META_PAGE_TOKEN', 'META_IG_USER_ID'],
  linkedin: ['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_ORGANIZATION_ID'],
  tiktok: ['TIKTOK_ACCESS_TOKEN'],
  youtube: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'],
  x: ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'],
  snapchat: ['SNAPCHAT_ACCESS_TOKEN', 'SNAPCHAT_PROFILE_ID'],
  newsletter: ['BREVO_API_KEY', 'BREVO_NEWSLETTER_LIST_ID', 'BREVO_SENDER_EMAIL'],
  telegram: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHANNEL_ID'],
  // Chaîne WhatsApp : aucune API de publication, relais manuel depuis My Hub (vue « À relayer »).
  whatsapp_channel: [],
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

export const realSocialPublishers = (env: AppEnv): SocialPublishers => {
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
