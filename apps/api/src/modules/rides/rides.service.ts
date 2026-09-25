/**
 * Courses (sections 5.2, 5.3, 5.10, 7.2, prompt 05) : création à partir d'un devis (idempotente, atomique), cycle de
 * vie par la machine à états du domaine (chaque transition enregistre l'acteur dans `ride_events`, rejouer une
 * transition ne crée pas de doublon), frais d'annulation et de non-présentation depuis `settings` (calculés sous
 * verrou), prix final à la fin de course (attente dans la limite du prix maximal consenti), trace de course, messagerie
 * masquée, partage, SOS, attribution forcée par l'opérateur. Les événements de domaine sont publiés pour la
 * répartition (étape 6), les paiements (7), la facturation (9).
 */
import { schema } from '@neomoov/db';
import {
  ACTIVE_RIDE_STATES, canTransition, clientCancellationFeeCents, finalizeQuote, isTerminalState, mulDivRound, noShowCheck, parseSearchRadii, RIDE_EVENTS, RIDE_TRANSITIONS, subtotalForTotal, transition,
  waitedSecondsBetween, type AdminAssign, type AdminCreateRide, type CancellationRules, type CreateRide, type Language, type NegotiationSummary, type NotificationChannel, type PaymentMethod,
  type Quote, type RideEvent, type RideMessageView, type RideState, type RideView, type SosInput, type VehicleCategory,
} from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import type { Logger } from 'pino';
import { AppError } from '../../common/app-error.js';
import { randomToken } from '../../common/crypto.js';
import { DomainEventsService, type RideEventPayload } from '../../common/domain-events.js';
import { describeDuration } from '../../common/format.js';
import { lineLengthMeters, simplifyLine } from '../../common/geo.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { DB, type Database } from '../../infra/db.module.js';
import { hasStaffRole, type UserActor } from '../auth/actor.js';
import { AuditService } from '../audit/audit.service.js';
import { PricingRulesService } from '../pricing/pricing-rules.service.js';
import { categoryAtLeast, currentVehicleJoin, driverEligible, loadEligibilityRules, paymentAccepted, scheduledSlotFree } from './eligibility.js';
import { NotificationsOutbox } from './notifications-outbox.js';
import { PresenceService } from './presence.service.js';
import { dispatchRows, dispatchSummaryOf, driverSummaries, parseGeoPoint, selectRide, selectRides, timestampsOf, toRideView, type RideRow } from './ride-view.js';

export type ActorKind = 'client' | 'driver' | 'operator' | 'system' | 'agent';
export interface ActorRef {
  kind: ActorKind;
  userId: string | null;
}
export const SYSTEM_ACTOR: ActorRef = { kind: 'system', userId: null };

type Executor = Parameters<Parameters<Database['db']['transaction']>[0]>[0];
type RideUpdate = Partial<typeof schema.rides.$inferInsert>;
type QuoteRow = Awaited<ReturnType<RidesService['quoteById']>>;

interface TransitionResult {
  ride: RideRow;
  before: RideRow;
  replayed: boolean;
  effects: readonly string[];
  at: Date;
}

interface Parties {
  clientUserId: string | null;
  driverUserId: string | null;
  clientLanguage: Language;
}

/** Destinataire côté client : l'utilisateur du compte, sinon l'invité par texto. */
export interface ClientRecipient {
  recipientUserId: string | null;
  recipientAddress: string | null;
  channel: NotificationChannel;
  language: Language;
}

function constraintOf(error: unknown): string | null {
  const e = error as { code?: string; constraint_name?: string; cause?: { code?: string; constraint_name?: string } };
  const code = e?.code ?? e?.cause?.code;
  return code === '23505' ? (e?.constraint_name ?? e?.cause?.constraint_name ?? '23505') : null;
}

