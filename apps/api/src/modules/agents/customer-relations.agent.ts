/**
 * Agent relation client (prompt 13, tâche 6 ; section 5.16) : abonné à `conversation.inbound` (application, réservation
 * web, WhatsApp, voix). Le message est gardé dans la conversation du client, un accusé de réception part tout de suite
 * (réponse initiale en moins de 5 secondes), puis l'agent classe le message (sortie structurée) : plainte de sécurité ou
 * ton hostile, la conversation est transmise à l'équipe ; sinon il répond, en français ou en anglais selon le client,
 * avec ses outils (courses, compte, remboursement et crédit dans leurs plafonds, incident, escalade). Une exécution en
 * échec, un agent en mode manuel ou un plafond de dépense atteint remettent la conversation à l'équipe.
 *
 * Boîte unifiée (phase 1 autonome, 2 octobre 2026) : mêmes règles pour le courriel (contact@) et les réseaux sociaux
 * (messages privés, commentaires publics : un commentaire négatif ou une plainte est remis à l'humain avec une réponse
 * publique neutre) ; heures silencieuses (`inbox.quiet_hours`) : accusé seulement, réponse de fond différée.
 */
import { asUntrustedData, localClock, parseQuietHours, quietHoursWindow, redactSensitive, type AgentRunView, type Language } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { LlmMessage } from '../../adapters/types.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { QueueService } from '../../infra/queue.module.js';
import { AgentRunnerService, type AgentRunContext } from './agent-runner.service.js';
import { AgentToolsService, type ToolName } from './agent-tools.service.js';
import { ConversationsService, type ConversationRow, type InboundMessage } from './conversations.service.js';

export const CUSTOMER_RELATIONS = 'customer_relations';

/** Classification du dernier message (aucune contrainte de longueur : bornée après lecture). */
export const classificationSchema = z.object({
  category: z.enum(['question', 'booking', 'ride_issue', 'refund_request', 'lost_item', 'complaint', 'account', 'other']),
  language: z.enum(['fr', 'en']),
  safetyComplaint: z.boolean().describe('Plainte de sécurité : conduite dangereuse, agression, harcèlement, accident, malaise, détresse'),
  hostile: z.boolean().describe('Ton hostile : insultes, menaces, agressivité (un client simplement mécontent n\'est pas hostile)'),
  /** Boîte unifiée : un commentaire public négatif est remis à l'humain ; absent des anciennes classifications : neutre. */
  sentiment: z.enum(['positive', 'neutral', 'negative']).default('neutral').describe('Ton général du message : positif, neutre ou négatif (mécontentement, critique)'),
  summary: z.string().describe('Résumé factuel du message en une phrase, sans donnée personnelle'),
});
export type Classification = z.infer<typeof classificationSchema>;

const TOOLS: ToolName[] = ['lookupRide', 'lookupClient', 'issueCredit', 'refund', 'openIncident', 'escalateToHuman'];

const CHANNEL_LABELS: Record<string, { fr: string }> = {
  whatsapp: { fr: 'WhatsApp' }, sms: { fr: 'texto' }, voice: { fr: 'téléphone' }, web: { fr: 'réservation web' }, app: { fr: 'application' }, email: { fr: 'courriel (boîte contact@)' }, social: { fr: 'réseau social' },
};

const TEXTS = {
  ack: { fr: 'Bien reçu, merci. Je regarde votre demande et je vous réponds dans un instant.', en: 'Got it, thank you. I am looking into your request and will reply in a moment.' },
  ackQuiet: {
    fr: (resume: string) => `Bien reçu, merci. Notre service reprend à ${resume} (heure de Montréal) : nous vous répondons dès l'ouverture.`,
    en: (resume: string) => `Got it, thank you. Our service resumes at ${resume} (Montreal time): we will reply as soon as we open.`,
  },
  commentEscalated: {
    fr: 'Merci de nous l\'avoir signalé. Nous vous écrivons en message privé pour régler cela avec vous.',
    en: 'Thank you for letting us know. We are sending you a private message to sort this out with you.',
  },
  safety: {
    fr: 'Merci de nous avoir écrit. Votre signalement est transmis en priorité à notre équipe, qui vous contacte rapidement. En cas de danger immédiat, appelez le 911.',
    en: 'Thank you for reaching out. Your report has been sent in priority to our team, who will contact you shortly. If you are in immediate danger, call 911.',
  },
  hostile: {
    fr: 'Votre message est transmis à un membre de notre équipe, qui reprend la conversation avec vous.',
    en: 'Your message has been passed on to a member of our team, who will continue the conversation with you.',
  },
  handover: {
    fr: 'Un membre de notre équipe prend le relais et vous répond au plus vite.',
    en: 'A member of our team is taking over and will reply as soon as possible.',
  },
} as const;

