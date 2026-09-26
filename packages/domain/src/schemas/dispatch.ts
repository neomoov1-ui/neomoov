/**
 * Schémas de la répartition et de la négociation (prompt 06, sections 5.4, 5.5 et 7.2) : offres aux chauffeurs,
 * proposition et offres côté client, panneau opérateur, signalement de véhicule non conforme, passe manuelle.
 */
import { z } from 'zod';
import { EXCEPTIONAL_REASONS, NEGOTIATION_MODES } from '../dispatch/negotiation.js';
import { OFFER_STATES, OFFER_TYPES, PAYMENT_METHODS, RIDE_TYPES, VEHICLE_CATEGORIES } from '../enums.js';
import { cents, isoDate, uuid } from './common.js';
import { placeSchema, ridePreferencesSchema } from './quotes.js';
import { PAYMENT_CHOICES } from './rides.js';

const count = z.number().int().min(0);

export const DISPATCH_STATUSES = ['searching', 'offering', 'held', 'assigned', 'exhausted', 'window_closed', 'cancelled'] as const;
export type DispatchStatus = (typeof DISPATCH_STATUSES)[number];

/** Résumé de la répartition d'une course (My Hub et client : « recherche d'un chauffeur »). */
export const dispatchSummarySchema = z.object({
  status: z.enum(DISPATCH_STATUSES),
  mode: z.enum(NEGOTIATION_MODES),
  wave: count,
  radiusMeters: z.number().int().positive().nullable(),
  offersSent: count,
  priority: z.boolean(),
  startedAt: isoDate,
  nextActionAt: isoDate.nullable(),
  heldReason: z.string().nullable(),
});
export type DispatchSummary = z.infer<typeof dispatchSummarySchema>;

/** Négociation vue par le client (absente quand le drapeau est désactivé). */
export const negotiationSummarySchema = z.object({
  displayedTotalCents: cents,
  proposedTotalCents: cents.nullable(),
  agreedTotalCents: cents.nullable(),
  endsAt: isoDate.nullable(),
  openOffers: count,
});
export type NegotiationSummary = z.infer<typeof negotiationSummarySchema>;

