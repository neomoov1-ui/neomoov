/**
 * Implémentations réelles. À l'étape 1, chacune refuse proprement tout appel (PROVIDER_NOT_CONFIGURED, 501) :
 * elles sont remplacées par les vraies intégrations aux étapes 4 (cartes, livrée), 7 (paiements, livrée : Stripe), 13 (textos, courriels,
 * push, WhatsApp, voix, modèles de langage : Anthropic livré), 9 (SEV) et 3 (stockage), quand les clés sont dans `.env`.
 *
 * Chaque classe déclare explicitement ses méthodes (pas de Proxy) : NestJS sonde `onModuleInit` et consorts sur
 * chaque fournisseur, pino et util.inspect lisent `toJSON` et des symboles, et les méthodes typées Promise doivent
 * rejeter, jamais lancer de façon synchrone.
 */
import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../common/app-error.js';
import { squareConfig, type AppEnv } from '../../config/env.js';
import type { CalendarProvider, CrmProvider, EmailProvider, LlmProvider, MailboxProvider, MapsProvider, PaymentProvider, PlacesProvider, PushProvider, SevProvider, SmsProvider, SocialProvider, StorageProvider, VirusScanner, VoiceProvider, WhatsAppProvider } from '../types.js';
import { AnthropicLlmProvider } from './anthropic.js';
import { ClamAvScanner } from './clamav.js';
import { ExpoPushProvider } from './expo-push.js';
import { GoogleCalendarProvider } from './google-calendar.js';
import { GoogleMapsProvider } from './google-maps.js';
import { GooglePlacesProvider } from './google-places.js';
import { HubSpotCrmProvider } from './hubspot.real.js';
import { ImapMailboxProvider } from './imap-mailbox.js';
import { MetaSocialProvider } from './meta-social.js';
import { StripeBillingProvider } from './stripe-billing.real.js';
import type { BillingProvider } from '../billing.types.js';
import { ResendEmailProvider } from './resend.js';
import { S3StorageProvider } from './s3.js';
import { SquarePaymentProvider } from './square.js';
import { StripePaymentProvider } from './stripe.js';
import { TwilioSmsProvider } from './twilio.js';
import { VapiVoiceProvider } from './vapi.js';
import { WhatsAppCloudProvider } from './whatsapp-cloud.js';

const notConfigured = (service: string, variable: string) =>
  new AppError('PROVIDER_NOT_CONFIGURED', `Le fournisseur ${service} n'est pas configuré (${variable} absente ou adaptateur réel non livré à cette étape).`, HttpStatus.NOT_IMPLEMENTED);

/** Vérifie la présence de la clé au démarrage : sans clé, `<SERVICE>_PROVIDER=real` est une erreur de configuration. */
function requireKey(service: string, variable: keyof AppEnv, env: AppEnv): void {
  if (!env[variable]) throw notConfigured(service, variable);
}

abstract class NotDelivered {
  constructor(
    readonly name: string,
    private readonly service: string,
    private readonly variable: string,
  ) {}
  protected reject<T>(): Promise<T> {
    return Promise.reject(notConfigured(this.service, this.variable));
  }
  protected fail(): never {
    throw notConfigured(this.service, this.variable);
  }
  toJSON() {
    return { name: this.name, configured: false };
  }
}

/** Telnyx (abandonné par la décision D50) et Brevo : non livrés, Twilio et Resend le sont. */
class RealSmsProvider extends NotDelivered implements SmsProvider {
  send(): Promise<never> { return this.reject(); }
  verifyStatusWebhook(): boolean { return this.fail(); }
  parseStatus(): never { return this.fail(); }
  parseInbound(): never { return this.fail(); }
}

class RealEmailProvider extends NotDelivered implements EmailProvider {
  send(): Promise<never> { return this.reject(); }
}


/** Fournisseur certifié à choisir : contrat attendu et champs à confirmer dans docs/sev-adapter.md. */
class RealSevProvider extends NotDelivered implements SevProvider {
  registerSale(): Promise<never> { return this.reject(); }
  registerCancellation(): Promise<never> { return this.reject(); }
  registerCredit(): Promise<never> { return this.reject(); }
  healthcheck(): Promise<never> { return this.reject(); }
}

function build<T>(factory: new (name: string, service: string, variable: string) => T, name: string, service: string, variable: keyof AppEnv, env: AppEnv): T {
  requireKey(service, variable, env);
  return new factory(name, service, variable);
}

