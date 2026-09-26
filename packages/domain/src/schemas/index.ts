/**
 * Schémas Zod des objets échangés par l'API (validation des entrées et contrat des sorties).
 * Montants en cents entiers, coordonnées WGS 84, dates en ISO 8601. Les libellés sont en français.
 */

import { z } from 'zod';
import {
  CANCELLATION_REASONS, DOCUMENT_TYPES, OFFER_STATES, OFFER_TYPES, PACK_CODES, PACK_PURCHASE_STATUSES, PAYMENT_METHODS,
  RATING_TAGS, RIDE_STATES, RIDE_TYPES, SEV_STATUSES, STATEMENT_STATUSES, VEHICLE_CATEGORIES,
} from '../enums.js';

export * from './common.js';
export * from './auth.js';
import { cents, isoDate, localDateString, phoneE164, signedCents, uuid } from './common.js';

export * from './quotes.js';
export * from './rides.js';
export * from './dispatch.js';
export * from './client.js';
export * from './driver.js';
export * from './admin.js';
export * from './payments.js';
export * from './growth.js';
export * from './settlement.js';
export * from './agents.js';
import { PAYMENT_CHOICES } from './rides.js';
import { driverJobSchema } from './driver.js';
import { dispatchSummarySchema, negotiationSummarySchema } from './dispatch.js';
import { coordinatesSchema, placeSchema, quoteLineSchema, quoteSchema, ridePreferencesSchema } from './quotes.js';

export const thirdPartyPassengerSchema = z.object({ name: z.string().min(2).max(120), phone: phoneE164 });

