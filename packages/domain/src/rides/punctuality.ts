/**
 * Garantie de ponctualité (D10) : pour une réservation, retard du chauffeur à la prise en charge par rapport à l'heure
 * prévue. Montants proposés au fondateur le 26 septembre 2026, en attente de validation (réglages `punctuality.*`,
 * garantie désactivée tant qu'il ne les a pas validés) : de 10 à 20 minutes, crédit de 5 $ ; de 20 à 30 minutes, crédit
 * de 10 $ ; au-delà de 30 minutes, la course est remboursée. Neomoov finance la garantie : le tarif du chauffeur reste.
 */

export interface PunctualityTier {
  /** Retard minimal, en minutes entières, à partir duquel le palier s'applique. */
  minMinutes: number;
  creditCents: number;
}

export interface PunctualityRules {
  tiers: PunctualityTier[];
  /** Au-delà de ce retard (minutes), la course est remboursée. */
  refundAfterMinutes: number;
}

export const DEFAULT_PUNCTUALITY_RULES: PunctualityRules = {
  tiers: [{ minMinutes: 10, creditCents: 500 }, { minMinutes: 20, creditCents: 1000 }],
  refundAfterMinutes: 30,
};

/** Réglage `punctuality.rules` ; une valeur invalide garde le défaut. */
export function parsePunctualityRules(raw: unknown): PunctualityRules {
  if (!raw || typeof raw !== 'object') return DEFAULT_PUNCTUALITY_RULES;
  const r = raw as { tiers?: unknown; refundAfterMinutes?: unknown };
  const positive = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
  if (!Array.isArray(r.tiers) || !positive(r.refundAfterMinutes)) return DEFAULT_PUNCTUALITY_RULES;
  const tiers = r.tiers.filter((t): t is PunctualityTier => Boolean(t) && typeof t === 'object' && positive((t as PunctualityTier).minMinutes) && positive((t as PunctualityTier).creditCents));
  if (tiers.length !== r.tiers.length || tiers.some((t) => t.minMinutes > (r.refundAfterMinutes as number))) return DEFAULT_PUNCTUALITY_RULES;
  return { tiers: [...tiers].sort((a, b) => a.minMinutes - b.minMinutes), refundAfterMinutes: r.refundAfterMinutes };
}

export type PunctualityCompensation =
  | { kind: 'none'; minutesLate: number }
  | { kind: 'credit' | 'refund'; minutesLate: number; amountCents: number };

/** Compensation due au client pour ce retard ; `rideTotalCents` : ce que la course lui coûte (remboursée au-delà du dernier palier). */
export function punctualityCompensation(scheduledAt: Date, arrivedAt: Date, rideTotalCents: number, rules: PunctualityRules): PunctualityCompensation {
  const minutesLate = Math.max(0, Math.floor((arrivedAt.getTime() - scheduledAt.getTime()) / 60_000));
  if (minutesLate > rules.refundAfterMinutes) return { kind: 'refund', minutesLate, amountCents: Math.max(0, rideTotalCents) };
  let tier: PunctualityTier | null = null;
  for (const t of rules.tiers) if (minutesLate >= t.minMinutes) tier = t;
  return tier ? { kind: 'credit', minutesLate, amountCents: tier.creditCents } : { kind: 'none', minutesLate };
}
