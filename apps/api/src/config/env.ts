/**
 * Configuration typée de l'API (section 3.6 du cahier des charges). Toutes les valeurs viennent des variables
 * d'environnement ; le fichier .env de la racine du monorepo est chargé s'il existe. Le démarrage échoue avec un
 * message clair si une variable obligatoire manque ou est invalide.
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const providerMode = z.enum(['mock', 'real']).default('mock');
const flag = z
  .enum(['on', 'off', 'true', 'false', '1', '0', ''])
  .default('off')
  .transform((v) => v === 'on' || v === 'true' || v === '1');
const optionalString = z.string().trim().optional().transform((v) => (v ? v : undefined));

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  APP_BASE_URL: z.string().url().default('http://localhost:4000'),
  WEB_BASE_URL: z.string().url().default('http://localhost:3000'),
  // Origines autorisées par CORS, séparées par des virgules ; vide : WEB_BASE_URL seulement.
  CORS_ORIGINS: optionalString,
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  TIMEZONE: z.string().default('America/Toronto'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL est obligatoire (adresse « Session pooler » de Supabase ou base locale)'),
  TEST_DATABASE_URL: optionalString,
  // Connexions simultanées à la base par processus ; vide : 10 (2 en test, les fichiers de test tournant en parallèle).
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).optional(),
  // Sans REDIS_URL, l'API et le worker utilisent des files et un cache en mémoire (développement seulement).
  REDIS_URL: optionalString,
  // Répartition automatique (étape 6) : `auto` réagit aux demandes de course ; `manual` laisse l'opérateur ou les tests la piloter.
  DISPATCH_MODE: z.enum(['auto', 'manual']).default('auto'),
  // Période du battement de la répartition (expiration des offres, vagues, surveillance) ; 0 : aucun battement périodique.
  DISPATCH_TICK_MS: z.coerce.number().int().min(0).max(60_000).default(1000),

  JWT_ACCESS_SECRET: optionalString,
  JWT_REFRESH_SECRET: optionalString,
  ENCRYPTION_KEY: optionalString,
  /**
   * Clé des dérivations durables (vérification des factures émises, pseudonymes de l'export de géolocalisation) ; absente :
   * `ENCRYPTION_KEY`. Avant une rotation d'`ENCRYPTION_KEY`, y copier l'ancienne clé : codes QR et pseudonymes restent valides.
   */
  DERIVATION_KEY: optionalString,

  /**
   * Paiements (étape 26) : `stripe` (ou `real`, même chose), `square` (compte Square canadien, en attendant la validation
   * du compte Stripe), `mock`. Avec Square, les versements aux chauffeurs se font hors plateforme (aucun Connect).
   */
  PAYMENT_PROVIDER: z.enum(['mock', 'real', 'stripe', 'square']).default('mock'),
  MAPS_PROVIDER: providerMode,
  SMS_PROVIDER: providerMode,
  EMAIL_PROVIDER: providerMode,
  PUSH_PROVIDER: providerMode,
  WHATSAPP_PROVIDER: providerMode,
  VOICE_PROVIDER: providerMode,
  LLM_PROVIDER: providerMode,
  SEV_PROVIDER: providerMode,
  STORAGE_PROVIDER: providerMode,
  /** Antivirus des documents téléversés : simulé (fichier EICAR) ou ClamAV réel. */
  VIRUS_SCANNER_PROVIDER: providerMode,
  CLAMAV_HOST: optionalString,
  CLAMAV_PORT: z.coerce.number().int().min(1).max(65_535).default(3310),
  /** CRM (étape 25) : simulé, ou HubSpot réel par jeton d'application privée (`HUBSPOT_ACCESS_TOKEN`). */
  CRM_PROVIDER: providerMode,
  HUBSPOT_ACCESS_TOKEN: optionalString,
  /** Numéro de compte HubSpot (Hub ID), facultatif et non secret : liens affichés par `crm:setup`. */
  HUBSPOT_PORTAL_ID: optionalString,
  /** Facturation de la plateforme (étape 25) : simulée, ou Stripe Billing réel (même `STRIPE_SECRET_KEY` que les paiements). */
  BILLING_PROVIDER: providerMode,
  /** Secret de signature du point de terminaison `/v1/webhooks/stripe-billing` (distinct de `STRIPE_WEBHOOK_SECRET`). */
  STRIPE_BILLING_WEBHOOK_SECRET: optionalString,
  // Vérification des jetons Apple et Google : simulée (jetons « mock-apple:<sujet>:<courriel> ») ou réelle (JWKS des fournisseurs).
  SOCIAL_LOGIN_PROVIDER: providerMode,
  /**
   * Production : fournisseurs laissés en simulation, déclarés un par un (ex. `payment,sev,whatsapp,voice` pendant la
   * bêta). Tout autre `*_PROVIDER=mock` empêche le démarrage : jamais de retour silencieux aux simulateurs.
   */
  ALLOW_MOCK_PROVIDERS: optionalString,
  // Identifiants acceptés (audience) : bundle ids iOS et identifiant de service web pour Apple, client ids OAuth pour Google, séparés par des virgules.
  APPLE_CLIENT_IDS: optionalString,
  GOOGLE_CLIENT_IDS: optionalString,
  // Nom affiché dans les applications d'authentification (second facteur du personnel).
  MFA_ISSUER: z.string().default('Neomoov My Hub'),

  STRIPE_SECRET_KEY: optionalString,
  STRIPE_PUBLISHABLE_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
  STRIPE_CONNECT_CLIENT_ID: optionalString,
  /**
   * Square (étape 26) : jeton d'accès et identifiant d'application de production, leurs équivalents du bac à sable (lus
   * quand `SQUARE_ENVIRONMENT=sandbox`), emplacement qui encaisse (CAD ; celui du bac à sable est distinct), clé de
   * signature du point de réception des webhooks et adresse publique déclarée chez Square (elle entre dans la signature).
   */
  SQUARE_ACCESS_TOKEN: optionalString,
  SQUARE_SANDBOX_ACCESS_TOKEN: optionalString,
  SQUARE_APPLICATION_ID: optionalString,
  SQUARE_SANDBOX_APPLICATION_ID: optionalString,
  SQUARE_LOCATION_ID: optionalString,
  SQUARE_SANDBOX_LOCATION_ID: optionalString,
  SQUARE_WEBHOOK_SIGNATURE_KEY: optionalString,
  SQUARE_WEBHOOK_URL: z.string().url().optional(),
  /** `sandbox` (bac à sable Square) ou `production` ; vide : `production` quand NODE_ENV vaut production, sinon `sandbox`. */
  SQUARE_ENVIRONMENT: z.enum(['sandbox', 'production']).optional(),
  GOOGLE_MAPS_SERVER_KEY: optionalString,
  GOOGLE_MAPS_IOS_KEY: optionalString,
  GOOGLE_MAPS_ANDROID_KEY: optionalString,
  TELNYX_API_KEY: optionalString,
  TELNYX_MESSAGING_PROFILE_ID: optionalString,
  TWILIO_ACCOUNT_SID: optionalString,
  TWILIO_AUTH_TOKEN: optionalString,
  TWILIO_FROM_NUMBER: optionalString,
  /** Cloudflare Turnstile (anti-robots des formulaires publics) ; absent en développement : jeton accepté sauf « fail ». */
  TURNSTILE_SECRET_KEY: optionalString,
  RESEND_API_KEY: optionalString,
  /** Expéditeur des courriels, sur le domaine vérifié chez Resend. */
  EMAIL_FROM: optionalString.transform((v) => v ?? 'Neomoov <notifications@neomoov.net>'),
  BREVO_API_KEY: optionalString,
  WHATSAPP_TOKEN: optionalString,
  WHATSAPP_PHONE_ID: optionalString,
  WHATSAPP_VERIFY_TOKEN: optionalString,
  /** Secret de l'application Meta : signature `X-Hub-Signature-256` des webhooks WhatsApp. */
  WHATSAPP_APP_SECRET: optionalString,
  VAPI_API_KEY: optionalString,
  VAPI_WEBHOOK_SECRET: optionalString,
  VAPI_PHONE_NUMBER_ID: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  /** Repli côté serveur de l'API Claude (`fallbacks: "default"`) quand le modèle d'un agent décline ; `off` le coupe. */
  LLM_SERVER_FALLBACK: z.enum(['on', 'off']).default('on'),
  /**
   * Déclencheurs des agents IA (messages entrants, documents, relevés, rapports planifiés). Vide : actifs, sauf en test
   * (les fichiers de test tournent en parallèle sur la même base ; celui des agents les active).
   */
  AGENT_TRIGGERS: z.enum(['on', 'off']).optional(),
  /**
   * Examen des applications par Apple et Google : numéros déclarés (E.164, séparés par des virgules) qui reçoivent
   * toujours le code `REVIEW_OTP_CODE`, sans texto. Secret : ne jamais publier le code ailleurs que dans les notes
   * d'examen des magasins ; vider les deux variables après la publication.
   */
  REVIEW_PHONES: optionalString,
  REVIEW_OTP_CODE: optionalString,
  S3_ENDPOINT: optionalString,
  /** Région de l'accès S3 (Supabase : celle du projet, ca-central-1 par défaut). */
  S3_REGION: optionalString,
  S3_BUCKET: optionalString,
  S3_ACCESS_KEY: optionalString,
  S3_SECRET_KEY: optionalString,
  R2_ACCOUNT_ID: optionalString,
  R2_ACCESS_KEY_ID: optionalString,
  R2_SECRET_ACCESS_KEY: optionalString,
  R2_BUCKET: optionalString,
  /** Suivi des erreurs : actif seulement si le DSN est renseigné (API et worker). */
  SENTRY_DSN: optionalString,
  /** Environnement annoncé au suivi des erreurs et à la santé (`staging`, `production`) ; vide : NODE_ENV. */
  SENTRY_ENVIRONMENT: optionalString,
  /** Version déployée (étiquette ou empreinte Git, posée par le déploiement) ; vide : version du paquet. */
  APP_VERSION: optionalString,
  BETTERSTACK_TOKEN: optionalString,
  /** Moniteur « heartbeat » de Better Stack (adresse secrète) : le worker l'appelle à chaque battement, chaque minute ; vide : aucun appel. */
  BETTERSTACK_HEARTBEAT_URL: z.string().url().optional(),
  EXPO_TOKEN: optionalString,
  /** Jeton d'accès du service push d'Expo, seulement si la « sécurité renforcée » des push est activée. */
  EXPO_PUSH_ACCESS_TOKEN: optionalString,
  SEV_API_KEY: optionalString,

  FEATURE_NEGOTIATION: flag,
  FEATURE_NEGOTIATION_ABOVE_MAX: flag,
  FEATURE_FACE_CHECK: flag,
  FEATURE_SCHEDULED_FLIGHT_TRACKING: flag,
  FEATURE_IMMEDIATE_RIDES: flag,
  /** Paiement par carte (Stripe) proposé : `on` ou `off` ; par défaut, jamais en production avec le simulateur de paiement. */
  CARD_PAYMENTS: z.enum(['on', 'off']).optional(),
  /** Documentation OpenAPI servie sur `/v1/docs` : `on` ou `off` ; par défaut, jamais en production (carte des routes). */
  API_DOCS: z.enum(['on', 'off']).optional(),
  FEATURE_INSTALLMENTS: flag,
  FEATURE_RIDE_SERIES: flag,
  /**
   * Étape 21, développement seulement : `on` rend aussi le jeton d'une invitation à la personne qui invite (le lien part
   * toujours par texto ou courriel). Ignoré en production.
   */
  INVITATION_TOKEN_IN_RESPONSE: z.enum(['on', 'off']).optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

