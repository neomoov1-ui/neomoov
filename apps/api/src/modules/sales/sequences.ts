/**
 * Séquences approuvées de la prospection B2B (docs/sales/sequences.md, phase 1 « entreprise autonome ») : un message
 * d'introduction, puis trois relances aux échéances du réglage `sales.followup_days`, par le canal d'origine (courriel
 * professionnel, ou WhatsApp sur un numéro d'affaires). Les textes sont ceux du document ; le modèle personnalise une
 * relance sans en changer les promesses (prix fixe connu d'avance, véhicules électriques, chauffeurs vérifiés, aucune
 * promesse de revenu, aucun prix non décidé). Chaque envoi porte la mention de retrait (gabarit `sales.message`).
 */
import type { ProspectSegment } from '@neomoov/domain';

export interface SequenceText {
  subject: string;
  text: string;
}

export interface SequenceDefinition {
  key: string;
  name: string;
  intro: Record<'fr' | 'en', SequenceText>;
  /** Base de chaque relance, dans l'ordre des échéances (J+3, J+10, J+30). */
  followups: Array<Record<'fr' | 'en', SequenceText>>;
}

const SIGNATURE = { fr: '\n\nCordialement,\n{{senderName}}\nNeomoov, Montréal', en: '\n\nBest regards,\n{{senderName}}\nNeomoov, Montreal' };

