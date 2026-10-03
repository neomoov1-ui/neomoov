/**
 * Discussion du site (Tidio) vers la boîte unifiée (finalisation du 3 octobre 2026) : chaque message d'un visiteur reçu par
 * le webhook (`POST /v1/webhooks/tidio`, secret partagé) devient un message de la boîte de réception, dédoublonné par son
 * identifiant. Visiteur qui a laissé son courriel : conversation `email` confiée à l'agent relation client, qui répond
 * par courriel depuis contact@ (la plateforme n'écrit pas dans Tidio). Visiteur sans courriel : conversation `web` remise
 * au personnel, qui lui répond dans Tidio. Manuel : `docs/runbooks/boite-unifiee.md`.
 */
import { parseTidioWebhook } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'pino';
import { DomainEventsService } from '../../common/domain-events.js';
import { APP_LOGGER } from '../../common/logger.js';
import { ConversationsService } from '../agents/conversations.service.js';

export interface TidioReceiveReport {
  received: number;
  /** Confiés à l'agent relation client (visiteur avec courriel). */
  queued: number;
  /** Remis au personnel (visiteur sans courriel : réponse dans Tidio). */
  escalated: number;
  duplicates: number;
  /** Messages de l'équipe ou du robot de Tidio, éléments sans texte ou sans identifiant. */
  ignored: number;
}

@Injectable()
export class TidioInboxService {
  constructor(
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly events: DomainEventsService,
    private readonly conversations: ConversationsService,
  ) {}

  async receive(body: unknown, now = new Date()): Promise<TidioReceiveReport> {
    const parsed = parseTidioWebhook(body, now);
    const report: TidioReceiveReport = { received: parsed.messages.length + parsed.ignored, queued: 0, escalated: 0, duplicates: 0, ignored: parsed.ignored };
    for (const message of parsed.messages) {
      if (await this.conversations.findByExternalId(message.externalId)) {
        report.duplicates += 1;
        continue;
      }
      const metadata = { source: 'tidio', tidioConversation: message.conversationRef, tidioVisitor: message.visitorRef };
      if (message.email) {
        this.events.emit('conversation.inbound', {
          channel: 'email', externalId: message.externalId, userId: null, phone: message.phone, text: message.text, language: null, rideId: null, receivedAt: message.receivedAt,
          address: message.email, kind: 'message', subject: null, displayName: message.name, metadata,
        });
        report.queued += 1;
        continue;
      }
      const { conversation, duplicate } = await this.conversations.receive({
        channel: 'web', externalId: message.externalId, userId: null, phone: message.phone, text: message.text, language: null, rideId: null,
        address: `tidio:${message.visitorRef ?? message.conversationRef ?? message.externalId}`.slice(0, 254), kind: 'message', displayName: message.name, metadata,
      });
      if (duplicate) {
        report.duplicates += 1;
        continue;
      }
      // Une seule remise au personnel par conversation : les messages suivants s'y ajoutent sans nouvelle alerte.
      if (conversation.status !== 'escalated') {
        await this.conversations.escalate(conversation.id, 'tidio_chat', `Discussion du site${message.name ? ` (${message.name})` : ''}, sans courriel du visiteur : répondre dans Tidio. « ${message.text.slice(0, 200)} »`);
      }
      report.escalated += 1;
    }
    if (report.ignored) this.logger.info({ ignored: report.ignored }, 'Webhook Tidio : éléments ignorés (équipe, robot ou sans texte)');
    return report;
  }
}