export const offerRideSummarySchema = z.object({
  id: uuid,
  publicNumber: z.string(),
  type: z.enum(RIDE_TYPES),
  category: z.enum(VEHICLE_CATEGORIES),
  origin: placeSchema,
  destination: placeSchema,
  requestedAt: isoDate.nullable(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  paymentChoice: z.enum(PAYMENT_CHOICES),
  specialRequests: z.string().nullable(),
  /** Numéro de vol d'une prise en charge à l'aéroport (le chauffeur suit l'arrivée). */
  flightNumber: z.string().nullable(),
  /** Trajet estimé au devis (distance et durée), arrêts et préférences du client, affichés sur l'offre. */
  distanceMeters: count.nullable(),
  durationSeconds: count.nullable(),
  stops: count,
  preferences: ridePreferencesSchema.nullable(),
});

/** Offre telle que le chauffeur la voit (`GET /driver/offers`, événement `offer.new`). */
export const driverOfferSchema = z.object({
  id: uuid,
  rideId: uuid,
  wave: count,
  type: z.enum(OFFER_TYPES),
  state: z.enum(OFFER_STATES),
  driverFareCents: cents,
  /** Prix proposé par le client (P'), en négociation seulement. */
  proposedTotalCents: cents.nullable(),
  /** Prix affiché au client (P), en négociation seulement. */
  displayedTotalCents: cents.nullable(),
  pickupDistanceMeters: z.number().int().min(0).nullable(),
  pickupSeconds: z.number().int().min(0).nullable(),
  isFavourite: z.boolean(),
  sentAt: isoDate,
  expiresAt: isoDate,
  ride: offerRideSummarySchema,
});
export type DriverOfferView = z.infer<typeof driverOfferSchema>;

export const offerCounterSchema = z
  .object({
    proposedTotalCents: cents,
    reason: z.enum(EXCEPTIONAL_REASONS).optional(),
    reasonText: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.reason !== 'other' || Boolean(v.reasonText), { message: 'Précisez le motif', path: ['reasonText'] });
export type OfferCounterInput = z.infer<typeof offerCounterSchema>;

export const clientProposalSchema = z.object({ proposedTotalCents: cents });

/** Offre d'un chauffeur telle que le client la voit (`GET /rides/{id}/offers`, événement `offers.updated`). */
export const clientOfferSchema = z.object({
  id: uuid,
  type: z.enum(OFFER_TYPES),
  state: z.enum(OFFER_STATES),
  totalCents: cents,
  aboveDisplayed: z.boolean(),
  reason: z.enum(EXCEPTIONAL_REASONS).nullable(),
  reasonText: z.string().nullable(),
  sentAt: isoDate,
  expiresAt: isoDate,
  driver: z.object({
    id: uuid,
    /** Null sans prénom renseigné : l'application affiche son propre libellé traduit. */
    firstName: z.string().nullable(),
    rating: z.number().min(0).max(5),
    rideCount: count,
    vehicle: z.object({ make: z.string(), model: z.string(), colour: z.string(), category: z.enum(VEHICLE_CATEGORIES) }),
  }),
});
export type ClientOfferView = z.infer<typeof clientOfferSchema>;

/** Acceptation d'une offre par le client ; le texte de consentement est exigé quand l'offre dépasse le prix affiché. */
export const acceptOfferSchema = z.object({ consentText: z.string().trim().min(10).max(500).optional() });

export const adminReassignSchema = z.object({ reason: z.string().trim().min(3).max(200), excludeDriver: z.boolean().default(true) });
export const adminHoldSchema = z.object({ reason: z.string().trim().min(3).max(200) });

export const vehicleMismatchSchema = z.object({
  description: z.string().trim().min(5).max(1000),
  plateSeen: z.string().trim().max(12).optional(),
  modelSeen: z.string().trim().max(60).optional(),
});
export const incidentCreatedSchema = z.object({ incidentId: uuid, status: z.literal('open') });

export const dispatchTickSchema = z.object({ now: isoDate.optional() });
export const dispatchTickReportSchema = z.object({ expiredOffers: count, steps: count, fallbacks: count, noMovement: count, iterations: count });
export type DispatchTickReport = z.infer<typeof dispatchTickReportSchema>;

/** Offre telle que My Hub la voit (toutes les offres d'une course, tous états). */
export const adminOfferSchema = z.object({
  id: uuid,
  driverId: uuid,
  wave: count,
  type: z.enum(OFFER_TYPES),
  state: z.enum(OFFER_STATES),
  driverFareCents: cents,
  proposedTotalCents: cents.nullable(),
  pickupSeconds: z.number().int().min(0).nullable(),
  sentAt: isoDate,
  expiresAt: isoDate,
  respondedAt: isoDate.nullable(),
});
export type AdminOfferView = z.infer<typeof adminOfferSchema>;

/** `GET /admin/rides/{id}/dispatch` : répartition et offres d'une course. */
export const adminDispatchViewSchema = z.object({ dispatch: dispatchSummarySchema.nullable(), offers: z.array(adminOfferSchema) });
export type AdminDispatchView = z.infer<typeof adminDispatchViewSchema>;

/**
 * Sélection précise du véhicule (D37) : véhicules réellement libres sur le créneau d'un devis planifié, catégorie du devis
 * ou supérieure. `paymentMethods` : modes « payer le chauffeur après » que le chauffeur accepte (le prépaiement est
 * toujours possible).
 */
export const availableVehicleSchema = z.object({
  vehicleId: uuid,
  category: z.enum(VEHICLE_CATEGORIES),
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
  colour: z.string(),
  seats: z.number().int().min(1),
  photoUrl: z.string().url().nullable(),
  isFavourite: z.boolean(),
  paymentMethods: z.array(z.enum(PAYMENT_METHODS)),
  driver: z.object({ id: uuid, firstName: z.string().nullable(), rating: z.number().min(0).max(5), rideCount: count }),
});
export type AvailableVehicle = z.infer<typeof availableVehicleSchema>;
