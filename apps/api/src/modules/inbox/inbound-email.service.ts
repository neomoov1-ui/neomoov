/**
 * Courriels entrants de contact@ (boîte unifiée) : qu'ils arrivent par le relais entrant de Brevo (`POST /v1/webhooks/email`)
 * ou par la lecture IMAP de repli, chaque courriel est réduit (texte utile, 4 000 caractères, citations et signatures
 * coupées, pièces jointes listées mais jamais transmises au modèle), reconnu s'il est automatique (notification, rebond,
 * liste, réponse d'absence : conversation classée et fermée, aucune réponse), dédoublonné par son `Message-ID`, puis
 * confié à l'agent relation client par `conversation.inbound` (canal `email`).
 * Finalisation du 3 octobre 2026 : le courriel d'un prospect de la direction commerciale (même adresse professionnelle)
 * ne part pas à l'agent relation client : une demande de retrait (« STOP », « désabonner »…) le passe en « ne plus
 * contacter » (relances et appels annulés, HubSpot prévenu, conversation classée) ; toute autre réponse le passe en « a
 * répondu » et remet la conversation au personnel (rendez-vous, devis : une personne reprend).
 */
import { cleanEmailText, emailExternalId, isAutomatedEmail, isOptOutReply, normalizeMessageId, parseEmailAddress, threadReferences } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'pino';
import type { InboundEmail } from '../../adapters/types.js';
import { DomainEventsService } from '../../common/domain-events.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { ConversationsService, type InboundMessage } from '../agents/conversations.service.js';
import { ProspectsService, type ProspectRow } from '../sales/prospects.service.js';

export type InboundEmailStatus = 'queued' | 'automated' | 'duplicate' | 'ignored' | 'prospect_reply' | 'opt_out';

@Injectable()
export class InboundEmailService {
  constructor(
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly events: DomainEventsService,
    private readonly conversations: ConversationsService,
    private readonly settings: SettingsService,
    private readonly prospects: ProspectsService,
  ) {}

  /**
   * Courriel d'un prospect : retrait honoré sans délai (Loi canadienne anti-pourriel), ou réponse notée au fil du prospect
   * et remise au personnel. Le message est gardé dans une conversation `email` de la boîte de réception dans les deux cas.
   */
  private async fromProspect(prospect: ProspectRow, message: InboundMessage, subject: string | null): Promise<{ status: InboundEmailStatus; conversationId: string }> {
    const optOut = isOptOutReply(subject, message.text);
    const { conversation } = await this.conversations.receive({ ...message, language: prospect.language === 'en' ? 'en' : 'fr', metadata: { ...(message.metadata ?? {}), prospectId: prospect.id, ...(optOut ? { optOut: true } : {}) } });
    if (optOut) {
      await this.prospects.markDoNotContact(prospect.id, 'Retrait demandé par courriel (réponse « STOP » ou désabonnement)');
      await this.conversations.close(conversation.id);
      this.logger.info({ prospectId: prospect.id }, 'Retrait d\'un prospect reçu par courriel : ne plus contacter');
      return { status: 'opt_out', conversationId: conversation.id };
    }
    await this.prospects.incomingReply(prospect.id, 'email', `Réponse par courriel : ${(subject ?? message.text).slice(0, 200)}`);
    await this.conversations.escalate(conversation.id, 'prospect_reply', `${prospect.organizationName} a répondu par courriel : ${message.text.slice(0, 200)}`);
    return { status: 'prospect_reply', conversationId: conversation.id };
  }

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
    const prospect = await this.prospects.findByEmail(sender.email);
    if (prospect) {
      const handled = await this.fromProspect(prospect, {
        channel: 'email', externalId, userId: null, phone: null, text: text || '(courriel sans texte)', language: null, rideId: null, address: sender.email, kind: 'message', subject, displayName: sender.name, metadata,
      }, subject);
      return { ...handled, externalId };
    }
    this.events.emit('conversation.inbound', {
      channel: 'email', externalId, userId: null, phone: null, text: text || '(courriel sans texte)', language: null, rideId: null, receivedAt: email.receivedAt,
      address: sender.email, kind: 'message', subject, displayName: sender.name, metadata,
    });
    return { status: 'queued', externalId, conversationId: null };
  }
}