/** Jeton d'invitation rendu à la personne qui invite : jamais en production, et seulement sur demande en développement. */
export function invitationTokenInResponse(env: Pick<AppEnv, 'INVITATION_TOKEN_IN_RESPONSE' | 'NODE_ENV'>): boolean {
  return env.NODE_ENV !== 'production' && env.INVITATION_TOKEN_IN_RESPONSE === 'on';
}

type ProviderKey = 'PAYMENT_PROVIDER' | 'MAPS_PROVIDER' | 'SMS_PROVIDER' | 'EMAIL_PROVIDER' | 'PUSH_PROVIDER' | 'WHATSAPP_PROVIDER' | 'VOICE_PROVIDER' | 'LLM_PROVIDER' | 'SEV_PROVIDER' | 'STORAGE_PROVIDER' | 'VIRUS_SCANNER_PROVIDER' | 'CRM_PROVIDER' | 'BILLING_PROVIDER';
/** Nom court de chaque fournisseur dans `ALLOW_MOCK_PROVIDERS`. */
const PROVIDER_ALIASES: Record<ProviderKey, string> = {
  PAYMENT_PROVIDER: 'payment', MAPS_PROVIDER: 'maps', SMS_PROVIDER: 'sms', EMAIL_PROVIDER: 'email', PUSH_PROVIDER: 'push', WHATSAPP_PROVIDER: 'whatsapp',
  VOICE_PROVIDER: 'voice', LLM_PROVIDER: 'llm', SEV_PROVIDER: 'sev', STORAGE_PROVIDER: 'storage', VIRUS_SCANNER_PROVIDER: 'antivirus', CRM_PROVIDER: 'crm', BILLING_PROVIDER: 'billing',
};
const MOCKABLE_PROVIDERS = (Object.keys(PROVIDER_ALIASES) as ProviderKey[]).map((key) => [PROVIDER_ALIASES[key], key] as const);

