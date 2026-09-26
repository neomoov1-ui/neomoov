import 'reflect-metadata';
import { createLogger, flushErrorReporting, initErrorReporting, loadEnv, PinoNestLogger, releaseInfo } from '@neomoov/api';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';

const env = loadEnv();
const logger = createLogger('worker', env.LOG_LEVEL);
if (!env.REDIS_URL) logger.warn('REDIS_URL absente : files en mémoire, aucune persistance (développement seulement).');
// Suivi des erreurs (Sentry) : seulement si SENTRY_DSN est renseignée ; les tâches en échec définitif y sont signalées.
const release = releaseInfo(env);
await initErrorReporting({ dsn: env.SENTRY_DSN, service: 'worker', environment: release.environment, release: release.version, logger });
process.once('SIGTERM', () => void flushErrorReporting());

const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(env, logger), { logger: new PinoNestLogger(logger) });
app.enableShutdownHooks();
logger.info({ env: env.NODE_ENV, version: release.version, mode: env.REDIS_URL ? 'redis' : 'memory' }, 'Worker Neomoov démarré');