export interface InboundResult {
  conversationId: string;
  run: AgentRunView | null;
  duplicate: boolean;
  /** Heures silencieuses : accusé envoyé, réponse de fond différée à cet instant (tâche différée de la file `agents`). */
  deferredUntil?: Date;
}

@Injectable()
export class CustomerRelationsAgent {
  constructor(
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly settings: SettingsService,
    private readonly runner: AgentRunnerService,
    private readonly tools: AgentToolsService,
    private readonly conversations: ConversationsService,
    private readonly queues: QueueService,
  ) {}

  /**
   * Traite un message entrant. `resumed` : reprise après les heures silencieuses d'un message déjà reçu et accusé (aucun
   * nouvel enregistrement, aucun accusé) ; la réponse de fond part alors seulement si la conversation est encore ouverte.
   */
  async handleInbound(message: InboundMessage, options: { resumed?: boolean } = {}): Promise<InboundResult | null> {
    const text = message.text.trim();
    if ((!message.userId && !message.phone && !message.address) || !text) {
      // Ni compte, ni numéro, ni adresse (ou message vide) : aucune conversation possible, rien à répondre.
      this.logger.warn({ channel: message.channel, externalId: message.externalId }, 'Message entrant sans compte, téléphone ni adresse, ignoré');
      return null;
    }
    let conversation: ConversationRow;
    let messageId: string | null;
    if (options.resumed) {
      const found = await this.conversations.findByExternalId(message.externalId);
      if (!found) return null;
      conversation = found.conversation;
      messageId = found.message.id;
      if (conversation.status !== 'open') return { conversationId: conversation.id, run: null, duplicate: false };
    } else {
      const received = await this.conversations.receive({ ...message, text });
      if (received.duplicate) return { conversationId: received.conversation.id, run: null, duplicate: true };
      conversation = received.conversation;
      messageId = received.messageId;
    }
    const language: Language = conversation.language === 'en' ? 'en' : 'fr';
    if (!options.resumed) {
      if (conversation.status === 'escalated') {
        // Conversation reprise par l'équipe : le message l'attend, l'agent n'intervient plus.
        await this.conversations.escalate(conversation.id, 'client_message', redactSensitive(text).slice(0, 300));
        return { conversationId: conversation.id, run: null, duplicate: false };
      }
      const quiet = await this.quietWindow(message.channel);
      // Commentaire public : pas d'accusé de réception sous la publication, la première réponse est la réponse elle-même.
      if (quiet.active && quiet.resumeAt) {
        if (conversation.kind !== 'comment') await this.conversations.send(conversation, TEXTS.ackQuiet[language](quiet.resumeLabel ?? ''), 'system');
        await this.defer(message, quiet.resumeAt);
        return { conversationId: conversation.id, run: null, duplicate: false, deferredUntil: quiet.resumeAt };
      }
      if (conversation.kind !== 'comment') await this.conversations.send(conversation, TEXTS.ack[language], 'system');
    }

    const execution = await this.runner.execute(
      CUSTOMER_RELATIONS,
      { name: `conversation.${message.channel}`, ref: message.externalId, input: { conversationId: conversation.id, channel: message.channel, language, textLength: text.length, rideId: message.rideId, knownClient: Boolean(conversation.userId) } },
      (ctx) => this.respond(ctx, conversation, messageId, text, language),
      {
        subjectUserId: conversation.userId,
        conversationId: conversation.id,
        onSkip: async (reason) => {
          await this.conversations.escalate(conversation.id, reason, 'Agent relation client hors service : réponse humaine attendue');
          await this.conversations.send(conversation, TEXTS.handover[language], 'system');
        },
      },
    );
    if (execution.run.status === 'failed') {
      await this.conversations.escalate(conversation.id, 'agent_error', `Exécution ${execution.run.id} en échec`);
      await this.conversations.send(conversation, TEXTS.handover[language], 'system');
    }
    return { conversationId: conversation.id, run: execution.run, duplicate: false };
  }

  /** Heures silencieuses (`inbox.quiet_hours`, heure de Montréal) pour ce canal. */
  private async quietWindow(channel: string) {
    const [tz, setting] = await Promise.all([this.settings.string('service.time_zone', 'America/Toronto'), this.settings.get<unknown>('inbox.quiet_hours', null)]);
    return quietHoursWindow(new Date(), tz, parseQuietHours(setting), channel);
  }

