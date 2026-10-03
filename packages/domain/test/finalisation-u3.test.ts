import { describe, expect, it } from 'vitest';
import {
  boosterAnalyseQuerySchema, callbackStats, ESCALATION_REASONS, escalationCode, firstReplyByChannel, forwardCommentToolSchema, isAccountCallbackEscalation, isMetaPrivateNetwork, isOptOutReply,
  META_HUMAN_AGENT_WINDOW_MS, META_STANDARD_WINDOW_MS, metaReplyMode, normalizeVisitorPhone, notificationRule, outOfWindowFallback, parseTidioWebhook, replyCommentToolSchema, socialMetricsToolSchema,
  socialPublishToolSchema,
} from '../src/index.js';

const NOW = new Date('2026-10-03T15:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe('fenêtre de réponse de Meta (Messenger, Instagram)', () => {
  const base = { network: 'messenger', kind: 'message', now: NOW, author: 'agent' as const, humanAgentTagEnabled: false };

  it('réponse ordinaire dans les 24 heures, commentaires et autres réseaux jamais limités', () => {
    expect(metaReplyMode({ ...base, lastInboundAt: ago(META_STANDARD_WINDOW_MS) })).toBe('standard');
    expect(metaReplyMode({ ...base, network: 'instagram', lastInboundAt: ago(3_600_000) })).toBe('standard');
    expect(metaReplyMode({ ...base, kind: 'comment', lastInboundAt: null })).toBe('standard');
    expect(metaReplyMode({ ...base, network: 'facebook', lastInboundAt: ago(META_HUMAN_AGENT_WINDOW_MS * 2) })).toBe('standard');
    expect(metaReplyMode({ ...base, network: null, kind: null, lastInboundAt: null })).toBe('standard');
    expect(isMetaPrivateNetwork('instagram')).toBe(true);
    expect(isMetaPrivateNetwork(undefined)).toBe(false);
  });

  it('hors des 24 heures : étiquette HUMAN_AGENT pour un humain si Meta l\'a permise (7 jours), sinon fenêtre close', () => {
    const late = ago(META_STANDARD_WINDOW_MS + 60_000);
    expect(metaReplyMode({ ...base, lastInboundAt: late })).toBe('closed');
    expect(metaReplyMode({ ...base, author: 'staff', lastInboundAt: late })).toBe('closed');
    expect(metaReplyMode({ ...base, author: 'staff', humanAgentTagEnabled: true, lastInboundAt: late })).toBe('human_agent');
    expect(metaReplyMode({ ...base, author: 'agent', humanAgentTagEnabled: true, lastInboundAt: late })).toBe('closed');
    expect(metaReplyMode({ ...base, author: 'staff', humanAgentTagEnabled: true, lastInboundAt: ago(META_HUMAN_AGENT_WINDOW_MS + 1) })).toBe('closed');
    expect(metaReplyMode({ ...base, lastInboundAt: null })).toBe('closed');
  });

  it('autre canal de la personne : courriel, texto, push, sinon le personnel', () => {
    expect(outOfWindowFallback({ email: 'a@b.co', phone: '+15145550000', hasPushDevice: true })).toBe('email');
    expect(outOfWindowFallback({ email: null, phone: '+15145550000', hasPushDevice: true })).toBe('sms');
    expect(outOfWindowFallback({ email: null, phone: null, hasPushDevice: true })).toBe('push');
    expect(outOfWindowFallback({ email: null, phone: null, hasPushDevice: false })).toBeNull();
  });
});

