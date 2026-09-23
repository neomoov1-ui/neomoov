/**
 * Connexion à PostgreSQL (PostGIS) avec Drizzle ORM. Une seule instance par processus.
 * L'URL vient de DATABASE_URL (ou TEST_DATABASE_URL pour les tests d'intégration).
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export * as schema from './schema/index.js';
export type Database = ReturnType<typeof createDatabase>['db'];

export interface DatabaseOptions {
  url: string;
  /** Taille du pool ; 1 pour les scripts, 10 par défaut pour l'API. */
  max?: number;
  /** `prepare: false` est requis derrière le pooler de session de Supabase en mode transaction. */
  prepare?: boolean;
}

export function createDatabase({ url, max = 10, prepare = true }: DatabaseOptions) {
  // Bases hébergées (Supabase) : TLS exigé ; base locale Docker : sans TLS.
  const ssl = /localhost|127.0.0.1/.test(url) ? undefined : ('require' as const);
  const client = postgres(url, { max, prepare, ssl, onnotice: () => undefined });
  const db = drizzle(client, { schema, casing: 'snake_case' });
  return { db, client, close: () => client.end({ timeout: 5 }) };
}

export function databaseUrlFromEnv(name: 'DATABASE_URL' | 'TEST_DATABASE_URL' = 'DATABASE_URL'): string {
  const url = process.env[name];
  if (!url) throw new Error(`${name} n'est pas définie. Copier .env.example en .env et renseigner l'URL de la base.`);
  return url;
}
export { buildPricingRules, type PricingSources } from './pricing-rules.js';