/** Création d'une course à partir d'un devis (POST /v1/rides). */
export const createRideSchema = z.object({
  quoteId: uuid,
  type: z.enum(RIDE_TYPES),
  requestedAt: isoDate.optional(),
  flightNumber: z.string().regex(/^[A-Z0-9]{2}\d{1,4}$/).optional(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  paymentMethodId: z.string().max(100).optional().describe('Identifiant Stripe de la méthode, pour la carte'),
  passenger: thirdPartyPassengerSchema.optional(),
  preferences: ridePreferencesSchema.prefault({}),
  /** D36 : payé d'avance dans l'application, ou payé au chauffeur après la course. */
  paymentChoice: z.enum(PAYMENT_CHOICES).default('prepaid'),
  /** D37 : véhicule choisi dans `GET /quotes/{id}/vehicles` ; son chauffeur reçoit l'offre d'abord, puis la catégorie. */
  vehicleId: uuid.optional(),
  specialRequests: z.string().trim().max(500).optional(),
  maxConsentedCents: cents,
}).refine((r) => r.type === 'immediate' || r.requestedAt !== undefined, { message: 'Une course planifiée a une heure demandée', path: ['requestedAt'] });
export type CreateRide = z.infer<typeof createRideSchema>;

export const cancelRideSchema = z.object({ reason: z.enum(CANCELLATION_REASONS), comment: z.string().max(500).optional() });

export const rideDriverSchema = z.object({
  id: uuid, firstName: z.string(), rating: z.number().min(0).max(5), rideCount: z.number().int().min(0), photoUrl: z.string().url().nullable(),
  vehicle: z.object({ make: z.string(), model: z.string(), colour: z.string(), plate: z.string(), category: z.enum(VEHICLE_CATEGORIES) }),
});

/** Course telle que vue par le client, le chauffeur ou My Hub (les champs sensibles sont filtrés par rôle en amont). */
export const rideSchema = z.object({
  id: uuid,
  state: z.enum(RIDE_STATES),
  type: z.enum(RIDE_TYPES),
  category: z.enum(VEHICLE_CATEGORIES),
  servedCategory: z.enum(VEHICLE_CATEGORIES).nullable(),
  origin: placeSchema,
  destination: placeSchema,
  stops: z.array(placeSchema),
  requestedAt: isoDate.nullable(),
  quote: quoteSchema.pick({ totalCents: true, fareCents: true, maxConsentedCents: true, flatRateCode: true }),
  finalPriceCents: cents.nullable(),
  tipCents: cents,
  paymentMethod: z.enum(PAYMENT_METHODS),
  driver: rideDriverSchema.nullable(),
  etaSeconds: z.number().int().min(0).nullable(),
  trackingUrl: z.string().url().nullable(),
  timestamps: z.partialRecord(z.enum(RIDE_STATES), isoDate),
  /** Répartition en cours (étape 6) : null avant la première recherche et pour les courses closes. */
  dispatch: dispatchSummarySchema.nullable(),
  /** Négociation encadrée : toujours null quand le drapeau `FEATURE_NEGOTIATION` est désactivé. */
  negotiation: negotiationSummarySchema.nullable(),
});
export type RideView = z.infer<typeof rideSchema>;

/** Course vue par son chauffeur : la vue commune et la fiche de service (préférences, paiement, contact masqué). */
export const driverRideSchema = rideSchema.extend({ job: driverJobSchema });
export type DriverRideView = z.infer<typeof driverRideSchema>;

/** Offre faite à un chauffeur (ou contre-proposition, V1.1). */
export const offerSchema = z.object({
  id: uuid,
  rideId: uuid,
  driverId: uuid,
  type: z.enum(OFFER_TYPES),
  state: z.enum(OFFER_STATES),
  driverFareCents: cents,
  pickupDistanceMeters: z.number().int().min(0),
  pickupSeconds: z.number().int().min(0),
  expiresAt: isoDate,
});
export type OfferView = z.infer<typeof offerSchema>;

export const respondToOfferSchema = z.object({ accept: z.boolean(), counterFareCents: cents.optional() });

export const rateRideSchema = z.object({
  score: z.number().int().min(1).max(5),
  tags: z.array(z.enum(RATING_TAGS)).max(5).default([]),
  comment: z.string().max(500).optional(),
  tipCents: cents.max(10_000).optional(),
});

/** Relevé hebdomadaire, tel qu'exposé au chauffeur et à My Hub. */
export const statementLineSchema = z.object({
  kind: z.string(), amountCents: cents, rideId: uuid.optional(), packPurchaseId: uuid.optional(), occurredAt: isoDate, label: z.string(),
});
export const statementSchema = z.object({
  id: uuid,
  driverId: uuid,
  periodStart: localDateString,
  periodEnd: localDateString,
  status: z.enum(STATEMENT_STATUSES),
  lines: z.array(statementLineSchema),
  creditsCents: cents,
  debitsCents: cents,
  netCents: signedCents,
  payoutCents: cents,
  chargeCents: cents,
  issuedAt: isoDate.nullable(),
  pdfUrl: z.string().url().nullable(),
});
export type StatementView = z.infer<typeof statementSchema>;

/** Facture certifiée remise au client (section 5.13). */
export const invoiceSchema = z.object({
  id: uuid,
  rideId: uuid,
  number: z.string().regex(/^NM-\d{7}$/),
  issuedAt: isoDate,
  supplier: z.object({ driverId: uuid, name: z.string(), gstNumber: z.string().nullable(), qstNumber: z.string().nullable() }),
  platform: z.object({ name: z.string(), gstNumber: z.string(), qstNumber: z.string() }),
  lines: z.array(quoteLineSchema),
  totalCents: cents,
  paymentMethod: z.enum(PAYMENT_METHODS),
  sev: z.object({ status: z.enum(SEV_STATUSES), transactionId: z.string().nullable() }),
  pdfUrl: z.string().url().nullable(),
  qrPayload: z.string().nullable(),
});
export type InvoiceView = z.infer<typeof invoiceSchema>;

/** Pack au catalogue et achat d'un pack. */
export const packSchema = z.object({
  code: z.enum(PACK_CODES),
  name: z.string(),
  ridesIncluded: z.number().int().positive().nullable(),
  priceCents: cents,
  validityDays: z.number().int().positive(),
  rolloverAllowed: z.boolean(),
  active: z.boolean(),
});
export const packPurchaseSchema = z.object({
  id: uuid,
  packCode: z.enum(PACK_CODES),
  pricePaidCents: cents,
  ridesRemaining: z.number().int().min(0).nullable(),
  carriedOverRemaining: z.number().int().min(0),
  activatedAt: isoDate,
  expiresAt: isoDate,
  status: z.enum(PACK_PURCHASE_STATUSES),
  autoRenew: z.boolean(),
});
export const buyPackSchema = z.object({ packCode: z.enum(PACK_CODES), autoRenew: z.boolean().default(true) });
export type PackView = z.infer<typeof packSchema>;
export type PackPurchaseView = z.infer<typeof packPurchaseSchema>;

/** Téléversement d'un document chauffeur. */
export const driverDocumentUploadSchema = z.object({
  type: z.enum(DOCUMENT_TYPES),
  number: z.string().max(60).optional(),
  issuedOn: localDateString.optional(),
  expiresOn: localDateString.optional(),
  fileId: uuid,
});

/** Position envoyée par l'application chauffeur (toutes les 3 à 5 secondes en course). */
export const driverLocationSchema = z.object({
  coordinates: coordinatesSchema,
  speedMps: z.number().min(0).max(80).nullable(),
  headingDegrees: z.number().min(0).max(360).nullable(),
  accuracyMeters: z.number().min(0).nullable(),
  recordedAt: isoDate,
});

// Types des réponses, pour les clients de l'API (applications, web).
export type CancelRide = z.infer<typeof cancelRideSchema>;
export type RateRide = z.infer<typeof rateRideSchema>;
