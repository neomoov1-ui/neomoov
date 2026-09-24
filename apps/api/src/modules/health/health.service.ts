import { sql } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { DB, type Database } from '../../infra/db.module.js';
import { QueueService, type QueueStats } from '../../infra/queue.module.js';
import { REDIS } from '../../infra/redis.module.js';

export type CheckStatus = 'ok' | 'error' | 'not_configured';
export interface Check {
  status: CheckStatus;
  latencyMs?: number;
  detail?: string;
}
export interface HealthReport {
  status: 'ok' | 'degraded';
  version: string;
  uptimeSeconds: number;
  checks: { database: Check; redis: Check; queues: Check & { mode: 'redis' | 'memory'; stats: QueueStats[] } };
}

/** Délai maximal de chaque vérification : une dépendance qui ne répond pas est « en panne », la sonde répond toujours. */
export const CHECK_TIMEOUT_MS = 2_000;

/** Résout `promise`, ou rejette après `ms` : ioredis met les commandes en file sans limite quand Redis est hors ligne. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} : aucune réponse en ${ms} ms`)), ms);
    timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(REDIS) private readonly redis: Redis | null,
    private readonly queues: QueueService,
  ) {}

  async report(): Promise<HealthReport> {
    const [database, redis, queueStats] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      withTimeout(this.queues.stats(), CHECK_TIMEOUT_MS, 'files').catch(() => [] as QueueStats[]),
    ]);
    const queues: HealthReport['checks']['queues'] = { status: this.redis ? redis.status : 'not_configured', mode: this.queues.mode, stats: queueStats };
    const status = database.status === 'ok' && redis.status !== 'error' ? 'ok' : 'degraded';
    return { status, version: process.env['npm_package_version'] ?? '0.0.0', uptimeSeconds: Math.round(process.uptime()), checks: { database, redis, queues } };
  }

  private async checkDatabase(): Promise<Check> {
    return this.timed('base de données', async () => {
      await this.database.db.execute(sql`select 1`);
    });
  }

  private async checkRedis(): Promise<Check> {
    if (!this.redis) return { status: 'not_configured', detail: 'REDIS_URL absente : files et cache en mémoire' };
    const redis = this.redis;
    return this.timed('Redis', async () => {
      if (redis.status === 'wait') await redis.connect();
      await redis.ping();
    });
  }

  private async timed(label: string, check: () => Promise<void>): Promise<Check> {
    const started = performance.now();
    try {
      await withTimeout(check(), CHECK_TIMEOUT_MS, label);
      return { status: 'ok', latencyMs: Math.round(performance.now() - started) };
    } catch (error) {
      return { status: 'error', latencyMs: Math.round(performance.now() - started), detail: error instanceof Error ? error.message.slice(0, 120) : 'inconnu' };
    }
  }
}