/** Secrets de signature et de chiffrement : 32 caractères au moins en production (`openssl rand -hex 32` en donne 64 ; revue du 2 octobre 2026, sécurité 12). */
export const MIN_SECRET_LENGTH = 32;
const PRODUCTION_SECRETS = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY'] as const;

/**
 * Carte proposée aux clients : forcée par `CARD_PAYMENTS`, sinon partout sauf en production avec le simulateur de
 * paiement (bêta sans Stripe : paiement au chauffeur seulement, aucune carte fictive acceptée).
 */
/** `/v1/docs` servie : forcée par `API_DOCS`, sinon partout sauf en production (revue finale). */
export function apiDocsServed(env: Pick<AppEnv, 'API_DOCS' | 'NODE_ENV'>): boolean {
  return env.API_DOCS ? env.API_DOCS === 'on' : env.NODE_ENV !== 'production';
}

export function cardPaymentsEnabled(env: Pick<AppEnv, 'CARD_PAYMENTS' | 'NODE_ENV' | 'PAYMENT_PROVIDER'>): boolean {
  if (env.CARD_PAYMENTS) return env.CARD_PAYMENTS === 'on';
  return !(env.NODE_ENV === 'production' && env.PAYMENT_PROVIDER === 'mock');
}

/** Environnement Square effectif : explicite, sinon celui qui va avec `NODE_ENV`. */
export function squareEnvironment(env: Pick<AppEnv, 'SQUARE_ENVIRONMENT' | 'NODE_ENV'>): 'sandbox' | 'production' {
  return env.SQUARE_ENVIRONMENT ?? (env.NODE_ENV === 'production' ? 'production' : 'sandbox');
}

