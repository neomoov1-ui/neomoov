/**
 * Jeu de données de bout en bout (étape 15, tâche 2), pour les tests et les démonstrations locales :
 *
 *   pnpm seed:e2e                  crée (ou complète) le jeu : 50 chauffeurs en ligne, 200 clients, 300 courses passées
 *                                  avec paiements simulés, registres, factures transmises au SEV simulé, relevés réglés
 *   pnpm seed:e2e --online[=30]    garde les chauffeurs du jeu en ligne (déplacements simulés) pendant N minutes, ou
 *                                  jusqu'à Ctrl+C, puis les remet hors ligne
 *   pnpm seed:e2e --offline        retire la présence en ligne des chauffeurs du jeu (le reste est gardé)
 *   pnpm seed:e2e --status         état du jeu en base, sans rien écrire
 *   pnpm seed:e2e --reset          retire exactement les données du jeu (comptes marqués et tout ce qui s'y rattache)
 *
 * Fournisseurs toujours simulés, aucune passe périodique (mode test de l'API) : le script n'agit que sur ses données.
 * Refusé en production.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { createLogger, PinoNestLogger } from '../common/logger.js';
import { loadDotenvFromRoot, loadEnv } from '../config/env.js';
import { SeedE2e } from './seed-e2e/runner.js';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const mode = flag('reset') ? 'reset' : flag('offline') ? 'offline' : flag('status') ? 'status' : flag('online') ? 'online' : 'seed';

loadDotenvFromRoot();
if (process.env['NODE_ENV'] === 'production') {
  console.error('Refusé : le jeu de bout en bout ne s\'exécute jamais en production.');
  process.exit(2);
}
const env = loadEnv(
  {
    ...process.env,
    // Mode test de l'API : aucune passe périodique (files, relevés, notifications) sur les données des autres ; fournisseurs simulés.
    NODE_ENV: 'test', REDIS_URL: '', DISPATCH_MODE: 'manual', DISPATCH_TICK_MS: '0', AGENT_TRIGGERS: 'off',
    PAYMENT_PROVIDER: 'mock', MAPS_PROVIDER: 'mock', SMS_PROVIDER: 'mock', EMAIL_PROVIDER: 'mock', PUSH_PROVIDER: 'mock', WHATSAPP_PROVIDER: 'mock', VOICE_PROVIDER: 'mock',
    LLM_PROVIDER: 'mock', SEV_PROVIDER: 'mock', STORAGE_PROVIDER: 'mock', SOCIAL_LOGIN_PROVIDER: 'mock', VIRUS_SCANNER_PROVIDER: 'mock',
    DATABASE_POOL_MAX: process.env['SEED_E2E_POOL'] ?? '8', LOG_LEVEL: 'warn',
  },
  { dotenv: false },
);
const logger = createLogger('seed-e2e', 'warn');
const app = await NestFactory.createApplicationContext(AppModule.forRoot(env, logger), { logger: new PinoNestLogger(logger) });
const log = (message: string) => console.log(`[seed:e2e] ${message}`);
const seed = new SeedE2e(app, { log, concurrency: Number(process.env['SEED_E2E_CONCURRENCY'] ?? 6) });

let exitCode = 0;
try {
  if (mode === 'reset') {
    const removed = await seed.reset();
    log(Object.keys(removed).length ? `Retiré : ${JSON.stringify(removed)}` : 'Rien à retirer.');
  } else if (mode === 'offline') {
    log(`${await seed.setOnline(false)} chauffeur(s) du jeu remis hors ligne.`);
  } else if (mode === 'status') {
    log(`État : ${JSON.stringify(await seed.totals())}`);
  } else if (mode === 'online') {
    const minutes = Number(flag('online')!.split('=')[1] ?? '0');
    const count = await seed.setOnline(true);
    if (!count) throw new Error('Aucun chauffeur du jeu : lancez d\'abord « pnpm seed:e2e »');
    log(`${count} chauffeurs en ligne${minutes > 0 ? ` pendant ${minutes} minute(s)` : ' jusqu\'à Ctrl+C'} (présence rafraîchie toutes les 20 s).`);
    let stop = false;
    const onSignal = () => {
      stop = true;
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    const deadline = minutes > 0 ? Date.now() + minutes * 60_000 : Number.POSITIVE_INFINITY;
    for (let step = 1; !stop && Date.now() < deadline; step += 1) {
      for (let waited = 0; waited < 20_000 && !stop; waited += 500) await new Promise((resolve) => setTimeout(resolve, 500));
      if (!stop) await seed.heartbeat(step);
    }
    log(`${await seed.setOnline(false)} chauffeur(s) remis hors ligne.`);
  } else {
    const report = await seed.run();
    log(`Créé : ${JSON.stringify(report.created)}`);
    log(`État : ${JSON.stringify(report.totals)}`);
    log(`Durée : ${report.seconds} s. Les chauffeurs restent en ligne jusqu'à l'expiration de leur présence (60 s sans position si une API tourne) ; « --online » les y garde, « --offline » les retire.`);
  }
} catch (error) {
  const e = error as { code?: string; message?: string };
  console.error(`[seed:e2e] Échec${e.code ? ` (${e.code})` : ''} : ${e.message ?? String(error)}`);
  exitCode = 1;
} finally {
  await app.close();
}
process.exit(exitCode);
