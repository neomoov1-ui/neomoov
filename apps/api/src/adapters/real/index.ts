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
import type { AppEnv } from '../../config/env.js';
import type { EmailProvider, LlmProvider, MapsProvider, PaymentProvider, PushProvider, SevProvider, SmsProvider, StorageProvider, VirusScanner, VoiceProvider, WhatsAppProvider } from '../types.js';
import { AnthropicLlmProvider } from './anthropic.js';
import { ClamAvScanner } from './clamav.js';
import { ExpoPushProvider } from './expo-push.js';
import { GoogleMapsProvider } from './google-maps.js';
import { ResendEmailProvider } from './resend.js';
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

class RealStorageProvider extends NotDelivered implements StorageProvider {
  getObject(): Promise<never> { return this.reject(); }
  putObject(): Promise<never> { return this.reject(); }
  getSignedUrl(): Promise<never> { return this.reject(); }
  deleteObject(): Promise<never> { return this.reject(); }
}

function build<T>(factory: new (name: string, service: string, variable: string) => T, name: string, service: string, variable: keyof AppEnv, env: AppEnv): T {
  requireKey(service, variable, env);
  return new factory(name, service, variable);
}

export const realMaps = (env: AppEnv): MapsProvider => {
  requireKey('cartes (Google Maps Platform)', 'GOOGLE_MAPS_SERVER_KEY', env);
  return new GoogleMapsProvider(env.GOOGLE_MAPS_SERVER_KEY!);
};
export const realPayment = (env: AppEnv): PaymentProvider => {
  requireKey('paiements (Stripe)', 'STRIPE_SECRET_KEY', env);
  return new StripePaymentProvider(env.STRIPE_SECRET_KEY!, env.STRIPE_WEBHOOK_SECRET);
};
/** Textos : Twilio (D50), statut de livraison rapporté à `/v1/webhooks/twilio/status`. */
export const realSms = (env: AppEnv): SmsProvider => {
  if (!env.TWILIO_ACCOUNT_SID && env.TELNYX_API_KEY) return build(RealSmsProvider, 'telnyx', 'textos (Telnyx, remplacé par Twilio)', 'TELNYX_API_KEY', env);
  requireKey('textos (Twilio)', 'TWILIO_ACCOUNT_SID', env);
  requireKey('textos (Twilio)', 'TWILIO_AUTH_TOKEN', env);
  requireKey('textos (Twilio)', 'TWILIO_FROM_NUMBER', env);
  return new TwilioSmsProvider(env.TWILIO_ACCOUNT_SID!, env.TWILIO_AUTH_TOKEN!, env.TWILIO_FROM_NUMBER!, `${env.APP_BASE_URL.replace(/\/+$/, '')}/v1/webhooks/twilio/status`);
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
export const realStorage = (env: AppEnv): StorageProvider =>
  env.S3_ACCESS_KEY
    ? build(RealStorageProvider, 's3', 'stockage objet (S3 compatible)', 'S3_ACCESS_KEY', env)
    : build(RealStorageProvider, 'r2', 'stockage objet (S3 compatible ou R2)', 'R2_ACCESS_KEY_ID', env);