@Injectable()
export class RidesService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly settings: SettingsService,
    private readonly pricingRules: PricingRulesService,
    private readonly events: DomainEventsService,
    private readonly audit: AuditService,
    private readonly outbox: NotificationsOutbox,
    private readonly presence: PresenceService,
  ) {}

  private get db() {
    return this.database.db;
  }

  // --- Lecture ---

  async getRide(id: string): Promise<RideRow> {
    const ride = await selectRide(this.db, id);
    if (!ride) throw AppError.notFound('RIDE_NOT_FOUND', 'Course introuvable');
    return ride;
  }

  async view(ride: RideRow): Promise<RideView> {
    const [view] = await this.views([ride]);
    return view!;
  }

  async viewById(id: string): Promise<RideView> {
    return this.view(await this.getRide(id));
  }

  /**
   * Vues des courses : chauffeur, répartition en cours (`ride_dispatches`, lue ici directement pour ne pas dépendre du
   * service de répartition) et, quand le drapeau `FEATURE_NEGOTIATION` est actif, l'état de la négociation. Drapeau
   * inactif : `negotiation` est toujours null, rien de la négociation ne sort de l'API.
   */
  async views(rides: RideRow[]): Promise<RideView[]> {
    if (!rides.length) return [];
    const open = rides.filter((r) => !isTerminalState(r.state));
    const [drivers, dispatches, radii] = await Promise.all([
      driverSummaries(this.db, rides.map((r) => r.driverId).filter((d): d is string => Boolean(d))),
      dispatchRows(this.db, open.map((r) => r.id)),
      this.settings.get<unknown>('dispatch.search_radii_m', null).then(parseSearchRadii),
    ]);
    const openOffers = new Map<string, number>();
    if (this.env.FEATURE_NEGOTIATION && open.length) {
      const counts = await this.db
        .select({ rideId: schema.rideOffers.rideId, count: sql<number>`count(*)::int` })
        .from(schema.rideOffers)
        .where(and(inArray(schema.rideOffers.rideId, open.map((r) => r.id)), eq(schema.rideOffers.type, 'driver_counter'), eq(schema.rideOffers.state, 'sent'), sql`${schema.rideOffers.expiresAt} > now()`))
        .groupBy(schema.rideOffers.rideId);
      for (const c of counts) openOffers.set(c.rideId, c.count);
    }
    return rides.map((r) => {
      const dispatch = dispatches.get(r.id) ?? null;
      const negotiation: NegotiationSummary | null = this.env.FEATURE_NEGOTIATION
        ? {
            displayedTotalCents: r.quotedTotalCents,
            proposedTotalCents: r.proposedTotalCents,
            agreedTotalCents: r.agreedTotalCents,
            endsAt: dispatch && dispatch.mode === 'negotiation' && dispatch.negotiationEndsAt ? dispatch.negotiationEndsAt.toISOString() : null,
            openOffers: openOffers.get(r.id) ?? 0,
          }
        : null;
      return toRideView(r, r.driverId ? (drivers.get(r.driverId) ?? null) : null, { webBaseUrl: this.env.WEB_BASE_URL, dispatch: dispatch ? dispatchSummaryOf(dispatch, radii) : null, negotiation });
    });
  }

  /** Historique d'un client, du plus récent au plus ancien, par curseur. */
  async listForUser(userId: string, query: { cursor?: string | undefined; limit: number; state?: RideState | undefined }): Promise<{ items: RideView[]; nextCursor: string | null }> {
    const client = await this.clientOfUser(userId);
    const conditions: SQL[] = [or(client ? eq(schema.rides.clientId, client.id) : sql`false`, and(eq(schema.rides.createdByUserId, userId), sql`${schema.rides.guestPhone} IS NULL`))!];
    if (query.state) conditions.push(eq(schema.rides.state, query.state));
    if (query.cursor) {
      const [pivot] = await this.db.select({ createdAt: schema.rides.createdAt }).from(schema.rides).where(eq(schema.rides.id, query.cursor)).limit(1);
      if (pivot) conditions.push(lt(schema.rides.createdAt, pivot.createdAt));
    }
    const rows = await selectRides(this.db, and(...conditions), { limit: query.limit + 1 });
    const page = rows.slice(0, query.limit);
    return { items: await this.views(page), nextCursor: rows.length > query.limit ? page.at(-1)!.id : null };
  }

  /** Courses du chauffeur : en cours d'abord, puis les plus récentes. */
  async listForDriver(driverId: string, limit = 50): Promise<{ active: RideView | null; items: RideView[] }> {
    const rows = await selectRides(this.db, eq(schema.rides.driverId, driverId), { limit });
    const views = await this.views(rows);
    const active = views.find((v) => (ACTIVE_RIDE_STATES as readonly string[]).includes(v.state)) ?? null;
    return { active, items: views };
  }

  async clientOfUser(userId: string): Promise<{ id: string; rideCount: number } | null> {
    const [row] = await this.db.select({ id: schema.clients.id, rideCount: schema.clients.rideCount }).from(schema.clients).where(eq(schema.clients.userId, userId)).limit(1);
    return row ?? null;
  }

  async driverOfUser(userId: string): Promise<{ id: string; status: string; currentVehicleId: string | null } | null> {
    const [row] = await this.db.select({ id: schema.drivers.id, status: schema.drivers.status, currentVehicleId: schema.drivers.currentVehicleId }).from(schema.drivers).where(eq(schema.drivers.userId, userId)).limit(1);
    return row ?? null;
  }

  /**
   * Parties de la course. Le client est l'utilisateur du profil client ; une fiche minimale (invité) n'a pas
   * d'utilisateur client, même si un opérateur l'a créée ; un demandeur sans profil client est le client de sa course.
   */
  private async partiesOf(ride: RideRow): Promise<Parties> {
    const [client, driver] = await Promise.all([
      ride.clientId ? this.db.select({ userId: schema.clients.userId, language: schema.users.language }).from(schema.clients).innerJoin(schema.users, eq(schema.users.id, schema.clients.userId)).where(eq(schema.clients.id, ride.clientId)).limit(1) : Promise.resolve([]),
      ride.driverId ? this.db.select({ userId: schema.drivers.userId }).from(schema.drivers).where(eq(schema.drivers.id, ride.driverId)).limit(1) : Promise.resolve([]),
    ]);
    const clientUserId = client[0]?.userId ?? (ride.guestPhone ? null : (ride.createdByUserId ?? null));
    return { clientUserId, driverUserId: driver[0]?.userId ?? null, clientLanguage: (client[0]?.language ?? ride.guestLanguage ?? 'fr') as Language };
  }

  /** Destinataire des notifications côté client (5.14) : compte (push) ou invité (texto). */
  async recipientOf(ride: RideRow): Promise<ClientRecipient> {
    const parties = await this.partiesOf(ride);
    if (parties.clientUserId) return { recipientUserId: parties.clientUserId, recipientAddress: null, channel: 'push', language: parties.clientLanguage };
    return { recipientUserId: null, recipientAddress: ride.guestPhone ?? ride.passengerPhone ?? null, channel: 'sms', language: parties.clientLanguage };
  }

  /** Rôle de l'acteur sur cette course ; 403 s'il n'en a aucun. */
  async participantKind(ride: RideRow, actor: UserActor): Promise<ActorKind> {
    if (hasStaffRole(actor.roles)) return 'operator';
    const parties = await this.partiesOf(ride);
    if (parties.driverUserId && parties.driverUserId === actor.userId) return 'driver';
    if (parties.clientUserId === actor.userId) return 'client';
    throw AppError.forbidden('NOT_RIDE_PARTICIPANT', 'Vous ne participez pas à cette course');
  }

  private async cancellationRules(): Promise<CancellationRules> {
    const [freeCancellationSeconds, cancellationFeeCents, noShowFeeCents, noShowMinWaitSeconds, noShowMinContacts] = await Promise.all([
      this.settings.number('rides.free_cancellation_seconds', 120),
      this.settings.number('rides.cancellation_fee_cents', 500),
      this.settings.number('rides.no_show_fee_cents', 700),
      this.settings.number('rides.no_show_min_wait_seconds', 300),
      this.settings.number('rides.no_show_min_contacts', 2),
    ]);
    return { freeCancellationSeconds, cancellationFeeCents, noShowFeeCents, noShowMinWaitSeconds, noShowMinContacts };
  }

  private async leadTimeError(): Promise<AppError> {
    const minLead = await this.settings.number('rides.min_lead_seconds', 7200);
    return new AppError('LEAD_TIME_TOO_SHORT', `Réservez au moins ${describeDuration(minLead)} à l'avance`, 400, { minLeadSeconds: minLead });
  }

  // --- Création ---

  /** POST /v1/rides : à partir d'un devis valide du demandeur ; la même clé d'idempotence renvoie la même course. */
  async createFromQuote(input: CreateRide, actor: UserActor, idempotencyKey: string): Promise<{ ride: RideView; created: boolean }> {
    const existing = await this.byIdempotencyKey(idempotencyKey, actor.userId);
    if (existing) return { ride: await this.view(existing), created: false };
    const client = await this.clientOfUser(actor.userId);
    if (!client) throw AppError.forbidden('CLIENT_PROFILE_REQUIRED', 'Un profil client est requis pour réserver');
    const quote = await this.quoteById(input.quoteId);
    const type = await this.checkQuoteForRide(quote, { userId: actor.userId, clientId: client.id, maxConsentedCents: input.maxConsentedCents, requestedType: input.type });
    const requested = input.vehicleId
      ? await this.requestedVehicle(input.vehicleId, { category: quote.category, requestedAt: quote.requestedAt, paymentChoice: input.paymentChoice, paymentMethod: input.paymentMethod })
      : undefined;
    try {
      const ride = await this.db.transaction((tx) =>
        this.insertRide(tx, input.quoteId, {
          clientId: client.id,
          createdByUserId: actor.userId,
          type,
          paymentMethod: input.paymentMethod,
          paymentChoice: input.paymentChoice,
          passengerName: input.passenger?.name ?? null,
          passengerPhone: input.passenger?.phone ?? null,
          flightNumber: input.flightNumber ?? null,
          preferences: input.preferences,
          specialRequests: input.specialRequests ?? null,
          idempotencyKey,
        }, { kind: 'client', userId: actor.userId }, requested),
      );
      await this.afterCreation(ride, { kind: 'client', userId: actor.userId });
      return { ride: await this.view(ride), created: true };
    } catch (error) {
      const constraint = constraintOf(error);
      if (constraint === 'rides_idempotency_key_unique') {
        const replay = await this.byIdempotencyKey(idempotencyKey, actor.userId);
        if (replay) return { ride: await this.view(replay), created: false };
      }
      if (constraint === 'rides_quote_unique') throw AppError.conflict('QUOTE_ALREADY_USED', 'Ce devis a déjà servi à une course');
      throw error;
    }
  }

  /** POST /v1/admin/rides : création par l'opérateur, avec un compte client ou une fiche minimale. */
  async createByOperator(input: AdminCreateRide, actor: UserActor): Promise<RideView> {
    const client = input.clientUserId ? await this.clientOfUser(input.clientUserId) : null;
    if (input.clientUserId && !client) throw AppError.notFound('CLIENT_NOT_FOUND', 'Aucun profil client pour cet utilisateur');
    const quote = await this.quoteById(input.quoteId);
    const type = quote.requestedAt ? 'scheduled' : 'immediate';
    if (type === 'immediate' && !this.env.FEATURE_IMMEDIATE_RIDES) throw await this.leadTimeError();
    try {
      const ride = await this.db.transaction((tx) =>
        this.insertRide(tx, quote.id, {
          clientId: client?.id ?? null,
          guestName: client ? null : (input.guest?.name ?? null),
          guestPhone: client ? null : (input.guest?.phone ?? null),
          guestLanguage: client ? null : (input.guest?.language ?? 'fr'),
          createdByUserId: actor.userId,
          type,
          paymentMethod: input.paymentMethod,
          paymentChoice: input.paymentChoice,
          passengerName: input.passenger?.name ?? null,
          passengerPhone: input.passenger?.phone ?? null,
          flightNumber: input.flightNumber ?? null,
          preferences: {},
          specialRequests: input.specialRequests ?? null,
          idempotencyKey: null,
        }, { kind: 'operator', userId: actor.userId }),
      );
      await this.afterCreation(ride, { kind: 'operator', userId: actor.userId });
      this.audit.record({ action: 'admin.ride_created', entity: 'rides', entityId: ride.id, after: { publicNumber: ride.publicNumber, guest: Boolean(input.guest) } });
      return this.view(ride);
    } catch (error) {
      if (constraintOf(error) === 'rides_quote_unique') throw AppError.conflict('QUOTE_ALREADY_USED', 'Ce devis a déjà servi à une course');
      throw error;
    }
  }

  /**
   * D37 : véhicule choisi par le client, pour une réservation planifiée seulement ; mêmes règles que la liste des
   * véhicules libres et la répartition (`eligibility.ts`) : véhicule courant actif, chauffeur éligible et libre sur le
   * créneau, mode de paiement accepté, catégorie réservée ou supérieure.
   */
  private async requestedVehicle(vehicleId: string, booking: { category: string; requestedAt: Date | null; paymentChoice: string; paymentMethod: string }): Promise<{ requestedVehicleId: string; requestedDriverId: string }> {
    if (!booking.requestedAt) throw new AppError('VEHICLE_CHOICE_SCHEDULED_ONLY', 'Le choix précis du véhicule se fait pour une réservation planifiée', 400);
    const rules = await loadEligibilityRules(this.settings);
    const rows = await this.db.execute<{ driver_id: string; rank_ok: boolean; eligible: boolean }>(sql`
      SELECT d.id AS driver_id, ${categoryAtLeast(booking.category)} AS rank_ok,
             (${driverEligible(rules)} AND ${scheduledSlotFree(rules, booking.requestedAt)} AND ${paymentAccepted(booking.paymentChoice, booking.paymentMethod)}) AS eligible
      FROM drivers d ${currentVehicleJoin}
      WHERE v.id = ${vehicleId}::uuid`);
    const row = rows[0];
    if (row && !row.rank_ok) throw AppError.conflict('VEHICLE_CATEGORY_TOO_LOW', 'Ce véhicule est d\'une catégorie inférieure à celle réservée');
    if (!row?.eligible) throw AppError.conflict('VEHICLE_NOT_AVAILABLE', 'Ce véhicule n\'est plus disponible sur ce créneau ou pour ce mode de paiement : choisissez-en un autre ou laissez-nous attribuer');
    return { requestedVehicleId: vehicleId, requestedDriverId: row.driver_id };
  }

  private async byIdempotencyKey(key: string, userId: string): Promise<RideRow | null> {
    const [existing] = await selectRides(this.db, eq(schema.rides.idempotencyKey, key), { limit: 1 });
    if (!existing) return null;
    if (existing.createdByUserId !== userId) throw AppError.conflict('IDEMPOTENCY_KEY_REUSED', 'Cette clé d\'idempotence appartient à une autre demande');
    return existing;
  }

  private async checkQuoteForRide(quote: QuoteRow, check: { userId: string; clientId: string; maxConsentedCents: number; requestedType: 'immediate' | 'scheduled' }): Promise<'immediate' | 'scheduled'> {
    if (quote.createdByUserId !== check.userId && quote.clientId !== check.clientId) throw AppError.forbidden('QUOTE_NOT_YOURS', 'Ce devis appartient à un autre utilisateur');
    if (quote.validUntil.getTime() < Date.now()) throw new AppError('QUOTE_EXPIRED', 'Devis expiré : demandez un nouveau prix', 400);
    if (check.maxConsentedCents !== quote.maxConsentedCents) throw AppError.conflict('QUOTE_MISMATCH', 'Le prix maximal consenti ne correspond pas au devis', { expected: quote.maxConsentedCents });
    const type = quote.requestedAt ? 'scheduled' : 'immediate';
    if (check.requestedType !== type) throw new AppError('RIDE_TYPE_MISMATCH', type === 'scheduled' ? 'Ce devis est une réservation planifiée' : 'Ce devis est une course immédiate', 400, { expected: type });
    if (type === 'immediate' && !this.env.FEATURE_IMMEDIATE_RIDES) throw await this.leadTimeError();
    return type;
  }

  private async quoteById(id: string, tx: Executor | Database['db'] = this.db, forUpdate = false) {
    let query = tx
      .select({
        id: schema.quotes.id, clientId: schema.quotes.clientId, createdByUserId: schema.quotes.createdByUserId, cityCode: schema.quotes.cityCode, category: schema.quotes.category,
        originAddress: schema.quotes.originAddress, destinationAddress: schema.quotes.destinationAddress, stops: schema.quotes.stops, distanceMeters: schema.quotes.distanceMeters,
        durationSeconds: schema.quotes.durationSeconds, requestedAt: schema.quotes.requestedAt, fareCents: schema.quotes.fareCents, serviceFeeCents: schema.quotes.serviceFeeCents,
        regulatoryFeeCents: schema.quotes.regulatoryFeeCents, gstCents: schema.quotes.gstCents, qstCents: schema.quotes.qstCents, creditsAppliedCents: schema.quotes.creditsAppliedCents,
        totalCents: schema.quotes.totalCents, maxConsentedCents: schema.quotes.maxConsentedCents, options: schema.quotes.options, promoCode: schema.quotes.promoCode,
        flatRateCode: schema.quotes.flatRateCode, tollsCents: schema.quotes.tollsCents, promotionDiscountCents: schema.quotes.promotionDiscountCents,
        alignmentDiscountCents: schema.quotes.alignmentDiscountCents, validUntil: schema.quotes.validUntil,
        originGeo: sql<string>`ST_AsGeoJSON(${schema.quotes.originPosition})`, destinationGeo: sql<string>`ST_AsGeoJSON(${schema.quotes.destinationPosition})`,
      })
      .from(schema.quotes)
      .where(eq(schema.quotes.id, id))
      .limit(1)
      .$dynamic();
    if (forUpdate) query = query.for('update', { of: schema.quotes });
    const [row] = await query;
    if (!row) throw AppError.notFound('QUOTE_NOT_FOUND', 'Devis introuvable');
    return row;
  }

  /** Insertion sous verrou du devis : un devis ne sert qu'une fois, même sous deux demandes concurrentes. */
  private async insertRide(tx: Executor, quoteId: string, fields: RideUpdate & { type: 'immediate' | 'scheduled'; paymentMethod: PaymentMethod; paymentChoice: 'prepaid' | 'pay_driver_after' }, actor: ActorRef, extraOptions?: Record<string, unknown>): Promise<RideRow> {
    const quote = await this.quoteById(quoteId, tx, true);
    const [used] = await tx.select({ id: schema.rides.id }).from(schema.rides).where(eq(schema.rides.quoteId, quote.id)).limit(1);
    if (used) throw AppError.conflict('QUOTE_ALREADY_USED', 'Ce devis a déjà servi à une course', { rideId: used.id });
    const now = new Date();
    const [org] = await tx.select({ id: schema.organizations.id }).from(schema.organizations).where(eq(schema.organizations.code, 'neomoov')).limit(1);
    const [city] = await tx.select({ timeZone: schema.cities.timeZone }).from(schema.cities).where(eq(schema.cities.code, quote.cityCode)).limit(1);
    const [numberRow] = await tx.execute<{ n: string }>(sql`SELECT next_ride_public_number(${city?.timeZone ?? 'America/Toronto'}) AS n`);
    const [inserted] = await tx
      .insert(schema.rides)
      .values({
        publicNumber: numberRow!.n,
        cityCode: quote.cityCode,
        quoteId: quote.id,
        reservedCategory: quote.category,
        state: 'requested',
        requestedAt: quote.requestedAt,
        originAddress: quote.originAddress,
        originPosition: parseGeoPoint(quote.originGeo),
        destinationAddress: quote.destinationAddress,
        destinationPosition: parseGeoPoint(quote.destinationGeo),
        stops: quote.stops,
        options: extraOptions ? { ...((quote.options ?? {}) as Record<string, unknown>), ...extraOptions } : quote.options,
        favoriteDriverRequested: Boolean((quote.options as { favouriteDriverId?: string } | null)?.favouriteDriverId),
        maxConsentedCents: quote.maxConsentedCents,
        quotedTotalCents: quote.totalCents,
        fareCents: quote.fareCents,
        serviceFeeCents: quote.serviceFeeCents,
        regulatoryFeeCents: quote.regulatoryFeeCents,
        gstCents: quote.gstCents,
        qstCents: quote.qstCents,
        tollsCents: quote.tollsCents,
        promotionDiscountCents: quote.promotionDiscountCents,
        creditsAppliedCents: quote.creditsAppliedCents,
        distanceMeters: quote.distanceMeters,
        durationSeconds: quote.durationSeconds,
        organizationId: org?.id ?? null,
        stateTimestamps: { requested: now.toISOString() },
        ...fields,
      })
      .returning({ id: schema.rides.id });
    await tx.insert(schema.rideEvents).values({ rideId: inserted!.id, type: 'client_confirms', fromState: 'quoted', toState: 'requested', actorUserId: actor.userId, actorKind: actor.kind, data: { quoteId: quote.id, type: fields.type }, occurredAt: now });
    return (await selectRide(tx as unknown as Database['db'], inserted!.id))!;
  }

  private async afterCreation(ride: RideRow, actor: ActorRef): Promise<void> {
    const parties = await this.partiesOf(ride);
    const payload = this.payload(ride, parties, null, 'requested', 'client_confirms', actor, ride.createdAt);
    this.events.emit('ride.requested', payload);
    this.events.emit('ride.state_changed', payload);
    const recipient = await this.recipientOf(ride);
    await this.outbox.queue({ ...recipient, template: ride.type === 'scheduled' ? 'ride.scheduled_confirmed' : 'ride.requested', data: { rideId: ride.id, publicNumber: ride.publicNumber, requestedAt: ride.requestedAt?.toISOString() ?? null } });
  }

  private payload(ride: RideRow, parties: Parties, fromState: RideState | null, toState: RideState, event: string, actor: ActorRef, at: Date, data?: Record<string, unknown>): RideEventPayload {
    return { rideId: ride.id, publicNumber: ride.publicNumber, clientId: ride.clientId, clientUserId: parties.clientUserId, driverId: ride.driverId, driverUserId: parties.driverUserId, fromState, toState, event, actor: { kind: actor.kind, userId: actor.userId }, data, occurredAt: at };
  }

  // --- Machine à états ---

  /**
   * Applique une transition sous verrou : l'état n'est jamais modifié autrement. Rejouer la transition qui a mené à
   * l'état courant (dernière transition identique) renvoie la course telle quelle (idempotence) ; toute autre transition
   * impossible est un 409. Les champs à poser peuvent dépendre de l'état lu sous verrou (`set` fonction).
   */
  private async applyTransition(rideId: string, event: RideEvent, actor: ActorRef, options: { guards?: Record<string, boolean>; data?: Record<string, unknown>; set?: RideUpdate | ((ride: RideRow) => RideUpdate) } = {}): Promise<TransitionResult> {
    return this.db.transaction(async (tx) => {
      const ride = await selectRide(tx as unknown as Database['db'], rideId, true);
      if (!ride) throw AppError.notFound('RIDE_NOT_FOUND', 'Course introuvable');
      if (!canTransition(ride.state, event, options.guards)) {
        const replay = RIDE_TRANSITIONS.find((t) => t.event === event && t.to === ride.state);
        if (replay) {
          const [last] = await tx
            .select({ type: schema.rideEvents.type })
            .from(schema.rideEvents)
            .where(and(eq(schema.rideEvents.rideId, rideId), inArray(schema.rideEvents.type, [...RIDE_EVENTS])))
            .orderBy(desc(schema.rideEvents.occurredAt))
            .limit(1);
          if (last?.type === event) return { ride, before: ride, replayed: true, effects: [], at: new Date() };
        }
        throw AppError.conflict('RIDE_INVALID_TRANSITION', `Transition impossible depuis l'état ${ride.state}`, { state: ride.state, event });
      }
      const { to, effects } = transition(ride.state, event, options.guards);
      const at = new Date();
      const set = typeof options.set === 'function' ? options.set(ride) : (options.set ?? {});
      await tx
        .update(schema.rides)
        .set({ ...set, state: to, stateTimestamps: sql`${schema.rides.stateTimestamps} || ${JSON.stringify({ [to]: at.toISOString() })}::jsonb` })
        .where(eq(schema.rides.id, rideId));
      await tx.insert(schema.rideEvents).values({ rideId, type: event, fromState: ride.state, toState: to, actorUserId: actor.userId, actorKind: actor.kind, data: { ...(options.data ?? {}), effects }, occurredAt: at });
      const fresh = (await selectRide(tx as unknown as Database['db'], rideId))!;
      return { ride: fresh, before: ride, replayed: false, effects, at };
    });
  }

  private async publish(result: TransitionResult, event: RideEvent, actor: ActorRef, data?: Record<string, unknown>): Promise<RideEventPayload> {
    const parties = await this.partiesOf(result.ride);
    const payload = this.payload(result.ride, parties, result.before.state, result.ride.state, event, actor, result.at, data);
    if (!result.replayed) this.events.emit('ride.state_changed', payload);
    return payload;
  }

  /** Signal sans changement d'état dans `ride_events` (répartition, négociation, incidents) ; jamais un événement de transition. */
  async mark(rideId: string, type: string, actor: ActorRef, data: Record<string, unknown>): Promise<void> {
    if ((RIDE_EVENTS as readonly string[]).includes(type)) throw new Error(`Le signal ${type} est un événement de transition : utilisez la machine à états`);
    // Une seule requête (état lu et signal écrit ensemble) : la répartition en enchaîne plusieurs avant chaque offre.
    const rows = await this.db.execute<{ id: string }>(sql`
      INSERT INTO ride_events (ride_id, type, from_state, to_state, actor_user_id, actor_kind, data)
      SELECT r.id, ${type}::varchar, r.state, r.state, ${actor.userId}::uuid, ${actor.kind}::varchar, ${JSON.stringify(data)}::jsonb FROM rides r WHERE r.id = ${rideId}::uuid
      RETURNING id`);
    if (!rows.length) throw AppError.notFound('RIDE_NOT_FOUND', 'Course introuvable');
  }

  /**
   * Transitions de la répartition (5.4) : offres envoyées, nouvelle vague, aucun chauffeur trouvé. La dernière alerte
   * le client et l'exploitation, et publie `ride.no_driver` (l'étape 7 y annule l'autorisation de paiement).
   */
  async systemTransition(rideId: string, event: 'offers_sent' | 'new_wave' | 'no_driver_found', data: Record<string, unknown> = {}): Promise<RideRow> {
    const result = await this.applyTransition(rideId, event, SYSTEM_ACTOR, { data });
    const payload = await this.publish(result, event, SYSTEM_ACTOR, data);
    if (event === 'no_driver_found' && !result.replayed) {
      this.events.emit('ride.no_driver', payload);
      const recipient = await this.recipientOf(result.ride);
      await this.outbox.queue({ ...recipient, template: 'ride.no_driver', data: { rideId, publicNumber: result.ride.publicNumber } });
      await this.outbox.queueForStaff('alert.no_driver', { rideId, publicNumber: result.ride.publicNumber, ...data });
      this.logger.warn({ rideId, publicNumber: result.ride.publicNumber }, 'Course sans chauffeur : alerte à l\'exploitation');
    }
    return result.ride;
  }

  // --- Attribution (opérateur, confirmation d'une planifiée ; la répartition automatique arrive à l'étape 6) ---

  async assign(rideId: string, input: AdminAssign, actor: ActorRef): Promise<RideView> {
    const ride = await this.getRide(rideId);
    if (ride.state === 'assigned' && ride.driverId === input.driverId) return this.view(ride);
    if ((ACTIVE_RIDE_STATES as readonly string[]).includes(ride.state) || isTerminalState(ride.state)) {
      throw AppError.conflict('RIDE_ALREADY_ASSIGNED', 'La course a déjà un chauffeur ou est close', { state: ride.state, driverId: ride.driverId });
    }
    const [driver] = await this.db.select({ id: schema.drivers.id, status: schema.drivers.status, currentVehicleId: schema.drivers.currentVehicleId, userId: schema.drivers.userId }).from(schema.drivers).where(eq(schema.drivers.id, input.driverId)).limit(1);
    if (!driver) throw AppError.notFound('DRIVER_NOT_FOUND', 'Chauffeur introuvable');
    if (driver.status !== 'active') throw AppError.conflict('DRIVER_NOT_ACTIVE', 'Ce chauffeur n\'est pas actif', { status: driver.status });
    const vehicleId = input.vehicleId ?? driver.currentVehicleId;
    if (!vehicleId) throw AppError.conflict('VEHICLE_REQUIRED', 'Ce chauffeur n\'a pas de véhicule courant');
    const [vehicle] = await this.db.select({ id: schema.vehicles.id, category: schema.vehicles.category, status: schema.vehicles.status, driverId: schema.vehicles.driverId }).from(schema.vehicles).where(eq(schema.vehicles.id, vehicleId)).limit(1);
    if (!vehicle || vehicle.driverId !== driver.id || vehicle.status !== 'active') throw AppError.conflict('VEHICLE_NOT_ELIGIBLE', 'Véhicule introuvable, inactif ou d\'un autre chauffeur');
    // Garantie modèle (5.2) : la catégorie servie est au moins celle réservée.
    const ranks = await this.db.select({ code: schema.vehicleCategories.code, rank: schema.vehicleCategories.rank }).from(schema.vehicleCategories);
    const rankOf = (code: string) => ranks.find((r) => r.code === code)?.rank ?? 0;
    if (rankOf(vehicle.category) < rankOf(ride.reservedCategory)) throw AppError.conflict('VEHICLE_CATEGORY_TOO_LOW', 'Le véhicule est d\'une catégorie inférieure à celle réservée', { reserved: ride.reservedCategory, vehicle: vehicle.category });

    if (ride.state === 'requested') {
      const offered = await this.applyTransition(rideId, 'offers_sent', SYSTEM_ACTOR, { data: { forced: true } });
      await this.publish(offered, 'offers_sent', SYSTEM_ACTOR);
    }
    const result = await this.applyTransition(rideId, 'driver_accepts', actor, {
      guards: { vehicle_category_at_least_reserved: true },
      data: { driverId: driver.id, vehicleId: vehicle.id, forced: actor.kind !== 'driver' },
      set: { driverId: driver.id, vehicleId: vehicle.id, servedCategory: vehicle.category },
    });
    if (result.ride.type === 'scheduled') {
      await this.db.insert(schema.scheduledAssignments).values({ rideId, driverId: driver.id, confirmedAt: result.at }).onConflictDoNothing();
      await this.db.update(schema.scheduledAssignments).set({ confirmedAt: result.at }).where(and(eq(schema.scheduledAssignments.rideId, rideId), eq(schema.scheduledAssignments.driverId, driver.id)));
    }
    const payload = await this.publish(result, 'driver_accepts', actor, { driverId: driver.id });
    if (!result.replayed) {
      this.events.emit('ride.assigned', payload);
      const recipient = await this.recipientOf(result.ride);
      await this.outbox.queue([
        { ...recipient, template: 'ride.assigned', data: { rideId, driverId: driver.id } },
        { recipientUserId: driver.userId, template: 'ride.assigned_to_you', data: { rideId } },
      ]);
      // Course réservée pour un tiers (parcours 4) : le passager reçoit par texto le lien de suivi public.
      if (await this.passengerNeedsTracking(result.ride)) {
        const trackingUrl = this.trackingUrl(await this.trackingTokenOf(result.ride, SYSTEM_ACTOR));
        await this.outbox.queue({ recipientUserId: null, recipientAddress: result.ride.passengerPhone!, channel: 'sms', language: recipient.language, template: 'ride.passenger_tracking', data: { rideId, trackingUrl, passengerName: result.ride.passengerName } });
      }
      this.audit.record({ action: actor.kind === 'operator' ? 'admin.ride_assigned' : 'ride.assigned', entity: 'rides', entityId: rideId, after: { driverId: driver.id, vehicleId: vehicle.id, note: input.note ?? null } });
    }
    return this.view(result.ride);
  }

  // --- Annulations ---

  async cancelByClient(rideId: string, actor: UserActor, input: { reason: string; comment?: string | undefined }): Promise<{ state: RideState; feeCents: number }> {
    const ride = await this.getRide(rideId);
    const kind = await this.participantKind(ride, actor);
    if (kind === 'driver') throw AppError.forbidden('NOT_CLIENT', 'Le chauffeur annule par son propre endpoint');
    const rules = await this.cancellationRules();
    // Les frais dépendent de l'état lu sous verrou : une annulation qui croise « en route » paie le tarif d'annulation.
    const result = await this.applyTransition(rideId, 'client_cancels', { kind, userId: actor.userId }, {
      data: { reason: input.reason },
      set: (locked) => {
        const assignedAt = timestampsOf(locked).assigned;
        const feeCents = clientCancellationFeeCents({ state: locked.state, assignedAt: assignedAt ? new Date(assignedAt) : null, now: new Date() }, rules);
        return { cancellationReason: input.reason, cancellationComment: input.comment ?? null, cancellationFeeCents: feeCents };
      },
    });
    const feeCents = result.ride.cancellationFeeCents;
    const payload = await this.publish(result, 'client_cancels', { kind, userId: actor.userId }, { feeCents });
    if (!result.replayed) {
      this.events.emit('ride.cancelled_by_client', { ...payload, feeCents });
      if (payload.driverUserId) await this.outbox.queue({ recipientUserId: payload.driverUserId, template: 'ride.cancelled_by_client', data: { rideId, feeCents } });
    }
    return { state: result.ride.state, feeCents };
  }

  async cancelByDriver(rideId: string, driverActor: UserActor, reason: string): Promise<RideView> {
    await this.rideOfDriver(rideId, driverActor);
    const released = await this.releaseDriver(rideId, { kind: 'driver', userId: driverActor.userId }, reason, { sanction: true, source: 'driver' });
    return this.view(released.ride);
  }

  /**
   * Retire le chauffeur d'une course attribuée et la remet en demande avec priorité (5.2) : annulation du chauffeur
   * (sanction si déjà en route), retrait par l'opérateur ou par la surveillance du départ (sans sanction). La
   * réattribution est consommée par la répartition (`ride.reassign_requested`, `data.source`).
   */
  async releaseDriver(rideId: string, actor: ActorRef, reason: string, options: { sanction: boolean; source: 'driver' | 'operator' | 'system' }): Promise<{ ride: RideRow; previousDriverId: string; replayed: boolean }> {
    const current = await this.getRide(rideId);
    const previousDriverId = current.driverId;
    if (!previousDriverId) throw AppError.conflict('RIDE_NOT_ASSIGNED', 'La course n\'a pas de chauffeur à retirer', { state: current.state });
    const cancellationReason = options.source === 'driver' ? 'driver' : options.source === 'operator' ? 'operator_reassign' : 'no_movement';
    const cancelled = await this.applyTransition(rideId, 'driver_cancels', actor, { data: { reason, driverId: previousDriverId, source: options.source }, set: { cancellationReason, cancellationComment: reason } });
    const payload = await this.publish(cancelled, 'driver_cancels', actor, { reason, source: options.source });
    if (cancelled.replayed) return { ride: cancelled.ride, previousDriverId, replayed: true };
    if (options.source === 'driver') this.events.emit('ride.cancelled_by_driver', { ...payload, reason });
    // Réattribution immédiate avec priorité : la course redevient demandée, sans chauffeur.
    const reassigned = await this.applyTransition(rideId, 'reassign', SYSTEM_ACTOR, { data: { previousDriverId, priority: true, source: options.source }, set: { driverId: null, vehicleId: null, servedCategory: null } });
    // Une planifiée redevient ouverte aux propositions : celle du chauffeur retiré est retirée.
    await this.db.update(schema.scheduledAssignments).set({ declinedAt: reassigned.at }).where(and(eq(schema.scheduledAssignments.rideId, rideId), eq(schema.scheduledAssignments.driverId, previousDriverId), sql`${schema.scheduledAssignments.declinedAt} IS NULL`));
    const reassignPayload = await this.publish(reassigned, 'reassign', SYSTEM_ACTOR, { previousDriverId, source: options.source });
    this.events.emit('ride.reassign_requested', reassignPayload);
    const recipient = await this.recipientOf(reassigned.ride);
    await this.outbox.queue({ ...recipient, template: 'ride.reassigning', data: { rideId } });
    if (options.sanction && cancelled.effects.includes('driver_sanction')) this.audit.record({ action: 'ride.driver_cancellation_after_en_route', entity: 'drivers', entityId: previousDriverId, after: { rideId, reason } });
    if (options.source !== 'driver') this.audit.record({ action: options.source === 'operator' ? 'admin.ride_driver_released' : 'ride.driver_released_no_movement', entity: 'rides', entityId: rideId, after: { previousDriverId, reason } });
    return { ride: reassigned.ride, previousDriverId, replayed: false };
  }

  // --- Déroulé chauffeur ---

  private async rideOfDriver(rideId: string, actor: UserActor) {
    const driver = await this.driverOfUser(actor.userId);
    if (!driver) throw AppError.forbidden('DRIVER_PROFILE_REQUIRED', 'Profil chauffeur requis');
    const ride = await this.getRide(rideId);
    if (ride.driverId !== driver.id) throw AppError.forbidden('NOT_RIDE_DRIVER', 'Cette course n\'est pas attribuée à ce chauffeur');
    return { ride, driver };
  }

  private async driverStep(rideId: string, actor: UserActor, event: 'driver_departs' | 'driver_arrives', template: string): Promise<RideView> {
    await this.rideOfDriver(rideId, actor);
    const result = await this.applyTransition(rideId, event, { kind: 'driver', userId: actor.userId });
    await this.publish(result, event, { kind: 'driver', userId: actor.userId });
    if (!result.replayed) {
      const recipient = await this.recipientOf(result.ride);
      await this.outbox.queue({ ...recipient, template, data: { rideId } });
    }
    return this.view(result.ride);
  }

  depart(rideId: string, actor: UserActor): Promise<RideView> {
    return this.driverStep(rideId, actor, 'driver_departs', 'ride.driver_departed');
  }

  arrive(rideId: string, actor: UserActor): Promise<RideView> {
    return this.driverStep(rideId, actor, 'driver_arrives', 'ride.driver_arrived');
  }

  /** Tentative de contact du client (appel masqué, message) : compte pour la non-présentation. */
  async recordContactAttempt(rideId: string, actor: UserActor): Promise<{ contactAttempts: number }> {
    const { ride } = await this.rideOfDriver(rideId, actor);
    if (ride.state !== 'arrived') throw AppError.conflict('RIDE_NOT_ARRIVED', 'Les tentatives de contact se comptent sur place', { state: ride.state });
    const [row] = await this.db.update(schema.rides).set({ contactAttempts: sql`${schema.rides.contactAttempts} + 1` }).where(eq(schema.rides.id, rideId)).returning({ contactAttempts: schema.rides.contactAttempts });
    await this.db.insert(schema.rideEvents).values({ rideId, type: 'contact_attempt', fromState: ride.state, toState: ride.state, actorUserId: actor.userId, actorKind: 'driver', data: { contactAttempts: row!.contactAttempts } });
    return { contactAttempts: row!.contactAttempts };
  }

  async start(rideId: string, actor: UserActor): Promise<RideView> {
    await this.rideOfDriver(rideId, actor);
    const result = await this.applyTransition(rideId, 'ride_starts', { kind: 'driver', userId: actor.userId }, {
      set: (ride) => {
        const arrived = timestampsOf(ride).arrived;
        return { waitedSeconds: waitedSecondsBetween(arrived ? new Date(arrived) : null, new Date()) };
      },
    });
    await this.publish(result, 'ride_starts', { kind: 'driver', userId: actor.userId });
    return this.view(result.ride);
  }

  async declareNoShow(rideId: string, actor: UserActor): Promise<{ state: RideState; feeCents: number }> {
    const { ride } = await this.rideOfDriver(rideId, actor);
    const rules = await this.cancellationRules();
    const arrivedAt = timestampsOf(ride).arrived;
    if (ride.state !== 'arrived' || !arrivedAt) throw AppError.conflict('RIDE_NOT_ARRIVED', 'La non-présentation se déclare sur place', { state: ride.state });
    const check = noShowCheck({ arrivedAt: new Date(arrivedAt), now: new Date(), contactAttempts: ride.contactAttempts }, rules);
    if (!check.allowed) {
      const message = check.reason === 'not_waited_enough'
        ? `Attendez ${describeDuration(rules.noShowMinWaitSeconds)} sur place avant de déclarer une non-présentation`
        : `${rules.noShowMinContacts} tentative${rules.noShowMinContacts > 1 ? 's' : ''} de contact ${rules.noShowMinContacts > 1 ? 'sont requises' : 'est requise'}`;
      throw AppError.conflict('NO_SHOW_NOT_ALLOWED', message, { reason: check.reason, waitedSeconds: check.waitedSeconds, contactAttempts: check.contactAttempts, minWaitSeconds: rules.noShowMinWaitSeconds, minContacts: rules.noShowMinContacts });
    }
    const result = await this.applyTransition(rideId, 'client_no_show', { kind: 'driver', userId: actor.userId }, {
      guards: { waited_five_minutes_and_two_contacts: true },
      data: { feeCents: check.feeCents, waitedSeconds: check.waitedSeconds },
      set: { cancellationFeeCents: check.feeCents, waitedSeconds: check.waitedSeconds },
    });
    const payload = await this.publish(result, 'client_no_show', { kind: 'driver', userId: actor.userId }, { feeCents: check.feeCents });
    if (!result.replayed) {
      this.events.emit('ride.no_show', { ...payload, feeCents: check.feeCents });
      const recipient = await this.recipientOf(result.ride);
      await this.outbox.queue({ ...recipient, template: 'ride.no_show', data: { rideId, feeCents: check.feeCents } });
    }
    return { state: result.ride.state, feeCents: result.ride.cancellationFeeCents };
  }

  /** Fin de course : attente facturée dans la limite du prix maximal consenti, trace, compteurs ; paiement et facture aux étapes 7 et 9. */
  async complete(rideId: string, actor: UserActor, input: { measuredDistanceMeters?: number | undefined; measuredDurationSeconds?: number | undefined }): Promise<RideView> {
    const { ride, driver } = await this.rideOfDriver(rideId, actor);
    if (ride.state !== 'in_progress') {
      if (ride.state === 'completed' || ride.state === 'rated') return this.view(ride);
      throw AppError.conflict('RIDE_INVALID_TRANSITION', `Transition impossible depuis l'état ${ride.state}`, { state: ride.state, event: 'ride_ends' });
    }
    await this.presence.flush();
    const track = await this.buildTrack(rideId);
    const loaded = await this.pricingRules.rulesFor(ride.cityCode);
    const finalQuote = finalizeQuote(this.quoteOfRide(ride, loaded.rules, await this.favouriteWaiverOf(ride)), ride.waitedSeconds, loaded.rules);
    const waitChargeCents = finalQuote.lines.find((l) => l.kind === 'wait_time')?.amountCents ?? 0;
    const measuredDistance = track?.distanceMeters ?? input.measuredDistanceMeters ?? ride.distanceMeters;
    const measuredDuration = track?.durationSeconds ?? input.measuredDurationSeconds ?? ride.durationSeconds;
    const result = await this.applyTransition(rideId, 'ride_ends', { kind: 'driver', userId: actor.userId }, {
      data: { finalPriceCents: finalQuote.totalCents, waitChargeCents, waitedSeconds: ride.waitedSeconds, measuredDistanceMeters: measuredDistance, measuredDurationSeconds: measuredDuration },
      set: {
        finalPriceCents: finalQuote.totalCents,
        waitChargeCents,
        fareCents: finalQuote.fareCents,
        creditsAppliedCents: finalQuote.creditsAppliedCents,
        serviceFeeCents: finalQuote.serviceFeeCents,
        regulatoryFeeCents: finalQuote.regulatoryFeeCents,
        gstCents: finalQuote.gstCents,
        qstCents: finalQuote.qstCents,
        distanceMeters: measuredDistance,
        durationSeconds: measuredDuration,
      },
    });
    const payload = await this.publish(result, 'ride_ends', { kind: 'driver', userId: actor.userId }, { finalPriceCents: finalQuote.totalCents });
    if (!result.replayed) {
      await Promise.all([
        this.db.update(schema.drivers).set({ rideCount: sql`${schema.drivers.rideCount} + 1` }).where(eq(schema.drivers.id, driver.id)),
        ride.clientId ? this.db.update(schema.clients).set({ rideCount: sql`${schema.clients.rideCount} + 1` }).where(eq(schema.clients.id, ride.clientId)) : Promise.resolve(),
        ride.clientId
          ? this.db
              .insert(schema.clientDriverLinks)
              .values({ clientId: ride.clientId, driverId: driver.id, ridesCount: 1, lastRideAt: result.at })
              .onConflictDoUpdate({ target: [schema.clientDriverLinks.clientId, schema.clientDriverLinks.driverId], set: { ridesCount: sql`${schema.clientDriverLinks.ridesCount} + 1`, lastRideAt: result.at } })
          : Promise.resolve(),
      ]);
      this.events.emit('ride.completed', { ...payload, finalPriceCents: finalQuote.totalCents, waitChargeCents });
      const recipient = await this.recipientOf(result.ride);
      await this.outbox.queue([
        { ...recipient, template: 'ride.completed', data: { rideId, finalPriceCents: finalQuote.totalCents } },
        { recipientUserId: actor.userId, template: 'ride.completed_driver', data: { rideId, driverAmountCents: finalQuote.driverAmountCents } },
      ]);
    }
    return this.view(result.ride);
  }

  /**
   * Reconstitue le devis du domaine à partir de la course. Le sous-total est retrouvé depuis le total affiché
   * (`subtotalForTotal`) : il inclut donc la remise d'alignement (D33), que la course ne stocke pas. Un prix convenu par
   * négociation (5.5) remplace le total : l'écart avec le prix affiché est porté par le tarif du chauffeur, les frais
   * de service et la redevance ne se négocient pas.
   */
  private quoteOfRide(ride: RideRow, rules: Parameters<typeof finalizeQuote>[2], favouriteWaiverCents = 0): Quote {
    const baseFareCents = ride.fareCents ?? 0;
    const serviceFeeCents = ride.serviceFeeCents ?? 0;
    const regulatoryFeeCents = ride.regulatoryFeeCents ?? 0;
    const computedSubtotal = baseFareCents - ride.promotionDiscountCents + serviceFeeCents + regulatoryFeeCents + ride.tollsCents;
    const displayedSubtotal = subtotalForTotal(ride.quotedTotalCents, rules) ?? computedSubtotal;
    const alignmentDiscountCents = Math.max(0, computedSubtotal - displayedSubtotal);
    const negotiated = ride.agreedTotalCents !== null;
    // D37 : supplément « chauffeur favori » retiré du tarif quand un autre chauffeur fait la course ; un prix négocié fait foi.
    const waived = negotiated ? 0 : Math.max(0, Math.min(favouriteWaiverCents, baseFareCents));
    const agreedSubtotal = negotiated ? (subtotalForTotal(ride.agreedTotalCents!, rules) ?? displayedSubtotal) : displayedSubtotal;
    const negotiatedCents = agreedSubtotal - displayedSubtotal;
    const subtotalCents = agreedSubtotal - waived;
    const fareCents = Math.max(0, baseFareCents + negotiatedCents - waived);
    const retaxed = negotiated || waived > 0;
    const gstCents = retaxed ? mulDivRound(subtotalCents, rules.gstRatePpm, 1_000_000) : (ride.gstCents ?? 0);
    const qstCents = retaxed ? mulDivRound(subtotalCents, rules.qstRatePpm, 1_000_000) : (ride.qstCents ?? 0);
    const totalCents = negotiated ? ride.agreedTotalCents! : waived > 0 ? subtotalCents + gstCents + qstCents : ride.quotedTotalCents;
    return {
      category: ride.reservedCategory,
      flatRate: false,
      flatRateCode: null,
      lines: waived > 0 ? [{ kind: 'favourite_driver', code: 'favourite_driver', amountCents: -waived }] : [],
      fareCents,
      promotionCode: null,
      promotionDiscountCents: ride.promotionDiscountCents,
      promotionCompensationCents: ride.promotionDiscountCents,
      serviceFeeCents: serviceFeeCents - alignmentDiscountCents,
      regulatoryFeeCents,
      tollsCents: ride.tollsCents,
      alignmentDiscountCents,
      subtotalCents,
      gstCents,
      qstCents,
      totalCents,
      creditsAppliedCents: Math.min(ride.creditsAppliedCents, totalCents),
      amountDueCents: totalCents - Math.min(ride.creditsAppliedCents, totalCents),
      driverAmountCents: fareCents,
      maxConsentedCents: ride.maxConsentedCents,
      ignoredOptions: [],
    };
  }

  /**
   * D37 : le client a demandé un chauffeur favori (supplément du devis) mais un autre chauffeur fait la course : le client
   * a été prévenu et continue sans supplément. Montant exact de la ligne `favourite_driver` du devis.
   */
  private async favouriteWaiverOf(ride: RideRow): Promise<number> {
    const requested = (ride.options as { favouriteDriverId?: string } | null)?.favouriteDriverId;
    if (!requested || !ride.quoteId || ride.driverId === requested) return 0;
    const [quote] = await this.db.select({ lines: schema.quotes.lines }).from(schema.quotes).where(eq(schema.quotes.id, ride.quoteId)).limit(1);
    const lines = Array.isArray(quote?.lines) ? (quote.lines as Array<{ code?: string; kind?: string; amountCents?: number }>) : [];
    const line = lines.find((l) => l.code === 'favourite_driver' || l.kind === 'favourite_driver');
    return Math.max(0, line?.amountCents ?? 0);
  }

  /** Trace de course (8) : positions enregistrées pendant la course, simplifiées, distance et durée mesurées. */
  private async buildTrack(rideId: string): Promise<{ distanceMeters: number; durationSeconds: number; pointCount: number } | null> {
    const rows = await this.db.execute<{ position: string; recorded_at: string }>(sql`SELECT ST_AsGeoJSON(position) AS position, recorded_at FROM driver_locations WHERE ride_id = ${rideId} ORDER BY recorded_at ASC LIMIT 20000`);
    if (rows.length < 2) return null;
    const points = rows.map((r) => parseGeoPoint(r.position));
    const simplified = simplifyLine(points, 10);
    const distanceMeters = Math.round(lineLengthMeters(points));
    const durationSeconds = Math.max(0, Math.round((new Date(rows.at(-1)!.recorded_at).getTime() - new Date(rows[0]!.recorded_at).getTime()) / 1000));
    await this.db
      .insert(schema.rideTracks)
      .values({ rideId, track: { type: 'LineString', coordinates: simplified.map((p) => [p.lng, p.lat]) }, measuredDistanceMeters: distanceMeters, measuredDurationSeconds: durationSeconds, pointCount: rows.length })
      .onConflictDoNothing();
    return { distanceMeters, durationSeconds, pointCount: rows.length };
  }

  // --- Évaluation, partage, messages, SOS ---

  async rate(rideId: string, actor: UserActor, input: { score: number; tags: string[]; comment?: string | undefined; tipCents?: number | undefined }): Promise<RideView> {
    const ride = await this.getRide(rideId);
    const kind = await this.participantKind(ride, actor);
    if (kind !== 'client') throw AppError.forbidden('NOT_CLIENT', 'Seul le client évalue la course');
    if (ride.state !== 'completed' && ride.state !== 'rated') throw AppError.conflict('RIDE_NOT_COMPLETED', 'La course n\'est pas terminée', { state: ride.state });
    const [existing] = await this.db.select({ id: schema.rideRatings.id }).from(schema.rideRatings).where(and(eq(schema.rideRatings.rideId, rideId), eq(schema.rideRatings.authorKind, 'client'))).limit(1);
    if (existing) return this.view(ride);
    await this.db.insert(schema.rideRatings).values({ rideId, authorKind: 'client', authorUserId: actor.userId, score: input.score, tags: input.tags, comment: input.comment ?? null });
    const result = await this.applyTransition(rideId, 'client_rates', { kind: 'client', userId: actor.userId }, { data: { score: input.score, tipCents: input.tipCents ?? 0 }, set: { tipCents: input.tipCents ?? 0 } });
    if (ride.driverId) {
      await this.db
        .update(schema.drivers)
        .set({ ratingAverage: sql`round(((${schema.drivers.ratingAverage} * ${schema.drivers.ratingCount}) + ${input.score})::numeric / (${schema.drivers.ratingCount} + 1), 2)`, ratingCount: sql`${schema.drivers.ratingCount} + 1` })
        .where(eq(schema.drivers.id, ride.driverId));
    }
    await this.publish(result, 'client_rates', { kind: 'client', userId: actor.userId }, { score: input.score });
    return this.view(result.ride);
  }

  async share(rideId: string, actor: UserActor): Promise<{ trackingUrl: string; token: string; expiresAt: string | null }> {
    const ride = await this.getRide(rideId);
    const kind = await this.participantKind(ride, actor);
    const token = await this.trackingTokenOf(ride, { kind, userId: actor.userId });
    return { trackingUrl: this.trackingUrl(token), token, expiresAt: null };
  }

  /**
   * Le passager d'un tiers reçoit le lien de suivi une seule fois par course (pas à chaque réattribution), et jamais
   * quand son numéro est celui du client ou de l'invité qui a réservé.
   */
  private async passengerNeedsTracking(ride: RideRow): Promise<boolean> {
    const phone = ride.passengerPhone;
    if (!phone || phone === ride.guestPhone) return false;
    const parties = await this.partiesOf(ride);
    if (parties.clientUserId) {
      const [client] = await this.db.select({ phone: schema.users.phone }).from(schema.users).where(eq(schema.users.id, parties.clientUserId)).limit(1);
      if (client?.phone === phone) return false;
    }
    const [sent] = await this.db
      .select({ id: schema.notifications.id })
      .from(schema.notifications)
      .where(and(eq(schema.notifications.template, 'ride.passenger_tracking'), eq(schema.notifications.recipientAddress, phone), sql`${schema.notifications.data}->>'rideId' = ${ride.id}`))
      .limit(1);
    return !sent;
  }

  /** Jeton du suivi public de la course, créé au premier partage (client, ou système pour le passager d'un tiers). */
  private async trackingTokenOf(ride: RideRow, actor: ActorRef): Promise<string> {
    if (ride.trackingToken) return ride.trackingToken;
    const token = randomToken(15);
    await this.db.update(schema.rides).set({ trackingToken: token }).where(eq(schema.rides.id, ride.id));
    await this.db.insert(schema.rideEvents).values({ rideId: ride.id, type: 'shared', fromState: ride.state, toState: ride.state, actorUserId: actor.userId, actorKind: actor.kind, data: {} });
    return token;
  }

  private trackingUrl(token: string): string {
    return `${this.env.WEB_BASE_URL.replace(/\/+$/, '')}/suivi/${token}`;
  }

  /** Suivi public : le strict nécessaire, position du chauffeur seulement pendant la course. */
  async publicTracking(token: string) {
    const [ride] = await selectRides(this.db, eq(schema.rides.trackingToken, token), { limit: 1 });
    if (!ride) throw AppError.notFound('TRACKING_NOT_FOUND', 'Lien de suivi introuvable');
    const ttlHours = await this.settings.number('rides.share_link_ttl_hours', 24);
    if (isTerminalState(ride.state) && ride.updatedAt.getTime() + ttlHours * 3_600_000 < Date.now()) throw new AppError('TRACKING_EXPIRED', 'Ce lien de suivi a expiré', 410);
    const view = await this.view(ride);
    const driverPosition = ride.driverId && (ACTIVE_RIDE_STATES as readonly string[]).includes(ride.state) ? await this.presence.positionOf(ride.driverId) : null;
    return {
      publicNumber: ride.publicNumber,
      state: ride.state,
      category: ride.reservedCategory as VehicleCategory,
      destination: { address: ride.destinationAddress },
      requestedAt: ride.requestedAt?.toISOString() ?? null,
      driver: view.driver ? { firstName: view.driver.firstName, vehicle: { make: view.driver.vehicle.make, model: view.driver.vehicle.model, colour: view.driver.vehicle.colour, plate: view.driver.vehicle.plate } } : null,
      driverPosition,
      etaSeconds: null,
      updatedAt: ride.updatedAt.toISOString(),
    };
  }

  async sendMessage(rideId: string, actor: UserActor, body: string): Promise<RideMessageView> {
    const ride = await this.getRide(rideId);
    const kind = await this.participantKind(ride, actor);
    if (isTerminalState(ride.state)) throw AppError.conflict('RIDE_CLOSED', 'La course est terminée, la messagerie est fermée', { state: ride.state });
    const [row] = await this.db.insert(schema.rideMessages).values({ rideId, senderUserId: actor.userId, senderKind: kind, body }).returning();
    if (kind === 'driver' && ride.state === 'arrived') await this.db.update(schema.rides).set({ contactAttempts: sql`${schema.rides.contactAttempts} + 1` }).where(eq(schema.rides.id, rideId));
    this.events.emit('ride.message', { rideId, messageId: row!.id, senderKind: kind, senderUserId: actor.userId, body, sentAt: row!.sentAt });
    if (kind === 'driver') {
      const recipient = await this.recipientOf(ride);
      await this.outbox.queue({ ...recipient, template: 'ride.message', data: { rideId, messageId: row!.id } });
    } else {
      const parties = await this.partiesOf(ride);
      if (parties.driverUserId) await this.outbox.queue({ recipientUserId: parties.driverUserId, template: 'ride.message', data: { rideId, messageId: row!.id } });
    }
    return { id: row!.id, rideId, senderKind: kind as RideMessageView['senderKind'], mine: true, body, sentAt: row!.sentAt.toISOString(), readAt: null };
  }

  async listMessages(rideId: string, actor: UserActor): Promise<RideMessageView[]> {
    const ride = await this.getRide(rideId);
    await this.participantKind(ride, actor);
    const rows = await this.db.select().from(schema.rideMessages).where(eq(schema.rideMessages.rideId, rideId)).orderBy(asc(schema.rideMessages.sentAt));
    return rows.map((m) => ({ id: m.id, rideId, senderKind: m.senderKind as RideMessageView['senderKind'], mine: m.senderUserId === actor.userId, body: m.body, sentAt: m.sentAt.toISOString(), readAt: m.readAt?.toISOString() ?? null }));
  }

  /** SOS : incident de gravité maximale, alerte immédiate à l'exploitation (5.14). */
  async sos(rideId: string, actor: UserActor, input: SosInput): Promise<{ incidentId: string; status: 'alerted' }> {
    const ride = await this.getRide(rideId);
    const kind = await this.participantKind(ride, actor);
    const [incident] = await this.db
      .insert(schema.incidents)
      .values({ rideId, type: 'sos', severity: 'critical', reportedByUserId: actor.userId, reportedByKind: kind, description: input.description ?? 'SOS déclenché depuis l\'application', attachments: input.coordinates ? [{ coordinates: input.coordinates, at: new Date().toISOString() }] : [] })
      .returning({ id: schema.incidents.id });
    await this.db.insert(schema.rideEvents).values({ rideId, type: 'sos', fromState: ride.state, toState: ride.state, actorUserId: actor.userId, actorKind: kind, data: { incidentId: incident!.id } });
    this.events.emit('ride.sos', { rideId, incidentId: incident!.id, reportedByUserId: actor.userId, coordinates: input.coordinates ?? null });
    await this.outbox.queueForStaff('alert.sos', { rideId, incidentId: incident!.id, publicNumber: ride.publicNumber, reportedByKind: kind }, 'sms');
    this.audit.record({ action: 'ride.sos', entity: 'incidents', entityId: incident!.id, after: { rideId, reportedByKind: kind } });
    this.logger.error({ rideId, incidentId: incident!.id, kind }, 'SOS déclenché');
    return { incidentId: incident!.id, status: 'alerted' };
  }

  /**
   * Garantie modèle (5.2) : le client signale un véhicule non conforme à la catégorie réservée (ou au véhicule choisi).
   * Incident `model_guarantee` traité à l'étape 8 (remboursement de l'écart) ; un seul signalement par course, dans les
   * `rides.vehicle_mismatch_window_hours` qui suivent la fin de course.
   */
  async reportVehicleMismatch(rideId: string, actor: UserActor, input: { description: string; plateSeen?: string | undefined; modelSeen?: string | undefined }): Promise<{ incidentId: string; status: 'open' }> {
    const ride = await this.getRide(rideId);
    const kind = await this.participantKind(ride, actor);
    if (kind !== 'client') throw AppError.forbidden('NOT_CLIENT', 'Seul le client signale un véhicule non conforme');
    if (!ride.driverId || !ride.vehicleId) throw AppError.conflict('RIDE_NOT_ASSIGNED', 'Aucun véhicule n\'a encore été attribué à cette course', { state: ride.state });
    const windowHours = await this.settings.number('rides.vehicle_mismatch_window_hours', 24);
    const timestamps = timestampsOf(ride);
    const endedAt = timestamps.completed ?? (isTerminalState(ride.state) ? ride.updatedAt.toISOString() : null);
    if (endedAt && new Date(endedAt).getTime() + windowHours * 3_600_000 < Date.now()) throw AppError.conflict('MISMATCH_WINDOW_CLOSED', `Le signalement se fait dans les ${windowHours} heures qui suivent la course`, { windowHours });
    const [existing] = await this.db.select({ id: schema.incidents.id, status: schema.incidents.status }).from(schema.incidents).where(and(eq(schema.incidents.rideId, rideId), eq(schema.incidents.type, 'model_guarantee'))).limit(1);
    if (existing) throw AppError.conflict('ALREADY_REPORTED', 'Un signalement existe déjà pour cette course', { incidentId: existing.id, status: existing.status });
    const [vehicle] = await this.db.select({ make: schema.vehicles.make, model: schema.vehicles.model, plate: schema.vehicles.plate, category: schema.vehicles.category }).from(schema.vehicles).where(eq(schema.vehicles.id, ride.vehicleId)).limit(1);
    const [incident] = await this.db
      .insert(schema.incidents)
      .values({
        rideId, type: 'model_guarantee', severity: 'medium', reportedByUserId: actor.userId, reportedByKind: 'client', description: input.description,
        attachments: [{ reservedCategory: ride.reservedCategory, servedCategory: ride.servedCategory, assignedVehicle: vehicle ?? null, plateSeen: input.plateSeen ?? null, modelSeen: input.modelSeen ?? null, driverId: ride.driverId, reportedAt: new Date().toISOString() }],
      })
      .returning({ id: schema.incidents.id });
    await this.mark(rideId, 'vehicle_mismatch_reported', { kind: 'client', userId: actor.userId }, { incidentId: incident!.id, plateSeen: input.plateSeen ?? null, modelSeen: input.modelSeen ?? null });
    this.events.emit('ride.incident', { rideId, incidentId: incident!.id, type: 'model_guarantee', severity: 'medium', reportedByUserId: actor.userId });
    await this.outbox.queueForStaff('alert.vehicle_mismatch', { rideId, incidentId: incident!.id, publicNumber: ride.publicNumber });
    return { incidentId: incident!.id, status: 'open' };
  }

  /** Journal d'une course (extrait de `ride_events`). */
  async eventsOf(rideId: string) {
    const rows = await this.db.select().from(schema.rideEvents).where(eq(schema.rideEvents.rideId, rideId)).orderBy(asc(schema.rideEvents.occurredAt));
    return rows.map((e) => ({ id: e.id, type: e.type, fromState: e.fromState, toState: e.toState, actorKind: e.actorKind, data: e.data, occurredAt: e.occurredAt.toISOString() }));
  }
}
