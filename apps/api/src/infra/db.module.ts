import { createDatabase } from '@neomoov/db';
import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { currentOrgScope } from '../common/org-scope.context.js';
import { APP_ENV, type AppEnv } from '../config/env.js';

export const DB = Symbol('DB');
export type Database = ReturnType<typeof createDatabase>;

/**
 * Accès à la base (étape 20). Hors contexte d'organisation : le pool de l'API, propriétaire des tables et non soumis à la
 * sécurité au niveau des lignes. Dans une transaction restreinte ouverte par `OrgScopeService.run` : l'exécuteur de cette
 * transaction, propagé par AsyncLocalStorage. Tout service qui lit `database.db` pendant la requête ou la tâche passe alors
 * par le rôle `neomoov_scoped` et les politiques d'isolation, sans changement de son code. Hors contexte, le coût se
 * limite à une lecture du stockage asynchrone.
 */
export function scopedDatabase(real: Database): Database {
  return {
    get db() {
      return (currentOrgScope()?.tx as Database['db'] | undefined) ?? real.db;
    },
    client: real.client,
    close: real.close,
  };
}

@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [APP_ENV],
      useFactory: (env: AppEnv) => scopedDatabase(createDatabase({ url: env.DATABASE_URL, max: env.DATABASE_POOL_MAX ?? (env.NODE_ENV === 'test' ? 2 : 10) })),
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