export const SEQUENCES: Record<string, SequenceDefinition> = {
  b2b_standard: {
    key: 'b2b_standard',
    name: 'Entreprises : compte entreprise et prix fixe',
    intro: {
      fr: {
        subject: 'Déplacements professionnels à prix fixe pour {{organizationName}}',
        text: `Bonjour{{contactGreeting}},\n\nNeomoov est un service de voitures avec chauffeur à Montréal : prix fixe et tout compris connu avant la course, véhicules électriques, chauffeurs professionnels vérifiés, réservation à l'avance (au moins 2 heures) depuis l'application, le web ou par téléphone.\n\nPour une organisation comme {{organizationName}}, nous ouvrons un compte entreprise : facturation mensuelle unique, centres de coûts, suivi des déplacements de vos équipes et de vos invités.\n\nSi vous le souhaitez, je vous propose un court appel de 15 minutes pour voir si cela correspond à vos besoins. Répondez simplement à ce courriel avec un créneau qui vous convient.${SIGNATURE.fr}`,
      },
      en: {
        subject: 'Fixed-price business rides for {{organizationName}}',
        text: `Hello{{contactGreeting}},\n\nNeomoov is a chauffeured car service in Montreal: an all-inclusive fixed price known before the ride, electric vehicles, vetted professional drivers, bookings made in advance (at least 2 hours) from the app, the web or by phone.\n\nFor an organization like {{organizationName}}, we open a business account: one monthly invoice, cost centres, and visibility on your teams' and guests' trips.\n\nIf useful, I can suggest a short 15-minute call to see whether this fits your needs. Simply reply to this email with a time that works for you.${SIGNATURE.en}`,
      },
    },
    followups: [
      {
        fr: { subject: 'Re : déplacements professionnels à prix fixe pour {{organizationName}}', text: `Bonjour{{contactGreeting}},\n\nJe me permets de revenir vers vous au sujet des déplacements de {{organizationName}}. En résumé : un prix fixe connu avant chaque course, des véhicules électriques et des chauffeurs vérifiés, une seule facture par mois.\n\nUn appel de 15 minutes suffit pour voir si un compte entreprise vous serait utile. Quel créneau vous conviendrait cette semaine ?${SIGNATURE.fr}` },
        en: { subject: 'Re: fixed-price business rides for {{organizationName}}', text: `Hello{{contactGreeting}},\n\nI am following up about {{organizationName}}'s travel needs. In short: a fixed price known before every ride, electric vehicles and vetted drivers, a single monthly invoice.\n\nA 15-minute call is enough to see whether a business account would help you. What time would suit you this week?${SIGNATURE.en}` },
      },
      {
        fr: { subject: 'Comment nos clients entreprises utilisent Neomoov', text: `Bonjour{{contactGreeting}},\n\nNos clients entreprises utilisent surtout Neomoov pour trois choses : les transferts vers l'aéroport, les déplacements d'invités et de clients, et les trajets des équipes en soirée. Dans les trois cas, le prix est fixé avant le départ et la facture est mensuelle.\n\nSi l'un de ces usages ressemble à ceux de {{organizationName}}, je vous envoie volontiers une proposition adaptée à votre volume.${SIGNATURE.fr}` },
        en: { subject: 'How our business clients use Neomoov', text: `Hello{{contactGreeting}},\n\nOur business clients mostly use Neomoov for three things: airport transfers, trips for guests and clients, and evening rides for their teams. In all three cases the price is set before departure and the invoice is monthly.\n\nIf one of these looks like {{organizationName}}'s needs, I would be glad to send a proposal adapted to your volume.${SIGNATURE.en}` },
      },
      {
        fr: { subject: 'Dernier message au sujet de {{organizationName}}', text: `Bonjour{{contactGreeting}},\n\nJe ne veux pas encombrer votre boîte : ce message est le dernier de ma part. Si les déplacements de {{organizationName}} deviennent un sujet plus tard, un simple courriel suffit et nous reprendrons la conversation.\n\nMerci pour votre attention.${SIGNATURE.fr}` },
        en: { subject: 'Last message about {{organizationName}}', text: `Hello{{contactGreeting}},\n\nI do not want to crowd your inbox: this is my last message. If {{organizationName}}'s travel needs become a topic later, a simple email is enough and we will pick up the conversation.\n\nThank you for your attention.${SIGNATURE.en}` },
      },
    ],
  },
  b2b_hotel: {
    key: 'b2b_hotel',
    name: 'Hôtels et agences : transferts aéroport et conciergerie',
    intro: {
      fr: {
        subject: 'Transferts aéroport à prix fixe pour les clients de {{organizationName}}',
        text: `Bonjour{{contactGreeting}},\n\nNeomoov propose aux hôtels et aux agences de Montréal un service de voitures avec chauffeur pour leurs clients : transferts aéroport et courses en ville à prix fixe, connu avant la réservation, en véhicule électrique, avec des chauffeurs professionnels vérifiés.\n\nPour {{organizationName}}, cela signifie une réservation en quelques secondes par votre conciergerie (application, web ou téléphone), un reçu clair pour le client, et aucune surprise de prix.\n\nPuis-je vous appeler 15 minutes pour vous présenter le fonctionnement et le programme réservé aux établissements ?${SIGNATURE.fr}`,
      },
      en: {
        subject: 'Fixed-price airport transfers for {{organizationName}}\'s guests',
        text: `Hello{{contactGreeting}},\n\nNeomoov offers Montreal hotels and agencies a chauffeured car service for their guests: airport transfers and city rides at a fixed price known before booking, in electric vehicles, with vetted professional drivers.\n\nFor {{organizationName}}, that means a booking in seconds by your concierge (app, web or phone), a clear receipt for the guest, and no price surprises.\n\nMay I call you for 15 minutes to walk you through the service and the programme for establishments?${SIGNATURE.en}`,
      },
    },
    followups: [
      {
        fr: { subject: 'Re : transferts aéroport pour les clients de {{organizationName}}', text: `Bonjour{{contactGreeting}},\n\nUn mot pour revenir sur ma proposition : des transferts aéroport et des courses à prix fixe pour les clients de {{organizationName}}, réservés par votre équipe en quelques secondes.\n\nSi vous préférez, je peux passer quelques minutes à la réception pour une démonstration. Quel moment vous conviendrait ?${SIGNATURE.fr}` },
        en: { subject: 'Re: airport transfers for {{organizationName}}\'s guests', text: `Hello{{contactGreeting}},\n\nA quick note to follow up on my proposal: fixed-price airport transfers and rides for {{organizationName}}'s guests, booked by your team in seconds.\n\nIf you prefer, I can stop by the front desk for a short demonstration. What time would suit you?${SIGNATURE.en}` },
      },
      {
        fr: { subject: 'Ce que votre conciergerie y gagne', text: `Bonjour{{contactGreeting}},\n\nTrois choses que les conciergeries apprécient avec Neomoov : le prix annoncé au client avant la course, le suivi du chauffeur en temps réel, et un reçu envoyé automatiquement. Aucune carte de l'établissement n'est engagée : le client paie sa course.\n\nJe reste à votre disposition pour en parler quand vous le souhaitez.${SIGNATURE.fr}` },
        en: { subject: 'What your concierge team gains', text: `Hello{{contactGreeting}},\n\nThree things concierge teams appreciate with Neomoov: the price announced to the guest before the ride, real-time tracking of the driver, and a receipt sent automatically. No card of the establishment is involved: the guest pays for the ride.\n\nI remain available to discuss it whenever you wish.${SIGNATURE.en}` },
      },
      {
        fr: { subject: 'Dernier message au sujet de {{organizationName}}', text: `Bonjour{{contactGreeting}},\n\nCe message est le dernier de ma part. Si vos clients ont un jour besoin d'un service de voitures avec chauffeur à prix fixe, un courriel suffit et nous reprendrons la conversation.\n\nMerci pour votre attention.${SIGNATURE.fr}` },
        en: { subject: 'Last message about {{organizationName}}', text: `Hello{{contactGreeting}},\n\nThis is my last message. If your guests ever need a fixed-price chauffeured car service, an email is enough and we will pick up the conversation.\n\nThank you for your attention.${SIGNATURE.en}` },
      },
    ],
  },
  b2b_event: {
    key: 'b2b_event',
    name: 'Événements : déplacements des invités et des équipes',
    intro: {
      fr: {
        subject: 'Déplacements des invités de vos événements, à prix fixe',
        text: `Bonjour{{contactGreeting}},\n\nPour les événements de {{organizationName}}, Neomoov assure les déplacements des invités, des conférenciers et des équipes : courses réservées à l'avance, prix fixe connu avant le départ, véhicules électriques et chauffeurs professionnels vérifiés, suivi en temps réel.\n\nUn compte entreprise permet de réserver pour un tiers, de regrouper les courses d'un même événement et de recevoir une seule facture.\n\nJe vous propose un appel de 15 minutes pour préparer votre prochain événement. Quel créneau vous conviendrait ?${SIGNATURE.fr}`,
      },
      en: {
        subject: 'Fixed-price rides for your event guests',
        text: `Hello{{contactGreeting}},\n\nFor {{organizationName}}'s events, Neomoov handles rides for guests, speakers and teams: booked in advance, a fixed price known before departure, electric vehicles and vetted professional drivers, real-time tracking.\n\nA business account lets you book for someone else, group the rides of one event and receive a single invoice.\n\nI suggest a 15-minute call to prepare your next event. What time would suit you?${SIGNATURE.en}`,
      },
    },
    followups: [
      {
        fr: { subject: 'Re : déplacements des invités de vos événements', text: `Bonjour{{contactGreeting}},\n\nJe reviens vers vous au sujet des déplacements lors des événements de {{organizationName}}. Si une date approche, nous pouvons préparer les courses des invités dès maintenant, au prix fixe annoncé.\n\nQuel moment vous conviendrait pour un court appel ?${SIGNATURE.fr}` },
        en: { subject: 'Re: rides for your event guests', text: `Hello{{contactGreeting}},\n\nI am following up about rides during {{organizationName}}'s events. If a date is coming up, we can prepare the guests' rides now, at the announced fixed price.\n\nWhat time would suit you for a short call?${SIGNATURE.en}` },
      },
      {
        fr: { subject: 'Comment nous préparons un événement', text: `Bonjour{{contactGreeting}},\n\nPour un événement, nous travaillons à partir de votre liste d'invités et de l'horaire : chaque course est réservée à l'avance, confirmée par texto à l'invité, suivie en temps réel par votre équipe, et facturée en une fois.\n\nSi cela peut aider {{organizationName}}, je vous envoie volontiers une proposition.${SIGNATURE.fr}` },
        en: { subject: 'How we prepare an event', text: `Hello{{contactGreeting}},\n\nFor an event, we work from your guest list and schedule: every ride is booked in advance, confirmed to the guest by text message, tracked in real time by your team, and invoiced once.\n\nIf this can help {{organizationName}}, I would be glad to send a proposal.${SIGNATURE.en}` },
      },
      {
        fr: { subject: 'Dernier message au sujet de {{organizationName}}', text: `Bonjour{{contactGreeting}},\n\nCe message est le dernier de ma part. Pour un prochain événement, un courriel suffit et nous reprendrons la conversation.\n\nMerci pour votre attention.${SIGNATURE.fr}` },
        en: { subject: 'Last message about {{organizationName}}', text: `Hello{{contactGreeting}},\n\nThis is my last message. For a future event, an email is enough and we will pick up the conversation.\n\nThank you for your attention.${SIGNATURE.en}` },
      },
    ],
  },
};

