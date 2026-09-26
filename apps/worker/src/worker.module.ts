import {
  AdaptersModule, APP_LOGGER, AuditModule, AuthModule, CoreModule, DbModule, DispatchService, DomainEventsModule, PackLifecycleService, PaymentJobsService, PaymentsModule, SettlementJobsService, SettlementModule, NotificationJobsService, NotificationsModule, PricingModule, PrivacyJobsService, PrivacyModule, QueueModule,
  QueueService, RedisModule, RidesModule, ScheduledService, SettingsModule, UsersModule, type AppEnv,
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

/**
 * Répartition automatique (étape 6) : avec Redis, le worker porte la répartition (événements de course reçus par
 * Redis, battement `DISPATCH_TICK_MS`) ; sans Redis, c'est le processus de l'API, seul à recevoir ses événements,
 * qui la porte : le worker s'en retire pour ne pas solliciter deux fois les chauffeurs.
 */
@Injectable()
export class DispatchWorker implements OnModuleInit {
  constructor(
    private readonly dispatch: DispatchService,
    private readonly queues: QueueService,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  onModuleInit() {
    if (this.queues.mode === 'redis') this.dispatch.enableRunner();
    else {
      this.dispatch.disableRunner();
      this.logger.warn('Sans Redis, la répartition automatique est portée par le processus de l\'API, pas par le worker');
    }
  }
}

/**
 * Paiements (étape 7) : avec Redis, le worker traite la file `payments` (autorisation à l'attribution, capture, frais,
 * webhooks) et reprend toutes les 5 minutes les webhooks en attente ou en échec. Sans Redis, c'est l'API.
 */
@Injectable()
export class PaymentsWorker implements OnModuleInit {
  constructor(
    private readonly jobs: PaymentJobsService,
    private readonly queues: QueueService,
  ) {}

  onModuleInit() {
    if (this.queues.mode === 'redis') this.jobs.register({ sweepEveryMs: 300_000 });
  }
}

/** Packs (étape 8) : avec Redis, le worker porte la passe horaire (expiration, renouvellement, report). Sans Redis, c'est l'API. */
@Injectable()
export class PacksWorker implements OnModuleInit {
  constructor(
    private readonly packs: PackLifecycleService,
    private readonly queues: QueueService,
  ) {}

  onModuleInit() {
    if (this.queues.mode === 'redis') this.packs.register({ everyMs: 3_600_000 });
  }
}

/** Règlement hebdomadaire (étape 9) : avec Redis, le worker porte la file `settlements` (passe du quart d'heure, PDF). Sans Redis, c'est l'API. */
@Injectable()
export class SettlementWorker implements OnModuleInit {
  constructor(
    private readonly jobs: SettlementJobsService,
    private readonly queues: QueueService,
  ) {}

  onModuleInit() {
    if (this.queues.mode === 'redis') this.jobs.register({ everyMs: 900_000 });
  }
}

/** Notifications (étape 13) : avec Redis, le worker envoie (file `notifications`, reprise toutes les 30 secondes). Sans Redis, c'est l'API. */
@Injectable()
export class NotificationsWorker implements OnModuleInit {
  constructor(
    private readonly jobs: NotificationJobsService,
    private readonly queues: QueueService,
  ) {}

  onModuleInit() {
    if (this.queues.mode === 'redis') this.jobs.register({ everyMs: 30_000 });
  }
}

@Module({})
export class WorkerModule {
  static forRoot(env: AppEnv, logger: Logger): DynamicModule {
    return {
      module: WorkerModule,
      imports: [CoreModule.forRoot(env, logger), DbModule, RedisModule, QueueModule, AdaptersModule, SettingsModule, DomainEventsModule, UsersModule, AuthModule, AuditModule, PrivacyModule, PricingModule, RidesModule, PaymentsModule, SettlementModule, NotificationsModule],
      providers: [HeartbeatService, PrivacyWorker, SchedulingWorker, DispatchWorker, PaymentsWorker, PacksWorker, SettlementWorker, NotificationsWorker],
    };
  }
}
