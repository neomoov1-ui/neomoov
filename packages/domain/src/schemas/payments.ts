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

/** Fournisseurs de paiement (étape 26) : Stripe, Square (en attendant la validation du compte Stripe), simulé. */
export const PAYMENT_PROVIDERS = ['stripe', 'square', 'mock'] as const;
export type PaymentProviderName = (typeof PAYMENT_PROVIDERS)[number];
export const SQUARE_ENVIRONMENTS = ['sandbox', 'production'] as const;

/**
 * Réponse d'un SetupIntent : à confirmer par le SDK Stripe de l'application (feuille de paiement, Apple Pay, Google Pay).
 * Avec Square (`provider: 'square'`), il n'y a pas de SetupIntent (`setupIntentId` et `clientSecret` nuls) : l'application
 * ouvre `cardFormUrl` (page de saisie du web, session signée de 15 minutes) qui charge le Web Payments SDK de Square.
 */
export const setupIntentResponseSchema = z.object({
  provider: z.enum(PAYMENT_PROVIDERS),
  setupIntentId: z.string().nullable(),
  clientSecret: z.string().nullable(),
  customerId: z.string(),
  /** Clé publiable Stripe pour le SDK ; nulle avec le fournisseur simulé ou Square. */
  publishableKey: z.string().nullable(),
  /** Identifiant marchand Apple Pay et pays, pour la feuille de paiement native. */
  applePayMerchantId: z.string().nullable(),
  merchantCountry: z.literal('CA'),
  simulated: z.boolean(),
  /** Page de saisie de carte (fournisseur par jeton de carte : Square, simulé) ; nulle avec Stripe. */
  cardFormUrl: z.string().url().nullable(),
  squareApplicationId: z.string().nullable(),
  squareLocationId: z.string().nullable(),
  squareEnvironment: z.enum(SQUARE_ENVIRONMENTS).nullable(),
});
export type SetupIntentResponse = z.infer<typeof setupIntentResponseSchema>;

/**
 * Enregistrement d'une carte : SetupIntent confirmé par la feuille de paiement Stripe (l'API le relit chez Stripe, jamais
 * les détails fournis par l'application), ou jeton de carte du Web Payments SDK de Square (`sourceId`, avec le jeton de
 * vérification 3-D Secure quand Square l'a demandé).
 */
export const setupIntentConfirmSchema = z.union([
  z.object({ setupIntentId: z.string().trim().min(3).max(100), makeDefault: z.boolean().default(true) }),
  z.object({ sourceId: z.string().trim().min(3).max(200), verificationToken: z.string().trim().min(3).max(500).optional(), makeDefault: z.boolean().default(true) }),
]);
export type SetupIntentConfirm = z.infer<typeof setupIntentConfirmSchema>;

/** Session de saisie de carte (page `/carte` du web, étape 26) : jeton signé de 15 minutes lié à l'utilisateur. */
export const cardSessionQuerySchema = z.object({ session: z.string().min(20).max(400) });
export const CARD_SESSION_PURPOSES = ['client_card', 'driver_debit'] as const;
export const cardSessionInfoSchema = z.object({
  provider: z.enum(PAYMENT_PROVIDERS),
  purpose: z.enum(CARD_SESSION_PURPOSES),
  expiresAt: isoDate,
  squareApplicationId: z.string().nullable(),
  squareLocationId: z.string().nullable(),
  squareEnvironment: z.enum(SQUARE_ENVIRONMENTS).nullable(),
  /** Lien profond qui ramène à l'application une fois la carte enregistrée. */
  returnUrl: z.string(),
});
export type CardSessionInfo = z.infer<typeof cardSessionInfoSchema>;
export const cardSessionConfirmSchema = z.object({
  session: z.string().min(20).max(400),
  sourceId: z.string().trim().min(3).max(200),
  verificationToken: z.string().trim().min(3).max(500).optional(),
});
export type CardSessionConfirm = z.infer<typeof cardSessionConfirmSchema>;
export const cardSessionResultSchema = z.object({
  purpose: z.enum(CARD_SESSION_PURPOSES),
  card: paymentMethodViewSchema.nullable(),
  debitMethod: z.object({ brand: z.string(), last4: z.string() }).nullable(),
});
export type CardSessionResult = z.infer<typeof cardSessionResultSchema>;

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
export const PAYOUT_MODES = ['connect', 'offline'] as const;
export const connectStatusSchema = z.object({
  linked: z.boolean(),
  onboarded: z.boolean(),
  payoutsEnabled: z.boolean(),
  debitMethod: z.object({ brand: z.string(), last4: z.string() }).nullable(),
  provider: z.string(),
  /** `connect` : versements par Stripe Connect ; `offline` (Square, étape 26) : relevés réglés par virement ou Interac chaque semaine. */
  payoutMode: z.enum(PAYOUT_MODES),
});
export type ConnectStatus = z.infer<typeof connectStatusSchema>;
