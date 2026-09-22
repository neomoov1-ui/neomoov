/**
 * Schémas Zod des objets échangés par l'API (validation des entrées et contrat des sorties).
 * Montants en cents entiers, coordonnées WGS 84, dates en ISO 8601. Les libellés sont en français.
 */

import { z } from 'zod';
import {
  CANCELLATION_REASONS, DOCUMENT_TYPES, LANGUAGES, OFFER_STATES, OFFER_TYPES, PACK_CODES, PACK_PURCHASE_STATUSES, PAYMENT_METHODS,
  RATING_TAGS, RIDE_STATES, RIDE_TYPES, SEV_STATUSES, STATEMENT_STATUSES, VEHICLE_CATEGORIES,
} from '../enums.js';

export const cents = z.number().int().min(0).describe('Montant en cents');
export const signedCents = z.number().int().describe('Montant signé en cents');
export const uuid = z.string().uuid();
export const isoDate = z.string().datetime({ offset: true });
export const phoneE164 = z.string().regex(/^\+[1-9]\d{6,14}$/, 'Numéro au format E.164 attendu, par exemple +15145550142');
export const localDateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date AAAA-MM-JJ attendue');

export const coordinatesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type Coordinates = z.infer<typeof coordinatesSchema>;

export const placeSchema = z.object({
  address: z.string().min(3).max(300),
  coordinates: coordinatesSchema,
  placeId: z.string().max(200).optional(),
  instructions: z.string().max(300).optional(),
});
export type Place = z.infer<typeof placeSchema>;

export const ridePreferencesSchema = z.object({
  conversation: z.enum(['silence', 'chat', 'indifferent']).default('indifferent'),
  music: z.enum(['none', 'soft', 'client_choice', 'indifferent']).default('indifferent'),
  temperature: z.enum(['cool', 'neutral', 'warm']).default('neutral'),
  driverLanguage: z.enum(LANGUAGES).optional(),
  luggageHelp: z.boolean().default(false),
});

export const rideOptionsSchema = z.object({
  flex: z.boolean().default(false),
  priority: z.boolean().default(false),
  favouriteDriverId: uuid.optional(),
  childSeat: z.boolean().default(false),
  luggage: z.boolean().default(false),
  promoCode: z.string().trim().toUpperCase().max(30).optional(),
});

/** Demande de devis (POST /v1/quotes). */
export const quoteRequestSchema = z.object({
  category: z.enum(VEHICLE_CATEGORIES),
  origin: placeSchema,
  destination: placeSchema,
  stops: z.array(placeSchema).max(3).default([]),
  requestedAt: isoDate.optional().describe('Absent : course immédiate'),
  options: rideOptionsSchema.prefault({}),
}).refine((q) => q.stops.length === 0 || !q.options.flex, { message: 'L\'offre Flex n\'est pas compatible avec des arrêts', path: ['options', 'flex'] });
export type QuoteRequest = z.infer<typeof quoteRequestSchema>;

export const quoteLineSchema = z.object({ code: z.string(), label: z.string(), amountCents: signedCents });

/** Devis retourné au client : prix affiché identique au centime à celui de l'API. */
export const quoteSchema = z.object({
  id: uuid,
  category: z.enum(VEHICLE_CATEGORIES),
  distanceMeters: z.number().int().min(0),
  durationSeconds: z.number().int().min(0),
  lines: z.array(quoteLineSchema),
  fareCents: cents,
  serviceFeeCents: cents,
  regulatoryFeeCents: cents,
  gstCents: cents,
  qstCents: cents,
  creditsAppliedCents: cents,
  totalCents: cents,
  maxConsentedCents: cents,
  flatRateCode: z.string().nullable(),
  ignoredOptions: z.array(z.string()),
  validUntil: isoDate,
  fingerprint: z.string(),
});
export type QuoteView = z.infer<typeof quoteSchema>;

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
});
export type RideView = z.infer<typeof rideSchema>;

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
