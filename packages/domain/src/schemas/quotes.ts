/**
 * Schémas des lieux et des devis (sections 4.4, 5.1 et 7.2, prompt 04). Le client affiche le détail renvoyé par l'API
 * et ne recalcule jamais un prix.
 */
import { z } from 'zod';
import { BENCHMARK_TIME_WINDOWS } from '../pricing/benchmark.js';
import { LANGUAGES, PAYMENT_METHODS, VEHICLE_CATEGORIES } from '../enums.js';
import { cents, isoDate, signedCents, uuid } from './common.js';

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
  /** D36, D37 : genre de musique souhaité, bagages (nombre et taille), siège enfant, accessibilité (mobilité réduite). */
  musicGenre: z.string().trim().max(60).optional(),
  luggageCount: z.number().int().min(0).max(10).optional(),
  luggageSize: z.enum(['small', 'medium', 'large']).optional(),
  childSeat: z.boolean().optional(),
  accessibility: z.boolean().optional(),
});
export type RidePreferences = z.infer<typeof ridePreferencesSchema>;

export const rideOptionsSchema = z.object({
  flex: z.boolean().default(false),
  priority: z.boolean().default(false),
  favouriteDriverId: uuid.optional(),
  childSeat: z.boolean().default(false),
  luggage: z.boolean().default(false),
  promoCode: z.string().trim().toUpperCase().max(30).optional(),
});

/** Arrêts intermédiaires d'une course, au plus (limite du contrat de l'API, partagée par les applications). */
export const MAX_QUOTE_STOPS = 3;

/** Demande de devis (POST /v1/quotes) : sans catégorie, toutes les catégories actives sont tarifées. */
export const quoteRequestSchema = z.object({
  category: z.enum(VEHICLE_CATEGORIES).optional(),
  origin: placeSchema,
  destination: placeSchema,
  stops: z.array(placeSchema).max(MAX_QUOTE_STOPS).default([]),
  /** Heure de prise en charge demandée (au moins 2 heures après la demande, D32) ; absente : course immédiate, si le drapeau l'autorise. */
  requestedAt: isoDate.optional(),
  options: rideOptionsSchema.prefault({}),
}).refine((q) => q.stops.length === 0 || !q.options.flex, { message: 'L\'offre Flex n\'est pas compatible avec des arrêts', path: ['options', 'flex'] });
export type QuoteRequest = z.infer<typeof quoteRequestSchema>;

export const QUOTE_LINE_CODES = [
  'base_fare', 'distance', 'duration', 'minimum_fare', 'night', 'airport', 'child_seat', 'bulky_luggage', 'stops', 'flex', 'priority',
  'favourite_driver', 'flat_rate', 'tolls', 'benchmark_alignment', 'wait_time', 'promotion', 'service_fee', 'regulatory_fee', 'gst', 'qst', 'credits',
] as const;

/** Ligne du détail : `code` stable (traduit par l'application), `label` en français canadien à défaut. */
export const quoteLineSchema = z.object({ code: z.string(), label: z.string(), amountCents: signedCents });

export const etaSchema = z.object({
  /** Temps d'arrivée estimé du chauffeur en ligne le plus proche, en secondes ; null : « selon disponibilité ». */
  seconds: z.number().int().min(0).nullable(),
  status: z.enum(['estimated', 'on_availability']),
});

/** Devis d'une catégorie : prix affiché identique au centime à celui de l'API. */
export const quoteSchema = z.object({
  id: uuid,
  category: z.enum(VEHICLE_CATEGORIES),
  distanceMeters: z.number().int().min(0),
  durationSeconds: z.number().int().min(0),
  lines: z.array(quoteLineSchema),
  fareCents: cents,
  serviceFeeCents: cents,
  regulatoryFeeCents: cents,
  tollsCents: cents,
  promotionCode: z.string().nullable(),
  promotionDiscountCents: cents,
  alignmentDiscountCents: cents,
  subtotalCents: cents,
  gstCents: cents,
  qstCents: cents,
  totalCents: cents,
  creditsAppliedCents: cents,
  amountDueCents: cents,
  maxConsentedCents: cents,
  flatRateCode: z.string().nullable(),
  ignoredOptions: z.array(z.string()),
  /** Vrai quand l'itinéraire vient de l'estimation interne (API Routes indisponible) : le client en est informé. */
  estimated: z.boolean(),
  eta: etaSchema,
  requestedAt: isoDate.nullable(),
  validUntil: isoDate,
  fingerprint: z.string(),
});
export type QuoteView = z.infer<typeof quoteSchema>;

