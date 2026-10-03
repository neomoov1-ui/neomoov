/**
 * File `inbox` (boîte unifiée) : lecture périodique de la boîte contact@ par IMAP (repli du relais entrant, quand
 * `MAILBOX_PROVIDER=real`), rattrapage des réseaux Meta par interrogation (quand `SOCIAL_PROVIDER=real`), et rappels des
 * appels manqués échus (le personnel est rappelé si la conversation est toujours ouverte). Les rappels sont inscrits
 * dans `followups` (cible `missed_call`) et relus à chaque passe : un redémarrage sans Redis ne les perd plus
 * (finalisation du 3 octobre 2026) ; les anciennes tâches différées `callback` restent comprises. Avec Redis, le worker
 * porte la file ; sans Redis, l'API. En test, rien n'est automatique : les tests appellent les passes.
 */
import { schema } from '@neomoov/db';
import { maskPhone } from '@neomoov/domain';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, asc, eq, lte } from 'drizzle-orm';
import type { Logger } from 'pino';
import { MAILBOX_PROVIDER, type MailboxProvider } from '../../adapters/types.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { DB, type Database } from '../../infra/db.module.js';
import { QueueService } from '../../infra/queue.module.js';
import { ConversationsService } from '../agents/conversations.service.js';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';
import { InboundEmailService, type InboundEmailStatus } from './inbound-email.service.js';
import { MISSED_CALL_FOLLOWUP } from './missed-calls.service.js';
import { SocialInboxService } from './social-inbox.service.js';

type InboxJob = { kind?: undefined; at?: string } | { conversationId: string; minutes?: number };

export interface MailboxPollReport {
  fetched: number;
  byStatus: Record<InboundEmailStatus, number>;
}

@Injectable()
export class InboxJobsService implements OnModuleInit {
  private registered = false;
  private lastSocialPoll = new Date();

  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(MAILBOX_PROVIDER) private readonly mailbox: MailboxProvider,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly queues: QueueService,
    private readonly settings: SettingsService,
    private readonly inboundEmail: InboundEmailService,
    private readonly socialInbox: SocialInboxService,
    private readonly conversations: ConversationsService,
    private readonly outbox: NotificationsOutbox,
  ) {}

  onModuleInit() {
    if (this.env.NODE_ENV === 'test') return;
    if (this.queues.mode === 'memory') void this.register();
  }

  /** Enregistre le traitement de la file (API sans Redis, worker avec Redis) ; la passe périodique suit `inbox.mailbox_poll_seconds`. */
  async register(options: { everyMs?: number } = {}): Promise<void> {
    if (this.registered) return;
    this.registered = true;
    const everyMs = options.everyMs ?? (await this.settings.number('inbox.mailbox_poll_seconds', 120)) * 1000;
    this.queues.process('inbox', async (job) => this.run(job.name, job.data as InboxJob), { concurrency: 2, everyMs, jobName: 'tick' });
  }

  async run(name: string, job: InboxJob): Promise<void> {
    if (name === 'callback' && 'conversationId' in job) {
      // Ancienne tâche différée (avant la finalisation du 3 octobre 2026) : traitée telle quelle.
      await this.callbackDue(job.conversationId, job.minutes);
      return;
    }
    const callbacks = await this.callbacksDue().catch((error: unknown) => {
      this.logger.warn({ err: error }, 'Rappels des appels manqués non relus');
      return null;
    });
    if (callbacks?.due) this.logger.info(callbacks, 'rappels des appels manqués échus');
    if (this.env.MAILBOX_PROVIDER === 'real') {
      const report = await this.pollMailbox().catch((error: unknown) => {
        this.logger.warn({ err: error }, 'Lecture IMAP de la boîte contact@ impossible');
        return null;
      });
      if (report?.fetched) this.logger.info(report, 'courriels lus par IMAP');
    }
    if (this.env.SOCIAL_PROVIDER === 'real') {
      const since = this.lastSocialPoll;
      this.lastSocialPoll = new Date();
      const report = await this.socialInbox.poll(since).catch((error: unknown) => {
        this.logger.warn({ err: error }, 'Rattrapage des réseaux Meta impossible');
        return null;
      });
      if (report && (report.messages || report.comments)) this.logger.info(report, 'messages des réseaux rattrapés');
    }
  }

  /** Lecture de la boîte : chaque courriel non lu est confié au traitement des courriels entrants (dédoublonné par son identifiant). */
  async pollMailbox(limit = 50): Promise<MailboxPollReport> {
    const emails = await this.mailbox.fetchUnseen(limit);
    const byStatus: Record<InboundEmailStatus, number> = { queued: 0, automated: 0, duplicate: 0, ignored: 0, prospect_reply: 0, opt_out: 0 };
    for (const email of emails) {
      const { status } = await this.inboundEmail.receive(email);
      byStatus[status] += 1;
    }
    return { fetched: emails.length, byStatus };
  }

  /** Rappel d'un appel manqué : si la conversation est toujours ouverte, le personnel est rappelé (courriel, texto au fondateur). */
  async callbackDue(conversationId: string, minutes?: number): Promise<boolean> {
    const conversation = await this.conversations.get(conversationId).catch(() => null);
    if (!conversation || conversation.status === 'closed') return false;
    const elapsed = minutes ?? Math.round((Date.now() - conversation.createdAt.getTime()) / 60_000);
    const data = { conversationId, phone: maskPhone(conversation.phone), minutes: elapsed, summary: (conversation.escalationReason ?? '').replace(/^[a-z_]+ : /, '').slice(0, 300) };
    await this.outbox.queueForStaff('alert.callback_due', data);
    if ((await this.settings.get<unknown>('inbox.escalation_sms', true)) === true) {
      const phone = await this.settings.string('alerts.founder_phone', '');
      if (phone) await this.outbox.queue({ recipientAddress: phone, channel: 'sms', template: 'alert.callback_due', language: 'fr', data });
    }
    return true;
  }

  /**
   * Rappels échus des appels manqués (`followups`, cible `missed_call`) : le personnel est rappelé si la conversation est
   * toujours ouverte, puis le rappel est clos (`reminded`, ou `conversation_closed` si l'équipe a déjà terminé). Chaque
   * rappel est réservé par une mise à jour conditionnelle : deux passes simultanées ne rappellent qu'une fois.
   */
  async callbacksDue(now = new Date(), limit = 50): Promise<{ due: number; reminded: number }> {
    const db = this.database.db;
    const due = await db
      .select()
      .from(schema.followups)
      .where(and(eq(schema.followups.targetType, MISSED_CALL_FOLLOWUP), eq(schema.followups.status, 'scheduled'), lte(schema.followups.dueAt, now)))
      .orderBy(asc(schema.followups.dueAt))
      .limit(limit);
    let reminded = 0;
    for (const followup of due) {
      const [claimed] = await db
        .update(schema.followups)
        .set({ status: 'sent', attempt: 1, lastSentAt: now })
        .where(and(eq(schema.followups.id, followup.id), eq(schema.followups.status, 'scheduled')))
        .returning({ id: schema.followups.id });
      if (!claimed) continue;
      const minutes = Math.max(0, Math.round((now.getTime() - followup.referenceAt.getTime()) / 60_000));
      const sent = await this.callbackDue(followup.targetId, minutes);
      if (sent) reminded += 1;
      await db.update(schema.followups).set({ status: 'closed', closedAt: now, closeReason: sent ? 'reminded' : 'conversation_closed' }).where(eq(schema.followups.id, followup.id));
    }
    return { due: due.length, reminded };
  }
}
