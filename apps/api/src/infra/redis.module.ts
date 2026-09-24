import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { APP_ENV, type AppEnv } from '../config/env.js';

export const REDIS = Symbol('REDIS');

/**
 * Connexion Redis partagée (présence, index GEO, verrous, files). Sans REDIS_URL (poste de développement sans Redis),
 * la valeur injectée est `null` et les services concernés basculent sur une implémentation en mémoire.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [APP_ENV],
      useFactory: (env: AppEnv): Redis | null =>
        env.REDIS_URL
          ? new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: true, connectTimeout: 5_000 })
          : null,
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis | null) {}

  /**
   * Arrêt propre en un temps borné. `quit()` n'est envoyé qu'à une connexion prête : hors ligne, ioredis le mettrait en
   * file sans limite (maxRetriesPerRequest: null) et l'arrêt ne finirait jamais. Au-delà de deux secondes, coupure franche
   * (`disconnect()` est sans effet sur une connexion déjà fermée).
   */
  async onModuleDestroy() {
    const redis = this.redis;
    if (!redis) return;
    if (redis.status === 'ready') {
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2_000).unref());
      await Promise.race([redis.quit().then(() => undefined, () => undefined), timeout]);
    }
    redis.disconnect();
  }
}
