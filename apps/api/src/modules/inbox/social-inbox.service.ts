/**
 * Messages privés et commentaires des réseaux (boîte unifiée) : reçus par le webhook Meta (`/v1/webhooks/meta`, ou
 * `/v1/webhooks/whatsapp` quand l'objet est `page` ou `instagram`) ou rattrapés par interrogation, ils deviennent des
 * événements `conversation.inbound` (canal `social`, réseau, identifiant de la personne, commentaire rattaché à sa
 * publication). Les réseaux sans connecteur passent par le relais humain (`InboxService.relay`).
 */
import { Inject, Injectable } from '@nestjs/common';
import { SOCIAL_PROVIDER, type SocialInboundComment, type SocialInboundMessage, type SocialProvider } from '../../adapters/types.js';
import { DomainEventsService } from '../../common/domain-events.js';

@Injectable()
export class SocialInboxService {
  constructor(
    @Inject(SOCIAL_PROVIDER) private readonly social: SocialProvider,
    private readonly events: DomainEventsService,
  ) {}

  /** Webhook vérifié par le contrôleur : messages et commentaires confiés à l'agent relation client. */
  receiveWebhook(body: unknown): { messages: number; comments: number } {
    const parsed = this.social.parseWebhook(body);
    return this.dispatch(parsed.messages, parsed.comments);
  }

  /** Rattrapage par interrogation du connecteur (messages et commentaires depuis `since`). */
  async poll(since: Date): Promise<{ messages: number; comments: number }> {
    const [messages, comments] = await Promise.all([this.social.listInbound(since), this.social.listComments(since)]);
    return this.dispatch(messages, comments);
  }

  private dispatch(messages: SocialInboundMessage[], comments: SocialInboundComment[]): { messages: number; comments: number } {
    for (const m of messages) {
      this.events.emit('conversation.inbound', {
        channel: 'social', externalId: `social:${m.network}:${m.messageId}`.slice(0, 120), userId: null, phone: null, text: m.text, language: null, rideId: null, receivedAt: m.receivedAt,
        address: m.senderId, network: m.network, kind: 'message', threadRef: m.senderId, displayName: m.senderName, metadata: { messageId: m.messageId },
      });
    }
    for (const c of comments) {
      this.events.emit('conversation.inbound', {
        channel: 'social', externalId: `social:${c.network}:comment:${c.commentId}`.slice(0, 120), userId: null, phone: null, text: c.text, language: null, rideId: null, receivedAt: c.receivedAt,
        address: c.authorId, network: c.network, kind: 'comment', threadRef: c.commentId, displayName: c.authorName, metadata: { commentId: c.commentId, postId: c.postId },
      });
    }
    return { messages: messages.length, comments: comments.length };
  }
}