describe('discussion du site (Tidio) : lecture tolérante du webhook', () => {
  it('message seul, objet data, liste de messages ; visiteur, courriel et téléphone normalisés', () => {
    const single = parseTidioWebhook({
      event: 'message_sent', data: { conversation_id: 'conv-1', message: { id: 'm-1', content: '  Bonjour, avez-vous une place pour demain ?  ', created_at: '2026-10-03T14:00:00Z' }, visitor: { id: 'v-1', email: 'Marie@Example.com', first_name: 'Marie', last_name: 'Roy', phone: '(514) 555-0101' } },
    }, NOW);
    expect(single).toEqual({
      ignored: 0,
      messages: [{ externalId: 'tidio:m-1', conversationRef: 'conv-1', visitorRef: 'v-1', email: 'marie@example.com', name: 'Marie Roy', phone: '+15145550101', text: 'Bonjour, avez-vous une place pour demain ?', receivedAt: new Date('2026-10-03T14:00:00Z') }],
    });
    const list = parseTidioWebhook({
      messages: [
        { chat_id: 'c-2', timestamp: 1_790_000_000, message: 'Question tarif', contact: { distinct_id: 'd-2', name: 'Paul', email: 'pas-une-adresse' } },
        { thread_id: 't-3', timestamp: 1_790_000_000_000, text: 'Bonsoir', customer: { phone: '+33 6 12 34 56 78' } },
        { id: 42, content: 'Sans date', visitor_id: 'v-4', phone: '15145550102' },
        { message: { content: 'Réponse de l\'équipe', author: 'operator', id: 'm-5' } },
        { sender_type: 'bot', text: 'Bonjour, je suis Lyro', message_id: 'm-6' },
        { message: { id: 'm-7' } },
        { content: 'Sans identifiant ni date', conversation_id: 'c-8' },
        { content: 'Date illisible', conversation_id: 'c-9', created_at: 'hier' },
        'pas un objet',
      ],
    }, NOW);
    expect(list.ignored).toBe(6);
    expect(list.messages).toEqual([
      { externalId: `tidio:c-2:${1_790_000_000_000}`, conversationRef: 'c-2', visitorRef: 'd-2', email: null, name: 'Paul', phone: null, text: 'Question tarif', receivedAt: new Date(1_790_000_000_000) },
      { externalId: `tidio:t-3:${1_790_000_000_000}`, conversationRef: 't-3', visitorRef: null, email: null, name: null, phone: '+33612345678', text: 'Bonsoir', receivedAt: new Date(1_790_000_000_000) },
      { externalId: 'tidio:42', conversationRef: null, visitorRef: 'v-4', email: null, name: null, phone: '+15145550102', text: 'Sans date', receivedAt: NOW },
    ]);
    // Corps à la racine, sans objet data.
    expect(parseTidioWebhook({ message_id: 'm-9', text: 'x'.repeat(5_000), email: 'a@b.co', created_at: '' }, NOW).messages[0]).toMatchObject({ externalId: 'tidio:m-9', email: 'a@b.co', receivedAt: NOW });
    expect(parseTidioWebhook({ message_id: 'm-9', text: 'x'.repeat(5_000) }, NOW).messages[0]!.text).toHaveLength(4_000);
    expect(parseTidioWebhook(null, NOW)).toEqual({ messages: [], ignored: 0 });
    expect(parseTidioWebhook([1, 2], NOW)).toEqual({ messages: [], ignored: 0 });
  });

  it('téléphone du visiteur : international gardé, 10 ou 11 chiffres nord-américains, le reste écarté', () => {
    expect(normalizeVisitorPhone('514 555 0101')).toBe('+15145550101');
    expect(normalizeVisitorPhone('1-514-555-0101')).toBe('+15145550101');
    expect(normalizeVisitorPhone('+44 20 7946 0958')).toBe('+442079460958');
    expect(normalizeVisitorPhone('+12')).toBeNull();
    expect(normalizeVisitorPhone('555-0101')).toBeNull();
    expect(normalizeVisitorPhone(null)).toBeNull();
  });
});

