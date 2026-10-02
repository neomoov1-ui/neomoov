/**
 * Appels manqués et messages vocaux (boîte unifiée) : à partir du rapport de fin d'appel du centre vocal (`voice.call_ended`,
 * journalisé une seule fois), tout appel sans réservation ni transfert devient une conversation `voice` (résumé de l'appel,
 * nature `missed_call` ou `voicemail`), remise à l'humain (alerte au personnel, texto au fondateur), avec un texto
 * « nous vous rappelons » à la personne et une tâche de rappel différée (file `inbox`, en attendant la table `followups`
 * de l'agent F).
 */
import { schema } from '@neomoov/db';
import { callOutcome, type Language } from '@neomoov/domain';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq, gte, or } from 'drizzle-orm';
import type { Logger } from 'pino';
import { DomainEventsService, type DomainEvents } from '../../common/domain-events.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { QueueService } from '../../infra/queue.module.js';
import { ConversationsService } from '../agents/conversations.service.js';

const TEXTS = {
  callback: {
    fr: 'Nous avons bien reçu votre appel. Un membre de l\'équipe Neomoov vous rappelle dès que possible ; vous pouvez aussi répondre à ce texto.',
    en: 'We received your call. A member of the Neomoov team will call you back as soon as possible; you can also reply to this text message.',
  },
  noSummary: { fr: 'Appel sans suite (aucun résumé disponible).', en: 'Call without outcome (no summary available).' },
} as const;

/** Marge, avant le début de l'appel, pour retrouver une course créée pendant l'appel. */
const BOOKING_LOOKBACK_MS = 120_000;

export interface MissedCallResult {
  missed: boolean;
  conversationId: string | null;
  duplicate: boolean;
}

@Injectable()
export class MissedCallsService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly events: DomainEventsService,
    private readonly settings: SettingsService,
    private readonly conversations: ConversationsService,
    private readonly queues: QueueService,
  ) {}

  onModuleInit() {
    this.events.on('voice.call_ended', (p) => {
      void this.handle(p).catch((error: unknown) => this.logger.error({ err: error, callId: p.callId }, 'Appel manqué non traité'));
    });
  }

  /** Course créée pour l'appelant pendant l'appel (compte ou fiche minimale). */
  private async bookedDuring(phone: string, userId: string | null, startedAt: Date): Promise<boolean> {
    const client = userId ? (await this.database.db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.userId, userId)).limit(1))[0] : undefined;
    const owner = client ? or(eq(schema.rides.guestPhone, phone), eq(schema.rides.clientId, client.id)) : eq(schema.rides.guestPhone, phone);
    const [ride] = await this.database.db.select({ id: schema.rides.id }).from(schema.rides).where(and(owner, gte(schema.rides.createdAt, startedAt))).limit(1);
    return Boolean(ride);
  }

  async handle(report: DomainEvents['voice.call_ended']): Promise<MissedCallResult> {
    if (!report.phone) return { missed: false, conversationId: null, duplicate: false };
    const [user] = await this.database.db.select({ id: schema.users.id, language: schema.users.language }).from(schema.users).where(eq(schema.users.phone, report.phone)).limit(1);
    const startedAt = new Date(report.endedAt.getTime() - (report.durationSeconds ?? 0) * 1000 - BOOKING_LOOKBACK_MS);
    const outcome = callOutcome(
      { endedReason: report.endedReason, durationSeconds: report.durationSeconds, summary: report.summary },
      { bookedRide: await this.bookedDuring(report.phone, user?.id ?? null, startedAt), transferred: false },
    );
    if (!outcome.missed) return { missed: false, conversationId: null, duplicate: false };
    const language: Language = user?.language === 'en' ? 'en' : 'fr';
    const summary = (report.summary ?? '').trim().slice(0, 2_000) || TEXTS.noSummary[language];
    const externalId = `call:${report.callId ?? `${report.phone}:${report.endedAt.toISOString()}`}`.slice(0, 120);
    const { conversation, duplicate } = await this.conversations.receive({
      channel: 'voice', externalId, userId: user?.id ?? null, phone: report.phone, text: summary, language, rideId: null,
      kind: outcome.kind ?? 'missed_call', metadata: { endedReason: report.endedReason, durationSeconds: report.durationSeconds, reason: outcome.reason, callId: report.callId },
    });
    if (duplicate) return { missed: true, conversationId: conversation.id, duplicate: true };
    // Texto « nous vous rappelons », gardé dans la conversation ; puis l'humain est prévenu (courriel au personnel, texto au fondateur).
    await this.conversations.send(conversation, TEXTS.callback[language], 'system');
    await this.conversations.escalate(conversation.id, outcome.kind === 'voicemail' ? 'voicemail' : 'missed_call', summary.slice(0, 300));
    const minutes = await this.settings.number('inbox.callback_reminder_minutes', 60);
    try {
      await this.queues.add('inbox', 'callback', { conversationId: conversation.id, minutes }, { jobId: `callback-${conversation.id}`, delay: minutes * 60_000 });
    } catch (error) {
      this.logger.error({ err: error, conversationId: conversation.id }, 'Tâche de rappel non mise en file');
    }
    return { missed: true, conversationId: conversation.id, duplicate: false };
  }
}
