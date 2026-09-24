import type { NestExpressApplication } from '@nestjs/platform-express';
import { pino } from 'pino';
import { createApp } from '../src/bootstrap.js';
import { loadDotenvFromRoot, loadEnv, type AppEnv } from '../src/config/env.js';

/** Configuration de test : le .env de la racine (base Supabase de développement), fournisseurs simulés, sans Redis. */
export function testEnv(overrides: Record<string, string> = {}): AppEnv | null {
  loadDotenvFromRoot();
  const databaseUrl = process.env['TEST_DATABASE_URL'] || process.env['DATABASE_URL'];
  if (!databaseUrl) return null;
  return loadEnv(
    {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      REDIS_URL: '',
      PAYMENT_PROVIDER: 'mock', MAPS_PROVIDER: 'mock', SMS_PROVIDER: 'mock', EMAIL_PROVIDER: 'mock', PUSH_PROVIDER: 'mock',
      WHATSAPP_PROVIDER: 'mock', VOICE_PROVIDER: 'mock', LLM_PROVIDER: 'mock', SEV_PROVIDER: 'mock', STORAGE_PROVIDER: 'mock',
      ...overrides,
    },
    { dotenv: false },
  );
}

export async function startTestApp(overrides: Record<string, string> = {}): Promise<NestExpressApplication | null> {
  const env = testEnv(overrides);
  if (!env) return null;
  const app = await createApp(env, pino({ level: 'silent' }));
  await app.init();
  return app;
}
