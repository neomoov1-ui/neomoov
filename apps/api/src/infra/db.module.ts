import { createDatabase } from '@neomoov/db';
import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../config/env.js';

export const DB = Symbol('DB');
export type Database = ReturnType<typeof createDatabase>;

@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [APP_ENV],
      useFactory: (env: AppEnv) => createDatabase({ url: env.DATABASE_URL, max: env.DATABASE_POOL_MAX ?? (env.NODE_ENV === 'test' ? 2 : 10) }),
    },
  ],
  exports: [DB],
})
export class DbModule implements OnModuleDestroy {
  constructor(@Inject(DB) private readonly database: Database) {}
  async onModuleDestroy() {
    await this.database.close();
  }
}
