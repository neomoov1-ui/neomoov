/** Section 4.5 : courses. */

import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, smallint, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { cents, createdAt, geoLine, geoPoint, id, tz, updatedAt } from './_helpers.js';
import { clients } from './clients.js';
import { drivers, vehicles } from './drivers.js';
import { offerStateEnum, offerTypeEnum, paymentMethodEnum, rideStateEnum, rideTypeEnum, vehicleCategoryEnum } from './enums.js';
import { cities, quotes } from './pricing.js';

export const rides = pgTable('rides', {
  id: id(),
  /** Numéro lisible (NM-2026-09-23-0412). */
  publicNumber: varchar('public_number', { length: 24 }).notNull(),
  cityCode: varchar('city_code', { length: 30 }).notNull().references(() => cities.code),
  clientId: uuid('client_id').references(() => clients.id),
  /** Réservation sans compte (web, téléphone) : fiche minimale. */
  guestName: varchar('guest_name', { length: 120 }),
  guestPhone: varchar('guest_phone', { length: 20 }),
  guestLanguage: varchar('guest_language', { length: 2 }),
  driverId: uuid('driver_id').references(() => drivers.id),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id),
  quoteId: uuid('quote_id').references(() => quotes.id),
  reservedCategory: vehicleCategoryEnum('reserved_category').notNull(),
  servedCategory: vehicleCategoryEnum('served_category'),
  state: rideStateEnum('state').notNull().default('requested'),
  type: rideTypeEnum('type').notNull().default('immediate'),
  requestedAt: tz('requested_at'),
  flightNumber: varchar('flight_number', { length: 10 }),
  passengerName: varchar('passenger_name', { length: 120 }),
  passengerPhone: varchar('passenger_phone', { length: 20 }),
  originAddress: varchar('origin_address', { length: 300 }).notNull(),
  originPosition: geoPoint('origin_position').notNull(),
  destinationAddress: varchar('destination_address', { length: 300 }).notNull(),
  destinationPosition: geoPoint('destination_position').notNull(),
  stops: jsonb('stops').notNull().default(sql`'[]'::jsonb`),
  preferences: jsonb('preferences').notNull().default(sql`'{}'::jsonb`),
  specialRequests: text('special_requests'),
  options: jsonb('options').notNull().default(sql`'{}'::jsonb`),
  paymentMethod: paymentMethodEnum('payment_method').notNull(),
  /** D36 : payé d'avance dans l'application, ou payé au chauffeur après la course. */
  paymentChoice: varchar('payment_choice', { length: 20 }).notNull().default('prepaid'),
  /** Référence chez le fournisseur de paiement échelonné (plus de 150 $, V1.1). */
  installmentProviderRef: varchar('installment_provider_ref', { length: 100 }),
  tollsCents: cents('tolls_cents').notNull().default(0),
  organizationId: uuid('organization_id'),
  maxConsentedCents: cents('max_consented_cents').notNull(),
  quotedTotalCents: cents('quoted_total_cents').notNull(),
  finalPriceCents: cents('final_price_cents'),
  fareCents: cents('fare_cents'),
  serviceFeeCents: cents('service_fee_cents'),
  regulatoryFeeCents: cents('regulatory_fee_cents'),
  gstCents: cents('gst_cents'),
  qstCents: cents('qst_cents'),
  waitChargeCents: cents('wait_charge_cents').notNull().default(0),
  /** Attente mesurée sur place (secondes) et tentatives de contact du chauffeur avant une non-présentation (5.2). */
  waitedSeconds: integer('waited_seconds').notNull().default(0),
  contactAttempts: smallint('contact_attempts').notNull().default(0),
  tipCents: cents('tip_cents').notNull().default(0),
  promotionId: uuid('promotion_id'),
  promotionDiscountCents: cents('promotion_discount_cents').notNull().default(0),
  creditsAppliedCents: cents('credits_applied_cents').notNull().default(0),
  modelGuaranteeApplied: boolean('model_guarantee_applied').notNull().default(false),
  favoriteDriverRequested: boolean('favorite_driver_requested').notNull().default(false),
  cancellationReason: varchar('cancellation_reason', { length: 40 }),
  cancellationComment: text('cancellation_comment'),
  cancellationFeeCents: cents('cancellation_fee_cents').notNull().default(0),
  /** Négociation encadrée (5.5) : proposition du client P', prix convenu à l'acceptation d'une offre, mode de répartition. */
  proposedTotalCents: cents('proposed_total_cents'),
  agreedTotalCents: cents('agreed_total_cents'),
  negotiationMode: varchar('negotiation_mode', { length: 20 }),
  /** Horodatage de chaque état atteint : { requested: ISO, assigned: ISO, ... }. */
  stateTimestamps: jsonb('state_timestamps').notNull().default(sql`'{}'::jsonb`),
  trackingToken: varchar('tracking_token', { length: 24 }),
  /** En-tête Idempotency-Key de la création (section 7.1) : la même clé renvoie la même course. */
  idempotencyKey: varchar('idempotency_key', { length: 80 }),
  distanceMeters: integer('distance_meters'),
  durationSeconds: integer('duration_seconds'),
  createdByUserId: uuid('created_by_user_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('rides_public_number_unique').on(t.publicNumber),
  uniqueIndex('rides_tracking_token_unique').on(t.trackingToken).where(sql`${t.trackingToken} IS NOT NULL`),
  uniqueIndex('rides_idempotency_key_unique').on(t.idempotencyKey).where(sql`${t.idempotencyKey} IS NOT NULL`),
  /** Un devis ne sert qu'à une seule course, même sous deux demandes concurrentes. */
  uniqueIndex('rides_quote_unique').on(t.quoteId).where(sql`${t.quoteId} IS NOT NULL`),
  index('rides_client_idx').on(t.clientId, t.createdAt),
  index('rides_driver_idx').on(t.driverId, t.createdAt),
  index('rides_state_idx').on(t.state).where(sql`${t.state} IN ('requested', 'offering', 'assigned', 'en_route', 'arrived', 'in_progress')`),
  index('rides_scheduled_idx').on(t.requestedAt).where(sql`${t.type} = 'scheduled'`),
  index('rides_origin_gist').using('gist', t.originPosition),
  check('rides_amounts_positive', sql`${t.maxConsentedCents} >= 0 AND ${t.quotedTotalCents} >= 0 AND ${t.tipCents} >= 0 AND ${t.waitChargeCents} >= 0 AND ${t.cancellationFeeCents} >= 0`),
  check('rides_final_within_consent', sql`${t.finalPriceCents} IS NULL OR ${t.finalPriceCents} <= ${t.maxConsentedCents}`),
  /** Invariant de la négociation (5.5, T-11.2) : le prix convenu ne dépasse jamais le prix maximal consenti. */
  check('rides_agreed_within_consent', sql`${t.agreedTotalCents} IS NULL OR ${t.agreedTotalCents} <= ${t.maxConsentedCents}`),
  check('rides_negotiation_mode', sql`${t.negotiationMode} IS NULL OR ${t.negotiationMode} IN ('fixed', 'negotiation')`),
  check('rides_client_or_guest', sql`${t.clientId} IS NOT NULL OR ${t.guestPhone} IS NOT NULL`),
  check('rides_payment_choice', sql`${t.paymentChoice} IN ('prepaid', 'pay_driver_after')`),
]);

