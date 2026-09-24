import 'reflect-metadata';
import { createLogger, loadEnv, PinoNestLogger } from '@neomoov/api';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';

const env = loadEnv();
const logger = createLogger('worker', env.LOG_LEVEL);
if (!env.REDIS_URL) logger.warn('REDIS_URL absente : files en mémoire, aucune persistance (développement seulement).');

const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(env, logger), { logger: new PinoNestLogger(logger) });
app.enableShutdownHooks();
logger.info({ env: env.NODE_ENV, mode: env.REDIS_URL ? 'redis' : 'memory' }, 'Worker Neomoov démarré');
