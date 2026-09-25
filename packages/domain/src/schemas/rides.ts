/**
 * Schémas des courses en temps réel (prompt 05, sections 5.2, 5.3, 7.2 et 7.3) : messages, SOS, partage, déroulé
 * chauffeur, présence et positions, réservation planifiée, création et attribution par l'opérateur, suivi public.
 */
import { z } from 'zod';
import { CANCELLATION_REASONS, PAYMENT_METHODS, RIDE_STATES, VEHICLE_CATEGORIES } from '../enums.js';
import { cents, isoDate, phoneE164, uuid } from './common.js';
import { coordinatesSchema, placeSchema } from './quotes.js';

export const PAYMENT_CHOICES = ['prepaid', 'pay_driver_after'] as const;
export type PaymentChoice = (typeof PAYMENT_CHOICES)[number];

export const DRIVER_STATUS_REQUESTS = ['online', 'offline', 'paused'] as const;
export type DriverStatusRequest = (typeof DRIVER_STATUS_REQUESTS)[number];

/** Message dans la course (messagerie masquée : les numéros ne sont jamais échangés). */
export const rideMessageInputSchema = z.object({ body: z.string().trim().min(1).max(1000) });

export const rideMessageSchema = z.object({
  id: uuid,
  rideId: uuid,
  senderKind: z.enum(['client', 'driver', 'operator', 'system']),
  /** Vrai si le message vient de l'utilisateur qui consulte. */
  mine: z.boolean(),
  body: z.string(),
  sentAt: isoDate,
  readAt: isoDate.nullable(),
});

export const sosInputSchema = z.object({
  description: z.string().trim().max(1000).optional(),
  coordinates: coordinatesSchema.optional(),
});

export const sosResponseSchema = z.object({ incidentId: uuid, status: z.literal('alerted') });

export const shareResponseSchema = z.object({ trackingUrl: z.string(), token: z.string(), expiresAt: isoDate.nullable() });

/** Déroulé chauffeur : annulation avec motif ; non-présentation ; fin de course avec compteurs. */
export const driverCancelSchema = z.object({ reason: z.string().trim().min(3).max(200) });

export const completeRideSchema = z.object({
  /** Distance et durée mesurées par l'application, si la trace serveur est incomplète. */
  measuredDistanceMeters: z.number().int().min(0).optional(),
  measuredDurationSeconds: z.number().int().min(0).optional(),
});

export const driverStatusSchema = z.object({
  status: z.enum(DRIVER_STATUS_REQUESTS),
  vehicleId: uuid.optional(),
  coordinates: coordinatesSchema.optional(),
});

export const driverStatusViewSchema = z.object({
  status: z.enum(DRIVER_STATUS_REQUESTS),
  vehicleId: uuid.nullable(),
  category: z.enum(VEHICLE_CATEGORIES).nullable(),
  since: isoDate.nullable(),
});

/** Position reçue par socket ou par POST /v1/driver/location (secours). */
export const locationUpdateSchema = z.object({
  coordinates: coordinatesSchema,
  speedMps: z.number().min(0).max(80).nullable().optional(),
  headingDegrees: z.number().min(0).max(360).nullable().optional(),
  accuracyMeters: z.number().min(0).nullable().optional(),
  recordedAt: isoDate.optional(),
});
export type LocationUpdate = z.infer<typeof locationUpdateSchema>;

export const locationBatchSchema = z.object({ positions: z.array(locationUpdateSchema).min(1).max(100) });

/** Événement `driver.location` diffusé au client de la course et à My Hub. */
export const driverLocationEventSchema = z.object({
  rideId: uuid.nullable(),
  driverId: uuid,
  coordinates: coordinatesSchema,
  headingDegrees: z.number().nullable(),
  speedMps: z.number().nullable(),
  recordedAt: isoDate,
});