describe('indicateurs de la boîte unifiée pour le rapport quotidien', () => {
  it('temps de première réponse par canal : médiane, 90e centile, réponses en retard, conversations sans réponse', () => {
    const samples = [
      ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 60].map((s) => ({ channel: 'whatsapp', firstReplySeconds: s })),
      { channel: 'email', firstReplySeconds: null },
      { channel: 'email', firstReplySeconds: -3 },
      { channel: 'email', firstReplySeconds: 120 },
    ];
    expect(firstReplyByChannel(samples, 5)).toEqual([
      { channel: 'email', conversations: 3, answered: 2, medianSeconds: 0, p90Seconds: 120, late: 1 },
      { channel: 'whatsapp', conversations: 10, answered: 10, medianSeconds: 6, p90Seconds: 10, late: 6 },
    ]);
    expect(firstReplyByChannel([{ channel: 'voice', firstReplySeconds: null }], 5)).toEqual([{ channel: 'voice', conversations: 1, answered: 0, medianSeconds: null, p90Seconds: null, late: 0 }]);
    expect(firstReplyByChannel([], 5)).toEqual([]);
  });

  it('rappel sous 4 heures des problèmes de compte ou de paiement', () => {
    expect(ESCALATION_REASONS).toContain('account');
    expect(ESCALATION_REASONS).toContain('payment');
    expect(escalationCode('payment : carte refusée deux fois')).toBe('payment');
    expect(escalationCode(null)).toBeNull();
    expect(escalationCode('  ')).toBeNull();
    expect(isAccountCallbackEscalation('account : connexion impossible')).toBe(true);
    expect(isAccountCallbackEscalation('safety : chauffeur dangereux')).toBe(false);
    expect(isAccountCallbackEscalation(undefined)).toBe(false);
    const h = 3_600_000;
    const stats = callbackStats([
      { escalatedAt: ago(10 * h), handledAt: ago(9 * h) },
      { escalatedAt: ago(10 * h), handledAt: ago(5 * h) },
      { escalatedAt: ago(9 * h), handledAt: null },
      { escalatedAt: ago(h), handledAt: null },
      { escalatedAt: ago(2 * h), handledAt: ago(3 * h) },
    ], NOW, 4);
    expect(stats).toEqual({ targetHours: 4, escalated: 5, withinTarget: 2, late: 2, pending: 1, medianMinutes: 60 });
    expect(callbackStats([], NOW, 4)).toEqual({ targetHours: 4, escalated: 0, withinTarget: 0, late: 0, pending: 0, medianMinutes: null });
  });
});

describe('ventes : retrait demandé par un prospect', () => {
  it('reconnaît STOP, désabonnement, « ne plus me contacter » en français et en anglais, dans l\'objet ou le message', () => {
    expect(isOptOutReply(null, 'STOP')).toBe(true);
    expect(isOptOutReply('Re: Proposition Neomoov', 'Arrêt svp')).toBe(true);
    expect(isOptOutReply('RE: TR: Désabonnement', '')).toBe(true);
    expect(isOptOutReply(undefined, 'Merci de ne plus me contacter.')).toBe(true);
    expect(isOptOutReply(null, 'Bonjour, retirez-moi de votre liste.')).toBe(true);
    expect(isOptOutReply(null, 'Please remove me from your list')).toBe(true);
    expect(isOptOutReply(null, 'Do not contact us again')).toBe(true);
    expect(isOptOutReply('Unsubscribe', null)).toBe(true);
    expect(isOptOutReply('Re: Proposition', 'Pas intéressés pour le moment, merci.')).toBe(false);
    expect(isOptOutReply('Re: Proposition', 'Oui, appelez-moi jeudi pour en parler.')).toBe(false);
    expect(isOptOutReply(null, `${'a'.repeat(500)} stop`)).toBe(false);
  });
});

describe('schémas et matrice de la finalisation', () => {
  it('outils de l\'agent de diffusion, analyse Booster asynchrone, avis de parrainage', () => {
    const itemId = '00000000-0000-4000-8000-000000000001';
    expect(socialPublishToolSchema.parse({ itemId })).toEqual({ itemId });
    expect(socialMetricsToolSchema.safeParse({ itemId: 'x' }).success).toBe(false);
    expect(replyCommentToolSchema.parse({ itemId, commentId: ' c1 ', text: 'Merci !' })).toEqual({ itemId, commentId: 'c1', text: 'Merci !' });
    expect(forwardCommentToolSchema.safeParse({ itemId, commentId: 'c1', intent: 'autre', negative: false }).success).toBe(false);
    expect(boosterAnalyseQuerySchema.parse({ async: 'true' })).toEqual({ async: 'true' });
    expect(boosterAnalyseQuerySchema.parse({})).toEqual({});
    expect(notificationRule('referral.rewarded')).toMatchObject({ audience: 'client', channels: ['push'] });
    expect(notificationRule('referral.driver_rewarded')).toMatchObject({ audience: 'driver', channels: ['push'] });
  });
});