/** GET /v1/quotes/{id} : le devis avec son itinéraire. */
export const quoteDetailSchema = quoteSchema.extend({
  origin: placeSchema,
  destination: placeSchema,
  stops: z.array(placeSchema),
});
export type QuoteDetail = z.infer<typeof quoteDetailSchema>;

/** Réponse de POST /v1/quotes : un devis par catégorie demandée, même itinéraire. */
export const quotesResponseSchema = z.object({
  origin: placeSchema,
  destination: placeSchema,
  stops: z.array(placeSchema),
  requestedAt: isoDate.nullable(),
  distanceMeters: z.number().int().min(0),
  durationSeconds: z.number().int().min(0),
  estimated: z.boolean(),
  polyline: z.string().nullable(),
  quotes: z.array(quoteSchema),
  /** Modes de paiement proposables (5.6) : carte toujours, paiement au chauffeur si des chauffeurs de la zone l'acceptent. */
  paymentMethods: z.array(z.enum(PAYMENT_METHODS)),
});
export type QuotesResponse = z.infer<typeof quotesResponseSchema>;

/** Simulation pour My Hub (POST /v1/admin/pricing/simulate) : mêmes entrées, plus des valeurs forcées, sans persistance. */
export const simulateQuoteSchema = quoteRequestSchema.safeExtend({
  /** Distance et durée imposées (sans appel cartographique). */
  distanceMeters: z.number().int().min(0).optional(),
  durationSeconds: z.number().int().min(0).optional(),
  tollsCents: cents.optional(),
  clientCompletedRides: z.number().int().min(0).optional(),
  creditsAvailableCents: cents.optional(),
  /** Ignore le préavis (minimal et maximal, D32) pour tester une heure quelconque. */
  ignoreLeadTime: z.boolean().default(false),
}).refine((s) => (s.distanceMeters === undefined) === (s.durationSeconds === undefined), { message: 'Distance et durée forcées ensemble, ou aucune des deux', path: ['durationSeconds'] });
export type SimulateQuote = z.infer<typeof simulateQuoteSchema>;

export const simulateResponseSchema = quotesResponseSchema.extend({
  pricingRulesVersion: z.string(),
  benchmark: z.array(z.object({ category: z.enum(VEHICLE_CATEGORIES), referenceCents: cents.nullable(), exceeded: z.boolean() })),
});
export type SimulateResponse = z.infer<typeof simulateResponseSchema>;

// --- Lieux (GET /v1/places/*) ---

export const autocompleteQuerySchema = z.object({
  input: z.string().trim().min(2).max(200),
  /** Jeton de session Places (facturation groupée) : généré par l'application, réutilisé jusqu'au choix. */
  sessionToken: z.string().trim().max(100).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

export const autocompleteSuggestionSchema = z.object({ placeId: z.string(), description: z.string() });

export const placeDetailsQuerySchema = z.object({
  placeId: z.string().trim().min(1).max(200),
  sessionToken: z.string().trim().max(100).optional(),
});

export const placeDetailsSchema = z.object({
  placeId: z.string().nullable(),
  address: z.string(),
  coordinates: coordinatesSchema,
});

// --- Relevés concurrentiels (D33, My Hub) ---

export const benchmarkInputSchema = z.object({
  category: z.enum(VEHICLE_CATEGORIES),
  originZoneCode: z.string().trim().min(1).max(40),
  destinationZoneCode: z.string().trim().min(1).max(40),
  timeWindow: z.enum(BENCHMARK_TIME_WINDOWS),
  uberPriceCents: cents.nullable().optional(),
  lyftPriceCents: cents.nullable().optional(),
  observedAt: isoDate.optional(),
  source: z.string().trim().max(60).optional(),
}).refine((b) => (b.uberPriceCents ?? 0) > 0 || (b.lyftPriceCents ?? 0) > 0, { message: 'Au moins un prix observé' });
export type BenchmarkInput = z.infer<typeof benchmarkInputSchema>;

export const benchmarkViewSchema = z.object({
  id: uuid,
  category: z.enum(VEHICLE_CATEGORIES),
  originZoneCode: z.string(),
  destinationZoneCode: z.string(),
  timeWindow: z.enum(BENCHMARK_TIME_WINDOWS),
  uberPriceCents: cents.nullable(),
  lyftPriceCents: cents.nullable(),
  observedAt: isoDate,
  source: z.string(),
  createdAt: isoDate,
});

// Types des réponses, pour les clients de l'API (applications, web).
export type AutocompleteSuggestion = z.infer<typeof autocompleteSuggestionSchema>;
export type PlaceDetails = z.infer<typeof placeDetailsSchema>;
