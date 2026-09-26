/**
 * Schémas de l'étape 8 (prompt 08, sections 5.9 et 5.10) côté client : validation d'un code promo, crédits,
 * parrainage, chauffeurs favoris. Les montants viennent des données (promotions, réglages), jamais du code.
 */
import { z } from 'zod';
import { PROMOTION_REFUSALS } from '../promotions/promotions.js';
import { cents, isoDate, uuid } from './common.js';

/** `POST /v1/promotions/validate` : le code est vérifié contre le devis indiqué (ou seulement ses conditions générales). */
export const promotionValidateSchema = z.object({
  code: z.string().trim().toUpperCase().min(2).max(30),
  quoteId: uuid.optional(),
});
export type PromotionValidateInput = z.input<typeof promotionValidateSchema>;

export const promotionValidationSchema = z.object({
  code: z.string(),
  valid: z.boolean(),
  /** Motif du refus, stable (traduit par l'application). */
  reason: z.enum([...PROMOTION_REFUSALS, 'unknown_code']).nullable(),
  name: z.string().nullable(),
  /** Remise sur le devis indiqué, en cents (nulle sans devis). */
  discountCents: cents.nullable(),
});
export type PromotionValidation = z.infer<typeof promotionValidationSchema>;

export const creditViewSchema = z.object({
  id: uuid,
  origin: z.enum(['referral', 'promotion', 'goodwill', 'guarantee', 'refund']),
  amountCents: cents,
  remainingCents: cents,
  reference: z.string().nullable(),
  expiresAt: isoDate.nullable(),
  createdAt: isoDate,
});
export const creditsSchema = z.object({ availableCents: cents, credits: z.array(creditViewSchema) });
export type CreditsView = z.infer<typeof creditsSchema>;

export const referralSchema = z.object({
  code: z.string(),
  /** Lien de partage (page web avec le code prérempli). */
  link: z.string().url(),
  kind: z.enum(['client', 'driver']),
  /** Montants versés au parrain et au filleul (réglages), en cents. */
  referrerRewardCents: cents,
  referredRewardCents: cents,
  /** Courses terminées du filleul qui déclenchent la récompense. */
  thresholdRides: z.number().int().min(1),
  stats: z.object({ invited: z.number().int().min(0), completed: z.number().int().min(0), earnedCents: cents }),
  /** Parrain de ce compte, s'il en a un. */
  referredBy: z.object({ code: z.string(), status: z.enum(['pending', 'completed', 'expired']) }).nullable(),
});
export type ReferralView = z.infer<typeof referralSchema>;
export const referralApplySchema = z.object({ code: z.string().trim().toUpperCase().min(4).max(12) });

export const favoriteSchema = z.object({
  driverId: uuid,
  firstName: z.string().nullable(),
  rating: z.number().min(0).max(5),
  ridesTogether: z.number().int().min(0),
  vehicle: z.object({ make: z.string(), model: z.string(), colour: z.string(), category: z.string() }).nullable(),
  /** Vrai quand le chauffeur est actif et peut recevoir des réservations. */
  available: z.boolean(),
  since: isoDate,
});
export type FavoriteView = z.infer<typeof favoriteSchema>;

/** Garantie modèle (prompt 08, tâche 6) : décision sur un incident `model_guarantee`. */
export const guaranteeDecisionSchema = z
  .object({
    outcome: z.enum(['validated', 'rejected']),
    /** Motif de la décision (obligatoire), communiqué au client. */
    decision: z.string().trim().min(3).max(2000),
    /** Validée : le chauffeur est-il en faute ? Non : son tarif normal est maintenu ; oui : une sanction est proposée. */
    driverAtFault: z.boolean().default(false),
    /** Validée : remboursement sur la carte, ou crédit si le client le préfère ou a payé le chauffeur. */
    refundMode: z.enum(['refund', 'credit']).default('refund'),
  })
  .refine((d) => d.outcome === 'validated' || !d.driverAtFault, { message: 'Une garantie refusée ne met pas le chauffeur en faute', path: ['driverAtFault'] });
export type GuaranteeDecision = z.input<typeof guaranteeDecisionSchema>;
export const guaranteeResultSchema = z.object({
  incidentId: uuid,
  outcome: z.enum(['validated', 'rejected']),
  refundedCents: cents,
  refundMode: z.enum(['refund', 'credit']).nullable(),
  driverFareProtected: z.boolean(),
  sanctionProposed: z.boolean(),
});
export type GuaranteeResult = z.infer<typeof guaranteeResultSchema>;
