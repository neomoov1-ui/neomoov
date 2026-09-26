import 'reflect-metadata';
import { createApp } from './bootstrap.js';
import { flushErrorReporting, initErrorReporting, releaseInfo } from './common/error-reporting.js';
import { createLogger } from './common/logger.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const logger = createLogger('api', env.LOG_LEVEL);
if (!env.REDIS_URL) logger.warn('REDIS_URL absente : files et cache en mémoire (développement seulement).');
// Suivi des erreurs (Sentry) : seulement si SENTRY_DSN est renseignée, avant tout le reste pour voir les erreurs du démarrage.
const release = releaseInfo(env);
await initErrorReporting({ dsn: env.SENTRY_DSN, service: 'api', environment: release.environment, release: release.version, logger });
process.once('SIGTERM', () => void flushErrorReporting());

const app = await createApp(env, logger);
await app.listen(env.PORT);
logger.info({ port: env.PORT, env: env.NODE_ENV, version: release.version, docs: `${env.APP_BASE_URL}/v1/docs` }, 'API Neomoov démarrée');
