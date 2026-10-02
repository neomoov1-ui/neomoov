/**
 * Commentaires reçus sur les publications : classement déterministe (sans appel au modèle) des commentaires simples
 * auxquels l'agent de diffusion répond lui-même (remerciement, horaires, lien de réservation) ; tout le reste (question
 * de fond, plainte, ton négatif) part vers la relation client ou vers un humain.
 */
export const COMMENT_INTENTS = ['thanks', 'hours', 'booking', 'other'] as const;
export type CommentIntent = (typeof COMMENT_INTENTS)[number];

export interface CommentClassification {
  intent: CommentIntent;
  language: 'fr' | 'en';
  /** Plainte, insulte, mécontentement : jamais de réponse automatique. */
  negative: boolean;
  /** Réponse automatique possible : intention simple et ton neutre ou positif. */
  simple: boolean;
}

const ENGLISH = /\b(the|you|your|thanks|thank|hours|open|book|booking|price|how|when|where|great|love|is|are|can|do|ever|never|worst|best|my|we|it|this|that|with|for|and|to|of)\b/gi;
const FRENCH = /\b(le|la|les|vous|votre|merci|heures|ouvert|réserver|reservation|réservation|prix|comment|quand|où|bravo|super|est|sont|peut|je|nous|et|pour|avec|mon|ma|mes|ce|cette|de|des|du|un|une|pas|ne|que|qui|c'est)\b/gi;
const NEGATIVE = /\b(nul|nuls|arnaque|honte|honteux|scandale|inacceptable|d[ée]gueulasse|voleurs?|menteurs?|plainte|rembours\w*|refund|scam|worst|terrible|awful|horrible|disgusting|liars?|thieves|fraud|dangerous|dangereux|jamais plus|never again|pire)\b/i;
const THANKS = /\b(merci|bravo|super|g[ée]nial|excellent|magnifique|f[ée]licitations|j'adore|thank|thanks|great|awesome|love|congrats|congratulations|amazing|nice)\b/i;
const HOURS = /\b(heures?|horaires?|ouvert|ouverts|ouverture|disponible|disponibles|24\s?h|24\/7|nuit|hours?|open|opening|available|availability|night|schedule)\b/i;
const BOOKING = /\b(r[ée]serv\w*|commander|commande|rendez-vous|prix|tarif|co[uû]te|combien|book\w*|reserve|price|cost|how much|rate|fare|quote|devis|aéroport|airport)\b/i;

function count(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

export function classifyComment(text: string): CommentClassification {
  const language: 'fr' | 'en' = count(text, ENGLISH) > count(text, FRENCH) ? 'en' : 'fr';
  const negative = NEGATIVE.test(text);
  const intent: CommentIntent = BOOKING.test(text) ? 'booking' : HOURS.test(text) ? 'hours' : THANKS.test(text) ? 'thanks' : 'other';
  return { intent, language, negative, simple: !negative && intent !== 'other' };
}

export interface ReplyTexts {
  /** Texte des horaires et du préavis, par langue (réglage `marketing.service_hours`). */
  hours: { fr: string; en: string };
  bookingUrl: string;
}

/** Réponse automatique d'un commentaire simple ; null si l'intention n'est pas simple ou si le ton est négatif. */
export function simpleReply(classification: CommentClassification, texts: ReplyTexts): string | null {
  if (!classification.simple) return null;
  const fr = classification.language === 'fr';
  switch (classification.intent) {
    case 'thanks':
      return fr ? 'Merci beaucoup ! Au plaisir de vous accueillir à bord.' : 'Thank you very much! We look forward to welcoming you on board.';
    case 'hours':
      return fr ? texts.hours.fr : texts.hours.en;
    case 'booking':
      return fr ? `Vous pouvez réserver en ligne, prix tout compris affiché avant de confirmer : ${texts.bookingUrl}` : `You can book online, with the all-inclusive price shown before you confirm: ${texts.bookingUrl}`;
    default:
      return null;
  }
}
