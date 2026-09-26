/**
 * Conversations de l'assistance (prompt 13, tâche 6) : chaque message entrant (`conversation.inbound` : WhatsApp, voix,
 * web, application) est rattaché à la conversation ouverte du client sur ce canal, ou en ouvre une ; un message reçu
 * deux fois (même identifiant externe) n'est gardé qu'une fois. Les réponses partent par le canal d'entrée (WhatsApp,
 * push de l'application, texto) par la file des notifications, et sont gardées dans la conversation.
 */
import { schema } from '@neomoov/db';
import { asUntrustedData, type ConversationChannel, type ConversationView, type Language, type NotificationChannel } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { LlmMessage } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { APP_LOGGER } from '../../common/logger.js';
import { DB, type Database } from '../../infra/db.module.js';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';

export type ConversationRow = typeof schema.conversations.$inferSelect;

export interface InboundMessage {
  channel: ConversationChannel;
  externalId: string;
  userId: string | null;
  phone: string | null;
  text: string;
  language: Language | null;
  rideId: string | null;
}

@Injectable()
export class ConversationsService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly outbox: NotificationsOutbox,
  ) {}

  private get db() {
    return this.database.db;
  }

  async get(id: string): Promise<ConversationRow> {
    const [row] = await this.db.select().from(schema.conversations).where(eq(schema.conversations.id, id)).limit(1);
    if (!row) throw AppError.notFound('CONVERSATION_NOT_FOUND', 'Conversation introuvable');
    return row;
  }

  /**
   * Enregistre un message entrant : compte retrouvé par le téléphone s'il n'est pas donné, conversation ouverte ou
   * escaladée du client sur ce canal (sinon nouvelle), message gardé une seule fois (identifiant externe unique).
   */
  async receive(message: InboundMessage): Promise<{ conversation: ConversationRow; messageId: string | null; duplicate: boolean }> {
    let userId = message.userId;
    let language: Language | null = message.language;
    if (!userId && message.phone) {
      const [user] = await this.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.phone, message.phone)).limit(1);
      userId = user?.id ?? null;
    }
    if (userId && !language) {
      const [user] = await this.db.select({ language: schema.users.language }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
      language = user?.language === 'en' ? 'en' : user?.language === 'fr' ? 'fr' : null;
    }
    const [existingMessage] = await this.db.select({ id: schema.conversationMessages.id, conversationId: schema.conversationMessages.conversationId }).from(schema.conversationMessages).where(eq(schema.conversationMessages.externalId, message.externalId)).limit(1);
    if (existingMessage) return { conversation: await this.get(existingMessage.conversationId), messageId: existingMessage.id, duplicate: true };

    const party = userId ? eq(schema.conversations.userId, userId) : eq(schema.conversations.phone, message.phone ?? '');
    let [conversation] = await this.db
      .select()
      .from(schema.conversations)
      .where(and(party, eq(schema.conversations.channel, message.channel), ne(schema.conversations.status, 'closed')))
      .orderBy(desc(schema.conversations.lastMessageAt))
      .limit(1);
    if (!conversation) {
      [conversation] = await this.db
        .insert(schema.conversations)
        .values({ channel: message.channel, userId, phone: message.phone, language: language ?? 'fr', rideId: message.rideId })
        .returning();
    }
    const [inserted] = await this.db
      .insert(schema.conversationMessages)
      .values({ conversationId: conversation!.id, direction: 'inbound', author: 'client', body: message.text.slice(0, 4000), externalId: message.externalId })
      .onConflictDoNothing()
      .returning({ id: schema.conversationMessages.id });
    if (!inserted) return { conversation: conversation!, messageId: null, duplicate: true };
    const [updated] = await this.db
      .update(schema.conversations)
      .set({ lastMessageAt: new Date(), ...(message.rideId ? { rideId: message.rideId } : {}), ...(message.phone && !conversation!.phone ? { phone: message.phone } : {}) })
      .where(eq(schema.conversations.id, conversation!.id))
      .returning();
    return { conversation: updated!, messageId: inserted.id, duplicate: false };
  }

  async setLanguage(id: string, language: Language): Promise<void> {
    await this.db.update(schema.conversations).set({ language }).where(eq(schema.conversations.id, id));
  }

  /**
   * Historique transmis au modèle : messages du client balisés comme des données, réponses de l'agent et du personnel
   * comme réponses de l'assistant ; les accusés de réception sont omis. Le dernier message du client est exclu (il est
   * placé par l'appelant avec la consigne de la tâche). Commence toujours par un message du client.
   */
  async history(conversationId: string, limit: number, excludeMessageId: string | null): Promise<LlmMessage[]> {
    const rows = await this.db
      .select()
      .from(schema.conversationMessages)
      .where(and(eq(schema.conversationMessages.conversationId, conversationId), ne(schema.conversationMessages.author, 'system')))
      .orderBy(desc(schema.conversationMessages.createdAt))
      .limit(limit + 1);
    const messages: LlmMessage[] = rows
      .filter((r) => r.id !== excludeMessageId)
      .slice(0, limit)
      .reverse()
      .map((r) => (r.direction === 'inbound' ? { role: 'user' as const, content: asUntrustedData('client', r.body) } : { role: 'assistant' as const, content: r.body }));
    while (messages[0]?.role === 'assistant') messages.shift();
    return messages;
  }

  /**
   * Canal de réponse : WhatsApp pour WhatsApp, push pour l'application (l'accusé de réception reste à l'écran, sans
   * push), écran pour la réservation web, texto sinon ; le personnel voit tout dans My Hub.
   */
  private replyChannel(conversation: ConversationRow, author: string): { channel: NotificationChannel; recipientUserId: string | null; recipientAddress: string | null } | null {
    if (conversation.channel === 'whatsapp' && conversation.phone) return { channel: 'whatsapp', recipientUserId: conversation.userId, recipientAddress: conversation.phone };
    if (conversation.userId && (conversation.channel === 'app' || conversation.channel === 'web')) return { channel: conversation.channel === 'app' && author !== 'system' ? 'push' : 'in_app', recipientUserId: conversation.userId, recipientAddress: null };
    if (conversation.phone) return { channel: 'sms', recipientUserId: conversation.userId, recipientAddress: conversation.phone };
    if (conversation.userId) return { channel: 'push', recipientUserId: conversation.userId, recipientAddress: null };
    return null;
  }

  /** Envoie un message au client (gabarit `agent.reply`) et le garde dans la conversation. */
  async send(conversation: ConversationRow, text: string, author: 'agent' | 'system' | 'staff', agentRunId: string | null = null): Promise<string> {
    const [row] = await this.db
      .insert(schema.conversationMessages)
      .values({ conversationId: conversation.id, direction: 'outbound', author, body: text.slice(0, 4000), agentRunId })
      .returning({ id: schema.conversationMessages.id });
    await this.db.update(schema.conversations).set({ lastMessageAt: new Date() }).where(eq(schema.conversations.id, conversation.id));
    const target = this.replyChannel(conversation, author);
    if (target) {
      await this.outbox.queue({ ...target, template: 'agent.reply', language: conversation.language === 'en' ? 'en' : 'fr', data: { text, conversationId: conversation.id } });
    } else {
      this.logger.warn({ conversationId: conversation.id }, 'Conversation sans canal de réponse');
    }
    return row!.id;
  }

  /** Réponse de l'équipe (My Hub) : message envoyé par le canal de la conversation ; `close` la termine. */
  async reply(conversationId: string, text: string, close: boolean): Promise<ConversationView> {
    const conversation = await this.get(conversationId);
    if (conversation.status === 'closed') throw AppError.conflict('CONVERSATION_CLOSED', 'Cette conversation est terminée');
    await this.send(conversation, text, 'staff');
    if (close) await this.db.update(schema.conversations).set({ status: 'closed' }).where(eq(schema.conversations.id, conversationId));
    return this.view(await this.get(conversationId));
  }

  /** Remet la conversation à l'équipe : état `escalated`, motif, alerte au personnel d'exploitation. */
  async escalate(conversationId: string, reason: string, summary: string): Promise<boolean> {
    const [row] = await this.db
      .update(schema.conversations)
      .set({ status: 'escalated', escalationReason: `${reason} : ${summary}`.slice(0, 1000), escalatedAt: new Date() })
      .where(and(eq(schema.conversations.id, conversationId), ne(schema.conversations.status, 'escalated')))
      .returning({ id: schema.conversations.id });
    await this.outbox.queueForStaff('alert.agent_escalation', { conversationId, reason, summary: summary.slice(0, 300) }, 'push');
    return Boolean(row);
  }

  /** Conversation en cours du client dans l'application ou la réservation web (la plus récente non fermée), ou null. */
  async currentFor(userId: string): Promise<ConversationView | null> {
    const [row] = await this.db
      .select()
      .from(schema.conversations)
      .where(and(eq(schema.conversations.userId, userId), sql`${schema.conversations.channel} IN ('app', 'web')`, ne(schema.conversations.status, 'closed')))
      .orderBy(desc(schema.conversations.lastMessageAt))
      .limit(1);
    return row ? this.view(row) : null;
  }

  /** Conversations pour My Hub : escaladées d'abord, puis les plus récentes. */
  async list(status: string | undefined, limit: number, offset: number): Promise<{ items: ConversationView[]; total: number }> {
    const where = status ? eq(schema.conversations.status, status) : undefined;
    const [rows, [total]] = await Promise.all([
      this.db.select().from(schema.conversations).where(where).orderBy(sql`${schema.conversations.status} = 'escalated' DESC`, desc(schema.conversations.lastMessageAt)).limit(limit).offset(offset),
      this.db.select({ n: sql<number>`count(*)::int` }).from(schema.conversations).where(where),
    ]);
    const items = await Promise.all(rows.map((r) => this.view(r)));
    return { items, total: total?.n ?? 0 };
  }

  async view(conversation: ConversationRow): Promise<ConversationView> {
    const messages = await this.db.select().from(schema.conversationMessages).where(eq(schema.conversationMessages.conversationId, conversation.id)).orderBy(asc(schema.conversationMessages.createdAt)).limit(200);
    return {
      id: conversation.id, channel: conversation.channel as ConversationChannel, status: conversation.status, language: conversation.language, userId: conversation.userId,
      escalationReason: conversation.escalationReason, createdAt: conversation.createdAt.toISOString(),
      messages: messages.map((m) => ({ id: m.id, direction: m.direction as 'inbound' | 'outbound', author: m.author, body: m.body, createdAt: m.createdAt.toISOString() })),
    };
  }
}
