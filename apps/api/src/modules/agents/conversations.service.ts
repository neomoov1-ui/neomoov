/**
 * Conversations de l'assistance (prompt 13, tâche 6) : chaque message entrant (`conversation.inbound` : WhatsApp, voix,
 * web, application) est rattaché à la conversation ouverte du client sur ce canal, ou en ouvre une ; un message reçu
 * deux fois (même identifiant externe) n'est gardé qu'une fois. Les réponses partent par le canal d'entrée (WhatsApp,
 * push de l'application, texto) par la file des notifications, et sont gardées dans la conversation.
 *
 * Boîte unifiée (phase 1 « entreprise autonome », 2 octobre 2026) : canaux `email` (réponse par courriel depuis
 * contact@, fil conservé par `In-Reply-To` et `References`) et `social` (réponse par le connecteur du réseau d'origine ;
 * réseaux sans connecteur : la réponse attend qu'un humain la relaie), conversations `voice` des appels manqués, liste
 * de la boîte de réception de My Hub (filtres par canal et par état), texto au fondateur à chaque escalade.
 */
import { schema } from '@neomoov/db';
import {
  asUntrustedData, isRelayNetwork, replySubject, type ConversationChannel, type ConversationKind, type ConversationView, type InboxItemView, type InboxListQuery, type InboxState,
  type InboxSummaryView, type Language, type NotificationChannel, type SocialNetwork,
} from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ne, sql, type SQL } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { LlmMessage } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { APP_LOGGER } from '../../common/logger.js';
import { organizationIdFor } from '../../common/org-scope.context.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';

export type ConversationRow = typeof schema.conversations.$inferSelect;
export type ConversationMessageRow = typeof schema.conversationMessages.$inferSelect;

export interface InboundMessage {
  channel: ConversationChannel;
  externalId: string;
  userId: string | null;
  phone: string | null;
  text: string;
  language: Language | null;
  rideId: string | null;
  /** Boîte unifiée : courriel de l'expéditeur ou identifiant de la personne chez le réseau. */
  address?: string | null;
  network?: string | null;
  kind?: ConversationKind;
  subject?: string | null;
  /** Référence de réponse chez le réseau (identifiant de la personne, ou du commentaire pour un commentaire). */
  threadRef?: string | null;
  displayName?: string | null;
  /** Gardé avec le message : identifiant et références d'un courriel, pièces jointes listées, publication d'un commentaire. */
  metadata?: Record<string, unknown> | null;
}

/** Métadonnées d'un message (jamais transmises au modèle) ; les pièces jointes ne sont que listées. */
interface MessageMetadata {
  messageId?: string;
  inReplyTo?: string | null;
  references?: string[];
  attachments?: Array<{ name: string; contentType?: string | null; size?: number | null }>;
  [key: string]: unknown;
}

const PREVIEW_LENGTH = 160;