/** Table en ajout seul (déclencheur en migration 0001). */
export const rideEvents = pgTable('ride_events', {
  id: id(),
  rideId: uuid('ride_id').notNull().references(() => rides.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 40 }).notNull(),
  fromState: rideStateEnum('from_state'),
  toState: rideStateEnum('to_state'),
  actorUserId: uuid('actor_user_id'),
  actorKind: varchar('actor_kind', { length: 20 }).notNull(),
  data: jsonb('data'),
  occurredAt: tz('occurred_at').notNull().defaultNow(),
}, (t) => [index('ride_events_ride_idx').on(t.rideId, t.occurredAt), check('ride_events_actor_kind', sql`${t.actorKind} IN ('client', 'driver', 'operator', 'system', 'agent')`)]);

/**
 * Offres faites aux chauffeurs (5.4) et contre-propositions (5.5). L'état d'une offre évolue (`sent` → `accepted`,
 * `declined`, `expired`, `withdrawn`) ; l'historique complet est dans `ride_events`.
 */
export const rideOffers = pgTable('ride_offers', {
  id: id(),
  rideId: uuid('ride_id').notNull().references(() => rides.id, { onDelete: 'cascade' }),
  driverId: uuid('driver_id').notNull().references(() => drivers.id),
  wave: smallint('wave').notNull().default(1),
  type: offerTypeEnum('type').notNull().default('fixed'),
  state: offerStateEnum('state').notNull().default('sent'),
  driverFareCents: cents('driver_fare_cents').notNull(),
  /** Prix proposé (P' du client, ou contre-offre du chauffeur) ; null en mode fixe. */
  proposedTotalCents: cents('proposed_total_cents'),
  /** Prix affiché au client (P) au moment de l'offre, en négociation. */
  displayedTotalCents: cents('displayed_total_cents'),
  /** Motif d'une contre-offre au-dessus du prix affiché (`exceptional_reason`) et son texte. */
  reason: varchar('reason', { length: 40 }),
  reasonText: text('reason_text'),
  pickupDistanceMeters: integer('pickup_distance_meters'),
  pickupSeconds: integer('pickup_seconds'),
  sentAt: createdAt(),
  respondedAt: tz('responded_at'),
  expiresAt: tz('expires_at').notNull(),
}, (t) => [
  index('ride_offers_ride_idx').on(t.rideId, t.wave),
  index('ride_offers_driver_idx').on(t.driverId, t.sentAt),
  index('ride_offers_pending_idx').on(t.expiresAt).where(sql`${t.state} = 'sent'`),
  /** Une seule offre en attente par chauffeur, par course et par type (une contre-offre coexiste avec l'offre reçue). */
  uniqueIndex('ride_offers_pending_unique').on(t.rideId, t.driverId, t.type).where(sql`${t.state} = 'sent'`),
  check('ride_offers_fare_positive', sql`${t.driverFareCents} >= 0`),
]);