export const rideEventSchema = z.object({
  id: uuid,
  type: z.string(),
  fromState: z.enum(RIDE_STATES).nullable(),
  toState: z.enum(RIDE_STATES).nullable(),
  actorKind: z.string(),
  data: z.unknown().nullable(),
  occurredAt: isoDate,
});

export const rideListQuerySchema = z.object({
  /** Curseur : identifiant de la dernière course de la page précédente. */
  cursor: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  state: z.enum(RIDE_STATES).optional(),
});

/** Création par l'opérateur (fiche minimale d'un client sans compte). */
export const adminCreateRideSchema = z.object({
  quoteId: uuid,
  guest: z.object({ name: z.string().trim().min(2).max(120), phone: phoneE164, language: z.enum(['fr', 'en']).default('fr') }).optional(),
  clientUserId: uuid.optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).default('cash'),
  paymentChoice: z.enum(PAYMENT_CHOICES).default('pay_driver_after'),
  passenger: z.object({ name: z.string().min(2).max(120), phone: phoneE164 }).optional(),
  flightNumber: z.string().regex(/^[A-Z0-9]{2}\d{1,4}$/).optional(),
  specialRequests: z.string().trim().max(500).optional(),
}).refine((r) => r.guest !== undefined || r.clientUserId !== undefined, { message: 'Un client (compte ou fiche minimale) est requis', path: ['guest'] });

export const adminAssignSchema = z.object({
  driverId: uuid,
  vehicleId: uuid.optional(),
  note: z.string().trim().max(300).optional(),
});

export const scheduledRideSchema = z.object({
  id: uuid,
  publicNumber: z.string(),
  state: z.enum(RIDE_STATES),
  category: z.enum(VEHICLE_CATEGORIES),
  requestedAt: isoDate,
  origin: placeSchema,
  destination: placeSchema,
  driverFareCents: cents,
  paymentMethod: z.enum(PAYMENT_METHODS),
  /** Attribution en attente de confirmation par ce chauffeur, s'il y en a une. */
  assignment: z.object({ id: uuid, proposedAt: isoDate, confirmedAt: isoDate.nullable() }).nullable(),
});

/** Suivi public d'une course partagée (lien signé) : le strict nécessaire, jamais le numéro du client. */
export const publicTrackingSchema = z.object({
  publicNumber: z.string(),
  state: z.enum(RIDE_STATES),
  category: z.enum(VEHICLE_CATEGORIES),
  destination: z.object({ address: z.string() }),
  requestedAt: isoDate.nullable(),
  driver: z.object({ firstName: z.string(), vehicle: z.object({ make: z.string(), model: z.string(), colour: z.string(), plate: z.string() }) }).nullable(),
  driverPosition: coordinatesSchema.nullable(),
  etaSeconds: z.number().int().min(0).nullable(),
  updatedAt: isoDate,
});

export const cancellationResultSchema = z.object({
  state: z.enum(RIDE_STATES),
  feeCents: cents,
  reason: z.enum(CANCELLATION_REASONS).optional(),
});

export type RideMessageView = z.infer<typeof rideMessageSchema>;
export type SosInput = z.infer<typeof sosInputSchema>;
export type AdminCreateRide = z.infer<typeof adminCreateRideSchema>;
export type AdminAssign = z.infer<typeof adminAssignSchema>;
export type ScheduledRideView = z.infer<typeof scheduledRideSchema>;
export type DriverStatusInput = z.infer<typeof driverStatusSchema>;
export type DriverStatusView = z.infer<typeof driverStatusViewSchema>;
export type PublicTrackingView = z.infer<typeof publicTrackingSchema>;

// Types des réponses, pour les clients de l'API (applications, web).
export type RideEventView = z.infer<typeof rideEventSchema>;
export type CancellationResult = z.infer<typeof cancellationResultSchema>;
export type ShareResponse = z.infer<typeof shareResponseSchema>;
export type SosResponse = z.infer<typeof sosResponseSchema>;
export type RideMessageInput = z.infer<typeof rideMessageInputSchema>;
