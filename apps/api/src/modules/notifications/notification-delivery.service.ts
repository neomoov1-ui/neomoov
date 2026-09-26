/**
 * Envoi des notifications mises en file (section 5.14, prompt 13 tâche 2). Chaque ligne `notifications` est réservée
 * atomiquement (un seul processus l'envoie), rendue dans la langue du destinataire, envoyée par son canal, puis marquée
 * envoyée (identifiant du fournisseur) ou en erreur. Événement critique sans push possible (aucun appareil, refus) :
 * texto de secours, noté dans la ligne. Les reçus push (Expo) et les statuts de livraison des textos (Twilio) complètent
 * `delivered_at`. Un courriel de facture ou de relevé attend son PDF quelques minutes, puis part avec un lien.
 */
import { randomUUID } from 'node:crypto';
import { schema } from '@neomoov/db';
import { needsSmsFallback, notificationRule } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import {
  EMAIL_PROVIDER, PUSH_PROVIDER, SMS_PROVIDER, STORAGE_PROVIDER, WHATSAPP_PROVIDER,
  type EmailProvider, type PushProvider, type SmsDeliveryStatus, type SmsProvider, type StorageProvider, type WhatsAppProvider,
} from '../../adapters/types.js';
import { APP_LOGGER } from '../../common/logger.js';
import { DB, type Database } from '../../infra/db.module.js';
import { renderNotification } from './templates.js';

type NotificationRow = typeof schema.notifications.$inferSelect;
export type DeliveryOutcome = 'sent' | 'failed' | 'deferred' | 'skipped';

/** Délai pendant lequel un courriel attend le PDF de sa facture ou de son relevé. */
const ATTACHMENT_WAIT_MS = 10 * 60_000;
/** Une réservation plus vieille que ce délai est réputée abandonnée (processus arrêté pendant l'envoi). */
const STALE_CLAIM_MS = 10 * 60_000;
/** Essais d'envoi avant l'erreur définitive (pannes passagères d'un fournisseur). */
const MAX_ATTEMPTS = 3;

interface Recipient {
  language: string;
  phone: string | null;
  email: string | null;
  pushTokens: string[];
}

