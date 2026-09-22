/**
 * pnpm db:reset : vide entièrement la base de développement (schémas public et drizzle), puis réactive PostGIS.
 * Refusé si l'URL ne contient pas « dev », « test » ou « localhost », pour ne jamais toucher une base de production.
 */

import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { createDatabase, databaseUrlFromEnv } from './index.js';

const url = databaseUrlFromEnv();
if (!/dev|test|localhost|127\.0\.0\.1/i.test(url)) {
  console.error('db:reset refusé : l\'URL ne ressemble pas à une base de développement ou de test.');
  process.exit(1);
}
const { db, close } = createDatabase({ url, max: 1 });
try {
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS postgis`);
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  console.log('Base vidée, PostGIS et pgcrypto réactivés.');
} finally {
  await close();
}
