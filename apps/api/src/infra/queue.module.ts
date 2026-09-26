import { Global, Inject, Injectable, Module, Optional, type OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker, type JobsOptions, type Processor } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { reportError } from '../common/error-reporting.js';
import { APP_LOGGER, currentCorrelationId, isValidCorrelationId, newCorrelationId, runWithCorrelation } from '../common/logger.js';
import { REDIS } from './redis.module.js';

export const QUEUE_NAMES = ['heartbeat', 'notifications', 'invoicing', 'settlements', 'exports', 'agents', 'privacy', 'scheduling', 'payments', 'packs', 'compliance', 'retention'] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

export interface QueueStats {
  name: QueueName;
  waiting: number;
  active: number;
  failed: number;
  /** Mode mémoire seulement : tâches ajoutées sans traitement enregistré dans ce processus (perdues). */
  dropped?: number;
}

/**
 * Identifiant de tâche accepté par BullMQ : un « : » n'y est permis que pour trois segments exactement (compatibilité des
 * anciennes tâches répétées), sinon l'ajout échoue (« Custom Id cannot contain : »). Les appelants gardent des
 * identifiants lisibles (`completed:<course>`), normalisés ici.
 */
export function bullJobId(id: string): string {
  return id.replace(/:/g, '-');
}

/**
 * Clé réservée dans les données d'une tâche (étape 15, observabilité) : identifiant de corrélation de la requête ou de
 * la tâche qui l'a créée. Le traitement le remet dans le contexte de journal : les lignes de l'API (requête) et du
 * worker (tâche) se retrouvent par le même identifiant.
 */
export const JOB_CORRELATION_KEY = '_correlationId';

/** Données de tâche complétées par l'identifiant de corrélation courant (objets seulement ; un identifiant déjà posé est gardé). */
export function withJobCorrelation(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  if (isValidCorrelationId((data as Record<string, unknown>)[JOB_CORRELATION_KEY])) return data;
  return { ...data, [JOB_CORRELATION_KEY]: currentCorrelationId() ?? newCorrelationId() };
}

/** Identifiant de corrélation porté par les données d'une tâche, s'il y en a un. */
export function jobCorrelationId(data: unknown): string | undefined {
  const value = data && typeof data === 'object' ? (data as Record<string, unknown>)[JOB_CORRELATION_KEY] : undefined;
  return isValidCorrelationId(value) ? value : undefined;
}

interface MemoryJob {
  name: string;
  data: unknown;
}

/**
 * Traitement exécuté dans le contexte de corrélation de sa tâche (un nouvel identifiant pour une tâche planifiée) ;
 * l'échec de la dernière tentative est signalé au suivi des erreurs avec la file et le nom de la tâche.
 */
export function correlatedProcessor(queue: QueueName, processor: Processor): Processor {
  return (job, token, signal) =>
    runWithCorrelation(jobCorrelationId(job.data), async () => {
      try {
        return await processor(job, token, signal);
      } catch (error) {
        const attempts = job.opts?.attempts ?? 1;
        if ((job.attemptsMade ?? 0) + 1 >= attempts) reportError(error, { tags: { queue, job: job.name } });
        throw error;
      }
    });
}

