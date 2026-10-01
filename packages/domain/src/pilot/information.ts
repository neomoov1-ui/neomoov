/**
 * Information sur la décision automatisée de Neomoov Pilote (Loi sur la protection des renseignements personnels dans le
 * secteur privé, article 12.1, en vigueur depuis la Loi 25) : ce que fait Pilote, les renseignements utilisés, les
 * principaux facteurs, les garde-fous, le droit de faire rectifier et de présenter ses observations à une personne qui
 * peut réviser la décision. Le chauffeur l'accepte, à sa version courante, avant d'activer Pilote. Toute modification du
 * texte change la version : le consentement est alors redemandé.
 */

export const PILOT_INFORMATION_VERSION = '2026-10-01';

export interface PilotInformation {
  version: string;
  title: string;
  paragraphs: string[];
}

const TEXT: Record<'fr' | 'en', { title: string; paragraphs: string[] }> = {
  fr: {
    title: 'Neomoov Pilote : décision automatisée',
    paragraphs: [
      'Quand Pilote est activé, il accepte pour vous, sans intervention humaine, les offres de course Neomoov qui respectent les critères que vous avez choisis. Pilote n\'agit que sur les courses Neomoov : il ne lit rien et ne fait rien sur une autre plateforme.',
      'Renseignements utilisés : le détail de l\'offre (tarif, distance et temps d\'approche, durée, heure, zones de départ et d\'arrivée, catégorie), la note moyenne du client, vos réservations déjà planifiées et vos critères.',
      'Principaux facteurs : chacun des critères que vous avez fixés. Chaque offre reçoit un score vert, jaune ou rouge avec ses raisons ; seule une offre verte est acceptée automatiquement. Pilote ne refuse jamais une offre à votre place.',
      'Une demande avec animal d\'assistance ou un besoin d\'accessibilité n\'est jamais écartée par vos critères : elle vous est présentée pour décision. Neomoov surveille les exclusions de zones pour prévenir toute discrimination indirecte.',
      'Chaque course acceptée pour vous s\'affiche aussitôt et peut être annulée sans frais, sans pénalité et sans effet sur votre dossier pendant {{graceSeconds}} secondes. Vous pouvez désactiver Pilote à tout moment.',
      'Vous pouvez demander les renseignements utilisés et les raisons d\'une décision, les faire rectifier, et présenter vos observations à une personne de l\'équipe Neomoov qui peut réviser la décision (Assistance, dans l\'application).',
    ],
  },
  en: {
    title: 'Neomoov Pilot: automated decision',
    paragraphs: [
      'When Pilot is on, it accepts on your behalf, with no human involvement, the Neomoov ride offers that meet the criteria you chose. Pilot only acts on Neomoov rides: it reads nothing and does nothing on any other platform.',
      'Information used: the offer details (fare, pickup distance and time, duration, time, pickup and drop-off zones, category), the client\'s average rating, your already scheduled bookings and your criteria.',
      'Main factors: each criterion you set. Every offer gets a green, yellow or red score with its reasons; only a green offer is accepted automatically. Pilot never declines an offer for you.',
      'A request with a service animal or an accessibility need is never ruled out by your criteria: it is shown to you to decide. Neomoov monitors zone exclusions to prevent indirect discrimination.',
      'Every ride accepted for you is shown right away and can be cancelled at no cost, with no penalty and no effect on your record, for {{graceSeconds}} seconds. You can turn Pilot off at any time.',
      'You can ask for the information used and the reasons for a decision, have it corrected, and submit your observations to a member of the Neomoov team who can review the decision (Support, in the app).',
    ],
  },
};

/** Texte d'information dans la langue demandée (français par défaut), avec le délai d'annulation sans frais en vigueur. */
export function pilotInformation(language: string | null | undefined, graceSeconds: number): PilotInformation {
  const text = language === 'en' ? TEXT.en : TEXT.fr;
  const seconds = String(Math.max(0, Math.round(graceSeconds)));
  return { version: PILOT_INFORMATION_VERSION, title: text.title, paragraphs: text.paragraphs.map((p) => p.replace('{{graceSeconds}}', seconds)) };
}