/**
 * Répartition en cours d'une course (5.4) : une ligne par course demandée, pilotée par le service de répartition
 * (vagues, rayon, candidats, offres en attente, mise en attente par l'opérateur, surveillance du départ du chauffeur).
 */
export const rideDispatches = pgTable('ride_dispatches', {
  rideId: uuid('ride_id').primaryKey().references(() => rides.id, { onDelete: 'cascade' }),
  mode: varchar('mode', { length: 20 }).notNull().default('fixed'),
  status: varchar('status', { length: 20 }).notNull().default('searching'),
  wave: smallint('wave').notNull().default(0),
  radiusIndex: smallint('radius_index').notNull().default(-1),
  /** Candidats de la vague en cours, dans l'ordre du score, et position du prochain à solliciter. */
  candidateIds: jsonb('candidate_ids').notNull().default(sql`'[]'::jsonb`),
  candidateCursor: smallint('candidate_cursor').notNull().default(0),
  excludedDriverIds: jsonb('excluded_driver_ids').notNull().default(sql`'[]'::jsonb`),
  offeredDriverIds: jsonb('offered_driver_ids').notNull().default(sql`'[]'::jsonb`),
  priority: boolean('priority').notNull().default(false),
  offersSent: integer('offers_sent').notNull().default(0),
  nextActionAt: tz('next_action_at'),
  startedAt: tz('started_at').notNull().defaultNow(),
  endedAt: tz('ended_at'),
  heldReason: varchar('held_reason', { length: 200 }),
  heldByUserId: uuid('held_by_user_id'),
  assignedAt: tz('assigned_at'),
  assignedPosition: geoPoint('assigned_position'),
  movementCheckedAt: tz('movement_checked_at'),
  negotiationEndsAt: tz('negotiation_ends_at'),
  lastError: text('last_error'),
  updatedAt: updatedAt(),
}, (t) => [
  index('ride_dispatches_due_idx').on(t.status, t.nextActionAt),
  check('ride_dispatches_status', sql`${t.status} IN ('searching', 'offering', 'held', 'assigned', 'exhausted', 'window_closed', 'cancelled')`),
  check('ride_dispatches_mode', sql`${t.mode} IN ('fixed', 'negotiation')`),
]);

export const rideRatings = pgTable('ride_ratings', {
  id: id(),
  rideId: uuid('ride_id').notNull().references(() => rides.id, { onDelete: 'cascade' }),
  authorKind: varchar('author_kind', { length: 10 }).notNull(),
  authorUserId: uuid('author_user_id').notNull(),
  score: smallint('score').notNull(),
  tags: jsonb('tags').notNull().default(sql`'[]'::jsonb`),
  comment: text('comment'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('ride_ratings_unique').on(t.rideId, t.authorKind), check('ride_ratings_score', sql`${t.score} BETWEEN 1 AND 5`), check('ride_ratings_author_kind', sql`${t.authorKind} IN ('client', 'driver')`)]);

export const rideTracks = pgTable('ride_tracks', {
  rideId: uuid('ride_id').primaryKey().references(() => rides.id, { onDelete: 'cascade' }),
  track: geoLine('track').notNull(),
  measuredDistanceMeters: integer('measured_distance_meters').notNull(),
  measuredDurationSeconds: integer('measured_duration_seconds').notNull(),
  pointCount: integer('point_count').notNull(),
  createdAt: createdAt(),
});

export const rideMessages = pgTable('ride_messages', {
  id: id(),
  rideId: uuid('ride_id').notNull().references(() => rides.id, { onDelete: 'cascade' }),
  senderUserId: uuid('sender_user_id'),
  senderKind: varchar('sender_kind', { length: 20 }).notNull(),
  body: text('body').notNull(),
  channel: varchar('channel', { length: 20 }).notNull().default('in_app'),
  sentAt: createdAt(),
  readAt: tz('read_at'),
}, (t) => [index('ride_messages_ride_idx').on(t.rideId, t.sentAt)]);

export const scheduledAssignments = pgTable('scheduled_assignments', {
  id: id(),
  rideId: uuid('ride_id').notNull().references(() => rides.id, { onDelete: 'cascade' }),
  driverId: uuid('driver_id').notNull().references(() => drivers.id),
  proposedAt: createdAt(),
  confirmedAt: tz('confirmed_at'),
  declinedAt: tz('declined_at'),
  remindersSent: smallint('reminders_sent').notNull().default(0),
  operatorAlertedAt: tz('operator_alerted_at'),
}, (t) => [index('scheduled_assignments_ride_idx').on(t.rideId), uniqueIndex('scheduled_assignments_active_unique').on(t.rideId).where(sql`${t.declinedAt} IS NULL`)]);