export const realMaps = (env: AppEnv): MapsProvider => {
  requireKey('cartes (Google Maps Platform)', 'GOOGLE_MAPS_SERVER_KEY', env);
  return new GoogleMapsProvider(env.GOOGLE_MAPS_SERVER_KEY!);
};
/** Prospection B2B (phase 1 « entreprise autonome ») : Google Places avec la clé serveur des cartes (même choix `MAPS_PROVIDER`). */
export const realPlaces = (env: AppEnv): PlacesProvider => {
  requireKey('établissements (Google Places)', 'GOOGLE_MAPS_SERVER_KEY', env);
  return new GooglePlacesProvider(env.GOOGLE_MAPS_SERVER_KEY!);
};
/** Agenda du fondateur : Google Calendar par client OAuth et jeton de rafraîchissement (`GOOGLE_CALENDAR_*`). */
export const realCalendar = (env: AppEnv): CalendarProvider => {
  for (const variable of ['GOOGLE_CALENDAR_CLIENT_ID', 'GOOGLE_CALENDAR_CLIENT_SECRET', 'GOOGLE_CALENDAR_REFRESH_TOKEN'] as const) requireKey('agenda (Google Calendar)', variable, env);
  return new GoogleCalendarProvider({ clientId: env.GOOGLE_CALENDAR_CLIENT_ID!, clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET!, refreshToken: env.GOOGLE_CALENDAR_REFRESH_TOKEN!, calendarId: env.GOOGLE_CALENDAR_ID ?? 'primary' });
};
/** Paiements : Stripe (`real` ou `stripe`), ou Square (`square`, étape 26) avec les valeurs de son environnement effectif. */
export const realPayment = (env: AppEnv): PaymentProvider => {
  if (env.PAYMENT_PROVIDER === 'square') {
    const square = squareConfig(env);
    // Le webhook est vérifié à la réception (501 sans sa clé) ; le reste est exigé au démarrage.
    const required = square.missing.filter((key) => key !== 'SQUARE_WEBHOOK_SIGNATURE_KEY' && key !== 'SQUARE_WEBHOOK_URL');
    if (required.length) throw notConfigured('paiements (Square)', required.join(', '));
    return new SquarePaymentProvider({ accessToken: square.accessToken!, locationId: square.locationId!, environment: square.environment, webhookSignatureKey: square.webhookSignatureKey, webhookUrl: square.webhookUrl });
  }
  requireKey('paiements (Stripe)', 'STRIPE_SECRET_KEY', env);
  return new StripePaymentProvider(env.STRIPE_SECRET_KEY!, env.STRIPE_WEBHOOK_SECRET);
};
/** Textos : Twilio (D50), statut de livraison rapporté à `/v1/webhooks/twilio/status`. */
export const realSms = (env: AppEnv): SmsProvider => {
  if (!env.TWILIO_ACCOUNT_SID && env.TELNYX_API_KEY) return build(RealSmsProvider, 'telnyx', 'textos (Telnyx, remplacé par Twilio)', 'TELNYX_API_KEY', env);
  requireKey('textos (Twilio)', 'TWILIO_ACCOUNT_SID', env);
  requireKey('textos (Twilio)', 'TWILIO_AUTH_TOKEN', env);
  requireKey('textos (Twilio)', 'TWILIO_FROM_NUMBER', env);
  const extra = (env.TWILIO_EXTRA_NUMBERS ?? '').split(',').map((n) => n.trim()).filter(Boolean);
  return new TwilioSmsProvider(env.TWILIO_ACCOUNT_SID!, env.TWILIO_AUTH_TOKEN!, env.TWILIO_FROM_NUMBER!, `${env.APP_BASE_URL.replace(/\/+$/, '')}/v1/webhooks/twilio/status`, fetch, extra);
};
export const realEmail = (env: AppEnv): EmailProvider => {
  if (!env.RESEND_API_KEY && env.BREVO_API_KEY) return build(RealEmailProvider, 'brevo', 'courriels (Brevo, non livré : utiliser Resend)', 'BREVO_API_KEY', env);
  requireKey('courriels (Resend)', 'RESEND_API_KEY', env);
  return new ResendEmailProvider(env.RESEND_API_KEY!, env.EMAIL_FROM);
};
/** Push Expo : aucune clé exigée ; le jeton d'accès n'est requis que si la sécurité renforcée est activée chez Expo. */
export const realPush = (env: AppEnv): PushProvider => new ExpoPushProvider(env.EXPO_PUSH_ACCESS_TOKEN ?? null);
export const realWhatsApp = (env: AppEnv): WhatsAppProvider => {
  requireKey('WhatsApp (Meta)', 'WHATSAPP_TOKEN', env);
  requireKey('WhatsApp (Meta)', 'WHATSAPP_PHONE_ID', env);
  return new WhatsAppCloudProvider(env.WHATSAPP_TOKEN!, env.WHATSAPP_PHONE_ID!, env.WHATSAPP_VERIFY_TOKEN ?? null, env.WHATSAPP_APP_SECRET ?? null);
};
export const realVoice = (env: AppEnv): VoiceProvider => {
  requireKey('voix (Vapi)', 'VAPI_API_KEY', env);
  return new VapiVoiceProvider(env.VAPI_API_KEY!, env.VAPI_WEBHOOK_SECRET ?? null, env.VAPI_PHONE_NUMBER_ID ?? null);
};
export const realSev = (env: AppEnv): SevProvider => build(RealSevProvider, 'sev', 'facturation certifiée (SEV)', 'SEV_API_KEY', env);
/** API Claude (SDK officiel) : clé `ANTHROPIC_API_KEY`, repli côté serveur selon `LLM_SERVER_FALLBACK`. */
export const realLlm = (env: AppEnv): LlmProvider => {
  requireKey('modèles de langage (Anthropic)', 'ANTHROPIC_API_KEY', env);
  return new AnthropicLlmProvider(env.ANTHROPIC_API_KEY!, { serverFallback: env.LLM_SERVER_FALLBACK === 'on' });
};
/** Antivirus : démon ClamAV (conteneur `clamav/clamav`), adresse `CLAMAV_HOST` et port `CLAMAV_PORT` (3310). */
export const realVirusScanner = (env: AppEnv): VirusScanner => {
  requireKey('antivirus (ClamAV)', 'CLAMAV_HOST', env);
  return new ClamAvScanner(env.CLAMAV_HOST!, env.CLAMAV_PORT);
};
/**
 * Stockage objet (D49) : Supabase Storage par son accès S3 (`S3_ENDPOINT` du tableau de bord, `S3_REGION`, `S3_BUCKET`,
 * `S3_ACCESS_KEY`, `S3_SECRET_KEY`), sinon Cloudflare R2 (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`).
 */
