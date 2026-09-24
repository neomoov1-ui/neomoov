import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { Logger } from 'pino';
import { APP_LOGGER } from './common/logger.js';
import { APP_ENV, type AppEnv } from './config/env.js';

/** Configuration et journal, visibles partout (module global). */
@Global()
@Module({})
export class CoreModule {
  static forRoot(env: AppEnv, logger: Logger): DynamicModule {
    return {
      module: CoreModule,
      providers: [
        { provide: APP_ENV, useValue: env },
        { provide: APP_LOGGER, useValue: logger },
      ],
      exports: [APP_ENV, APP_LOGGER],
    };
  }
}
