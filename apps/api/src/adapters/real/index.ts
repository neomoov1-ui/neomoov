/**
 * Implémentations réelles. À l'étape 1, chacune refuse proprement tout appel (PROVIDER_NOT_CONFIGURED, 501) :
 * elles sont remplacées par les vraies intégrations aux étapes 4 (cartes, livrée), 7 (paiements, livrée : Stripe), 13 (textos, courriels,
 * push, WhatsApp, voix, modèles de langage), 9 (SEV) et 3 (stockage), quand les clés sont dans `.env`.
 *
 * Chaque classe déclare explicitement ses méthodes (pas de Proxy) : NestJS sonde `onModuleInit` et consorts sur
 * chaque fournisseur, pino et util.inspect lisent `toJSON` et des symboles, et les méthodes typées Promise doivent
 * rejeter, jamais lancer de façon synchrone.
 */
import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../common/app-error.js';
import type { AppEnv } from '../../config/env.js';
import type { EmailProvider, LlmProvider, MapsProvider, PaymentProvider, PushProvider, SevProvider, SmsProvider, StorageProvider, VoiceProvider, WhatsAppProvider } from '../types.js';
import { GoogleMapsProvider } from './google-maps.js';
import { StripePaymentProvider } from './stripe.js';

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

class RealSmsProvider extends NotDelivered implements SmsProvider {
  send(): Promise<never> { return this.reject(); }
}

class RealEmailProvider extends NotDelivered implements EmailProvider {
  send(): Promise<never> { return this.reject(); }
}

class RealPushProvider extends NotDelivered implements PushProvider {
  send(): Promise<never> { return this.reject(); }
}

class RealWhatsAppProvider extends NotDelivered implements WhatsAppProvider {
  sendText(): Promise<never> { return this.reject(); }
  verifyWebhook(): string | null { return this.fail(); }
  parseInbound(): never { return this.fail(); }
}

class RealVoiceProvider extends NotDelivered implements VoiceProvider {
  startOutboundCall(): Promise<never> { return this.reject(); }
  verifyWebhook(): Promise<never> { return this.reject(); }
}

class RealSevProvider extends NotDelivered implements SevProvider {
  transmitInvoice(): Promise<never> { return this.reject(); }
  transmitCancellation(): Promise<never> { return this.reject(); }
}

class RealLlmProvider extends NotDelivered implements LlmProvider {
  complete(): Promise<never> { return this.reject(); }
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
export const realSms = (env: AppEnv): SmsProvider =>
  env.TWILIO_ACCOUNT_SID
    ? build(RealSmsProvider, 'twilio', 'textos (Twilio)', 'TWILIO_ACCOUNT_SID', env)
    : build(RealSmsProvider, 'telnyx', 'textos (Telnyx ou Twilio)', 'TELNYX_API_KEY', env);
export const realEmail = (env: AppEnv): EmailProvider =>
  env.BREVO_API_KEY
    ? build(RealEmailProvider, 'brevo', 'courriels (Brevo)', 'BREVO_API_KEY', env)
    : build(RealEmailProvider, 'resend', 'courriels (Resend ou Brevo)', 'RESEND_API_KEY', env);
export const realPush = (env: AppEnv): PushProvider => build(RealPushProvider, 'expo-push', 'notifications push (Expo)', 'EXPO_TOKEN', env);
export const realWhatsApp = (env: AppEnv): WhatsAppProvider => build(RealWhatsAppProvider, 'meta-whatsapp', 'WhatsApp (Meta)', 'WHATSAPP_TOKEN', env);
export const realVoice = (env: AppEnv): VoiceProvider => build(RealVoiceProvider, 'vapi', 'voix (Vapi)', 'VAPI_API_KEY', env);
export const realSev = (env: AppEnv): SevProvider => build(RealSevProvider, 'sev', 'facturation certifiée (SEV)', 'SEV_API_KEY', env);
export const realLlm = (env: AppEnv): LlmProvider => build(RealLlmProvider, 'anthropic', 'modèles de langage (Anthropic)', 'ANTHROPIC_API_KEY', env);
export const realStorage = (env: AppEnv): StorageProvider =>
  env.S3_ACCESS_KEY
    ? build(RealStorageProvider, 's3', 'stockage objet (S3 compatible)', 'S3_ACCESS_KEY', env)
    : build(RealStorageProvider, 'r2', 'stockage objet (S3 compatible ou R2)', 'R2_ACCESS_KEY_ID', env);