  /** Réponse de fond différée à la fin des heures silencieuses : tâche différée de la file `agents` (identifiant stable). */
  private async defer(message: InboundMessage, resumeAt: Date): Promise<void> {
    const delay = Math.max(1_000, resumeAt.getTime() - Date.now());
    try {
      await this.queues.add('agents', 'conversation', { ...message, resumed: true }, { jobId: `conversation-${message.externalId}-resume`, delay });
    } catch (error) {
      this.logger.error({ err: error, externalId: message.externalId }, 'Reprise différée non mise en file');
    }
  }

  private async respond(ctx: AgentRunContext, conversation: ConversationRow, messageId: string | null, text: string, fallbackLanguage: Language) {
    const limit = await this.settings.number('agents.conversation_history_messages', 20);
    const tz = await this.settings.string('service.time_zone', 'America/Toronto');
    const history = await this.conversations.history(conversation.id, limit, messageId);
    const isComment = conversation.kind === 'comment';
    const channel = `${CHANNEL_LABELS[conversation.channel]?.fr ?? conversation.channel}${conversation.network ? ` (${conversation.network})` : ''}`;
    const nature = isComment
      ? 'Nature : commentaire PUBLIC sous une publication ; réponds en une ou deux phrases, courtoises, sans aucune donnée personnelle ni détail de course, et invite la personne à écrire en message privé pour tout ce qui la concerne personnellement.'
      : conversation.channel === 'email'
        ? `Nature : courriel${conversation.subject ? ` (objet : ${redactSensitive(conversation.subject).slice(0, 120)})` : ''} ; réponds comme un courriel court, sans objet ni formule de signature.`
        : 'Nature : message de messagerie.';
    const context = [
      `Contexte : canal ${channel}, langue du client ${fallbackLanguage === 'en' ? 'anglais' : 'français'}, ${conversation.userId ? 'client avec compte' : 'client sans compte identifié'}, date du jour ${localClock(new Date(), tz).date} (heure de Montréal).`,
      nature,
      asUntrustedData('client', text),
    ].join('\n');

    const classification = await ctx.structured('classification', classificationSchema, [...history, { role: 'user', content: `Tâche : classer le dernier message du client.\n${context}` }]);
    const language: Language = classification.language;
    if (language !== conversation.language) await this.conversations.setLanguage(conversation.id, language);
    const summary = redactSensitive(classification.summary).slice(0, 500);

    if (isComment && (classification.sentiment === 'negative' || classification.category === 'complaint' || classification.safetyComplaint || classification.hostile)) {
      // Commentaire public négatif ou plainte : l'humain reprend ; la réponse publique reste neutre et renvoie au privé.
      const reason = classification.safetyComplaint ? 'safety' : classification.hostile ? 'hostile' : 'other';
      await this.tools.call(ctx, 'escalateToHuman', { reason, summary: summary || 'Commentaire négatif' });
      const reply = TEXTS.commentEscalated[language];
      await this.conversations.send({ ...conversation, language }, reply, 'agent', ctx.runId);
      return { classification: { ...classification, summary }, escalated: `comment_${reason}`, reply };
    }

    if (classification.safetyComplaint || classification.hostile) {
      const reason = classification.safetyComplaint ? 'safety' : 'hostile';
      await this.tools.call(ctx, 'escalateToHuman', { reason, summary: summary || 'Escalade' });
      const reply = classification.safetyComplaint ? TEXTS.safety[language] : TEXTS.hostile[language];
      await this.conversations.send({ ...conversation, language }, reply, 'agent', ctx.runId);
      return { classification: { ...classification, summary }, escalated: reason, reply };
    }

    const messages: LlmMessage[] = [...history, { role: 'user', content: `Tâche : répondre au client (catégorie : ${classification.category}).\n${context}` }];
    const result = await ctx.runTools(this.tools.llmTools(ctx, TOOLS), messages);
    let reply = redactSensitive(result.text).trim().slice(0, 2_000);
    let escalated: string | null = null;
    if (!reply) {
      // Boucle arrêtée sans réponse (nombre maximal de requêtes) : l'équipe reprend.
      await this.tools.call(ctx, 'escalateToHuman', { reason: 'other', summary: `Aucune réponse de l'agent : ${summary}`.slice(0, 1_000) });
      reply = TEXTS.handover[language];
      escalated = 'no_reply';
    }
    await this.conversations.send({ ...conversation, language }, reply, 'agent', ctx.runId);
    this.logger.debug({ conversationId: conversation.id, runId: ctx.runId, iterations: result.iterations }, 'Réponse de l\'agent relation client');
    return { classification: { ...classification, summary }, escalated, reply, iterations: result.iterations };
  }
}