@Injectable()
export class ConversationsService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly outbox: NotificationsOutbox,
    private readonly settings: SettingsService,
  ) {}

  private get db() {
    return this.database.db;
  }

  async get(id: string): Promise<ConversationRow> {
    const [row] = await this.db.select().from(schema.conversations).where(eq(schema.conversations.id, id)).limit(1);
    if (!row) throw AppError.notFound('CONVERSATION_NOT_FOUND', 'Conversation introuvable');
    return row;
  }

  /** Conversation et message d'un identifiant externe déjà reçu (reprise différée), ou null. */
  async findByExternalId(externalId: string): Promise<{ conversation: ConversationRow; message: ConversationMessageRow } | null> {
    const [message] = await this.db.select().from(schema.conversationMessages).where(eq(schema.conversationMessages.externalId, externalId)).limit(1);
    if (!message) return null;
    return { conversation: await this.get(message.conversationId), message };
  }

  /**
   * Enregistre un message entrant : compte retrouvé par le téléphone (ou le courriel) s'il n'est pas donné, conversation
   * ouverte ou escaladée de la personne sur ce canal (et ce réseau) sinon nouvelle, message gardé une seule fois
   * (identifiant externe unique).
   */
  async receive(message: InboundMessage): Promise<{ conversation: ConversationRow; messageId: string | null; duplicate: boolean }> {
    let userId = message.userId;
    let language: Language | null = message.language;
    const address = message.address?.trim().toLowerCase() || null;
    if (!userId && message.phone) {
      const [user] = await this.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.phone, message.phone)).limit(1);
      userId = user?.id ?? null;
    }
    if (!userId && message.channel === 'email' && address) {
      const [user] = await this.db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.email, address), eq(schema.users.status, 'active'))).limit(1);
      userId = user?.id ?? null;
    }
    if (userId && !language) {
      const [user] = await this.db.select({ language: schema.users.language }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
      language = user?.language === 'en' ? 'en' : user?.language === 'fr' ? 'fr' : null;
    }
    const [existingMessage] = await this.db.select({ id: schema.conversationMessages.id, conversationId: schema.conversationMessages.conversationId }).from(schema.conversationMessages).where(eq(schema.conversationMessages.externalId, message.externalId)).limit(1);
    if (existingMessage) return { conversation: await this.get(existingMessage.conversationId), messageId: existingMessage.id, duplicate: true };

    const party = userId ? eq(schema.conversations.userId, userId) : message.phone ? eq(schema.conversations.phone, message.phone) : eq(schema.conversations.address, address ?? '');
    const sameNetwork = message.network ? eq(schema.conversations.network, message.network) : undefined;
    // Un commentaire public n'est jamais rattaché à un fil de messages privés, et réciproquement ; un courriel automatique
    // (réponse d'absence à notre propre réponse, rebond) ouvre toujours sa propre conversation, fermée aussitôt.
    const sameKind = message.kind === 'comment' ? eq(schema.conversations.kind, 'comment') : ne(schema.conversations.kind, 'comment');
    let [conversation] = message.kind === 'automated' ? [] : await this.db
      .select()
      .from(schema.conversations)
      .where(and(party, eq(schema.conversations.channel, message.channel), sameNetwork, sameKind, ne(schema.conversations.status, 'closed')))
      .orderBy(desc(schema.conversations.lastMessageAt))
      .limit(1);
    if (!conversation) {
      [conversation] = await this.db
        .insert(schema.conversations)
        // Étape 20 : l'organisation du contexte ; hors contexte, la base la dérive de la course ou du profil client (0022).
        .values({
          channel: message.channel, userId, phone: message.phone, address, network: message.network ?? null, kind: message.kind ?? 'message', displayName: message.displayName?.slice(0, 120) ?? null,
          subject: message.subject?.slice(0, 255) ?? null, threadRef: message.threadRef?.slice(0, 255) ?? null, language: language ?? 'fr', rideId: message.rideId, organizationId: organizationIdFor(),
        })
        .returning();
    }
    const [inserted] = await this.db
      .insert(schema.conversationMessages)
      .values({ conversationId: conversation!.id, direction: 'inbound', author: 'client', body: message.text.slice(0, 4000), externalId: message.externalId, metadata: message.metadata ?? null })
      .onConflictDoNothing()
      .returning({ id: schema.conversationMessages.id });
    if (!inserted) return { conversation: conversation!, messageId: null, duplicate: true };
    const [updated] = await this.db
      .update(schema.conversations)
      .set({
        lastMessageAt: new Date(),
        ...(message.rideId ? { rideId: message.rideId } : {}),
        ...(message.phone && !conversation!.phone ? { phone: message.phone } : {}),
        ...(address && !conversation!.address ? { address } : {}),
        ...(message.subject ? { subject: message.subject.slice(0, 255) } : {}),
        ...(message.threadRef ? { threadRef: message.threadRef.slice(0, 255) } : {}),
        ...(message.displayName && !conversation!.displayName ? { displayName: message.displayName.slice(0, 120) } : {}),
      })
      .where(eq(schema.conversations.id, conversation!.id))
      .returning();
    return { conversation: updated!, messageId: inserted.id, duplicate: false };
  }

  async setLanguage(id: string, language: Language): Promise<void> {
    await this.db.update(schema.conversations).set({ language }).where(eq(schema.conversations.id, id));
  }

  /** Termine une conversation (courriel automatique classé, appel rappelé). */
  async close(id: string): Promise<void> {
    await this.db.update(schema.conversations).set({ status: 'closed' }).where(eq(schema.conversations.id, id));
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
   * push), écran pour la réservation web, courriel pour un courriel, connecteur du réseau pour un message ou un
   * commentaire social, texto sinon ; le personnel voit tout dans My Hub.
   */
  private replyChannel(conversation: ConversationRow, author: string): { channel: NotificationChannel; recipientUserId: string | null; recipientAddress: string | null } | null {
    if (conversation.channel === 'email' && conversation.address) return { channel: 'email', recipientUserId: conversation.userId, recipientAddress: conversation.address };
    if (conversation.channel === 'social' && conversation.address) return { channel: 'social', recipientUserId: null, recipientAddress: conversation.address };
    if (conversation.channel === 'whatsapp' && conversation.phone) return { channel: 'whatsapp', recipientUserId: conversation.userId, recipientAddress: conversation.phone };
    if (conversation.userId && (conversation.channel === 'app' || conversation.channel === 'web')) return { channel: conversation.channel === 'app' && author !== 'system' ? 'push' : 'in_app', recipientUserId: conversation.userId, recipientAddress: null };
    if (conversation.phone) return { channel: 'sms', recipientUserId: conversation.userId, recipientAddress: conversation.phone };
    if (conversation.userId) return { channel: 'push', recipientUserId: conversation.userId, recipientAddress: null };
    return null;
  }

  /** Dernier courriel reçu de la conversation : identifiant de message et références, pour répondre dans le fil. */
  private async emailThread(conversationId: string): Promise<{ inReplyTo: string | null; references: string[] }> {
    const rows = await this.db
      .select({ metadata: schema.conversationMessages.metadata })
      .from(schema.conversationMessages)
      .where(and(eq(schema.conversationMessages.conversationId, conversationId), eq(schema.conversationMessages.direction, 'inbound')))
      .orderBy(desc(schema.conversationMessages.createdAt))
      .limit(10);
    const ids = rows.map((r) => (r.metadata as MessageMetadata | null)?.messageId).filter((id): id is string => typeof id === 'string' && id.length > 0);
    const last = rows[0]?.metadata as MessageMetadata | null;
    const references = [...new Set([...(last?.references ?? []), ...ids.slice().reverse()])].slice(-10);
    return { inReplyTo: ids[0] ?? null, references };
  }

  /**
   * Envoie un message à la personne (gabarit `agent.reply`) et le garde dans la conversation. Courriel : objet « Re: »,
   * expéditeur contact@ (réglage `inbox.email_from`), fil conservé. Réseau sans connecteur : rien ne part, la réponse
   * attend qu'un humain la relaie (`relay_status` en attente, écran Boîte de réception).
   */
  async send(conversation: ConversationRow, text: string, author: 'agent' | 'system' | 'staff', agentRunId: string | null = null): Promise<string> {
    const relay = conversation.channel === 'social' && isRelayNetwork(conversation.network);
    const [row] = await this.db
      .insert(schema.conversationMessages)
      .values({ conversationId: conversation.id, direction: 'outbound', author, body: text.slice(0, 4000), agentRunId, relayStatus: relay ? 'pending' : null })
      .returning({ id: schema.conversationMessages.id });
    await this.db.update(schema.conversations).set({ lastMessageAt: new Date() }).where(eq(schema.conversations.id, conversation.id));
    if (relay) return row!.id;
    const target = this.replyChannel(conversation, author);
    const language: Language = conversation.language === 'en' ? 'en' : 'fr';
    if (!target) {
      this.logger.warn({ conversationId: conversation.id }, 'Conversation sans canal de réponse');
      return row!.id;
    }
    let data: Record<string, unknown> = { text, conversationId: conversation.id };
    if (target.channel === 'email') {
      const thread = await this.emailThread(conversation.id);
      const from = await this.settings.string('inbox.email_from', 'Neomoov <contact@neomoov.net>');
      const headers: Record<string, string> = {};
      if (thread.inReplyTo) headers['In-Reply-To'] = `<${thread.inReplyTo}>`;
      if (thread.references.length) headers['References'] = thread.references.map((id) => `<${id}>`).join(' ');
      data = { ...data, emailSubject: replySubject(conversation.subject, language), emailFrom: from, emailReplyTo: from, emailHeaders: headers };
    } else if (target.channel === 'social') {
      data = { ...data, network: conversation.network, threadRef: conversation.threadRef ?? conversation.address, kind: conversation.kind };
    }
    await this.outbox.queue({ ...target, organizationId: conversation.organizationId, template: 'agent.reply', language, data });
    return row!.id;
  }

  /** Réponse relayée à la main sur un réseau sans connecteur : marquée faite par le membre du personnel. */
  async markRelayed(messageId: string, userId: string): Promise<ConversationView> {
    const [row] = await this.db
      .update(schema.conversationMessages)
      .set({ relayStatus: 'done', relayedAt: new Date(), relayedByUserId: userId })
      .where(and(eq(schema.conversationMessages.id, messageId), eq(schema.conversationMessages.relayStatus, 'pending')))
      .returning({ conversationId: schema.conversationMessages.conversationId });
    if (!row) throw AppError.notFound('RELAY_NOT_PENDING', 'Aucune réponse en attente de relais pour ce message');
    return this.view(await this.get(row.conversationId));
  }

  /** Réponse de l'équipe (My Hub) : message envoyé par le canal de la conversation ; `close` la termine. */
  async reply(conversationId: string, text: string, close: boolean): Promise<ConversationView> {
    const conversation = await this.get(conversationId);
    if (conversation.status === 'closed') throw AppError.conflict('CONVERSATION_CLOSED', 'Cette conversation est terminée');
    await this.send(conversation, text, 'staff');
    if (close) await this.db.update(schema.conversations).set({ status: 'closed' }).where(eq(schema.conversations.id, conversationId));
    return this.view(await this.get(conversationId));
  }

  /**
   * Remet la conversation à l'équipe : état `escalated`, motif, alerte au personnel d'exploitation ; à la première
   * escalade, texto au fondateur (`inbox.escalation_sms`, numéro `alerts.founder_phone`) : l'humain est toujours prévenu.
   */
  async escalate(conversationId: string, reason: string, summary: string): Promise<boolean> {
    const [row] = await this.db
      .update(schema.conversations)
      .set({ status: 'escalated', escalationReason: `${reason} : ${summary}`.slice(0, 1000), escalatedAt: new Date() })
      .where(and(eq(schema.conversations.id, conversationId), ne(schema.conversations.status, 'escalated')))
      .returning({ id: schema.conversations.id });
    const data = { conversationId, reason, summary: summary.slice(0, 300) };
    await this.outbox.queueForStaff('alert.agent_escalation', data);
    if (row && (await this.settings.get<unknown>('inbox.escalation_sms', true)) === true) {
      const phone = await this.settings.string('alerts.founder_phone', '');
      if (phone) await this.outbox.queue({ recipientAddress: phone, channel: 'sms', template: 'alert.agent_escalation', language: 'fr', data });
    }
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
      id: conversation.id, channel: conversation.channel as ConversationChannel, kind: conversation.kind as ConversationKind, network: (conversation.network as SocialNetwork | null) ?? null,
      status: conversation.status, language: conversation.language, userId: conversation.userId, address: conversation.address, displayName: conversation.displayName, subject: conversation.subject,
      escalationReason: conversation.escalationReason, relayPending: messages.some((m) => m.relayStatus === 'pending'), lastMessageAt: conversation.lastMessageAt.toISOString(), createdAt: conversation.createdAt.toISOString(),
      messages: messages.map((m) => ({
        id: m.id, direction: m.direction as 'inbound' | 'outbound', author: m.author, body: m.body, createdAt: m.createdAt.toISOString(),
        relayStatus: (m.relayStatus as 'pending' | 'done' | null) ?? null,
        attachments: ((m.metadata as MessageMetadata | null)?.attachments ?? []).map((a) => a.name).filter((n): n is string => typeof n === 'string'),
      })),
    };
  }

  // Boîte de réception unifiée (My Hub) -------------------------------------------------------------------------------

  /** État calculé d'une conversation : fermée, remise à l'humain, réponse à relayer, sans réponse (dernier message reçu), répondue. */
  private static readonly STATE_SQL = sql<string>`CASE
    WHEN conversations.status = 'closed' THEN 'closed'
    WHEN conversations.status = 'escalated' THEN 'escalated'
    WHEN EXISTS (SELECT 1 FROM conversation_messages r WHERE r.conversation_id = conversations.id AND r.relay_status = 'pending') THEN 'relay'
    WHEN (SELECT l.direction FROM conversation_messages l WHERE l.conversation_id = conversations.id ORDER BY l.created_at DESC LIMIT 1) = 'inbound' THEN 'awaiting'
    ELSE 'answered' END`;

  /**
   * Boîte de réception : conversations de tous les canaux, filtrées par canal, réseau, état calculé et recherche
   * (adresse, téléphone, nom, objet), les remises à l'humain et les réponses à relayer d'abord, puis les plus récentes.
   */
  async listInbox(query: InboxListQuery): Promise<{ items: InboxItemView[]; total: number }> {
    const conditions: SQL[] = [];
    if (query.channel) conditions.push(eq(schema.conversations.channel, query.channel));
    if (query.network) conditions.push(eq(schema.conversations.network, query.network));
    if (query.state) conditions.push(sql`${ConversationsService.STATE_SQL} = ${query.state}`);
    else conditions.push(ne(schema.conversations.status, 'closed'));
    if (query.q) {
      const like = `%${query.q.toLowerCase()}%`;
      conditions.push(sql`(lower(coalesce(${schema.conversations.address}, '')) LIKE ${like} OR lower(coalesce(${schema.conversations.displayName}, '')) LIKE ${like} OR lower(coalesce(${schema.conversations.subject}, '')) LIKE ${like} OR coalesce(${schema.conversations.phone}, '') LIKE ${like})`);
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const firstReplySeconds = await this.settings.number('inbox.first_reply_seconds', 5);
    const last = sql<string | null>`(SELECT l.body FROM conversation_messages l WHERE l.conversation_id = conversations.id ORDER BY l.created_at DESC LIMIT 1)`;
    const lastDirection = sql<string | null>`(SELECT l.direction FROM conversation_messages l WHERE l.conversation_id = conversations.id ORDER BY l.created_at DESC LIMIT 1)`;
    const messageCount = sql<number>`(SELECT count(*)::int FROM conversation_messages m WHERE m.conversation_id = conversations.id)`;
    const firstReply = sql<number | null>`(SELECT EXTRACT(EPOCH FROM (min(o.created_at) FILTER (WHERE o.direction = 'outbound') - min(o.created_at) FILTER (WHERE o.direction = 'inbound')))::int FROM conversation_messages o WHERE o.conversation_id = conversations.id)`;
    const [rows, [total]] = await Promise.all([
      this.db
        .select({ conversation: schema.conversations, state: ConversationsService.STATE_SQL, last, lastDirection, messageCount, firstReply })
        .from(schema.conversations)
        .where(where)
        .orderBy(sql`${schema.conversations.status} = 'escalated' DESC`, sql`${ConversationsService.STATE_SQL} = 'relay' DESC`, desc(schema.conversations.lastMessageAt))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ n: sql<number>`count(*)::int` }).from(schema.conversations).where(where),
    ]);
    const items: InboxItemView[] = rows.map(({ conversation: c, state, last: preview, lastDirection: direction, messageCount: n, firstReply: seconds }) => ({
      id: c.id, channel: c.channel as ConversationChannel, kind: c.kind as ConversationKind, network: (c.network as SocialNetwork | null) ?? null, status: c.status, state: state as InboxState,
      language: c.language, userId: c.userId, phone: c.phone, address: c.address, displayName: c.displayName, subject: c.subject,
      preview: (preview ?? '').slice(0, PREVIEW_LENGTH), lastDirection: (direction as 'inbound' | 'outbound' | null) ?? null, messageCount: Number(n ?? 0), relayPending: state === 'relay',
      firstReplySeconds: seconds === null || seconds === undefined ? null : Math.max(0, Number(seconds)), firstReplyLate: seconds !== null && seconds !== undefined && Number(seconds) > firstReplySeconds,
      escalationReason: c.escalationReason, lastMessageAt: c.lastMessageAt.toISOString(), createdAt: c.createdAt.toISOString(),
    }));
    return { items, total: total?.n ?? 0 };
  }

  /** Compteurs par canal (sans réponse, remises à l'humain, ouvertes) et réponses à relayer. */
  async inboxSummary(): Promise<InboxSummaryView> {
    const rows = await this.db
      .select({
        channel: schema.conversations.channel,
        awaiting: sql<number>`count(*) FILTER (WHERE ${ConversationsService.STATE_SQL} = 'awaiting')::int`,
        escalated: sql<number>`count(*) FILTER (WHERE ${schema.conversations.status} = 'escalated')::int`,
        open: sql<number>`count(*) FILTER (WHERE ${schema.conversations.status} <> 'closed')::int`,
      })
      .from(schema.conversations)
      .where(ne(schema.conversations.status, 'closed'))
      .groupBy(schema.conversations.channel);
    const [relay] = await this.db.select({ n: sql<number>`count(*)::int` }).from(schema.conversationMessages).where(eq(schema.conversationMessages.relayStatus, 'pending'));
    return {
      byChannel: rows.map((r) => ({ channel: r.channel as ConversationChannel, awaiting: Number(r.awaiting), escalated: Number(r.escalated), open: Number(r.open) })),
      relayPending: Number(relay?.n ?? 0),
      firstReplySeconds: await this.settings.number('inbox.first_reply_seconds', 5),
    };
  }
}
