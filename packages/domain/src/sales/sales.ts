/**
 * Direction commerciale automatisée (phase 1 « Neomoov entreprise autonome », 2 octobre 2026) : règles pures de la
 * prospection B2B, des appels sortants, des relances et des devis entreprise. Aucune dépendance d'infrastructure ; l'API
 * applique ces règles et garde les chiffres (plafonds, délais, grille) dans les réglages.
 */
import type { BusinessHours } from '../drivers/fairness.js';

export const PROSPECT_STAGES = ['new', 'qualified', 'contacted', 'replied', 'meeting', 'quote', 'won', 'lost', 'do_not_contact'] as const;
export type ProspectStage = (typeof PROSPECT_STAGES)[number];

export const PROSPECT_SEGMENTS = ['hotel', 'business', 'agency', 'event', 'clinic', 'school', 'other'] as const;
export type ProspectSegment = (typeof PROSPECT_SEGMENTS)[number];

export const PROSPECT_SIZES = ['small', 'medium', 'large', 'unknown'] as const;
export type ProspectSize = (typeof PROSPECT_SIZES)[number];

export const PROSPECT_INTERESTS = ['low', 'medium', 'high', 'unknown'] as const;
export type ProspectInterest = (typeof PROSPECT_INTERESTS)[number];

export const PROSPECT_SOURCES = ['google_places', 'csv_import', 'web_lead', 'manual'] as const;
export type ProspectSource = (typeof PROSPECT_SOURCES)[number];

/**
 * Base légale du démarchage (Loi anti-pourriel, Loi 25) : adresse professionnelle publiée sans mention de refus
 * (consentement tacite), consentement exprès par formulaire, relation d'affaires existante, recommandation, ou aucune
 * (prospect connu mais jamais démarché par courriel ni WhatsApp).
 */
export const CONSENT_BASES = ['published_address', 'form', 'existing_relationship', 'referral', 'none'] as const;
export type ConsentBasis = (typeof CONSENT_BASES)[number];

export const TOUCH_CHANNELS = ['email', 'whatsapp', 'sms', 'call', 'meeting', 'note'] as const;
export type TouchChannel = (typeof TOUCH_CHANNELS)[number];
export const TOUCH_DIRECTIONS = ['outbound', 'inbound'] as const;
export type TouchDirection = (typeof TOUCH_DIRECTIONS)[number];

export const FOLLOWUP_TARGETS = ['prospect', 'quote', 'driver_candidate', 'web_booking'] as const;
export type FollowupTarget = (typeof FOLLOWUP_TARGETS)[number];
export const FOLLOWUP_STATUSES = ['scheduled', 'sent', 'replied', 'closed', 'cancelled'] as const;
export type FollowupStatus = (typeof FOLLOWUP_STATUSES)[number];
export const FOLLOWUP_CHANNELS = ['email', 'whatsapp', 'sms', 'push'] as const;
export type FollowupChannel = (typeof FOLLOWUP_CHANNELS)[number];

export const OUTBOUND_CALL_STATUSES = ['scheduled', 'calling', 'completed', 'failed', 'cancelled'] as const;
export type OutboundCallStatus = (typeof OUTBOUND_CALL_STATUSES)[number];
export const OUTBOUND_CALL_RESULTS = ['meeting', 'callback', 'not_interested', 'voicemail', 'no_answer', 'do_not_contact', 'failed'] as const;
export type OutboundCallResult = (typeof OUTBOUND_CALL_RESULTS)[number];

/** Étapes closes : plus aucun envoi ni appel sans décision humaine. */
export const CLOSED_STAGES: readonly ProspectStage[] = ['won', 'lost', 'do_not_contact'];

export interface ContactableInput {
  stage: ProspectStage;
  /** Retrait demandé (réponse STOP, demande au téléphone) : définitif. */
  unsubscribedAt: Date | null;
  /** Date du passage en « perdu » : aucune nouvelle relance avant le délai de repos. */
  lostAt: Date | null;
}

/**
 * Un prospect peut être démarché : jamais après un retrait ni en « ne plus contacter », jamais un compte gagné, et un
 * prospect perdu seulement après `lostCooldownDays` jours (6 mois par défaut dans les réglages).
 */
