import { AdaptersModule, APP_LOGGER, CoreModule, DbModule, QueueModule, QueueService, RedisModule, type AppEnv } from '@neomoov/api';
import { type DynamicModule, Inject, Injectable, Module, type OnModuleInit } from '@nestjs/common';
import type { Logger } from 'pino';

/** File de démonstration : un battement chaque minute, qui prouve que les files et la planification fonctionnent. */
@Injectable()
export class HeartbeatService implements OnModuleInit {
  ticks = 0;

  constructor(
    private readonly queues: QueueService,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  onModuleInit() {
    this.queues.process(
      'heartbeat',
      async (job) => {
        this.ticks += 1;
        this.logger.info({ job: job.name, ticks: this.ticks, mode: this.queues.mode }, 'battement du worker');
      },
      { everyMs: 60_000, jobName: 'tick', concurrency: 1 },
    );
  }
}

@Module({})
export class WorkerModule {
  static forRoot(env: AppEnv, logger: Logger): DynamicModule {
    return {
      module: WorkerModule,
      imports: [CoreModule.forRoot(env, logger), DbModule, RedisModule, QueueModule, AdaptersModule],
      providers: [HeartbeatService],
    };
  }
}
