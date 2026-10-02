/**
 * Courriels entrants de contact@ (boîte unifiée) : qu'ils arrivent par le relais entrant de Brevo (`POST /v1/webhooks/email`)
 * ou par la lecture IMAP de repli, chaque courriel est réduit (texte utile, 4 000 caractères, citations et signatures
 * coupées, pièces jointes listées mais jamais transmises au modèle), reconnu s'il est automatique (notification, rebond,
 * liste, réponse d'absence : conversation classée et fermée, aucune réponse), dédoublonné par son `Message-ID`, puis
 * confié à l'agent relation client par `conversation.inbound` (canal `email`).
 */
import { cleanEmailText, emailExternalId, isAutomatedEmail, normalizeMessageId, parseEmailAddress, threadReferences } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'pino';
import type { InboundEmail } from '../../adapters/types.js';
import { DomainEventsService } from '../../common/domain-events.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { ConversationsService } from '../agents/conversations.service.js';

export type InboundEmailStatus = 'queued' | 'automated' | 'duplicate' | 'ignored';

@Injectable()
export class InboundEmailService {
  constructor(
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly events: DomainEventsService,
    private readonly conversations: ConversationsService,
    private readonly settings: SettingsService,
  ) {}

  /** Adresse de la boîte contact@ (réglage `inbox.email_from`) : un courriel qui en vient est le nôtre, jamais traité. */
  private async ownAddress(): Promise<string | null> {
    return parseEmailAddress(await this.settings.string('inbox.email_from', 'Neomoov <contact@neomoov.net>'))?.email ?? null;
  }

  async receive(email: InboundEmail): Promise<{ status: InboundEmailStatus; externalId: string | null; conversationId: string | null }> {
    const sender = parseEmailAddress(email.from);
    if (!sender) {
      this.logger.warn({ subject: email.subject?.slice(0, 80) ?? null }, 'Courriel entrant sans expéditeur lisible, ignoré');
      return { status: 'ignored', externalId: null, conversationId: null };
    }
    if (sender.email === (await this.ownAddress())) return { status: 'ignored', externalId: null, conversationId: null };
    const externalId = emailExternalId(email.messageId, { from: sender.email, subject: email.subject, receivedAt: email.receivedAt.toISOString() });
    const existing = await this.conversations.findByExternalId(externalId);
    if (existing) return { status: 'duplicate', externalId, conversationId: existing.conversation.id };

    const text = cleanEmailText(email.text, email.html);
    const check = isAutomatedEmail({ from: email.from, subject: email.subject, headers: email.headers });
    const metadata = {
      messageId: normalizeMessageId(email.messageId), inReplyTo: normalizeMessageId(email.inReplyTo), references: threadReferences(email.inReplyTo, email.references),
      attachments: email.attachments.slice(0, 20).map((a) => ({ name: a.name.slice(0, 200), contentType: a.contentType, size: a.size })),
      ...(check.automated ? { automated: check.reason } : {}),
    };
    const subject = email.subject?.trim().slice(0, 255) || null;
    if (check.automated) {
      // Classé sans réponse : conversation fermée, visible dans la boîte (filtre « fermées »), jamais confiée à l'agent.
      const { conversation } = await this.conversations.receive({
        channel: 'email', externalId, userId: null, phone: null, text: text || `(courriel automatique : ${check.reason})`, language: null, rideId: null,
        address: sender.email, kind: 'automated', subject, displayName: sender.name, metadata,
      });
      await this.conversations.close(conversation.id);
      return { status: 'automated', externalId, conversationId: conversation.id };
    }
    this.events.emit('conversation.inbound', {
      channel: 'email', externalId, userId: null, phone: null, text: text || '(courriel sans texte)', language: null, rideId: null, receivedAt: email.receivedAt,
      address: sender.email, kind: 'message', subject, displayName: sender.name, metadata,
    });
    return { status: 'queued', externalId, conversationId: null };
  }
}
