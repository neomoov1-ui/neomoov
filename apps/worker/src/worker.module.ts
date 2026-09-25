import {
  AdaptersModule, APP_LOGGER, AuditModule, AuthModule, CoreModule, DbModule, DomainEventsModule, PricingModule, PrivacyJobsService, PrivacyModule, QueueModule, QueueService,
  RedisModule, RidesModule, ScheduledService, SettingsModule, UsersModule, type AppEnv,
} from '@neomoov/api';
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

/** Tâches de confidentialité (export, suppression de compte) : avec Redis, c'est le worker qui les traite. En mode mémoire, PrivacyJobsService s'enregistre lui-même. */
@Injectable()
export class PrivacyWorker implements OnModuleInit {
  constructor(
    private readonly jobs: PrivacyJobsService,
    private readonly queues: QueueService,
  ) {}

  onModuleInit() {
    if (this.queues.mode === 'redis') this.jobs.register();
  }
}

/** Courses planifiées : une passe par minute (rappel J-1, attribution à 60 minutes, alerte opérateur à 30 minutes). */
@Injectable()
export class SchedulingWorker implements OnModuleInit {
  constructor(
    private readonly scheduled: ScheduledService,
    private readonly queues: QueueService,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  onModuleInit() {
    this.queues.process(
      'scheduling',
      async () => {
        const report = await this.scheduled.tick(new Date());
        if (report.reminders.length || report.dispatchDue.length || report.operatorAlerts.length) this.logger.info(report, 'courses planifiées');
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
      imports: [CoreModule.forRoot(env, logger), DbModule, RedisModule, QueueModule, AdaptersModule, SettingsModule, DomainEventsModule, UsersModule, AuthModule, AuditModule, PrivacyModule, PricingModule, RidesModule],
      providers: [HeartbeatService, PrivacyWorker, SchedulingWorker],
    };
  }
}
