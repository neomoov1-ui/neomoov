/**
 * Comptes des tests de charge (étape 15, tâche 3), appelé par `pnpm test:load` avant k6, puis avec `--reset` après :
 *
 *   node dist/scripts/load-fixtures.js --drivers=2000 --clients=500 --area=city --out=<fichier>
 *   node dist/scripts/load-fixtures.js --reset
 *
 * Écrit les comptes dans la base de l'environnement visé (même base que l'API testée) et un fichier JSON de jetons
 * (droits limités au propriétaire, hors du dépôt, supprimé par `pnpm test:load` après l'essai). Refusé en production.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { AppModule } from '../app.module.js';
import { createLogger, PinoNestLogger } from '../common/logger.js';
import { loadDotenvFromRoot, loadEnv } from '../config/env.js';
import { createLoadFixtures, LOAD_AREAS, removeLoadFixtures, type LoadArea } from './load-fixtures/fixtures.js';

const arg = (name: string): string | undefined => {
  const found = process.argv.slice(2).find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!found) return undefined;
  return found.includes('=') ? found.slice(found.indexOf('=') + 1) : 'true';
};

loadDotenvFromRoot();
if (process.env['NODE_ENV'] === 'production' || process.env['LOAD_ENV'] === 'production') {
  console.error('Refusé : jamais de comptes de charge en production.');
  process.exit(2);
}
const env = loadEnv(
  { ...process.env, NODE_ENV: 'test', REDIS_URL: '', DISPATCH_MODE: 'manual', DISPATCH_TICK_MS: '0', AGENT_TRIGGERS: 'off', PAYMENT_PROVIDER: 'mock', SEV_PROVIDER: 'mock', STORAGE_PROVIDER: 'mock', LOG_LEVEL: 'warn', DATABASE_POOL_MAX: '4' },
  { dotenv: false },
);
const logger = createLogger('load-fixtures', 'warn');
const app = await NestFactory.createApplicationContext(AppModule.forRoot(env, logger), { logger: new PinoNestLogger(logger) });
const log = (message: string) => console.log(`[load:fixtures] ${message}`);
let exitCode = 0;

try {
  if (arg('reset')) {
    const removed = await removeLoadFixtures(app);
    log(Object.keys(removed).length ? `Retiré : ${JSON.stringify(removed)}` : 'Rien à retirer.');
  } else {
    const area = (arg('area') ?? 'isolated') as LoadArea;
    if (!(area in LOAD_AREAS)) throw new Error(`Zone inconnue : ${area} (isolated ou city)`);
    const out = resolve(arg('out') ?? resolve(tmpdir(), 'neomoov-load', 'fixtures.json'));
    const started = Date.now();
    const fixtures = await createLoadFixtures(app, { drivers: Number(arg('drivers') ?? 20), clients: Number(arg('clients') ?? 10), area, acceptsScheduled: arg('accepts-scheduled') === 'true' });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(fixtures)}\n`, { mode: 0o600 });
    log(`${fixtures.drivers.length} chauffeurs et ${fixtures.clients.length} clients prêts (zone ${area}) en ${Math.round((Date.now() - started) / 1000)} s ; jetons valides jusqu'à ${fixtures.tokensExpireAt}, écrits dans ${out}`);
  }
} catch (error) {
  const e = error as { code?: string; message?: string };
  console.error(`[load:fixtures] Échec${e.code ? ` (${e.code})` : ''} : ${e.message ?? String(error)}`);
  exitCode = 1;
} finally {
  await app.close();
}
process.exit(exitCode);
