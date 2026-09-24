/** Point d'entrée de bibliothèque : le worker et les tests réutilisent la configuration, le journal et les modules d'infrastructure. */
export { createApp } from './bootstrap.js';
export { AppModule } from './app.module.js';
export { CoreModule } from './core.module.js';
export { APP_ENV, envSchema, loadDotenvFromRoot, loadEnv, type AppEnv } from './config/env.js';
export { APP_LOGGER, createLogger, currentCorrelationId, PinoNestLogger } from './common/logger.js';
export { AppError } from './common/app-error.js';
export { DB, DbModule, type Database } from './infra/db.module.js';
export { REDIS, RedisModule } from './infra/redis.module.js';
export { QUEUE_NAMES, QueueModule, QueueService, type QueueName, type QueueStats } from './infra/queue.module.js';
export { AdaptersModule } from './adapters/adapters.module.js';
export * from './adapters/types.js';
export * from './adapters/mock/index.js';
