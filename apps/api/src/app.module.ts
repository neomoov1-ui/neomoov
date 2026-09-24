import { type DynamicModule, Module } from '@nestjs/common';
import type { Logger } from 'pino';
import { AdaptersModule } from './adapters/adapters.module.js';
import type { AppEnv } from './config/env.js';
import { CoreModule } from './core.module.js';
import { DbModule } from './infra/db.module.js';
import { QueueModule } from './infra/queue.module.js';
import { RedisModule } from './infra/redis.module.js';
import { HealthModule } from './modules/health/health.module.js';

/** Module racine de l'API. Les modules métier s'ajoutent ici étape par étape (section 11.1). */
@Module({})
export class AppModule {
  static forRoot(env: AppEnv, logger: Logger): DynamicModule {
    return {
      module: AppModule,
      imports: [CoreModule.forRoot(env, logger), DbModule, RedisModule, QueueModule, AdaptersModule, HealthModule],
    };
  }
}