type SquareEnvKeys = 'SQUARE_ENVIRONMENT' | 'NODE_ENV' | 'SQUARE_ACCESS_TOKEN' | 'SQUARE_SANDBOX_ACCESS_TOKEN' | 'SQUARE_APPLICATION_ID' | 'SQUARE_SANDBOX_APPLICATION_ID' | 'SQUARE_LOCATION_ID' | 'SQUARE_SANDBOX_LOCATION_ID' | 'SQUARE_WEBHOOK_SIGNATURE_KEY' | 'SQUARE_WEBHOOK_URL';

/**
 * Valeurs Square de l'environnement effectif (étape 26) : en bac à sable, le jeton, l'identifiant d'application et
 * l'emplacement du bac à sable (`SQUARE_SANDBOX_*` : les identifiants de production n'y existent pas) ; en production,
 * les valeurs de production. `missing` liste les variables qui manquent pour cet environnement (l'API refuse de démarrer
 * en production avec Square).
 */
export function squareConfig(env: Pick<AppEnv, SquareEnvKeys>) {
  const environment = squareEnvironment(env);
  const sandbox = environment === 'sandbox';
  const values = {
    environment,
    accessToken: sandbox ? env.SQUARE_SANDBOX_ACCESS_TOKEN : env.SQUARE_ACCESS_TOKEN,
    applicationId: sandbox ? env.SQUARE_SANDBOX_APPLICATION_ID : env.SQUARE_APPLICATION_ID,
    locationId: sandbox ? env.SQUARE_SANDBOX_LOCATION_ID : env.SQUARE_LOCATION_ID,
    webhookSignatureKey: env.SQUARE_WEBHOOK_SIGNATURE_KEY,
    webhookUrl: env.SQUARE_WEBHOOK_URL,
  };
  const missing = [
    ...(values.accessToken ? [] : [sandbox ? 'SQUARE_SANDBOX_ACCESS_TOKEN' : 'SQUARE_ACCESS_TOKEN']),
    ...(values.applicationId ? [] : [sandbox ? 'SQUARE_SANDBOX_APPLICATION_ID' : 'SQUARE_APPLICATION_ID']),
    ...(values.locationId ? [] : [sandbox ? 'SQUARE_SANDBOX_LOCATION_ID' : 'SQUARE_LOCATION_ID']),
    ...(values.webhookSignatureKey ? [] : ['SQUARE_WEBHOOK_SIGNATURE_KEY']),
    ...(values.webhookUrl ? [] : ['SQUARE_WEBHOOK_URL']),
  ];
  return { ...values, missing };
}

