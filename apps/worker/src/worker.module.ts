import {
  AdaptersModule, AgentJobsService, AgentsModule, APP_LOGGER, AuditModule, AuthModule, CoreModule, DbModule, DispatchService, DomainEventsModule, LedgerJobsService, LedgersModule, PackLifecycleService, PaymentJobsService, PaymentsModule, SettlementJobsService, SettlementModule, NotificationJobsService, NotificationsModule, ComplianceJobsService, ComplianceModule, RetentionJobsService, RetentionModule, PricingModule, PrivacyJobsService, PrivacyModule, QueueModule,
  QueueService, RedisModule, RidesModule, ScheduledService, SettingsModule, StuckRidesService, UsersModule, type AppEnv,
} from '@neomoov/api';
import { InvoiceJobsService, InvoicingModule } from '@neomoov/api';
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

/**
 * Courses planifiées : une passe par minute (rappel J-1, attribution à 60 minutes, alerte opérateur à 30 minutes) ;
 * toutes les 5 minutes, surveillance des courses figées (étape 15).
 */
@Injectable()
export class SchedulingWorker implements OnModuleInit {
  private passes = 0;

  constructor(
    private readonly scheduled: ScheduledService,
    private readonly stuck: StuckRidesService,
    private readonly queues: QueueService,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  onModuleInit() {
    this.queues.process(
      'scheduling',
      async () => {
        const now = new Date();
        const report = await this.scheduled.tick(now);
        this.passes += 1;
        if (this.passes % 5 === 0) await this.stuck.alert(now);
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

/**
 * Registres et exports (étape 9) : avec Redis, le worker traite la file `exports` (lignes des registres à la fin des
 * courses, rapports de synthèse PDF, exports de géolocalisation) et porte la passe horaire (reprise des registres,
 * export de géolocalisation du mois précédent dès le 1er). Sans Redis, c'est l'API.
 */
@Injectable()
export class LedgersWorker implements OnModuleInit {
  constructor(
    private readonly jobs: LedgerJobsService,
    private readonly queues: QueueService,
  ) {}

  onModuleInit() {
    if (this.queues.mode === 'redis') this.jobs.register({ everyMs: 3_600_000 });
  }
}

/**
 * Facturation (étape 9) : avec Redis, le worker traite la file `invoicing` (factures, notes de crédit, transmission au
 * SEV, PDF) et fait la passe de reprise toutes les 5 minutes. Sans Redis, c'est l'API.
 */
@Injectable()
export class InvoicingWorker implements OnModuleInit {
  constructor(
    private readonly jobs: InvoiceJobsService,
    private readonly queues: QueueService,
  ) {}

  onModuleInit() {
    if (this.queues.mode === 'redis') this.jobs.register({ sweepEveryMs: 300_000 });
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

/** Conformité (étape 14) : avec Redis, le worker porte la passe quotidienne (rappels, suspensions à minuit). Sans Redis, c'est l'API. */
@Injectable()
export class ComplianceWorker implements OnModuleInit {
  constructor(
    private readonly jobs: ComplianceJobsService,
    private readonly queues: QueueService,
  ) {}

  onModuleInit() {
    if (this.queues.mode === 'redis') this.jobs.register({ everyMs: 900_000 });
  }
}

/** Conservation (étape 14) : avec Redis, le worker porte la passe nocturne (3 h). Sans Redis, c'est l'API. */
@Injectable()
export class RetentionWorker implements OnModuleInit {
  constructor(
    private readonly jobs: RetentionJobsService,
    private readonly queues: QueueService,
  ) {}

  onModuleInit() {
    if (this.queues.mode === 'redis') this.jobs.register({ everyMs: 900_000 });
  }
}

/**
 * Agents IA (étape 13) : avec Redis, le worker traite la file `agents` (messages entrants, documents, relevés) et la
 * passe des rapports toutes les 5 minutes (quotidien à 07 h, hebdomadaire le lundi). Sans Redis, c'est l'API.
 */
@Injectable()
export class AgentsWorker implements OnModuleInit {
  constructor(
    private readonly jobs: AgentJobsService,
    private readonly queues: QueueService,
  ) {}

  onModuleInit() {
    if (this.queues.mode === 'redis' && this.jobs.triggersEnabled) this.jobs.register({ tickEveryMs: 300_000 });
  }
}

@Module({})
export class WorkerModule {
  static forRoot(env: AppEnv, logger: Logger): DynamicModule {
    return {
      module: WorkerModule,
      imports: [CoreModule.forRoot(env, logger), DbModule, RedisModule, QueueModule, AdaptersModule, SettingsModule, DomainEventsModule, UsersModule, AuthModule, AuditModule, PrivacyModule, PricingModule, RidesModule, PaymentsModule, SettlementModule, LedgersModule, InvoicingModule, NotificationsModule, ComplianceModule, RetentionModule, AgentsModule],
      providers: [HeartbeatService, PrivacyWorker, SchedulingWorker, DispatchWorker, PaymentsWorker, PacksWorker, SettlementWorker, LedgersWorker, InvoicingWorker, NotificationsWorker, ComplianceWorker, RetentionWorker, AgentsWorker],
    };
  }
}
