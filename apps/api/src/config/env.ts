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

  PAYMENT_PROVIDER: providerMode,
  MAPS_PROVIDER: providerMode,
  SMS_PROVIDER: providerMode,
  EMAIL_PROVIDER: providerMode,
  PUSH_PROVIDER: providerMode,
  WHATSAPP_PROVIDER: providerMode,
  VOICE_PROVIDER: providerMode,
  LLM_PROVIDER: providerMode,
  SEV_PROVIDER: providerMode,
  STORAGE_PROVIDER: providerMode,
  // Vérification des jetons Apple et Google : simulée (jetons « mock-apple:<sujet>:<courriel> ») ou réelle (JWKS des fournisseurs).
  SOCIAL_LOGIN_PROVIDER: providerMode,
  // Identifiants acceptés (audience) : bundle ids iOS et identifiant de service web pour Apple, client ids OAuth pour Google, séparés par des virgules.
  APPLE_CLIENT_IDS: optionalString,
  GOOGLE_CLIENT_IDS: optionalString,
  // Nom affiché dans les applications d'authentification (second facteur du personnel).
  MFA_ISSUER: z.string().default('Neomoov My Hub'),

  STRIPE_SECRET_KEY: optionalString,
  STRIPE_PUBLISHABLE_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,
  STRIPE_CONNECT_CLIENT_ID: optionalString,
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
  BREVO_API_KEY: optionalString,
  WHATSAPP_TOKEN: optionalString,
  WHATSAPP_PHONE_ID: optionalString,
  WHATSAPP_VERIFY_TOKEN: optionalString,
  VAPI_API_KEY: optionalString,
  VAPI_WEBHOOK_SECRET: optionalString,
  VAPI_PHONE_NUMBER_ID: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  S3_ENDPOINT: optionalString,
  S3_BUCKET: optionalString,
  S3_ACCESS_KEY: optionalString,
  S3_SECRET_KEY: optionalString,
  R2_ACCOUNT_ID: optionalString,
  R2_ACCESS_KEY_ID: optionalString,
  R2_SECRET_ACCESS_KEY: optionalString,
  R2_BUCKET: optionalString,
  SENTRY_DSN: optionalString,
  BETTERSTACK_TOKEN: optionalString,
  EXPO_TOKEN: optionalString,
  SEV_API_KEY: optionalString,

  FEATURE_NEGOTIATION: flag,
  FEATURE_NEGOTIATION_ABOVE_MAX: flag,
  FEATURE_FACE_CHECK: flag,
  FEATURE_SCHEDULED_FLIGHT_TRACKING: flag,
  FEATURE_IMMEDIATE_RIDES: flag,
  FEATURE_INSTALLMENTS: flag,
  FEATURE_RIDE_SERIES: flag,
});

export type AppEnv = z.infer<typeof envSchema>;

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
  if (env.NODE_ENV === 'production') {
    const missing = (['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY'] as const).filter((k) => !env[k]);
    if (missing.length) throw new Error(`Configuration invalide en production : ${missing.join(', ')} obligatoire(s).`);
    if (!env.REDIS_URL) throw new Error('Configuration invalide en production : REDIS_URL est obligatoire.');
    // Le mode simulé accepte des jetons forgés (« mock-apple:<sujet> ») : jamais en production.
    if (env.SOCIAL_LOGIN_PROVIDER !== 'real') throw new Error('Configuration invalide en production : SOCIAL_LOGIN_PROVIDER doit valoir « real ».');
  }
  return {
    ...env,
    JWT_ACCESS_SECRET: env.JWT_ACCESS_SECRET ?? 'dev-access-secret-non-secret',
    JWT_REFRESH_SECRET: env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-non-secret',
    ENCRYPTION_KEY: env.ENCRYPTION_KEY ?? 'dev-encryption-key-non-secret-32b',
  };
}

export const APP_ENV = Symbol('APP_ENV');
