import { Global, Module, type Provider } from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../config/env.js';
import {
  MockBillingProvider, MockCrmProvider, MockEmailProvider, MockLlmProvider, MockMapsProvider, MockPaymentProvider, MockPushProvider, MockSevProvider, MockSmsProvider,
  MockStorageProvider, MockVirusScanner, MockVoiceProvider, MockWhatsAppProvider,
} from './mock/index.js';
import { realBilling, realCrm, realEmail, realLlm, realMaps, realPayment, realPush, realSev, realSms, realStorage, realVirusScanner, realVoice, realWhatsApp } from './real/index.js';
import {
  CRM_PROVIDER, EMAIL_PROVIDER, LLM_PROVIDER, MAPS_PROVIDER, PAYMENT_PROVIDER, PUSH_PROVIDER, SEV_PROVIDER, SMS_PROVIDER, STORAGE_PROVIDER, VIRUS_SCANNER, VOICE_PROVIDER, WHATSAPP_PROVIDER,
  type CrmProvider, type EmailProvider, type LlmProvider, type MapsProvider, type PaymentProvider, type PushProvider, type SevProvider, type SmsProvider, type StorageProvider, type VirusScanner, type VoiceProvider, type WhatsAppProvider,
} from './types.js';
import { BILLING_PROVIDER, type BillingProvider } from './billing.types.js';
import { SEARCH_CONSOLE_PROVIDER, SITE_CONNECTOR, SOCIAL_PUBLISHERS, TTS_PROVIDER, type SearchConsoleProvider, type SiteConnector, type SocialPublishers, type TtsProvider } from './marketing.types.js';
import { MockSearchConsoleProvider, MockSiteConnector, MockTtsProvider, mockSocialPublishers } from './mock/marketing.mock.js';
import { realSearchConsole, realSiteConnector, realSocialPublishers, realTts } from './real/marketing.js';

type Mode = 'mock' | 'real';
const choose = <T>(token: symbol, key: keyof AppEnv, mock: (env: AppEnv) => T, real: (env: AppEnv) => T): Provider => ({
  provide: token,
  inject: [APP_ENV],
  useFactory: (env: AppEnv) => ((env[key] as Mode) === 'real' ? real(env) : mock(env)),
});
/** En production, un fournisseur simulé refuse tout webhook (la signature de test est publique). */
const mockWebhooks = (env: AppEnv) => ({ acceptTestSignatures: env.NODE_ENV !== 'production' });

/** Un fournisseur par service, simulé par défaut, réel quand `<SERVICE>_PROVIDER=real` et que la clé est présente. */
@Global()
@Module({
  providers: [
    choose<MapsProvider>(MAPS_PROVIDER, 'MAPS_PROVIDER', () => new MockMapsProvider(), realMaps),
    // Paiements : `mock`, sinon `real` ou `stripe` (Stripe) ou `square` (étape 26), départagés par `realPayment`.
    { provide: PAYMENT_PROVIDER, inject: [APP_ENV], useFactory: (env: AppEnv): PaymentProvider => (env.PAYMENT_PROVIDER === 'mock' ? new MockPaymentProvider(mockWebhooks(env)) : realPayment(env)) },
    choose<SmsProvider>(SMS_PROVIDER, 'SMS_PROVIDER', (env) => new MockSmsProvider(mockWebhooks(env)), realSms),
    choose<EmailProvider>(EMAIL_PROVIDER, 'EMAIL_PROVIDER', () => new MockEmailProvider(), realEmail),
    choose<PushProvider>(PUSH_PROVIDER, 'PUSH_PROVIDER', () => new MockPushProvider(), realPush),
    choose<WhatsAppProvider>(WHATSAPP_PROVIDER, 'WHATSAPP_PROVIDER', (env) => new MockWhatsAppProvider(mockWebhooks(env)), realWhatsApp),
    choose<VoiceProvider>(VOICE_PROVIDER, 'VOICE_PROVIDER', (env) => new MockVoiceProvider(mockWebhooks(env)), realVoice),
    choose<SevProvider>(SEV_PROVIDER, 'SEV_PROVIDER', () => new MockSevProvider(), realSev),
    choose<LlmProvider>(LLM_PROVIDER, 'LLM_PROVIDER', () => new MockLlmProvider(), realLlm),
    choose<StorageProvider>(STORAGE_PROVIDER, 'STORAGE_PROVIDER', () => new MockStorageProvider(), realStorage),
    choose<VirusScanner>(VIRUS_SCANNER, 'VIRUS_SCANNER_PROVIDER', () => new MockVirusScanner(), realVirusScanner),
    choose<CrmProvider>(CRM_PROVIDER, 'CRM_PROVIDER', () => new MockCrmProvider(), realCrm),
    choose<BillingProvider>(BILLING_PROVIDER, 'BILLING_PROVIDER', (env) => new MockBillingProvider(mockWebhooks(env)), realBilling),
    // Marketing automatisé (phase 1 « entreprise autonome ») : un seul interrupteur pour les onze espaces, le site, la voix et la Search Console.
    choose<SocialPublishers>(SOCIAL_PUBLISHERS, 'MARKETING_PROVIDER', () => mockSocialPublishers(), realSocialPublishers),
    choose<SiteConnector>(SITE_CONNECTOR, 'MARKETING_PROVIDER', () => new MockSiteConnector(), realSiteConnector),
    choose<TtsProvider>(TTS_PROVIDER, 'MARKETING_PROVIDER', () => new MockTtsProvider(), realTts),
    choose<SearchConsoleProvider>(SEARCH_CONSOLE_PROVIDER, 'MARKETING_PROVIDER', () => new MockSearchConsoleProvider(), realSearchConsole),
  ],
  exports: [MAPS_PROVIDER, PAYMENT_PROVIDER, SMS_PROVIDER, EMAIL_PROVIDER, PUSH_PROVIDER, WHATSAPP_PROVIDER, VOICE_PROVIDER, SEV_PROVIDER, LLM_PROVIDER, STORAGE_PROVIDER, VIRUS_SCANNER, CRM_PROVIDER, BILLING_PROVIDER, SOCIAL_PUBLISHERS, SITE_CONNECTOR, TTS_PROVIDER, SEARCH_CONSOLE_PROVIDER],
})
export class AdaptersModule {}