export function canContact(input: ContactableInput, now: Date, lostCooldownDays: number): boolean {
  if (input.unsubscribedAt || input.stage === 'do_not_contact' || input.stage === 'won') return false;
  if (input.stage === 'lost') return input.lostAt !== null && now.getTime() - input.lostAt.getTime() >= lostCooldownDays * 86_400_000;
  return true;
}

/** Domaines de messageries grand public : une adresse chez eux désigne une personne, jamais une organisation. */
export const FREE_MAIL_DOMAINS: readonly string[] = [
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.ca', 'hotmail.fr', 'outlook.com', 'outlook.fr', 'live.com', 'live.ca', 'live.fr', 'msn.com',
  'yahoo.com', 'yahoo.ca', 'yahoo.fr', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'protonmail.com', 'proton.me', 'videotron.ca', 'sympatico.ca',
  'bell.net', 'cogeco.ca', 'gmx.com', 'gmx.fr', 'laposte.net', 'orange.fr', 'free.fr', 'wanadoo.fr', 'sfr.fr', 'yandex.com', 'mail.com',
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Domaine d'une adresse (minuscules), ou null si l'adresse est mal formée. */
export function emailDomain(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  return EMAIL.test(trimmed) ? trimmed.slice(trimmed.indexOf('@') + 1) : null;
}

/** Adresse professionnelle : bien formée et hors des messageries grand public (prospection B2B seulement). */
export function isBusinessEmail(email: string): boolean {
  const domain = emailDomain(email);
  return domain !== null && !FREE_MAIL_DOMAINS.includes(domain);
}

export interface ProspectScoreInput {
  segment: ProspectSegment;
  hasEmail: boolean;
  hasPhone: boolean;
  hasWebsite: boolean;
  /** Note publique (Google) et nombre d'avis, s'ils sont connus. */
  rating: number | null;
  reviewCount: number | null;
  interest: ProspectInterest;
  size: ProspectSize;
}

const SEGMENT_BASE: Record<ProspectSegment, number> = { hotel: 30, business: 25, agency: 25, event: 20, clinic: 15, school: 10, other: 5 };
const INTEREST_BONUS: Record<ProspectInterest, number> = { high: 20, medium: 10, low: 0, unknown: 5 };
const SIZE_BONUS: Record<ProspectSize, number> = { large: 10, medium: 5, small: 0, unknown: 2 };

/** Score de 0 à 100 : segment, canaux joignables, réputation publique, intérêt et taille estimés par le modèle. */
export function prospectScore(input: ProspectScoreInput): number {
  let score = SEGMENT_BASE[input.segment];
  if (input.hasEmail) score += 15;
  if (input.hasPhone) score += 10;
  if (input.hasWebsite) score += 5;
  if (input.rating !== null && input.rating >= 4) score += 10;
  if (input.reviewCount !== null && input.reviewCount >= 50) score += 5;
  score += INTEREST_BONUS[input.interest] + SIZE_BONUS[input.size];
  return Math.max(0, Math.min(100, score));
}

/**
 * Échéance de la relance numéro `attempt` (0 pour la première) après le premier contact : J+3, J+10, J+30 par défaut
 * (réglage `sales.followup_days`) ; null quand les relances sont épuisées (clôture).
 */
export function followupDueAt(firstContactAt: Date, followupDays: readonly number[], attempt: number): Date | null {
  const days = followupDays[attempt];
  return days === undefined ? null : new Date(firstContactAt.getTime() + days * 86_400_000);
}

/**
 * Heures de bureau des appels (réglage `sales.call_hours`, même forme que `fairness.business_hours` : `days`, `from`, `to`) :
 * lues par `parseBusinessHours` de la Charte d'équité (`BusinessHours` : jours, minute de début incluse, minute de fin exclue).
 */

/** Jour de la semaine et minutes écoulées dans la journée, à l'heure locale du fuseau. */
export function localDayMinutes(instant: Date, timeZone: string): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const get = (t: string): string => parts.find((p) => p.type === t)!.value;
  return { weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')), minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

/** L'instant tombe dans les heures de bureau (jour ouvrable, minute de début incluse, minute de fin exclue, heure locale). */
export function withinBusinessHours(instant: Date, timeZone: string, hours: BusinessHours): boolean {
  const { weekday, minutes } = localDayMinutes(instant, timeZone);
  return hours.days.includes(weekday) && minutes >= hours.startMinute && minutes < hours.endMinute;
}

/**
 * Prochain instant d'appel admissible : `instant` lui-même pendant les heures de bureau, sinon l'ouverture suivante
 * (même jour si l'heure n'est pas encore passée, sinon le prochain jour ouvrable), à la minute près.
 */
export function nextBusinessSlot(instant: Date, timeZone: string, hours: BusinessHours): Date {
  if (withinBusinessHours(instant, timeZone, hours)) return instant;
  // Avance minute par minute vers le début d'une journée ouvrable (au plus 8 jours : il y a toujours un jour admissible).
  let candidate = new Date(Math.ceil(instant.getTime() / 60_000) * 60_000);
  for (let i = 0; i < 8 * 24 * 60; i += 1) {
    const { weekday, minutes } = localDayMinutes(candidate, timeZone);
    if (hours.days.includes(weekday) && minutes === hours.startMinute) return candidate;
    candidate = new Date(candidate.getTime() + 60_000);
  }
  return candidate;
}

export interface BusinessGridTier {
  /** Volume mensuel de courses à partir duquel la remise s'applique. */
  minMonthlyRides: number;
  /** Remise sur le prix affiché, en points de base (500 = 5 %). */
  discountBps: number;
}

export interface BusinessGrid {
  tiers: BusinessGridTier[];
  /** Au-delà : tarif négocié, approbation humaine. */
  maxDiscountBps: number;
  /** Délai de paiement d'une facture mensuelle (jours) et délai maximal admis sans approbation. */
  paymentTermsDays: number;
  maxPaymentTermsDays: number;
  /** Validité d'un devis (jours). */
  validityDays: number;
  /** Volume mensuel minimal pour un compte entreprise. */
  minMonthlyRides: number;
}

/** Grille entreprise par défaut (à valider par le fondateur ; réglage `sales.business_grid`, jamais en dur ailleurs). */
export const DEFAULT_BUSINESS_GRID: BusinessGrid = {
  tiers: [{ minMonthlyRides: 1, discountBps: 0 }, { minMonthlyRides: 20, discountBps: 500 }, { minMonthlyRides: 50, discountBps: 1000 }],
  maxDiscountBps: 1000,
  paymentTermsDays: 30,
  maxPaymentTermsDays: 30,
  validityDays: 30,
  minMonthlyRides: 1,
};

/** Réglage `sales.business_grid` validé : tout champ absent ou invalide reprend la valeur par défaut. */
export function parseBusinessGrid(raw: unknown, fallback: BusinessGrid = DEFAULT_BUSINESS_GRID): BusinessGrid {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof BusinessGrid, unknown>>;
  const int = (value: unknown, def: number): number => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : def);
  const tiers = Array.isArray(r.tiers)
    ? r.tiers
      .filter((t): t is BusinessGridTier => Boolean(t) && typeof t === 'object' && Number.isInteger((t as BusinessGridTier).minMonthlyRides) && Number.isInteger((t as BusinessGridTier).discountBps))
      .map((t) => ({ minMonthlyRides: Math.max(0, t.minMonthlyRides), discountBps: Math.max(0, t.discountBps) }))
      .sort((a, b) => a.minMonthlyRides - b.minMonthlyRides)
    : [];
  return {
    tiers: tiers.length ? tiers : fallback.tiers,
    maxDiscountBps: int(r.maxDiscountBps, fallback.maxDiscountBps),
    paymentTermsDays: int(r.paymentTermsDays, fallback.paymentTermsDays),
    maxPaymentTermsDays: int(r.maxPaymentTermsDays, fallback.maxPaymentTermsDays),
    validityDays: Math.max(1, int(r.validityDays, fallback.validityDays)),
    minMonthlyRides: int(r.minMonthlyRides, fallback.minMonthlyRides),
  };
}

export interface BusinessQuoteRequest {
  expectedMonthlyRides: number;
  /** Remise demandée par le prospect (points de base), s'il en a demandé une. */
  requestedDiscountBps?: number | null;
  /** Délai de paiement demandé (jours), s'il en a demandé un. */
  paymentTermsDays?: number | null;
}

export interface BusinessQuoteDecision {
  /** Dans la grille : l'outil exécute (selon le mode de l'agent) ; hors grille : approbation humaine obligatoire. */
  inGrid: boolean;
  discountBps: number;
  paymentTermsDays: number;
  validityDays: number;
  /** Motifs de sortie de grille, vides quand le devis est dans la grille. */
  reasons: string[];
}

/**
 * Devis entreprise à partir de la grille : remise du palier atteint par le volume mensuel ; une remise demandée au-delà
 * du palier, au-delà du plafond, un délai de paiement au-delà du maximum ou un volume sous le minimum sortent de la
 * grille (le devis proposé garde alors les valeurs demandées, pour l'approbation).
 */
export function businessQuoteFromGrid(grid: BusinessGrid, request: BusinessQuoteRequest): BusinessQuoteDecision {
  const reasons: string[] = [];
  const tier = [...grid.tiers].reverse().find((t) => request.expectedMonthlyRides >= t.minMonthlyRides) ?? null;
  let discountBps = tier?.discountBps ?? 0;
  if (request.expectedMonthlyRides < grid.minMonthlyRides) reasons.push(`Volume mensuel ${request.expectedMonthlyRides} sous le minimum de ${grid.minMonthlyRides}`);
  const requested = request.requestedDiscountBps ?? null;
  if (requested !== null && requested > discountBps) {
    reasons.push(requested > grid.maxDiscountBps ? `Remise demandée ${requested} points de base au-delà du plafond ${grid.maxDiscountBps}` : `Remise demandée ${requested} points de base au-delà du palier ${discountBps}`);
    discountBps = requested;
  }
  let paymentTermsDays = grid.paymentTermsDays;
  if (request.paymentTermsDays !== null && request.paymentTermsDays !== undefined && request.paymentTermsDays > grid.maxPaymentTermsDays) {
    reasons.push(`Délai de paiement demandé ${request.paymentTermsDays} jours au-delà de ${grid.maxPaymentTermsDays}`);
    paymentTermsDays = request.paymentTermsDays;
  }
  return { inGrid: reasons.length === 0, discountBps, paymentTermsDays, validityDays: grid.validityDays, reasons };
}

/** Étape du prospect après un appel ; null quand le résultat ne change rien (messagerie, sans réponse, échec). */
export function stageAfterCall(result: OutboundCallResult): ProspectStage | null {
  switch (result) {
    case 'meeting':
      return 'meeting';
    case 'callback':
      return 'contacted';
    case 'not_interested':
      return 'lost';
    case 'do_not_contact':
      return 'do_not_contact';
    default:
      return null;
  }
}

/** Résultat déduit de la raison de fin d'appel de Vapi quand l'assistant n'a rien structuré ; null : à classer. */
export function callResultFromEndedReason(endedReason: string | null | undefined): OutboundCallResult | null {
  const reason = (endedReason ?? '').toLowerCase();
  if (!reason) return null;
  if (reason.includes('voicemail')) return 'voicemail';
  if (reason.includes('did-not-answer') || reason.includes('no-answer') || reason.includes('busy') || reason.includes('customer-did-not-give-microphone-permission')) return 'no_answer';
  if (reason.includes('error') || reason.includes('failed') || reason.includes('twilio')) return 'failed';
  return null;
}

/** Étape de la transaction HubSpot (parcours « Ventes B2B ») qui correspond à l'étape d'un prospect. */
export function dealStageForProspect(stage: ProspectStage): 'new' | 'contacted' | 'proposal' | 'active' | 'lost' {
  switch (stage) {
    case 'new':
    case 'qualified':
      return 'new';
    case 'contacted':
    case 'replied':
    case 'meeting':
      return 'contacted';
    case 'quote':
      return 'proposal';
    case 'won':
      return 'active';
    default:
      return 'lost';
  }
}
