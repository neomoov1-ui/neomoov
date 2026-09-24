import 'reflect-metadata';
import { createApp } from './bootstrap.js';
import { createLogger } from './common/logger.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const logger = createLogger('api', env.LOG_LEVEL);
if (!env.REDIS_URL) logger.warn('REDIS_URL absente : files et cache en mémoire (développement seulement).');

const app = await createApp(env, logger);
await app.listen(env.PORT);
logger.info({ port: env.PORT, env: env.NODE_ENV, docs: `${env.APP_BASE_URL}/v1/docs` }, 'API Neomoov démarrée');
