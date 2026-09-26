/**
 * `pnpm seed:e2e` (étape 15, tâche 2) : écrit en base le plan de `plan.ts` (50 chauffeurs en ligne, 200 clients, 300
 * courses passées sur six semaines, avec paiements, registres, factures et relevés réglés).
 *
 * Les faits passés (comptes, courses, journal, paiements) sont écrits directement, avec leurs dates réelles ; tout ce
 * qui en découle passe par les services de l'API, pour garder leurs règles : registres de la redevance et des taxes
 * (`LedgersService`), factures numérotées sans trou par fournisseur et transmises au SEV simulé (`InvoicingService`,
 * `SevService`), relevés générés, émis et réglés par semaine (`StatementsService`, `SettlementPayoutsService`). Les
 * montants viennent du moteur de tarification du domaine avec les règles en base. Paiements : fournisseur simulé
 * uniquement (refus explicite sinon).
 *
 * Idempotent : chaque compte est retrouvé par son téléphone, chaque course par sa clé d'idempotence, chaque document
 * dérivé par son index unique ; une exécution interrompue reprend là où elle s'est arrêtée.
 */
import { schema } from '@neomoov/db';
import { computeQuote, finalizeQuote, type Quote } from '@neomoov/domain';
import type { INestApplicationContext } from '@nestjs/common';
import { and, eq, inArray, isNull, like, sql } from 'drizzle-orm';
import { PAYMENT_PROVIDER, SEV_PROVIDER, type GeoPoint, type PaymentProvider, type SevProvider } from '../../adapters/types.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { InvoicingService } from '../../modules/invoicing/invoicing.service.js';
import { SevService } from '../../modules/invoicing/sev.service.js';
import { LedgersService } from '../../modules/ledgers/ledgers.service.js';
import { PaymentsService } from '../../modules/payments/payments.service.js';
import { PricingRulesService } from '../../modules/pricing/pricing-rules.service.js';
import { ZonesService } from '../../modules/pricing/zones.service.js';
import { SettlementPayoutsService } from '../../modules/settlement/settlement-payouts.service.js';
import { StatementsService } from '../../modules/settlement/statements.service.js';
import { UsersService } from '../../modules/users/users.service.js';
import { markedIds, removeMarked, takeOffline } from './marked-accounts.js';
import { markedPhonePattern, planE2eDataset, SEED_E2E_MARKER, shiftDay, weekAnchor, zonedTime, type PlanSizes, type PlannedRide, type SeedMarker, type SeedPlan } from './plan.js';

type Db = Database['db'];
type RideInsert = typeof schema.rides.$inferInsert;
type EventInsert = typeof schema.rideEvents.$inferInsert;
type PaymentInsert = typeof schema.payments.$inferInsert;

export interface SeedE2eOptions {
  marker?: SeedMarker;
  sizes?: Partial<PlanSizes>;
  seed?: number;
  /** Horloge (tests) ; par défaut, maintenant. */
  now?: Date;
  /** Traitements menés en parallèle (connexions à la base). */
  concurrency?: number;
  log?: (message: string) => void;
}

export interface SeedE2eReport {
  created: Record<string, number>;
  totals: Record<string, number>;
  seconds: number;
}

const CITY = 'montreal';
const DOCUMENT_TYPES = ['licence', 'training', 'background_check', 'insurance', 'registration', 'mechanical_check', 'profile_photo'] as const;

