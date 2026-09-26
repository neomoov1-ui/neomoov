/**
 * Schémas des paiements (prompt 07) : méthodes enregistrées (aucune donnée de carte, seulement des identifiants
 * Stripe), SetupIntent, pourboire, remboursement, règlement d'un solde dû, compte Connect du chauffeur, paiements d'une
 * course.
 */
import { z } from 'zod';
import { COLLECTED_BY, PAYMENT_KINDS, PAYMENT_METHODS, PAYMENT_STATUSES } from '../enums.js';
import { cents, isoDate, uuid } from './common.js';

export const paymentMethodViewSchema = z.object({
  id: uuid,
  brand: z.string(),
  last4: z.string().regex(/^\d{4}$/),
  expMonth: z.number().int().min(1).max(12).nullable(),
  expYear: z.number().int().nullable(),
  isDefault: z.boolean(),
  createdAt: isoDate,
});
export type PaymentMethodView = z.infer<typeof paymentMethodViewSchema>;

/** Réponse d'un SetupIntent : à confirmer par le SDK Stripe de l'application (feuille de paiement, Apple Pay, Google Pay). */
export const setupIntentResponseSchema = z.object({
  setupIntentId: z.string(),
  clientSecret: z.string(),
  customerId: z.string(),
  /** Clé publiable Stripe pour le SDK ; nulle avec le fournisseur simulé. */
  publishableKey: z.string().nullable(),
  /** Identifiant marchand Apple Pay et pays, pour la feuille de paiement native. */
  applePayMerchantId: z.string().nullable(),
  merchantCountry: z.literal('CA'),
  simulated: z.boolean(),
});
export type SetupIntentResponse = z.infer<typeof setupIntentResponseSchema>;

/** Après confirmation par le SDK : l'API relit le SetupIntent chez Stripe (jamais les détails fournis par l'application). */
export const setupIntentConfirmSchema = z.object({ setupIntentId: z.string().trim().min(3).max(100), makeDefault: z.boolean().default(true) });

export const tipInputSchema = z.object({ amountCents: cents.refine((v) => v > 0, 'Montant positif requis') });

export const refundInputSchema = z.object({
  amountCents: cents.refine((v) => v > 0, 'Montant positif requis'),
  reason: z.string().trim().min(3).max(300),
  /** Remboursement sur la carte (Stripe) ou crédit sur le compte du client (5.6 : au choix du client). */
  mode: z.enum(['refund', 'credit']).default('refund'),
});
export type RefundInput = z.input<typeof refundInputSchema>;

export const refundViewSchema = z.object({
  id: uuid,
  paymentId: uuid.nullable(),
  mode: z.enum(['refund', 'credit']),
  amountCents: cents,
  reason: z.string(),
  status: z.enum(['pending', 'succeeded', 'failed']),
  createdAt: isoDate,
});
export type RefundView = z.infer<typeof refundViewSchema>;

export const paymentViewSchema = z.object({
  id: uuid,
  rideId: uuid,
  kind: z.enum(PAYMENT_KINDS),
  method: z.enum(PAYMENT_METHODS),
  status: z.enum(PAYMENT_STATUSES),
  collectedBy: z.enum(COLLECTED_BY),
  authorizedCents: cents,
  capturedCents: cents,
  refundedCents: cents,
  /** Montant confirmé par le chauffeur pour un paiement direct. */
  driverConfirmedCents: cents.nullable(),
  /** Carte utilisée, masquée (marque et 4 derniers chiffres). */
  card: z.object({ brand: z.string(), last4: z.string() }).nullable(),
  failureCode: z.string().nullable(),
  createdAt: isoDate,
});
export type PaymentView = z.infer<typeof paymentViewSchema>;

/** Solde dû après un échec de capture : les nouvelles courses sont refusées jusqu'au règlement. */
export const balanceSchema = z.object({ balanceDueCents: cents, rides: z.array(z.object({ rideId: uuid, publicNumber: z.string(), amountDueCents: cents })) });
export type BalanceView = z.infer<typeof balanceSchema>;
export const settleInputSchema = z.object({ paymentMethodId: uuid.optional() });
export const settleResultSchema = z.object({ paidCents: cents, balanceDueCents: cents });

/** Paiement direct confirmé par le chauffeur à la fin de course (espèces, Interac, terminal). */
export const paidDirectSchema = z.object({ method: z.enum(['cash', 'interac', 'terminal']), amountCents: cents });

/** Compte Connect Express du chauffeur (versements) et méthode de prélèvement (relevés négatifs, étape 9). */
export const connectStatusSchema = z.object({
  linked: z.boolean(),
  onboarded: z.boolean(),
  payoutsEnabled: z.boolean(),
  debitMethod: z.object({ brand: z.string(), last4: z.string() }).nullable(),
  provider: z.string(),
});
export type ConnectStatus = z.infer<typeof connectStatusSchema>;