export const realStorage = (env: AppEnv): StorageProvider => {
  if (env.S3_ACCESS_KEY) {
    for (const variable of ['S3_ENDPOINT', 'S3_SECRET_KEY', 'S3_BUCKET'] as const) requireKey('stockage objet (S3 compatible)', variable, env);
    return new S3StorageProvider({ endpoint: env.S3_ENDPOINT!, region: env.S3_REGION ?? 'ca-central-1', bucket: env.S3_BUCKET!, accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY! });
  }
  for (const variable of ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ACCOUNT_ID', 'R2_BUCKET'] as const) requireKey('stockage objet (S3 compatible ou R2)', variable, env);
  return new S3StorageProvider({ endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, region: 'auto', bucket: env.R2_BUCKET!, accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY! });
};
/** CRM (étape 25) : HubSpot par jeton d'application privée ; le numéro de compte ne sert qu'aux liens de `crm:setup`. */
export const realCrm = (env: AppEnv): CrmProvider => {
  requireKey('CRM (HubSpot)', 'HUBSPOT_ACCESS_TOKEN', env);
  return new HubSpotCrmProvider(env.HUBSPOT_ACCESS_TOKEN!, { portalId: env.HUBSPOT_PORTAL_ID ?? null });
};
/** Facturation de la plateforme (étape 25) : Stripe Billing par la clé secrète des paiements ; secret de webhook propre. */
export const realBilling = (env: AppEnv): BillingProvider => {
  requireKey('facturation de la plateforme (Stripe Billing)', 'STRIPE_SECRET_KEY', env);
  return new StripeBillingProvider(env.STRIPE_SECRET_KEY!, env.STRIPE_BILLING_WEBHOOK_SECRET);
};
/** Boîte unifiée : lecture IMAP de contact@ (`imapflow`), repli du relais entrant Brevo. */
export const realMailbox = (env: AppEnv): MailboxProvider => {
  for (const variable of ['MAILBOX_HOST', 'MAILBOX_USER', 'MAILBOX_PASSWORD'] as const) requireKey('boîte courriel (IMAP)', variable, env);
  return new ImapMailboxProvider({ host: env.MAILBOX_HOST!, port: env.MAILBOX_PORT, user: env.MAILBOX_USER!, password: env.MAILBOX_PASSWORD!, folder: env.MAILBOX_FOLDER });
};
/** Boîte unifiée : Messenger, Facebook et Instagram par l'API Graph (même application Meta et même secret que WhatsApp). */
export const realSocial = (env: AppEnv): SocialProvider => {
  requireKey('réseaux sociaux (Meta)', 'META_PAGE_TOKEN', env);
  requireKey('réseaux sociaux (Meta)', 'META_PAGE_ID', env);
  return new MetaSocialProvider(env.META_PAGE_TOKEN!, env.META_PAGE_ID!, env.META_INSTAGRAM_ID ?? null, env.WHATSAPP_VERIFY_TOKEN ?? null, env.WHATSAPP_APP_SECRET ?? null);
};