@Injectable()
export class NotificationDeliveryService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsapp: WhatsAppProvider,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  private get db() {
    return this.database.db;
  }

  /** Envoie une notification en attente ; sans effet si elle est déjà envoyée, en erreur ou en cours d'envoi ailleurs. */
  async deliver(id: string, now = new Date()): Promise<DeliveryOutcome> {
    const claim = `claim:${randomUUID()}`;
    const [row] = await this.db
      .update(schema.notifications)
      .set({ providerMessageId: claim })
      .where(and(eq(schema.notifications.id, id), isNull(schema.notifications.sentAt), isNull(schema.notifications.error), isNull(schema.notifications.providerMessageId)))
      .returning();
    if (!row) return 'skipped';
    try {
      return await this.send(row, now);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn({ err: error, notificationId: id, channel: row.channel, template: row.template }, 'Notification non envoyée');
      // Panne passagère du fournisseur : la ligne redevient disponible pour la reprise (30 s), 3 essais au plus.
      const data = (row.data ?? {}) as Record<string, unknown>;
      const attempts = (typeof data['attempts'] === 'number' ? data['attempts'] : 0) + 1;
      if (attempts < MAX_ATTEMPTS) {
        await this.db.update(schema.notifications).set({ providerMessageId: null, data: { ...data, attempts, lastError: message.slice(0, 200) } }).where(eq(schema.notifications.id, row.id));
        return 'deferred';
      }
      await this.finish(row.id, { error: message.slice(0, 500), data: { ...data, attempts } });
      return 'failed';
    }
  }

  private async send(row: NotificationRow, now: Date): Promise<DeliveryOutcome> {
    const data = (row.data ?? {}) as Record<string, unknown>;
    const recipient = await this.recipientOf(row);
    if (notificationRule(row.template)?.marketing && row.recipientUserId && !(await this.marketingConsent(row.recipientUserId))) {
      await this.finish(row.id, { error: 'no_marketing_consent' });
      return 'failed';
    }
    const rendered = renderNotification(row.template, data, row.language ?? recipient.language);
    switch (row.channel) {
      case 'push': {
        let detail = 'no_device';
        if (recipient.pushTokens.length) {
          const { tickets } = await this.push.send({ tokens: recipient.pushTokens, title: rendered.title, body: rendered.body, data: rendered.deepLink });
          const dead = tickets.filter((t) => t.detail === 'DeviceNotRegistered').map((t) => t.token);
          if (dead.length) await this.db.update(schema.devices).set({ pushToken: null }).where(inArray(schema.devices.pushToken, dead));
          const ok = tickets.filter((t) => t.status === 'ok');
          if (ok.length) {
            await this.finish(row.id, { sentAt: now, providerMessageId: ok.map((t) => t.ticketId ?? t.token).join(',').slice(0, 120) });
            return 'sent';
          }
          detail = tickets[0]?.detail ?? 'push_refused';
        }
        if (needsSmsFallback(row.template, 'push', false) && recipient.phone) {
          const { messageId } = await this.sms.send({ to: recipient.phone, body: `Neomoov : ${rendered.body}` });
          await this.finish(row.id, { sentAt: now, providerMessageId: messageId, data: { ...data, fallback: { channel: 'sms', reason: detail } } });
          return 'sent';
        }
        await this.finish(row.id, { error: detail });
        return 'failed';
      }
      case 'sms': {
        const to = row.recipientAddress ?? recipient.phone;
        if (!to) return this.fail(row.id, 'no_phone');
        const { messageId } = await this.sms.send({ to, body: `Neomoov : ${rendered.body}` });
        await this.finish(row.id, { sentAt: now, providerMessageId: messageId });
        return 'sent';
      }
      case 'whatsapp': {
        const to = row.recipientAddress ?? recipient.phone;
        if (!to) return this.fail(row.id, 'no_phone');
        const { messageId } = await this.whatsapp.sendText({ to, text: `${rendered.title}\n${rendered.body}` });
        await this.finish(row.id, { sentAt: now, providerMessageId: messageId });
        return 'sent';
      }
      case 'email': {
        const to = row.recipientAddress?.includes('@') ? row.recipientAddress : recipient.email;
        if (!to) return this.fail(row.id, 'no_email');
        const attachment = await this.attachmentOf(row.template, data);
        if (attachment === 'pending' && now.getTime() - row.createdAt.getTime() < ATTACHMENT_WAIT_MS) {
          // Le PDF n'est pas encore produit : la ligne redevient disponible pour la prochaine passe.
          await this.db.update(schema.notifications).set({ providerMessageId: null }).where(eq(schema.notifications.id, row.id));
          return 'deferred';
        }
        const { messageId } = await this.email.send({
          to, subject: rendered.subject, html: rendered.html, text: rendered.body, idempotencyKey: `notification:${row.id}`,
          ...(attachment && attachment !== 'pending' ? { attachments: [attachment] } : {}),
        });
        await this.finish(row.id, { sentAt: now, providerMessageId: messageId });
        return 'sent';
      }
      default:
        // `in_app` : l'écran suit le temps réel ; la ligne sert de journal.
        await this.finish(row.id, { sentAt: now, providerMessageId: 'in_app' });
        return 'sent';
    }
  }

  private async fail(id: string, error: string): Promise<DeliveryOutcome> {
    await this.finish(id, { error });
    return 'failed';
  }

  private async finish(id: string, set: { sentAt?: Date; providerMessageId?: string; error?: string; data?: Record<string, unknown> }): Promise<void> {
    await this.db
      .update(schema.notifications)
      .set({ ...set, providerMessageId: set.providerMessageId ?? null })
      .where(eq(schema.notifications.id, id));
  }

  private async recipientOf(row: NotificationRow): Promise<Recipient> {
    if (!row.recipientUserId) return { language: row.language ?? 'fr', phone: row.recipientAddress && !row.recipientAddress.includes('@') ? row.recipientAddress : null, email: row.recipientAddress?.includes('@') ? row.recipientAddress : null, pushTokens: [] };
    const [user] = await this.db.select({ language: schema.users.language, phone: schema.users.phone, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, row.recipientUserId)).limit(1);
    const devices = await this.db.select({ token: schema.devices.pushToken }).from(schema.devices).where(and(eq(schema.devices.userId, row.recipientUserId), isNotNull(schema.devices.pushToken)));
    return { language: user?.language ?? 'fr', phone: user?.phone ?? null, email: user?.email ?? null, pushTokens: devices.map((d) => d.token!).filter(Boolean) };
  }

  private async marketingConsent(userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: schema.consents.id })
      .from(schema.consents)
      .where(and(eq(schema.consents.userId, userId), eq(schema.consents.purpose, 'marketing'), isNull(schema.consents.withdrawnAt)))
      .limit(1);
    return Boolean(row);
  }

  /** PDF joint à un courriel de facture ou de relevé : le fichier, `pending` s'il n'est pas encore produit, sinon rien. */
  private async attachmentOf(template: string, data: Record<string, unknown>): Promise<{ filename: string; content: Buffer; contentType: string } | 'pending' | null> {
    let key: string | null | undefined;
    let filename = 'document.pdf';
    if (template === 'invoice.issued' && typeof data['invoiceId'] === 'string') {
      const [invoice] = await this.db.select({ pdfKey: schema.invoices.pdfKey, number: schema.invoices.number }).from(schema.invoices).where(eq(schema.invoices.id, data['invoiceId'])).limit(1);
      if (!invoice) return null;
      key = invoice.pdfKey;
      filename = `facture-${invoice.number}.pdf`;
    } else if (template === 'statement.issued' && typeof data['statementId'] === 'string') {
      const [statement] = await this.db.select({ pdfKey: schema.weeklyStatements.pdfKey, start: schema.weeklyStatements.periodStart }).from(schema.weeklyStatements).where(eq(schema.weeklyStatements.id, data['statementId'])).limit(1);
      if (!statement) return null;
      key = statement.pdfKey;
      filename = `releve-${statement.start}.pdf`;
    } else return null;
    if (!key) return 'pending';
    const file = await this.storage.getObject(key);
    return file ? { filename, content: file.body, contentType: 'application/pdf' } : 'pending';
  }

  /**
   * Reprise : envoie les notifications restées en attente (événement perdu, PDF attendu), libère les réservations
   * abandonnées. Rejouable, bornée à 200 lignes par passe.
   */
  async sweep(now = new Date()): Promise<number> {
    await this.db
      .update(schema.notifications)
      .set({ providerMessageId: null })
      .where(and(isNull(schema.notifications.sentAt), isNull(schema.notifications.error), sql`${schema.notifications.providerMessageId} LIKE 'claim:%'`, lt(schema.notifications.createdAt, new Date(now.getTime() - STALE_CLAIM_MS))));
    const rows = await this.db
      .select({ id: schema.notifications.id })
      .from(schema.notifications)
      .where(and(isNull(schema.notifications.sentAt), isNull(schema.notifications.error), isNull(schema.notifications.providerMessageId), sql`${schema.notifications.createdAt} > ${new Date(now.getTime() - 2 * 86_400_000).toISOString()}::timestamptz`))
      .orderBy(schema.notifications.createdAt)
      .limit(200);
    let sent = 0;
    for (const r of rows) if ((await this.deliver(r.id, now)) === 'sent') sent += 1;
    return sent;
  }

  /** Reçus push (Expo) des envois de la veille : livrés, ou refusés (appareil désinstallé retiré). */
  async pollReceipts(now = new Date()): Promise<number> {
    const rows = await this.db
      .select({ id: schema.notifications.id, ref: schema.notifications.providerMessageId, recipientUserId: schema.notifications.recipientUserId })
      .from(schema.notifications)
      .where(and(
        eq(schema.notifications.channel, 'push'), isNotNull(schema.notifications.sentAt), isNull(schema.notifications.deliveredAt), isNull(schema.notifications.error),
        sql`${schema.notifications.sentAt} > ${new Date(now.getTime() - 86_400_000).toISOString()}::timestamptz`,
        sql`${schema.notifications.providerMessageId} NOT LIKE 'claim:%'`,
      ))
      .limit(300);
    const byTicket = new Map<string, string>();
    for (const r of rows) for (const ticket of (r.ref ?? '').split(',').filter((t) => t && !t.startsWith('ExponentPushToken'))) byTicket.set(ticket, r.id);
    if (!byTicket.size) return 0;
    const receipts = await this.push.receipts([...byTicket.keys()]);
    let updated = 0;
    for (const receipt of receipts) {
      const id = byTicket.get(receipt.ticketId);
      if (!id) continue;
      await this.db.update(schema.notifications).set(receipt.status === 'ok' ? { deliveredAt: now } : { error: receipt.detail ?? 'push_receipt_error' }).where(eq(schema.notifications.id, id));
      updated += 1;
    }
    return updated;
  }

  /** Statut de livraison d'un texto (webhook Twilio), y compris un texto de secours d'un push. */
  async onSmsStatus(status: SmsDeliveryStatus, now = new Date()): Promise<boolean> {
    if (status.status === 'pending') return false;
    const [row] = await this.db.select({ id: schema.notifications.id }).from(schema.notifications).where(eq(schema.notifications.providerMessageId, status.messageId)).limit(1);
    if (!row) return false;
    await this.db
      .update(schema.notifications)
      .set(status.status === 'delivered' ? { deliveredAt: now } : { error: `sms_${status.errorCode ?? 'failed'}` })
      .where(eq(schema.notifications.id, row.id));
    return true;
  }
}