export const DEFAULT_SEQUENCE_KEY = 'b2b_standard';
/** Correspondance segment → séquence par défaut (réglage `sales.sequence_by_segment`). */
export const DEFAULT_SEQUENCE_BY_SEGMENT: Partial<Record<ProspectSegment, string>> = { hotel: 'b2b_hotel', agency: 'b2b_hotel', event: 'b2b_event' };

export function sequenceFor(segment: ProspectSegment, mapping: unknown, wanted?: string | null): SequenceDefinition {
  if (wanted && SEQUENCES[wanted]) return SEQUENCES[wanted]!;
  const map = (mapping && typeof mapping === 'object' ? mapping : DEFAULT_SEQUENCE_BY_SEGMENT) as Record<string, unknown>;
  const key = map[segment];
  return (typeof key === 'string' && SEQUENCES[key]) || SEQUENCES[DEFAULT_SEQUENCE_KEY]!;
}

export interface SequenceVars {
  organizationName: string;
  contactName: string | null;
  senderName: string;
}

/** Remplit un gabarit : `{{organizationName}}`, `{{contactGreeting}}` (« Madame, Monsieur » sans contact nommé), `{{senderName}}`. */
export function renderSequenceText(template: SequenceText, language: 'fr' | 'en', vars: SequenceVars): SequenceText {
  const greeting = vars.contactName ? ` ${vars.contactName}` : language === 'en' ? '' : ' Madame, Monsieur';
  const fill = (value: string) => value.replaceAll('{{organizationName}}', vars.organizationName).replaceAll('{{contactGreeting}}', greeting).replaceAll('{{senderName}}', vars.senderName);
  return { subject: fill(template.subject), text: fill(template.text) };
}