/**
 * Files de tâches. Avec Redis : BullMQ (persistant, nouvelles tentatives, file des échecs). Sans Redis (développement) :
 * exécution en mémoire, immédiate et sans persistance, dans le processus qui a enregistré le traitement (le worker) ;
 * une tâche ajoutée par un processus sans traitement (l'API) est perdue, comptée et journalisée.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly queues = new Map<QueueName, Queue>();
  private readonly workers: Worker[] = [];
  private readonly memoryHandlers = new Map<QueueName, Processor>();
  private readonly memoryStats = new Map<QueueName, { failed: number; done: number; dropped: number }>();
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(
    @Inject(REDIS) private readonly redis: Redis | null,
    @Optional() @Inject(APP_LOGGER) private readonly logger?: Logger,
  ) {}

  get mode(): 'redis' | 'memory' {
    return this.redis ? 'redis' : 'memory';
  }

  queue(name: QueueName): Queue | null {
    if (!this.redis) return null;
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.redis, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2_000 }, removeOnComplete: 1_000, removeOnFail: 5_000 } });
      this.queues.set(name, q);
    }
    return q;
  }

  async add(name: QueueName, jobName: string, rawData: unknown, options?: JobsOptions): Promise<void> {
    // L'identifiant de corrélation de la requête (ou de la tâche) en cours voyage avec la tâche.
    const data = withJobCorrelation(rawData);
    const q = this.queue(name);
    if (q) {
      await q.add(jobName, data, options?.jobId ? { ...options, jobId: bullJobId(options.jobId) } : options);
      return;
    }
    const handler = this.memoryHandlers.get(name);
    const stats = this.memoryStat(name);
    if (!handler) {
      stats.dropped += 1;
      this.logger?.warn({ queue: name, job: jobName, dropped: stats.dropped }, 'Tâche perdue : mode mémoire sans traitement dans ce processus (REDIS_URL absente)');
      return;
    }
    const job: MemoryJob = { name: jobName, data };
    try {
      await handler(job as never, 'memory');
      stats.done += 1;
    } catch (error) {
      stats.failed += 1;
      this.logger?.error({ err: error, queue: name, job: jobName }, 'Tâche en échec (mode mémoire)');
    }
  }

  /** Enregistre un traitement (côté worker). En mémoire, `everyMs` planifie une exécution périodique. */
  process(name: QueueName, processor: Processor, options?: { concurrency?: number; everyMs?: number; jobName?: string }): void {
    const correlated = correlatedProcessor(name, processor);
    if (this.redis) {
      this.workers.push(new Worker(name, correlated, { connection: this.redis, concurrency: options?.concurrency ?? 5 }));
      if (options?.everyMs) {
        const schedulerId = `${name}-${options.jobName ?? 'tick'}`;
        this.queue(name)
          ?.upsertJobScheduler(schedulerId, { every: options.everyMs }, { name: options.jobName ?? 'tick' })
          .catch((error: unknown) => this.logger?.error({ err: error, queue: name, schedulerId }, 'Planification impossible pour le moment (Redis) ; BullMQ réessaiera à la reconnexion'));
      }
      return;
    }
    this.memoryHandlers.set(name, correlated);
    if (options?.everyMs) {
      // Pas de unref : dans le worker, ce minuteur est le seul handle qui maintient le processus en vie.
      this.timers.push(setInterval(() => void this.add(name, options.jobName ?? 'tick', { at: new Date().toISOString() }), options.everyMs));
    }
  }

  async stats(): Promise<QueueStats[]> {
    if (this.redis) {
      return Promise.all(
        QUEUE_NAMES.map(async (name) => {
          const counts = await this.queue(name)!.getJobCounts('waiting', 'active', 'failed');
          return { name, waiting: counts['waiting'] ?? 0, active: counts['active'] ?? 0, failed: counts['failed'] ?? 0 };
        }),
      );
    }
    return QUEUE_NAMES.map((name) => {
      const s = this.memoryStat(name);
      return { name, waiting: 0, active: 0, failed: s.failed, dropped: s.dropped };
    });
  }

  /**
   * Tâches en échec d'une file (étape 15, My Hub) : identifiant, nom, motif, tentatives, date. En mode mémoire, rien
   * n'est gardé (les échecs sont seulement comptés et journalisés).
   */
  async failedJobs(name: QueueName, limit = 50): Promise<Array<{ id: string; name: string; failedReason: string | null; attempts: number; failedAt: string | null }>> {
    const q = this.queue(name);
    if (!q) return [];
    const jobs = await q.getFailed(0, Math.max(0, limit - 1));
    return jobs.map((j) => ({ id: String(j.id ?? ''), name: j.name, failedReason: j.failedReason ?? null, attempts: j.attemptsMade, failedAt: j.finishedOn ? new Date(j.finishedOn).toISOString() : null }));
  }

  /** Relance les tâches en échec d'une file (une seule si `jobId`) ; renvoie le nombre de tâches relancées. */
  async retryFailed(name: QueueName, jobId?: string): Promise<number> {
    const q = this.queue(name);
    if (!q) return 0;
    if (jobId) {
      const job = await q.getJob(jobId);
      if (!job || !(await job.isFailed())) return 0;
      await job.retry('failed');
      return 1;
    }
    const failed = await q.getFailedCount();
    if (failed) await q.retryJobs({ state: 'failed', count: 1000 });
    return failed;
  }

  private memoryStat(name: QueueName) {
    let stats = this.memoryStats.get(name);
    if (!stats) {
      stats = { failed: 0, done: 0, dropped: 0 };
      this.memoryStats.set(name, stats);
    }
    return stats;
  }

  async onModuleDestroy() {
    for (const t of this.timers) clearInterval(t);
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}

@Global()
@Module({ providers: [QueueService], exports: [QueueService] })
export class QueueModule {}
