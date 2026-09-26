/**
 * Agent relation client (prompt 13, tâche 6 ; section 5.16) : abonné à `conversation.inbound` (application, réservation
 * web, WhatsApp, voix). Le message est gardé dans la conversation du client, un accusé de réception part tout de suite
 * (réponse initiale en moins de 5 secondes), puis l'agent classe le message (sortie structurée) : plainte de sécurité ou
 * ton hostile, la conversation est transmise à l'équipe ; sinon il répond, en français ou en anglais selon le client,
 * avec ses outils (courses, compte, remboursement et crédit dans leurs plafonds, incident, escalade). Une exécution en
 * échec, un agent en mode manuel ou un plafond de dépense atteint remettent la conversation à l'équipe.
 */
import { asUntrustedData, localClock, redactSensitive, type AgentRunView, type Language } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { LlmMessage } from '../../adapters/types.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
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
  summary: z.string().describe('Résumé factuel du message en une phrase, sans donnée personnelle'),
});
export type Classification = z.infer<typeof classificationSchema>;

const TOOLS: ToolName[] = ['lookupRide', 'lookupClient', 'issueCredit', 'refund', 'openIncident', 'escalateToHuman'];

const TEXTS = {
  ack: { fr: 'Bien reçu, merci. Je regarde votre demande et je vous réponds dans un instant.', en: 'Got it, thank you. I am looking into your request and will reply in a moment.' },
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
}

@Injectable()
export class CustomerRelationsAgent {
  constructor(
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly settings: SettingsService,
    private readonly runner: AgentRunnerService,
    private readonly tools: AgentToolsService,
    private readonly conversations: ConversationsService,
  ) {}

  async handleInbound(message: InboundMessage): Promise<InboundResult | null> {
    const text = message.text.trim();
    if ((!message.userId && !message.phone) || !text) {
      // Ni compte ni numéro (ou message vide) : aucune conversation possible, rien à répondre.
      this.logger.warn({ channel: message.channel, externalId: message.externalId }, 'Message entrant sans compte ni téléphone, ignoré');
      return null;
    }
    const { conversation, messageId, duplicate } = await this.conversations.receive({ ...message, text });
    if (duplicate) return { conversationId: conversation.id, run: null, duplicate: true };
    const language: Language = conversation.language === 'en' ? 'en' : 'fr';
    if (conversation.status === 'escalated') {
      // Conversation reprise par l'équipe : le message l'attend, l'agent n'intervient plus.
      await this.conversations.escalate(conversation.id, 'client_message', redactSensitive(text).slice(0, 300));
      return { conversationId: conversation.id, run: null, duplicate: false };
    }
    await this.conversations.send(conversation, TEXTS.ack[language], 'system');

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

  private async respond(ctx: AgentRunContext, conversation: ConversationRow, messageId: string | null, text: string, fallbackLanguage: Language) {
    const limit = await this.settings.number('agents.conversation_history_messages', 20);
    const tz = await this.settings.string('service.time_zone', 'America/Toronto');
    const history = await this.conversations.history(conversation.id, limit, messageId);
    const context = [
      `Contexte : canal ${conversation.channel}, langue du client ${fallbackLanguage === 'en' ? 'anglais' : 'français'}, ${conversation.userId ? 'client avec compte' : 'client sans compte identifié'}, date du jour ${localClock(new Date(), tz).date} (heure de Montréal).`,
      asUntrustedData('client', text),
    ].join('\n');

    const classification = await ctx.structured('classification', classificationSchema, [...history, { role: 'user', content: `Tâche : classer le dernier message du client.\n${context}` }]);
    const language: Language = classification.language;
    if (language !== conversation.language) await this.conversations.setLanguage(conversation.id, language);
    const summary = redactSensitive(classification.summary).slice(0, 500);

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