/** Exécute `fn` sur chaque élément, `limit` à la fois, dans l'ordre de départ. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const at = (base: Date, seconds: number) => new Date(base.getTime() + seconds * 1000);
const iso = (d: Date) => d.toISOString();

export class SeedE2e {
  readonly marker: SeedMarker;
  private readonly db: Db;
  private readonly now: Date;
  private readonly concurrency: number;
  private readonly log: (message: string) => void;
  private readonly created: Record<string, number> = {};

  constructor(
    private readonly app: INestApplicationContext,
    private readonly options: SeedE2eOptions = {},
  ) {
    this.marker = options.marker ?? SEED_E2E_MARKER;
    this.db = app.get<Database>(DB).db;
    this.now = options.now ?? new Date();
    this.concurrency = options.concurrency ?? 4;
    this.log = options.log ?? (() => undefined);
  }

  private count(key: string, n = 1): void {
    if (n) this.created[key] = (this.created[key] ?? 0) + n;
  }

  private async timeZone(): Promise<string> {
    return this.app.get(SettingsService).string('service.time_zone', 'America/Toronto');
  }

  async plan(): Promise<SeedPlan> {
    const timeZone = await this.timeZone();
    return planE2eDataset({ anchorDay: weekAnchor(this.now, timeZone), timeZone, marker: this.marker, ...(this.options.sizes ? { sizes: this.options.sizes } : {}), ...(this.options.seed !== undefined ? { seed: this.options.seed } : {}) });
  }

  /** Jeu complet (ou complété) ; renvoie ce qui a été créé et l'état final. */
  async run(): Promise<SeedE2eReport> {
    const started = Date.now();
    for (const key of Object.keys(this.created)) delete this.created[key];
    this.assertSimulatedProviders();
    await this.assertBaseSeed();
    const plan = await this.plan();
    this.log(`Plan : ${plan.drivers.length} chauffeurs, ${plan.clients.length} clients, ${plan.rides.length} courses du ${plan.weeks[0]} au ${shiftDay(plan.weeks.at(-1)!, 6)}`);
    const users = await this.upsertUsers(plan);
    const clients = await this.upsertClients(plan, users);
    const drivers = await this.upsertDrivers(plan, users);
    await this.insertRides(plan, clients, drivers);
    await this.derivedDocuments(plan);
    await this.statements(plan, [...drivers.values()].map((d) => d.driverId));
    await this.refreshCounters([...drivers.values()].map((d) => d.driverId), [...clients.values()].map((c) => c.clientId));
    // Avis produits par l'émission des relevés (historique) : sans objet pour des comptes de démonstration.
    await this.db.delete(schema.notifications).where(inArray(schema.notifications.recipientUserId, [...users.values()]));
    this.count('driver_presence', await this.setOnline(true, plan));
    return { created: { ...this.created }, totals: await this.totals(), seconds: Math.round((Date.now() - started) / 100) / 10 };
  }

  /** Jamais de paiement ni de transmission réels : le jeu n'accepte que les fournisseurs simulés. */
  private assertSimulatedProviders(): void {
    const payments = this.app.get<PaymentProvider>(PAYMENT_PROVIDER);
    const sev = this.app.get<SevProvider>(SEV_PROVIDER);
    if (payments.name !== 'mock' || sev.name !== 'mock') throw new Error('Le jeu de bout en bout exige les fournisseurs simulés (PAYMENT_PROVIDER et SEV_PROVIDER à « mock »)');
  }

  private async assertBaseSeed(): Promise<void> {
    const [city] = await this.db.select({ code: schema.cities.code }).from(schema.cities).where(eq(schema.cities.code, CITY)).limit(1);
    const categories = await this.db.select({ code: schema.vehicleCategories.code }).from(schema.vehicleCategories);
    const [org] = await this.db.select({ id: schema.organizations.id }).from(schema.organizations).where(eq(schema.organizations.code, 'neomoov')).limit(1);
    if (!city || categories.length < 3 || !org) throw new Error('Données de départ absentes : lancez d\'abord « pnpm db:seed »');
  }

  // --- Comptes ---

  private async upsertUsers(plan: SeedPlan): Promise<Map<string, string>> {
    const existing = await this.db.select({ id: schema.users.id, phone: schema.users.phone }).from(schema.users).where(like(schema.users.phone, markedPhonePattern(this.marker)));
    const byPhone = new Map(existing.map((u) => [u.phone, u.id]));
    const policy = await this.app.get(UsersService).currentPrivacyPolicyVersion();
    const since = new Date(plan.anchor.getTime() - (plan.weeks.length + 4) * 7 * 86_400_000);
    const wanted = [
      ...plan.drivers.map((d) => ({ phone: d.phone, email: d.email, firstName: d.firstName, lastName: d.lastName, language: d.language, primaryRole: 'driver' as const })),
      ...plan.clients.map((c) => ({ phone: c.phone, email: c.email, firstName: c.firstName, lastName: c.lastName, language: c.language, primaryRole: 'client' as const })),
    ];
    const missing = wanted.filter((u) => !byPhone.has(u.phone));
    for (const part of chunks(missing, 200)) {
      const rows = await this.db
        .insert(schema.users)
        .values(part.map((u) => ({ ...u, termsAcceptedAt: since, privacyPolicyVersion: policy, createdAt: since })))
        .onConflictDoNothing()
        .returning({ id: schema.users.id, phone: schema.users.phone });
      for (const r of rows) byPhone.set(r.phone, r.id);
      this.count('users', rows.length);
    }
    const roles = wanted.filter((u) => byPhone.has(u.phone)).map((u) => ({ userId: byPhone.get(u.phone)!, role: u.primaryRole }));
    for (const part of chunks(roles, 500)) await this.db.insert(schema.userRoles).values(part).onConflictDoNothing();
    this.log(`Comptes : ${byPhone.size} (${missing.length} créés)`);
    return byPhone;
  }

  private async upsertClients(plan: SeedPlan, users: Map<string, string>): Promise<Map<number, { clientId: string; userId: string }>> {
    const userIds = plan.clients.map((c) => users.get(c.phone)!);
    const existing = new Map<string, string>();
    for (const part of chunks(userIds, 500)) for (const r of await this.db.select({ id: schema.clients.id, userId: schema.clients.userId }).from(schema.clients).where(inArray(schema.clients.userId, part))) existing.set(r.userId, r.id);
    const missing = userIds.filter((id) => !existing.has(id));
    for (const part of chunks(missing, 200)) {
      const rows = await this.db.insert(schema.clients).values(part.map((userId) => ({ userId }))).onConflictDoNothing().returning({ id: schema.clients.id, userId: schema.clients.userId });
      for (const r of rows) existing.set(r.userId, r.id);
      this.count('clients', rows.length);
    }
    // Carte simulée enregistrée par le service des paiements (client Stripe simulé, carte par défaut), comme l'application.
    const withCard = new Set<string>();
    for (const part of chunks([...existing.values()], 500)) {
      for (const r of await this.db.select({ clientId: schema.clientPaymentMethods.clientId }).from(schema.clientPaymentMethods).where(and(inArray(schema.clientPaymentMethods.clientId, part), isNull(schema.clientPaymentMethods.deletedAt)))) withCard.add(r.clientId);
    }
    const payments = this.app.get(PaymentsService);
    const needCard = plan.clients.filter((c) => !withCard.has(existing.get(users.get(c.phone)!)!));
    await mapLimit(needCard, this.concurrency, async (c) => {
      const userId = users.get(c.phone)!;
      const intent = await payments.setupIntent(userId);
      await payments.confirmSetupIntent(userId, { setupIntentId: intent.setupIntentId, makeDefault: true });
      this.count('client_payment_methods');
    });
    this.log(`Clients : ${existing.size} (${missing.length} créés, ${needCard.length} cartes simulées)`);
    return new Map(plan.clients.map((c) => [c.index, { clientId: existing.get(users.get(c.phone)!)!, userId: users.get(c.phone)! }]));
  }

  private async upsertDrivers(plan: SeedPlan, users: Map<string, string>): Promise<Map<number, { driverId: string; userId: string; vehicleId: string }>> {
    const result = new Map<number, { driverId: string; userId: string; vehicleId: string }>();
    const userIds = plan.drivers.map((d) => users.get(d.phone)!);
    const existing = new Map<string, { id: string; vehicleId: string | null }>();
    for (const part of chunks(userIds, 500)) {
      for (const r of await this.db.select({ id: schema.drivers.id, userId: schema.drivers.userId, vehicleId: schema.drivers.currentVehicleId }).from(schema.drivers).where(inArray(schema.drivers.userId, part))) existing.set(r.userId, { id: r.id, vehicleId: r.vehicleId });
    }
    const since = new Date(plan.anchor.getTime() - (plan.weeks.length + 3) * 7 * 86_400_000);
    const today = iso(this.now).slice(0, 10);
    const inOneYear = iso(new Date(this.now.getTime() + 365 * 86_400_000)).slice(0, 10);
    const missing = plan.drivers.filter((d) => !existing.has(users.get(d.phone)!));
    if (missing.length) {
      const numbers = await this.db.execute<{ n: string }>(sql`SELECT next_driver_public_number() AS n FROM generate_series(1, ${missing.length}::int)`);
      for (const [i, d] of missing.entries()) {
        const userId = users.get(d.phone)!;
        await this.db.transaction(async (tx) => {
          const [driver] = await tx
            .insert(schema.drivers)
            .values({
              userId, publicNumber: numbers[i]!.n, status: 'active', qualification: 'saaq_authorized', acceptsCash: d.acceptsCash, acceptsInterac: d.acceptsInterac,
              // Jamais le terminal ni les planifiées : les tests de répartition s'isolent par le terminal, et une réservation
              // planifiée sollicite les chauffeurs sans condition de position (5.4). Le jeu ne leur prend donc aucune offre.
              acceptsTerminal: false, acceptsScheduled: false, spokenLanguages: d.spokenLanguages, experienceYears: d.experienceYears,
              // Compte de versement et carte de prélèvement simulés : un relevé net positif est versé, un net négatif prélevé.
              stripeConnectAccountId: `acct_mock_${this.marker.key.replace(/[^a-z0-9]/gi, '')}${String(d.index + 1).padStart(5, '0')}`, stripeConnectOnboarded: true,
              stripeDebitPaymentMethodId: `pm_mock_${this.marker.key.replace(/[^a-z0-9]/gi, '')}${String(d.index + 1).padStart(5, '0')}`, stripeDebitCardBrand: 'visa', stripeDebitCardLast4: String(4242 + d.index).slice(-4),
              trainingCertifiedAt: since, activatedAt: since, createdAt: since,
            })
            .returning({ id: schema.drivers.id });
          const [vehicle] = await tx
            .insert(schema.vehicles)
            .values({ driverId: driver!.id, ...d.vehicle, status: 'active', lastInspectionOn: shiftDay(today, -60), nextInspectionDueOn: shiftDay(today, 120), createdAt: since })
            .returning({ id: schema.vehicles.id });
          await tx.update(schema.drivers).set({ currentVehicleId: vehicle!.id }).where(eq(schema.drivers.id, driver!.id));
          await tx.insert(schema.driverDocuments).values(DOCUMENT_TYPES.map((type) => ({ driverId: driver!.id, type, fileKey: `${this.marker.key}/${d.vehicle.plate}/${type}.pdf`, status: 'approved' as const, issuedOn: shiftDay(today, -200), expiresOn: inOneYear, verifiedAt: since })));
          await tx.insert(schema.driverBalances).values({ driverId: driver!.id }).onConflictDoNothing();
          existing.set(userId, { id: driver!.id, vehicleId: vehicle!.id });
        });
        this.count('drivers');
      }
    }
    for (const d of plan.drivers) {
      const row = existing.get(users.get(d.phone)!)!;
      result.set(d.index, { driverId: row.id, userId: users.get(d.phone)!, vehicleId: row.vehicleId! });
    }
    this.log(`Chauffeurs : ${result.size} (${missing.length} créés)`);
    return result;
  }

  // --- Courses ---

  private async insertRides(plan: SeedPlan, clients: Map<number, { clientId: string; userId: string }>, drivers: Map<number, { driverId: string; userId: string; vehicleId: string }>): Promise<void> {
    const done = new Set((await this.db.select({ key: schema.rides.idempotencyKey }).from(schema.rides).where(like(schema.rides.idempotencyKey, `${this.marker.key}-ride-%`))).map((r) => r.key));
    const todo = plan.rides.filter((r) => !done.has(r.key));
    if (!todo.length) {
      this.log(`Courses : ${plan.rides.length} déjà présentes`);
      return;
    }
    const loaded = await this.app.get(PricingRulesService).rulesFor(CITY);
    const zones = this.app.get(ZonesService);
    const settings = this.app.get(SettingsService);
    const [cancellationFeeCents, noShowFeeCents] = await Promise.all([settings.number('rides.cancellation_fee_cents', 500), settings.number('rides.no_show_fee_cents', 700)]);
    const [org] = await this.db.select({ id: schema.organizations.id }).from(schema.organizations).where(eq(schema.organizations.code, 'neomoov')).limit(1);
    const cards = new Map<string, string>();
    for (const part of chunks([...clients.values()].map((c) => c.clientId), 500)) {
      for (const r of await this.db.select({ clientId: schema.clientPaymentMethods.clientId, pm: schema.clientPaymentMethods.stripePaymentMethodId }).from(schema.clientPaymentMethods).where(and(inArray(schema.clientPaymentMethods.clientId, part), eq(schema.clientPaymentMethods.isDefault, true), isNull(schema.clientPaymentMethods.deletedAt)))) cards.set(r.clientId, r.pm);
    }
    const zoneOf = async (p: GeoPoint) => ({ code: (await zones.zoneOf(p))?.code ?? null, airport: await zones.isAirport(p) });
    const provider = this.app.get<PaymentProvider>(PAYMENT_PROVIDER);
    const payments = this.app.get(PaymentsService);

    await mapLimit(todo, this.concurrency, async (planned) => {
      const driver = drivers.get(planned.driverIndex)!;
      const client = clients.get(planned.clientIndex)!;
      const [from, to] = await Promise.all([zoneOf(planned.origin), zoneOf(planned.destination)]);
      const quote = computeQuote(
        { category: planned.category, distanceMeters: planned.distanceMeters, durationSeconds: planned.durationSeconds, pickupAt: planned.pickupAt, originZone: from.code, destinationZone: to.code, airport: from.airport || to.airport, options: {} },
        loaded.rules,
      );
      const final = planned.outcome === 'completed' ? finalizeQuote(quote, planned.waitedSeconds, loaded.rules) : null;
      const feeCents = planned.outcome === 'no_show' ? noShowFeeCents : planned.outcome === 'cancelled_by_client' ? cancellationFeeCents : 0;
      const t = this.timeline(planned);
      const { ride, events } = this.rideRows(planned, { quote, final, feeCents, timeline: t, organizationId: org?.id ?? null, driver, client });
      const card = cards.get(client.clientId) ?? null;
      const paymentRows = await this.paymentRows(planned, { final, feeCents, timeline: t, card, client, quote, provider, customerRef: card ? await payments.customerFor(client.userId) : null });
      await this.db.transaction(async (tx) => {
        const [inserted] = await tx.insert(schema.rides).values(ride).onConflictDoNothing().returning({ id: schema.rides.id });
        if (!inserted) return;
        await tx.insert(schema.rideEvents).values(events.map((e) => ({ ...e, rideId: inserted.id })));
        if (paymentRows.length) await tx.insert(schema.payments).values(paymentRows.map((p) => ({ ...p, rideId: inserted.id, idempotencyKey: p.idempotencyKey!.replace('<ride>', inserted.id) })));
        if (planned.rating && t.rated) {
          await tx.insert(schema.rideRatings).values({ rideId: inserted.id, authorKind: 'client', authorUserId: client.userId, score: planned.rating.score, tags: planned.rating.tags, comment: planned.rating.comment, createdAt: t.rated });
        }
        this.count('rides');
        this.count('payments', paymentRows.length);
      });
    });
    this.log(`Courses : ${todo.length} créées (${plan.rides.length} au total)`);
  }

  /** Horodatages d'une course, tous dans le passé : réservation, offre, acceptation, départ, arrivée, fin. */
  private timeline(r: PlannedRide) {
    const requested = r.bookedAt;
    const offering = at(requested, 2);
    const assigned = at(requested, r.acceptedAfterSeconds);
    const arrived = at(r.pickupAt, -60);
    const clamp = (d: Date) => (d.getTime() > this.now.getTime() ? this.now : d);
    if (r.outcome === 'cancelled_by_client') {
      return { requested, offering, assigned, enRoute: null, arrived: null, started: null, closed: at(r.pickupAt, -45 * 60), rated: null };
    }
    const enRoute = at(r.pickupAt, -15 * 60);
    if (r.outcome === 'no_show') return { requested, offering, assigned, enRoute, arrived, started: null, closed: at(arrived, r.waitedSeconds), rated: null };
    const started = at(arrived, r.waitedSeconds);
    const closed = at(started, r.durationSeconds);
    return { requested, offering, assigned, enRoute, arrived, started, closed, rated: r.rating ? clamp(at(closed, r.rating.afterSeconds)) : null };
  }

  private rideRows(
    r: PlannedRide,
    c: { quote: Quote; final: Quote | null; feeCents: number; timeline: ReturnType<SeedE2e['timeline']>; organizationId: string | null; driver: { driverId: string; userId: string; vehicleId: string }; client: { clientId: string; userId: string } },
  ): { ride: RideInsert; events: Omit<EventInsert, 'rideId'>[] } {
    const t = c.timeline;
    const amounts = c.final ?? c.quote;
    const state = r.outcome === 'completed' ? (r.rating ? 'rated' : 'completed') : r.outcome;
    const stamps: Record<string, string> = { requested: iso(t.requested), offering: iso(t.offering), assigned: iso(t.assigned) };
    if (t.enRoute) stamps['en_route'] = iso(t.enRoute);
    if (t.arrived) stamps['arrived'] = iso(t.arrived);
    if (t.started) stamps['in_progress'] = iso(t.started);
    stamps[r.outcome === 'completed' ? 'completed' : r.outcome] = iso(t.closed);
    if (t.rated) stamps['rated'] = iso(t.rated);
    const waitChargeCents = c.final?.lines.find((l) => l.kind === 'wait_time')?.amountCents ?? 0;
    const ride: RideInsert = {
      publicNumber: r.publicNumber, cityCode: CITY, clientId: c.client.clientId, driverId: c.driver.driverId, vehicleId: c.driver.vehicleId, reservedCategory: r.category, servedCategory: r.category,
      state, type: 'scheduled', requestedAt: r.pickupAt, originAddress: r.origin.address, originPosition: { lat: r.origin.lat, lng: r.origin.lng }, destinationAddress: r.destination.address,
      destinationPosition: { lat: r.destination.lat, lng: r.destination.lng }, paymentMethod: r.paymentMethod, paymentChoice: r.paymentChoice, organizationId: c.organizationId,
      maxConsentedCents: c.quote.maxConsentedCents, quotedTotalCents: c.quote.totalCents, finalPriceCents: c.final?.totalCents ?? null, fareCents: amounts.fareCents, serviceFeeCents: amounts.serviceFeeCents,
      regulatoryFeeCents: amounts.regulatoryFeeCents, gstCents: amounts.gstCents, qstCents: amounts.qstCents, tollsCents: amounts.tollsCents, promotionDiscountCents: amounts.promotionDiscountCents,
      waitChargeCents, waitedSeconds: r.outcome === 'cancelled_by_client' ? 0 : r.waitedSeconds, contactAttempts: r.outcome === 'no_show' ? 2 : 0, tipCents: r.tipCents,
      cancellationReason: r.outcome === 'cancelled_by_client' ? 'plans_changed' : null, cancellationFeeCents: c.feeCents, negotiationMode: 'fixed', stateTimestamps: stamps, idempotencyKey: r.key,
      distanceMeters: r.distanceMeters, durationSeconds: r.durationSeconds, createdByUserId: c.client.userId, createdAt: t.requested, updatedAt: t.rated ?? t.closed,
    };
    const client = { actorUserId: c.client.userId, actorKind: 'client' };
    const driver = { actorUserId: c.driver.userId, actorKind: 'driver' };
    const system = { actorUserId: null, actorKind: 'system' };
    const events: Omit<EventInsert, 'rideId'>[] = [
      { type: 'client_confirms', fromState: 'quoted', toState: 'requested', ...client, data: { type: 'scheduled', seed: this.marker.key }, occurredAt: t.requested },
      { type: 'offers_sent', fromState: 'requested', toState: 'offering', ...system, data: { wave: 1 }, occurredAt: t.offering },
      { type: 'driver_accepts', fromState: 'offering', toState: 'assigned', ...driver, data: { driverId: c.driver.driverId }, occurredAt: t.assigned },
    ];
    if (r.outcome === 'cancelled_by_client') {
      events.push({ type: 'client_cancels', fromState: 'assigned', toState: 'cancelled_by_client', ...client, data: { reason: 'plans_changed', feeCents: c.feeCents }, occurredAt: t.closed });
      events.push({ type: 'cancellation_fee_captured', fromState: 'cancelled_by_client', toState: 'cancelled_by_client', ...system, data: { amountCents: c.feeCents, attempts: 1 }, occurredAt: at(t.closed, 3) });
      return { ride, events };
    }
    events.push({ type: 'driver_departs', fromState: 'assigned', toState: 'en_route', ...driver, data: null, occurredAt: t.enRoute! });
    events.push({ type: 'driver_arrives', fromState: 'en_route', toState: 'arrived', ...driver, data: null, occurredAt: t.arrived! });
    if (r.outcome === 'no_show') {
      events.push({ type: 'client_no_show', fromState: 'arrived', toState: 'no_show', ...driver, data: { feeCents: c.feeCents, waitedSeconds: r.waitedSeconds, contactAttempts: 2 }, occurredAt: t.closed });
      events.push({ type: 'no_show_fee_captured', fromState: 'no_show', toState: 'no_show', ...system, data: { amountCents: c.feeCents, attempts: 1 }, occurredAt: at(t.closed, 3) });
      return { ride, events };
    }
    events.push({ type: 'ride_starts', fromState: 'arrived', toState: 'in_progress', ...driver, data: null, occurredAt: t.started! });
    events.push({
      type: 'ride_ends', fromState: 'in_progress', toState: 'completed', ...driver,
      data: { finalPriceCents: c.final!.totalCents, waitChargeCents, waitedSeconds: r.waitedSeconds, measuredDistanceMeters: r.distanceMeters, measuredDurationSeconds: r.durationSeconds }, occurredAt: t.closed,
    });
    if (r.paymentChoice === 'pay_driver_after') {
      events.push({ type: 'payment_received_direct', fromState: 'completed', toState: 'completed', ...driver, data: { amountCents: c.final!.totalCents, expectedCents: c.final!.totalCents, method: r.paymentMethod }, occurredAt: at(t.closed, 20) });
    } else {
      events.push({ type: 'ride_captured', fromState: 'completed', toState: 'completed', ...system, data: { amountCents: c.final!.totalCents, attempts: 1 }, occurredAt: at(t.closed, 3) });
    }
    if (t.rated) {
      events.push({ type: 'client_rates', fromState: 'completed', toState: 'rated', ...client, data: { score: r.rating!.score, tipCents: r.tipCents }, occurredAt: t.rated });
      if (r.tipCents) events.push({ type: 'tip_captured', fromState: 'rated', toState: 'rated', ...system, data: { amountCents: r.tipCents }, occurredAt: at(t.rated, 2) });
    }
    return { ride, events };
  }

  /**
   * Paiements d'une course passée, par le fournisseur simulé : autorisation à l'attribution et capture à la fin (carte),
   * paiement direct confirmé par le chauffeur (espèces, Interac), frais capturés (annulation, absence), pourboire séparé.
   * Les dates sont celles de la course ; `<ride>` est remplacé par l'identifiant de la course à l'insertion.
   */
  private async paymentRows(
    r: PlannedRide,
    c: { final: Quote | null; feeCents: number; timeline: ReturnType<SeedE2e['timeline']>; card: string | null; client: { clientId: string }; quote: Quote; provider: PaymentProvider; customerRef: string | null },
  ): Promise<Omit<PaymentInsert, 'rideId'>[]> {
    const t = c.timeline;
    if (r.paymentChoice === 'pay_driver_after') {
      return [{ clientId: c.client.clientId, method: r.paymentMethod, kind: 'ride', status: 'paid_direct', collectedBy: 'driver', driverConfirmedCents: c.final!.totalCents, idempotencyKey: 'direct:<ride>', createdAt: t.assigned, updatedAt: at(t.closed, 20) }];
    }
    if (!c.card || !c.customerRef) throw new Error(`Client sans carte simulée pour la course ${r.key}`);
    const authorizedCents = c.quote.maxConsentedCents;
    const auth = await c.provider.authorize({ amountCents: authorizedCents, currency: 'CAD', customerRef: c.customerRef, paymentMethodRef: c.card, idempotencyKey: `${r.key}:auth`, metadata: { seed: this.marker.key } });
    const due = r.outcome === 'completed' ? c.final!.totalCents : c.feeCents;
    const captured = await c.provider.capture(auth.intentId, due, `${r.key}:capture`);
    if (captured.status !== 'captured') throw new Error(`Capture simulée refusée pour ${r.key}`);
    const kind = r.outcome === 'no_show' ? 'no_show_fee' : r.outcome === 'cancelled_by_client' ? 'cancellation_fee' : 'ride';
    const rows: Omit<PaymentInsert, 'rideId'>[] = [{
      clientId: c.client.clientId, method: r.paymentMethod, kind, stripePaymentIntentId: auth.intentId, stripePaymentMethodId: c.card, idempotencyKey: 'ride:<ride>', attempts: 1,
      authorizedCents, capturedCents: due, status: 'captured', capturedAt: at(t.closed, 3), createdAt: t.requested, updatedAt: at(t.closed, 3),
    }];
    if (r.tipCents && t.rated) {
      const tip = await c.provider.chargeOffSession({ amountCents: r.tipCents, customerRef: c.customerRef, paymentMethodRef: c.card, idempotencyKey: `${r.key}:tip`, description: `Pourboire, course ${r.publicNumber}`, metadata: { seed: this.marker.key } });
      rows.push({
        clientId: c.client.clientId, method: r.paymentMethod, kind: 'tip', stripePaymentIntentId: tip.intentId, stripePaymentMethodId: c.card, idempotencyKey: 'tip:<ride>',
        authorizedCents: r.tipCents, capturedCents: r.tipCents, tipCents: r.tipCents, status: 'captured', capturedAt: at(t.rated, 2), createdAt: at(t.rated, 2), updatedAt: at(t.rated, 2),
      });
    }
    return rows;
  }

  // --- Documents dérivés : registres, factures, transmission au SEV ---

  private async derivedDocuments(plan: SeedPlan): Promise<void> {
    const keys = plan.rides.map((r) => r.key);
    type Row = { id: string; driver_id: string; state: string; closed_at: string; ledger: boolean; invoice_id: string | null; misdated: boolean; sev_pending: boolean };
    const rows = await this.db.execute<Row>(sql`
      SELECT r.id, r.driver_id, r.state,
             COALESCE(r.state_timestamps->>'completed', r.state_timestamps->>'no_show', r.state_timestamps->>'cancelled_by_client') AS closed_at,
             (EXISTS (SELECT 1 FROM redevance_ledger l WHERE l.ride_id = r.id) AND EXISTS (SELECT 1 FROM tax_ledger t WHERE t.ride_id = r.id)) AS ledger,
             i.id AS invoice_id, (i.id IS NOT NULL AND i.sev_transaction_id IS NULL AND i.sev_status IN ('pending', 'error')) AS sev_pending,
             (i.id IS NOT NULL AND abs(extract(epoch from i.issued_at - COALESCE(r.state_timestamps->>'completed', r.state_timestamps->>'no_show', r.state_timestamps->>'cancelled_by_client')::timestamptz)) > 60) AS misdated
      FROM rides r LEFT JOIN invoices i ON i.ride_id = r.id AND i.credit_note_of_id IS NULL
      WHERE r.idempotency_key IN ${keys}
      ORDER BY closed_at, r.id`);
    const ledgers = this.app.get(LedgersService);
    const invoicing = this.app.get(InvoicingService);
    const sev = this.app.get(SevService);
    const completed = rows.filter((r) => ['completed', 'rated'].includes(r.state));
    await mapLimit(completed.filter((r) => !r.ledger), this.concurrency, async (r) => {
      const written = await ledgers.record(r.id);
      if (written.redevance) this.count('redevance_ledger');
      if (written.taxes) this.count('tax_ledger');
    });
    // Factures par fournisseur, dans l'ordre des courses : la séquence du chauffeur suit la chronologie, sans trou.
    const byDriver = new Map<string, Row[]>();
    for (const r of rows) byDriver.set(r.driver_id, [...(byDriver.get(r.driver_id) ?? []), r]);
    await mapLimit([...byDriver.values()], this.concurrency, async (list) => {
      for (const r of list) {
        let invoiceId = r.invoice_id;
        let dated = !r.misdated;
        if (!invoiceId) {
          const issued = await invoicing.issueForRide(r.id);
          if (!issued) continue;
          invoiceId = issued.invoice.id;
          dated = false;
          if (issued.created) this.count('invoices');
        }
        // Émise à la clôture de la course, comme l'aurait fait la file `invoicing` (aussi après une exécution interrompue).
        if (!dated) await this.db.update(schema.invoices).set({ issuedAt: at(new Date(r.closed_at), 5), createdAt: at(new Date(r.closed_at), 5) }).where(eq(schema.invoices.id, invoiceId));
        if (r.invoice_id && !r.sev_pending) continue;
        const outcome = await sev.transmit(invoiceId);
        if (outcome.status === 'acknowledged' || outcome.status === 'sent') {
          await this.db.update(schema.sevTransmissions).set({ occurredAt: at(new Date(r.closed_at), 8) }).where(eq(schema.sevTransmissions.invoiceId, invoiceId));
          this.count('sev_transmissions');
        }
      }
    });
    this.log(`Registres et factures : ${completed.length} courses terminées, ${rows.length - completed.length} frais facturés`);
  }

  // --- Relevés hebdomadaires : générés, émis le vendredi et réglés (versement simulé) ---

  private async statements(plan: SeedPlan, driverIds: string[]): Promise<void> {
    const timeZone = await this.timeZone();
    const statements = this.app.get(StatementsService);
    const payouts = this.app.get(SettlementPayoutsService);
    const existing = await this.db
      .select({ id: schema.weeklyStatements.id, driverId: schema.weeklyStatements.driverId, periodStart: schema.weeklyStatements.periodStart, status: schema.weeklyStatements.status })
      .from(schema.weeklyStatements)
      .where(and(inArray(schema.weeklyStatements.driverId, driverIds), inArray(schema.weeklyStatements.periodStart, plan.weeks)));
    const known = new Map(existing.map((s) => [`${s.driverId}:${s.periodStart}`, s]));
    let settled = 0;
    await mapLimit(driverIds, this.concurrency, async (driverId) => {
      for (const week of plan.weeks) {
        const issueAt = this.clampNow(zonedTime(shiftDay(week, 11), 6, 15, timeZone));
        const settleAt = at(issueAt, 120);
        let row = known.get(`${driverId}:${week}`) ?? null;
        if (row && (row.status === 'paid' || row.status === 'charged')) continue;
        if (!row) {
          const generation = await statements.generate({ periodStart: week, driverId }, issueAt);
          const view = generation.statements[0];
          if (!view?.id) continue;
          row = { id: view.id, driverId, periodStart: week, status: view.status ?? 'draft' };
          this.count('weekly_statements');
        }
        if (row.status === 'draft') await statements.issue(row.id, issueAt);
        const detail = await payouts.settle(row.id, settleAt);
        if (detail.status === 'paid' || detail.status === 'charged') settled += 1;
      }
    });
    this.log(`Relevés : ${settled} réglés à cette exécution`);
  }

  private clampNow(d: Date): Date {
    return d.getTime() > this.now.getTime() ? new Date(this.now.getTime() - 60_000) : d;
  }

  /** Compteurs dénormalisés (courses, note moyenne, liens client-chauffeur), recalculés depuis les courses. */
  private async refreshCounters(driverIds: string[], clientIds: string[]): Promise<void> {
    if (!driverIds.length) return;
    await this.db.execute(sql`
      UPDATE drivers d SET ride_count = COALESCE(s.n, 0),
        rating_average = COALESCE(s.avg_score, 5.00), rating_count = COALESCE(s.ratings, 0)
      FROM (SELECT dr.id, count(r.id) FILTER (WHERE r.state IN ('completed', 'rated'))::int AS n,
                   round(avg(rr.score)::numeric, 2) AS avg_score, count(rr.id)::int AS ratings
            FROM drivers dr LEFT JOIN rides r ON r.driver_id = dr.id LEFT JOIN ride_ratings rr ON rr.ride_id = r.id AND rr.author_kind = 'client'
            WHERE dr.id IN ${driverIds} GROUP BY dr.id) s
      WHERE d.id = s.id`);
    if (clientIds.length) {
      await this.db.execute(sql`
        UPDATE clients c SET ride_count = COALESCE(s.n, 0)
        FROM (SELECT cl.id, count(r.id) FILTER (WHERE r.state IN ('completed', 'rated'))::int AS n FROM clients cl LEFT JOIN rides r ON r.client_id = cl.id WHERE cl.id IN ${clientIds} GROUP BY cl.id) s
        WHERE c.id = s.id`);
      await this.db.execute(sql`
        INSERT INTO client_driver_links (client_id, driver_id, rides_count, last_ride_at)
        SELECT r.client_id, r.driver_id, count(*)::int, max((r.state_timestamps->>'completed')::timestamptz)
        FROM rides r WHERE r.client_id IN ${clientIds} AND r.driver_id IS NOT NULL AND r.state IN ('completed', 'rated')
        GROUP BY r.client_id, r.driver_id
        ON CONFLICT (client_id, driver_id) DO UPDATE SET rides_count = EXCLUDED.rides_count, last_ride_at = EXCLUDED.last_ride_at, updated_at = now()`);
    }
  }

  // --- Présence ---

  /**
   * Met en ligne (position du plan, disponible, quart ouvert) ou hors ligne les chauffeurs du jeu. Sans position
   * pendant `presence.expiry_seconds` (60 s), la passe d'expiration d'une API en marche les remet hors ligne : pour une
   * démonstration, `heartbeat` (option `--online`) les garde en ligne.
   */
  async setOnline(online: boolean, knownPlan?: SeedPlan): Promise<number> {
    const plan = knownPlan ?? (await this.plan());
    const users = await this.db.select({ id: schema.users.id, phone: schema.users.phone }).from(schema.users).where(like(schema.users.phone, markedPhonePattern(this.marker)));
    const byPhone = new Map(users.map((u) => [u.phone, u.id]));
    const userIds = plan.drivers.map((d) => byPhone.get(d.phone)).filter((id): id is string => Boolean(id));
    if (!userIds.length) return 0;
    const drivers = await this.db
      .select({ id: schema.drivers.id, userId: schema.drivers.userId, vehicleId: schema.drivers.currentVehicleId, category: schema.vehicles.category })
      .from(schema.drivers)
      .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.drivers.currentVehicleId))
      .where(inArray(schema.drivers.userId, userIds));
    if (!online) return takeOffline(this.db, drivers.map((d) => d.id), new Date());
    const home = new Map(plan.drivers.map((d) => [byPhone.get(d.phone), d.home]));
    const now = new Date();
    for (const d of drivers) {
      const position = home.get(d.userId)!;
      await this.db
        .insert(schema.driverPresence)
        .values({ driverId: d.id, position, vehicleId: d.vehicleId, category: d.category, isAvailable: true, currentRideId: null })
        .onConflictDoUpdate({ target: schema.driverPresence.driverId, set: { position, vehicleId: d.vehicleId, category: d.category, isAvailable: true, currentRideId: null, updatedAt: now } });
    }
    const ids = drivers.map((d) => d.id);
    await this.db.update(schema.drivers).set({ isOnline: true }).where(inArray(schema.drivers.id, ids));
    const open = new Set((await this.db.select({ driverId: schema.driverShifts.driverId }).from(schema.driverShifts).where(and(inArray(schema.driverShifts.driverId, ids), isNull(schema.driverShifts.endedAt)))).map((s) => s.driverId));
    const toOpen = ids.filter((id) => !open.has(id));
    if (toOpen.length) await this.db.insert(schema.driverShifts).values(toOpen.map((driverId) => ({ driverId, startedAt: now })));
    return drivers.length;
  }

  /** Battement de la démonstration : chaque chauffeur en ligne se déplace un peu (60 m au plus) et sa présence est rafraîchie. */
  async heartbeat(step: number): Promise<number> {
    const ids = (await markedIds(this.db, this.marker)).driverIds;
    if (!ids.length) return 0;
    const angle = (step % 12) * (Math.PI / 6);
    const rows = await this.db.execute(sql`
      UPDATE driver_presence SET updated_at = now(),
        position = ST_SetSRID(ST_MakePoint(ST_X(position::geometry) + ${0.0005 * Math.cos(angle)}::float, ST_Y(position::geometry) + ${0.0003 * Math.sin(angle)}::float), 4326)::geography
      WHERE driver_id IN ${ids} RETURNING driver_id`);
    return rows.length;
  }

  async reset(): Promise<Record<string, number>> {
    return removeMarked(this.db, this.marker);
  }

  /** État du jeu en base : comptes, courses par état, paiements, factures, registres, relevés, présence. */
  async totals(): Promise<Record<string, number>> {
    const ids = await markedIds(this.db, this.marker);
    const totals: Record<string, number> = { users: ids.userIds.length, drivers: ids.driverIds.length, clients: ids.clientIds.length, rides: ids.rideIds.length };
    if (ids.rideIds.length) {
      const [row] = await this.db.execute<Record<string, number>>(sql`
        SELECT
          (SELECT count(*) FROM rides WHERE id IN ${ids.rideIds} AND state IN ('completed', 'rated'))::int AS rides_completed,
          (SELECT count(*) FROM rides WHERE id IN ${ids.rideIds} AND state = 'no_show')::int AS rides_no_show,
          (SELECT count(*) FROM rides WHERE id IN ${ids.rideIds} AND state = 'cancelled_by_client')::int AS rides_cancelled,
          (SELECT count(*) FROM payments WHERE ride_id IN ${ids.rideIds})::int AS payments,
          (SELECT count(*) FROM invoices WHERE ride_id IN ${ids.rideIds})::int AS invoices,
          (SELECT count(*) FROM invoices WHERE ride_id IN ${ids.rideIds} AND sev_status = 'acknowledged')::int AS invoices_acknowledged,
          (SELECT count(*) FROM redevance_ledger WHERE ride_id IN ${ids.rideIds})::int AS redevance_ledger,
          (SELECT count(*) FROM tax_ledger WHERE ride_id IN ${ids.rideIds})::int AS tax_ledger,
          (SELECT count(*) FROM ride_ratings WHERE ride_id IN ${ids.rideIds})::int AS ratings`);
      Object.assign(totals, row);
    }
    if (ids.driverIds.length) {
      const [row] = await this.db.execute<Record<string, number>>(sql`
        SELECT
          (SELECT count(*) FROM weekly_statements WHERE driver_id IN ${ids.driverIds})::int AS weekly_statements,
          (SELECT count(*) FROM weekly_statements WHERE driver_id IN ${ids.driverIds} AND status IN ('paid', 'charged'))::int AS statements_settled,
          (SELECT count(*) FROM driver_presence WHERE driver_id IN ${ids.driverIds})::int AS online`);
      Object.assign(totals, row);
    }
    return totals;
  }
}