/** Charge le .env le plus proche en remontant depuis ce fichier (la racine du monorepo), sans écraser l'environnement. */
export function loadDotenvFromRoot(): string | undefined {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate, override: false, quiet: true });
      return candidate;
    }
    dir = dirname(dir);
  }
  return undefined;
}

/**
 * Construit la configuration à partir de `source` (par défaut process.env, après chargement du .env).
 * Les secrets absents en développement et en test reçoivent des valeurs de repli non secrètes, jamais en production.
 */
export function loadEnv(source?: Record<string, string | undefined>, { dotenv = true }: { dotenv?: boolean } = {}): AppEnv {
  if (dotenv && !source) loadDotenvFromRoot();
  // Une valeur vide (« CLE= » dans .env, comme dans .env.example) équivaut à une variable absente : les défauts s'appliquent.
  const cleaned = Object.fromEntries(Object.entries(source ?? process.env).filter(([, value]) => typeof value === 'string' && value.trim() !== ''));
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.') || '(racine)'} : ${i.message}`).join(' ; ');
    throw new Error(`Configuration invalide. ${details}`);
  }
  const env = parsed.data;
  if (env.REVIEW_PHONES) {
    if (!env.REVIEW_OTP_CODE || !/^\d{6}$/.test(env.REVIEW_OTP_CODE)) throw new Error('Configuration invalide : REVIEW_OTP_CODE (6 chiffres) est obligatoire avec REVIEW_PHONES.');
    if (/^(\d)\1{5}$|^(123456|654321)$/.test(env.REVIEW_OTP_CODE)) throw new Error('Configuration invalide : REVIEW_OTP_CODE trop facile à deviner.');
    const bad = env.REVIEW_PHONES.split(',').map((p) => p.trim()).filter((p) => !/^\+\d{8,15}$/.test(p));
    if (bad.length) throw new Error('Configuration invalide : REVIEW_PHONES doit lister des numéros au format E.164.');
  }
  if (env.NODE_ENV === 'production') {
    const missing = PRODUCTION_SECRETS.filter((k) => !env[k]);
    if (missing.length) throw new Error(`Configuration invalide en production : ${missing.join(', ')} obligatoire(s).`);
    const short = PRODUCTION_SECRETS.filter((k) => (env[k] ?? '').length < MIN_SECRET_LENGTH);
    if (short.length) throw new Error(`Configuration invalide en production : ${short.join(', ')} : ${MIN_SECRET_LENGTH} caractères au moins (openssl rand -hex 32).`);
    if (!env.REDIS_URL) throw new Error('Configuration invalide en production : REDIS_URL est obligatoire.');
    // Le mode simulé accepte des jetons forgés (« mock-apple:<sujet> ») : jamais en production.
    if (env.SOCIAL_LOGIN_PROVIDER !== 'real') throw new Error('Configuration invalide en production : SOCIAL_LOGIN_PROVIDER doit valoir « real ».');
    const allowed = new Set((env.ALLOW_MOCK_PROVIDERS ?? '').split(',').map((p) => p.trim().toLowerCase()).filter(Boolean));
    const simulated = MOCKABLE_PROVIDERS.filter(([, key]) => env[key] === 'mock' && !allowed.has(PROVIDER_ALIASES[key]));
    if (simulated.length) {
      throw new Error(`Configuration invalide en production : fournisseurs simulés non déclarés (${simulated.map(([, key]) => key).join(', ')}). Passer chacun à « real » avec ses clés, ou l'autoriser explicitement dans ALLOW_MOCK_PROVIDERS (${simulated.map(([, key]) => PROVIDER_ALIASES[key]).join(',')}).`);
    }
    if (env.PAYMENT_PROVIDER === 'square') {
      const { environment, missing: absent } = squareConfig(env);
      if (absent.length) throw new Error(`Configuration invalide en production : PAYMENT_PROVIDER=square (environnement Square « ${environment} ») exige ${absent.join(', ')}.`);
    }
  }
  return {
    ...env,
    JWT_ACCESS_SECRET: env.JWT_ACCESS_SECRET ?? 'dev-access-secret-non-secret',
    JWT_REFRESH_SECRET: env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-non-secret',
    ENCRYPTION_KEY: env.ENCRYPTION_KEY ?? 'dev-encryption-key-non-secret-32b',
  };
}

export const APP_ENV = Symbol('APP_ENV');
