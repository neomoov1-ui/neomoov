/**
 * Paiements (section 5.6, prompt 07). Aucune donnée de carte ne transite par l'API : seulement des identifiants Stripe.
 * Chaque opération financière porte une clé d'idempotence (rejouée, elle ne crée ni second mouvement ni seconde
 * ligne). Carte : autorisation à capture différée du prix maximal consenti plus la marge (course immédiate avant sa
 * création, planifiée à l'attribution), capture du montant dû à la fin, frais d'annulation ou d'absence capturés sur
 * l'autorisation, sinon annulation. Échec de capture : nouvelle tentative, puis incident `payment_failed` et solde dû
 * (nouvelles courses refusées jusqu'au règlement). Paiement direct : montant confirmé par le chauffeur.
 */
import { schema } from '@neomoov/db';
import {
  authorizationCents, captureCents, isCardMethod, refundableCents, type BalanceView, type PaymentMethod, type PaymentMethodView, type PaymentView, type RefundView,
  type SetupIntentResponse,
} from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { Logger } from 'pino';
import { PAYMENT_PROVIDER, type PaymentAuthorization, type PaymentProvider, type WebhookEvent } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { DomainEventsService } from '../../common/domain-events.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';

type PaymentRow = typeof schema.payments.$inferSelect;
type MethodRow = typeof schema.clientPaymentMethods.$inferSelect;
type Executor = Pick<Database['db'], 'insert' | 'update' | 'select' | 'execute'>;

export interface RideAuthorization {
  intentId: string;
  authorizedCents: number;
  paymentMethodRef: string;
}

const CLOSED_FOR_TIP = ['completed', 'rated', 'disputed'];
const shortHash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 24);

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly events: DomainEventsService,
    private readonly outbox: NotificationsOutbox,
  ) {}

  private get db() {
    return this.database.db;
  }

  get providerName(): string {
    return this.provider.name;
  }

  // --- Clients Stripe et méthodes de paiement ---

  /** Client Stripe de l'utilisateur, créé au premier besoin (clé d'idempotence par utilisateur chez Stripe). */
  async customerFor(userId: string): Promise<string> {
    const [user] = await this.db.select({ customer: schema.users.stripeCustomerId, email: schema.users.email, phone: schema.users.phone }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    if (!user) throw AppError.notFound('USER_NOT_FOUND', 'Utilisateur introuvable');
    if (user.customer) return user.customer;
    const { customerRef } = await this.provider.createCustomer({ externalId: userId, ...(user.email ? { email: user.email } : {}), phone: user.phone });
    await this.db.update(schema.users).set({ stripeCustomerId: customerRef }).where(and(eq(schema.users.id, userId), isNull(schema.users.stripeCustomerId)));
    const [stored] = await this.db.select({ customer: schema.users.stripeCustomerId }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    return stored?.customer ?? customerRef;
  }

  private async clientOf(userId: string): Promise<{ id: string; balanceDueCents: number }> {
    const [client] = await this.db.select({ id: schema.clients.id, balanceDueCents: schema.clients.balanceDueCents }).from(schema.clients).where(eq(schema.clients.userId, userId)).limit(1);
    if (!client) throw AppError.forbidden('CLIENT_PROFILE_REQUIRED', 'Un profil client est requis');
    return client;
  }

  async setupIntent(userId: string): Promise<SetupIntentResponse> {
    await this.clientOf(userId);
    return this.newSetupIntent(userId);
  }

  /** SetupIntent pour une carte (client) ou la méthode de prélèvement (chauffeur, relevés négatifs). */
  async newSetupIntent(userId: string): Promise<SetupIntentResponse> {
    const customerId = await this.customerFor(userId);
    const intent = await this.provider.createSetupIntent(customerId);
    const merchant = await this.settings.string('payments.apple_pay_merchant_id', '');
    return {
      setupIntentId: intent.setupIntentId,
      clientSecret: intent.clientSecret,
      customerId,
      publishableKey: this.env.STRIPE_PUBLISHABLE_KEY ?? null,
      applePayMerchantId: merchant || null,
      merchantCountry: 'CA',
      simulated: this.provider.name === 'mock',
    };
  }

  /** Relit le SetupIntent chez Stripe et vérifie qu'il appartient bien à ce client : la carte vient de Stripe. */
  async confirmedCardOf(userId: string, setupIntentId: string) {
    const customer = await this.customerFor(userId);
    const intent = await this.provider.retrieveSetupIntent(setupIntentId);
    if (intent.customerRef !== customer) throw AppError.forbidden('SETUP_INTENT_NOT_YOURS', 'Cette autorisation de carte ne vous appartient pas');
    if (intent.status !== 'succeeded' || !intent.card) throw new AppError('SETUP_INTENT_NOT_CONFIRMED', 'La carte n\'a pas encore été confirmée', 409, { status: intent.status });
    return intent.card;
  }

  async confirmSetupIntent(userId: string, input: { setupIntentId: string; makeDefault: boolean }): Promise<PaymentMethodView> {
    const client = await this.clientOf(userId);
    const card = await this.confirmedCardOf(userId, input.setupIntentId);
    const [others] = await this.db.select({ n: sql<number>`count(*)::int` }).from(schema.clientPaymentMethods).where(and(eq(schema.clientPaymentMethods.clientId, client.id), isNull(schema.clientPaymentMethods.deletedAt)));
    const makeDefault = input.makeDefault || !others?.n;
    const row = await this.db.transaction(async (tx) => {
      if (makeDefault) await tx.update(schema.clientPaymentMethods).set({ isDefault: false }).where(eq(schema.clientPaymentMethods.clientId, client.id));
      const [inserted] = await tx
        .insert(schema.clientPaymentMethods)
        .values({ clientId: client.id, stripePaymentMethodId: card.ref, brand: card.brand, last4: card.last4, expMonth: card.expMonth, expYear: card.expYear, isDefault: makeDefault })
        // Une carte déjà connue n'est reprise que pour ce même client (jamais la ligne d'un autre compte).
        .onConflictDoUpdate({ target: schema.clientPaymentMethods.stripePaymentMethodId, set: { deletedAt: null, isDefault: makeDefault }, setWhere: eq(schema.clientPaymentMethods.clientId, client.id) })
        .returning();
      if (!inserted) throw AppError.forbidden('PAYMENT_METHOD_NOT_YOURS', 'Cette carte appartient à un autre compte');
      return inserted;
    });
    this.audit.record({ action: 'payment_method.added', entity: 'client_payment_methods', entityId: row.id, after: { brand: row.brand, last4: row.last4, isDefault: row.isDefault } });
    return this.methodView(row);
  }

  private methodView(row: MethodRow): PaymentMethodView {
    return { id: row.id, brand: row.brand, last4: row.last4, expMonth: row.expMonth ?? null, expYear: row.expYear ?? null, isDefault: row.isDefault, createdAt: row.createdAt.toISOString() };
  }

  async listMethods(userId: string): Promise<PaymentMethodView[]> {
    const client = await this.clientOf(userId);
    const rows = await this.db
      .select()
      .from(schema.clientPaymentMethods)
      .where(and(eq(schema.clientPaymentMethods.clientId, client.id), isNull(schema.clientPaymentMethods.deletedAt)))
      .orderBy(desc(schema.clientPaymentMethods.isDefault), desc(schema.clientPaymentMethods.createdAt));
    return rows.map((r) => this.methodView(r));
  }

  /** Retrait d'une carte : détachée chez Stripe, masquée ici ; une autre carte devient la carte par défaut. */
  async removeMethod(userId: string, methodId: string): Promise<void> {
    const client = await this.clientOf(userId);
    const [row] = await this.db.select().from(schema.clientPaymentMethods).where(and(eq(schema.clientPaymentMethods.id, methodId), eq(schema.clientPaymentMethods.clientId, client.id), isNull(schema.clientPaymentMethods.deletedAt))).limit(1);
    if (!row) throw AppError.notFound('PAYMENT_METHOD_NOT_FOUND', 'Carte introuvable');
    await this.provider.detachPaymentMethod(row.stripePaymentMethodId);
    await this.db.update(schema.clientPaymentMethods).set({ deletedAt: new Date(), isDefault: false }).where(eq(schema.clientPaymentMethods.id, row.id));
    if (row.isDefault) {
      const [next] = await this.db.select({ id: schema.clientPaymentMethods.id }).from(schema.clientPaymentMethods).where(and(eq(schema.clientPaymentMethods.clientId, client.id), isNull(schema.clientPaymentMethods.deletedAt))).orderBy(desc(schema.clientPaymentMethods.createdAt)).limit(1);
      if (next) await this.db.update(schema.clientPaymentMethods).set({ isDefault: true }).where(eq(schema.clientPaymentMethods.id, next.id));
    }
    this.audit.record({ action: 'payment_method.removed', entity: 'client_payment_methods', entityId: row.id, before: { brand: row.brand, last4: row.last4 } });
  }

  /** Carte choisie pour une course : celle indiquée (identifiant Neomoov ou Stripe) si elle est au client, sinon la carte par défaut. */
  async methodForClient(clientId: string, requested?: string): Promise<MethodRow> {
    const conditions = [eq(schema.clientPaymentMethods.clientId, clientId), isNull(schema.clientPaymentMethods.deletedAt)];
    const [row] = requested
      ? await this.db
          .select()
          .from(schema.clientPaymentMethods)
          .where(and(...conditions, /^[0-9a-f-]{36}$/i.test(requested) ? eq(schema.clientPaymentMethods.id, requested) : eq(schema.clientPaymentMethods.stripePaymentMethodId, requested)))
          .limit(1)
      : await this.db.select().from(schema.clientPaymentMethods).where(and(...conditions)).orderBy(desc(schema.clientPaymentMethods.isDefault), desc(schema.clientPaymentMethods.createdAt)).limit(1);
    if (!row) throw new AppError('PAYMENT_METHOD_REQUIRED', requested ? 'Carte introuvable : ajoutez-la de nouveau' : 'Ajoutez une carte pour prépayer la course', 400);
    return row;
  }

  // --- Réservation ---

  /** Solde dû après un échec de capture : aucune nouvelle course avant le règlement (5.6). Solde lu avec le profil client. */
  assertCanBook(balanceDueCents: number): void {
    if (balanceDueCents > 0) throw new AppError('BALANCE_DUE', 'Réglez le solde dû de votre dernière course avant d\'en réserver une nouvelle', 402, { balanceDueCents });
  }

  private async authorizationRules() {
    const [marginPpm, marginCapCents] = await Promise.all([this.settings.number('payments.authorization_margin_ppm', 150_000), this.settings.number('payments.authorization_margin_cap_cents', 2_000)]);
    return { marginPpm, marginCapCents };
  }

  private declined(auth: PaymentAuthorization): never {
    if (auth.status === 'requires_action') {
      throw new AppError('PAYMENT_AUTHENTICATION_REQUIRED', 'Votre banque demande une confirmation : validez le paiement dans l\'application puis réessayez', 402, { intentId: auth.intentId, clientSecret: auth.clientSecret ?? null });
    }
    throw new AppError('PAYMENT_DECLINED', 'Carte refusée : choisissez une autre carte ou payez le chauffeur', 402, { code: auth.failureCode ?? null });
  }

  /** Autorisation d'une course immédiate, avant sa création : un refus empêche la demande (message clair). */
  async authorizeBeforeRide(input: { userId: string; method: MethodRow; maxConsentedCents: number; idempotencyKey: string; quoteId: string }): Promise<RideAuthorization | null> {
    const amount = authorizationCents(input.maxConsentedCents, await this.authorizationRules());
    // Course offerte (rien à payer) : aucune autorisation, la ligne de paiement est close à la fin de course.
    if (amount <= 0) return null;
    const auth = await this.provider.authorize({
      amountCents: amount, currency: 'CAD', customerRef: await this.customerFor(input.userId), paymentMethodRef: input.method.stripePaymentMethodId,
      idempotencyKey: `ride-auth:${input.idempotencyKey}`, metadata: { quote_id: input.quoteId },
    });
    if (auth.status !== 'authorized') this.declined(auth);
    return { intentId: auth.intentId, authorizedCents: amount, paymentMethodRef: input.method.stripePaymentMethodId };
  }

  /** Autorisation annulée quand la course n'a finalement pas été créée (devis déjà utilisé, erreur). */
  async releaseAuthorization(intentId: string): Promise<void> {
    await this.provider.cancel(intentId, `release:${intentId}`).catch((error: unknown) => this.logger.error({ err: error, intentId }, 'Autorisation non annulée'));
  }

  /** Ligne de paiement de la course, dans la transaction qui la crée (une seule par course : clé `ride:<id>`). */
  async recordRidePayment(tx: Executor, input: { rideId: string; clientId: string | null; method: PaymentMethod; paymentMethodRef?: string | null; authorization?: RideAuthorization | null }): Promise<void> {
    if (!isCardMethod(input.method)) return;
    await tx
      .insert(schema.payments)
      .values({
        rideId: input.rideId, clientId: input.clientId, method: input.method, kind: 'ride', idempotencyKey: `ride:${input.rideId}`,
        stripePaymentMethodId: input.authorization?.paymentMethodRef ?? input.paymentMethodRef ?? null,
        stripePaymentIntentId: input.authorization?.intentId ?? null, authorizedCents: input.authorization?.authorizedCents ?? 0,
        status: input.authorization ? 'authorized' : 'pending',
      })
      .onConflictDoNothing();
  }

  private async ridePayment(rideId: string): Promise<PaymentRow | null> {
    const [row] = await this.db.select().from(schema.payments).where(and(eq(schema.payments.rideId, rideId), eq(schema.payments.kind, 'ride'))).limit(1);
    return row ?? null;
  }

  private async rideOf(rideId: string) {
    const [ride] = await this.db.select().from(schema.rides).where(eq(schema.rides.id, rideId)).limit(1);
    if (!ride) throw AppError.notFound('RIDE_NOT_FOUND', 'Course introuvable');
    return ride;
  }

  /** Signal dans le journal de la course (même forme que les signaux de la répartition). */
  private async journal(rideId: string, type: string, data: Record<string, unknown>): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO ride_events (ride_id, type, from_state, to_state, actor_user_id, actor_kind, data)
      SELECT r.id, ${type}::varchar, r.state, r.state, NULL, 'system', ${JSON.stringify(data)}::jsonb FROM rides r WHERE r.id = ${rideId}::uuid`);
  }

  // --- Abonnements aux événements de course ---

  /**
   * Planifiée attribuée : autorisation sur la carte choisie à la réservation. Une autorisation Stripe expire après
   * 7 jours : tant que la prise en charge est à plus de `payments.authorization_lead_days` (6) jours, elle est différée
   * et faite par la reprise périodique (`authorizeDueScheduled`).
   */
  async onRideAssigned(rideId: string, now = new Date()): Promise<void> {
    const payment = await this.ridePayment(rideId);
    if (!payment || payment.status !== 'pending' || payment.stripePaymentIntentId || !payment.stripePaymentMethodId) return;
    const ride = await this.rideOf(rideId);
    const leadDays = await this.settings.number('payments.authorization_lead_days', 6);
    if (ride.requestedAt && ride.requestedAt.getTime() - now.getTime() > leadDays * 86_400_000) {
      await this.journal(rideId, 'payment_authorization_deferred', { until: new Date(ride.requestedAt.getTime() - leadDays * 86_400_000).toISOString() });
      return;
    }
    const [client] = ride.clientId ? await this.db.select({ userId: schema.clients.userId }).from(schema.clients).where(eq(schema.clients.id, ride.clientId)).limit(1) : [];
    if (!client) return;
    const amount = authorizationCents(ride.maxConsentedCents, await this.authorizationRules());
    if (amount <= 0) return;
    const auth = await this.provider.authorize({
      amountCents: amount, currency: 'CAD', customerRef: await this.customerFor(client.userId), paymentMethodRef: payment.stripePaymentMethodId,
      idempotencyKey: `ride-auth:${rideId}`, metadata: { ride_id: rideId, public_number: ride.publicNumber },
    });
    if (auth.status === 'authorized') {
      await this.db.update(schema.payments).set({ stripePaymentIntentId: auth.intentId, authorizedCents: amount, status: 'authorized', failureCode: null }).where(eq(schema.payments.id, payment.id));
      await this.journal(rideId, 'payment_authorized', { amountCents: amount });
      return;
    }
    await this.db.update(schema.payments).set({ status: 'failed', failureCode: auth.failureCode ?? auth.status, ...(auth.intentId ? { stripePaymentIntentId: auth.intentId } : {}) }).where(eq(schema.payments.id, payment.id));
    await this.journal(rideId, 'payment_authorization_failed', { code: auth.failureCode ?? auth.status });
    await this.openIncident(rideId, `Autorisation refusée à l'attribution de la course ${ride.publicNumber} (${auth.failureCode ?? auth.status}) : le client doit choisir une autre carte ou payer le chauffeur.`, 'high');
    await this.outbox.queue({ recipientUserId: client.userId, template: 'payment.authorization_failed', data: { rideId, publicNumber: ride.publicNumber } });
  }

  /** Réservations attribuées dont l'autorisation a été différée et dont la prise en charge approche : autorisées maintenant. */
  async authorizeDueScheduled(now = new Date()): Promise<number> {
    const leadDays = await this.settings.number('payments.authorization_lead_days', 6);
    const rows = await this.db.execute<{ ride_id: string }>(sql`
      SELECT p.ride_id FROM payments p JOIN rides r ON r.id = p.ride_id
      WHERE p.kind = 'ride' AND p.status = 'pending' AND p.stripe_payment_intent_id IS NULL AND p.stripe_payment_method_id IS NOT NULL
        AND r.state IN ('assigned', 'en_route', 'arrived', 'in_progress') AND r.requested_at <= ${new Date(now.getTime() + leadDays * 86_400_000).toISOString()}::timestamptz
      LIMIT 100`);
    for (const row of rows) await this.onRideAssigned(row.ride_id, now);
    return rows.length;
  }

  /**
   * Carte sans autorisation valide : planifiée dont l'autorisation différée n'a pas été faite (`pending`), ou autorisation
   * refusée à l'attribution (`failed` sans tentative de capture). Une fois traité, le paiement porte une tentative et
   * n'est plus repris (événement rejoué sans effet).
   */
  private static unauthorized(payment: PaymentRow): boolean {
    return payment.status === 'pending' || (payment.status === 'failed' && payment.attempts === 0 && payment.capturedCents === 0);
  }

  /**
   * Montant dû sans autorisation valide : paiement hors session sur la carte de la réservation ; refusé (ou impossible),
   * il devient un solde dû (incident, réservations bloquées, avis au client). Avant la revue 17.B, ce montant était
   * abandonné en silence.
   */
  private async chargeWithoutAuthorization(payment: PaymentRow, dueCents: number, signal: string): Promise<void> {
    const ride = await this.rideOf(payment.rideId);
    const [client] = ride.clientId ? await this.db.select({ userId: schema.clients.userId }).from(schema.clients).where(eq(schema.clients.id, ride.clientId)).limit(1) : [];
    const charge = client && payment.stripePaymentMethodId
      ? await this.provider.chargeOffSession({
          amountCents: dueCents, customerRef: await this.customerFor(client.userId), paymentMethodRef: payment.stripePaymentMethodId, idempotencyKey: `ride-charge:${payment.id}`,
          description: `Course ${ride.publicNumber}`, metadata: { ride_id: ride.id, kind: payment.kind },
        })
      : null;
    const attempts = payment.attempts + 1;
    if (charge?.status === 'captured') {
      await this.db
        .update(schema.payments)
        .set({ status: 'captured', stripePaymentIntentId: charge.intentId, authorizedCents: dueCents, capturedCents: dueCents, capturedAt: new Date(), attempts, failureCode: null })
        .where(eq(schema.payments.id, payment.id));
      await this.journal(payment.rideId, signal, { amountCents: dueCents, attempts, offSession: true });
      return;
    }
    const failureCode = charge?.failureCode ?? charge?.status ?? 'no_authorization';
    await this.db.update(schema.payments).set({ status: 'failed', attempts, failureCode }).where(eq(schema.payments.id, payment.id));
    await this.journal(payment.rideId, 'payment_capture_failed', { amountCents: dueCents, attempts, code: failureCode, offSession: true });
    await this.addBalanceDue(payment, dueCents, 'capture_failed');
  }

  /** Fin de course : capture du montant dû (prix final moins les crédits), jamais au-delà de l'autorisation. */
  async onRideCompleted(rideId: string): Promise<void> {
    const payment = await this.ridePayment(rideId);
    if (!payment || (payment.status !== 'authorized' && !PaymentsService.unauthorized(payment))) return;
    const ride = await this.rideOf(rideId);
    const due = Math.max(0, (ride.finalPriceCents ?? ride.quotedTotalCents) - ride.creditsAppliedCents);
    // Course entièrement couverte (crédits, promotion) : rien à capturer ; l'autorisation éventuelle est levée (Stripe
    // refuse une capture nulle) et la ligne de paiement est close.
    if (due === 0) {
      if (payment.status === 'authorized' && payment.stripePaymentIntentId) return this.cancelRidePayment(payment, 'nothing_due');
      await this.db.update(schema.payments).set({ status: 'cancelled' }).where(eq(schema.payments.id, payment.id));
      await this.journal(rideId, 'payment_nothing_due', {});
      return;
    }
    if (payment.status !== 'authorized' || !payment.stripePaymentIntentId) return this.chargeWithoutAuthorization(payment, due, 'ride_captured');
    await this.captureWithRetry(payment, due, 'ride_captured');
  }

  /** Annulation ou absence : frais capturés sur l'autorisation, sinon autorisation annulée. */
  async onRideClosedWithFee(rideId: string, feeCents: number, kind: 'cancellation_fee' | 'no_show_fee'): Promise<void> {
    const payment = await this.ridePayment(rideId);
    if (!payment) return;
    if (!payment.stripePaymentIntentId || payment.status !== 'authorized') {
      if (!PaymentsService.unauthorized(payment)) return;
      // Frais sans autorisation valide (planifiée annulée avant l'autorisation différée, carte refusée) : prélevés hors
      // session, sinon solde dû ; sans frais, la ligne en attente est close.
      if (feeCents <= 0) {
        if (payment.status === 'pending') await this.db.update(schema.payments).set({ status: 'cancelled' }).where(eq(schema.payments.id, payment.id));
        return;
      }
      await this.db.update(schema.payments).set({ kind }).where(eq(schema.payments.id, payment.id));
      return this.chargeWithoutAuthorization({ ...payment, kind }, feeCents, kind === 'no_show_fee' ? 'no_show_fee_captured' : 'cancellation_fee_captured');
    }
    if (feeCents <= 0) return this.cancelRidePayment(payment, kind === 'no_show_fee' ? 'no_show' : 'cancelled');
    await this.db.update(schema.payments).set({ kind }).where(eq(schema.payments.id, payment.id));
    await this.captureWithRetry({ ...payment, kind }, feeCents, kind === 'no_show_fee' ? 'no_show_fee_captured' : 'cancellation_fee_captured');
  }

  /**
   * Aucun chauffeur : l'autorisation est levée, rien n'est dû. Annulation par le chauffeur : la course repart aussitôt en
   * répartition (5.2) et sera servie par un autre chauffeur ; l'autorisation (ou la ligne en attente d'une planifiée) est
   * gardée, sinon la course réattribuée se terminerait sans capture (revue 17.B). Si elle finit sans être servie, c'est
   * l'événement de cette fin (aucun chauffeur, annulation du client) qui lève l'autorisation.
   */
  async onRideReleased(rideId: string, reason: string): Promise<void> {
    const payment = await this.ridePayment(rideId);
    if (!payment) return;
    if (reason === 'cancelled_by_driver') {
      await this.journal(rideId, 'payment_authorization_kept', { reason });
      return;
    }
    if (payment.status === 'authorized' && payment.stripePaymentIntentId) return this.cancelRidePayment(payment, reason);
    if (payment.status === 'pending') await this.db.update(schema.payments).set({ status: 'cancelled' }).where(eq(schema.payments.id, payment.id));
  }

  private async cancelRidePayment(payment: PaymentRow, reason: string): Promise<void> {
    await this.provider.cancel(payment.stripePaymentIntentId!, `cancel:${payment.id}`);
    await this.db.update(schema.payments).set({ status: 'cancelled' }).where(eq(schema.payments.id, payment.id));
    await this.journal(payment.rideId, 'payment_authorization_released', { reason });
  }

  /**
   * Capture avec nouvelle tentative (`payments.capture_attempts`, 2 par défaut ; une clé d'idempotence par tentative,
   * Stripe mémorisant aussi les refus). Après la dernière : incident, solde dû du client, notification.
   */
  private async captureWithRetry(payment: PaymentRow, dueCents: number, signal: string): Promise<void> {
    const { captureCents: amount, shortfallCents } = captureCents(dueCents, payment.authorizedCents);
    const maxAttempts = await this.settings.number('payments.capture_attempts', 2);
    let attempts = payment.attempts;
    let last: PaymentAuthorization | null = null;
    while (attempts < maxAttempts) {
      attempts += 1;
      last = await this.provider.capture(payment.stripePaymentIntentId!, amount, `capture:${payment.id}:${attempts}`);
      if (last.status === 'captured') break;
      this.logger.warn({ paymentId: payment.id, attempts, code: last.failureCode }, 'Capture refusée');
    }
    if (last?.status === 'captured') {
      await this.db.update(schema.payments).set({ status: 'captured', capturedCents: amount, capturedAt: new Date(), attempts, failureCode: null }).where(eq(schema.payments.id, payment.id));
      await this.journal(payment.rideId, signal, { amountCents: amount, attempts });
      if (shortfallCents > 0) await this.addBalanceDue(payment, shortfallCents, 'shortfall');
      return;
    }
    await this.db.update(schema.payments).set({ status: 'failed', attempts, failureCode: last?.failureCode ?? 'capture_failed' }).where(eq(schema.payments.id, payment.id));
    await this.journal(payment.rideId, 'payment_capture_failed', { amountCents: amount, attempts, code: last?.failureCode ?? null });
    await this.addBalanceDue(payment, dueCents, 'capture_failed');
  }

  /** Solde dû : ticket pour l'agent relation client (incident), blocage des nouvelles courses, avis au client. */
  private async addBalanceDue(payment: PaymentRow, amountCents: number, reason: 'capture_failed' | 'shortfall'): Promise<void> {
    if (!payment.clientId || amountCents <= 0) return;
    await this.db.update(schema.clients).set({ balanceDueCents: sql`${schema.clients.balanceDueCents} + ${amountCents}` }).where(eq(schema.clients.id, payment.clientId));
    const ride = await this.rideOf(payment.rideId);
    await this.openIncident(payment.rideId, `Paiement non encaissé pour la course ${ride.publicNumber} : ${amountCents} ¢ (${reason === 'shortfall' ? 'dépassement de l\'autorisation' : 'capture refusée'}). Nouvelles courses du client bloquées jusqu'au règlement.`, 'medium');
    const [client] = await this.db.select({ userId: schema.clients.userId }).from(schema.clients).where(eq(schema.clients.id, payment.clientId)).limit(1);
    if (client) await this.outbox.queue({ recipientUserId: client.userId, template: 'payment.balance_due', data: { rideId: payment.rideId, publicNumber: ride.publicNumber, amountCents } });
  }

  private async openIncident(rideId: string | null, description: string, severity: 'medium' | 'high'): Promise<void> {
    const [incident] = await this.db.insert(schema.incidents).values({ rideId, type: 'payment_failed', severity, reportedByKind: 'system', description }).returning({ id: schema.incidents.id });
    if (rideId) this.events.emit('ride.incident', { rideId, incidentId: incident!.id, type: 'payment_failed', severity, reportedByUserId: null });
  }

  // --- Pourboire ---

  /** Pourboire après la course : paiement séparé hors session sur la carte de la course (ou la carte par défaut). */
  async tip(rideId: string, userId: string, amountCents: number): Promise<PaymentView> {
    const ride = await this.rideOf(rideId);
    const client = await this.clientOf(userId);
    if (ride.clientId !== client.id) throw AppError.forbidden('NOT_RIDE_CLIENT', 'Seul le client de la course peut laisser un pourboire');
    if (!CLOSED_FOR_TIP.includes(ride.state)) throw AppError.conflict('RIDE_NOT_COMPLETED', 'Le pourboire est proposé après la course', { state: ride.state });
    const maxCents = await this.settings.number('rides.tip_max_cents', 10_000);
    if (amountCents > maxCents) throw new AppError('TIP_TOO_HIGH', 'Pourboire au-delà du plafond', 400, { maxCents });
    const [existing] = await this.db.select().from(schema.payments).where(and(eq(schema.payments.rideId, rideId), eq(schema.payments.kind, 'tip'))).limit(1);
    if (existing && existing.status === 'captured') return this.paymentView(existing);
    const ridePayment = await this.ridePayment(rideId);
    const method = ridePayment?.stripePaymentMethodId ? { stripePaymentMethodId: ridePayment.stripePaymentMethodId, method: ridePayment.method } : await this.methodForClient(client.id).then((m) => ({ stripePaymentMethodId: m.stripePaymentMethodId, method: 'card_app' as const }));
    const charge = await this.provider.chargeOffSession({
      amountCents, customerRef: await this.customerFor(userId), paymentMethodRef: method.stripePaymentMethodId, idempotencyKey: `tip:${rideId}`,
      description: `Pourboire, course ${ride.publicNumber}`, metadata: { ride_id: rideId, kind: 'tip' },
    });
    if (charge.status !== 'captured') this.declined(charge);
    const [row] = await this.db
      .insert(schema.payments)
      .values({
        rideId, clientId: client.id, method: method.method, kind: 'tip', idempotencyKey: `tip:${rideId}`, stripePaymentIntentId: charge.intentId, stripePaymentMethodId: method.stripePaymentMethodId,
        authorizedCents: amountCents, capturedCents: amountCents, tipCents: amountCents, status: 'captured', capturedAt: new Date(),
      })
      .onConflictDoUpdate({ target: schema.payments.idempotencyKey, targetWhere: sql`${schema.payments.idempotencyKey} IS NOT NULL`, set: { status: 'captured', capturedCents: amountCents, tipCents: amountCents, stripePaymentIntentId: charge.intentId } })
      .returning();
    await this.db.update(schema.rides).set({ tipCents: amountCents }).where(eq(schema.rides.id, rideId));
    await this.journal(rideId, 'tip_captured', { amountCents });
    return this.paymentView(row!);
  }

  // --- Paiement direct ---

  /** Montant reçu par le chauffeur (espèces, Interac, terminal) : `paid_direct` ; un écart ouvre un incident. */
  async recordDirect(input: { rideId: string; driverUserId: string; method: PaymentMethod; amountCents: number; expectedCents: number | null; clientId: string | null }): Promise<void> {
    const [existing] = await this.db.select({ id: schema.payments.id }).from(schema.payments).where(and(eq(schema.payments.rideId, input.rideId), eq(schema.payments.collectedBy, 'driver'))).limit(1);
    if (existing) await this.db.update(schema.payments).set({ driverConfirmedCents: input.amountCents, status: 'paid_direct', method: input.method }).where(eq(schema.payments.id, existing.id));
    else {
      await this.db
        .insert(schema.payments)
        .values({ rideId: input.rideId, clientId: input.clientId, method: input.method, kind: 'ride', status: 'paid_direct', collectedBy: 'driver', driverConfirmedCents: input.amountCents, idempotencyKey: `direct:${input.rideId}` })
        .onConflictDoNothing();
    }
    await this.db.execute(sql`
      INSERT INTO ride_events (ride_id, type, from_state, to_state, actor_user_id, actor_kind, data)
      SELECT r.id, 'payment_received_direct', r.state, r.state, ${input.driverUserId}::uuid, 'driver', ${JSON.stringify({ amountCents: input.amountCents, expectedCents: input.expectedCents, method: input.method })}::jsonb FROM rides r WHERE r.id = ${input.rideId}::uuid`);
    if (input.expectedCents !== null && input.amountCents !== input.expectedCents) {
      const [incident] = await this.db
        .insert(schema.incidents)
        .values({ rideId: input.rideId, type: 'other', severity: 'medium', reportedByUserId: input.driverUserId, reportedByKind: 'driver', description: `Écart de paiement direct : ${input.amountCents} ¢ reçus pour ${input.expectedCents} ¢ dus` })
        .returning({ id: schema.incidents.id });
      await this.db.execute(sql`
        INSERT INTO ride_events (ride_id, type, from_state, to_state, actor_user_id, actor_kind, data)
        SELECT r.id, 'payment_discrepancy', r.state, r.state, ${input.driverUserId}::uuid, 'driver', ${JSON.stringify({ amountCents: input.amountCents, expectedCents: input.expectedCents, incidentId: incident!.id })}::jsonb FROM rides r WHERE r.id = ${input.rideId}::uuid`);
      this.events.emit('ride.incident', { rideId: input.rideId, incidentId: incident!.id, type: 'other', severity: 'medium', reportedByUserId: input.driverUserId });
    }
  }

  // --- Remboursements ---

  /**
   * Remboursement d'une course : sur la carte (dans la limite du capturé moins les remboursements), ou en crédit sur
   * le compte du client (5.6, au choix du client ; seule voie pour un paiement direct). Motif obligatoire, idempotent.
   */
  async refund(rideId: string, input: { amountCents: number; reason: string; mode: 'refund' | 'credit' }, actor: { userId: string | null; agentCode?: string | null }, idempotencyKey?: string): Promise<RefundView> {
    const ride = await this.rideOf(rideId);
    const key = `refund:${rideId}:${idempotencyKey ?? shortHash(`${input.mode}|${input.amountCents}|${input.reason}`)}`;
    const [replay] = await this.db.select().from(schema.refunds).where(eq(schema.refunds.idempotencyKey, key)).limit(1);
    if (replay) return this.refundView(replay);
    const payments = await this.db.select().from(schema.payments).where(and(eq(schema.payments.rideId, rideId), inArray(schema.payments.kind, ['ride', 'cancellation_fee', 'no_show_fee']))).orderBy(desc(schema.payments.createdAt));
    const payment = payments.find((p) => p.status === 'captured' || p.status === 'refunded' || p.status === 'paid_direct') ?? payments[0];
    if (!payment) throw AppError.conflict('NOTHING_TO_REFUND', 'Aucun paiement enregistré pour cette course');
    const [refunded] = await this.db.select({ total: sql<number>`COALESCE(sum(${schema.refunds.amountCents}), 0)::int` }).from(schema.refunds).where(and(eq(schema.refunds.paymentId, payment.id), ne(schema.refunds.status, 'failed')));
    const already = Number(refunded?.total ?? 0);

    if (input.mode === 'refund') {
      if (payment.collectedBy === 'driver' || !payment.stripePaymentIntentId) throw AppError.conflict('REFUND_CARD_IMPOSSIBLE', 'Payée au chauffeur : seul un crédit est possible');
      const refundable = refundableCents(payment.capturedCents, already);
      if (input.amountCents > refundable) throw new AppError('REFUND_TOO_HIGH', 'Montant supérieur au reste remboursable', 400, { refundableCents: refundable });
      const result = await this.provider.refund({ intentId: payment.stripePaymentIntentId, amountCents: input.amountCents, idempotencyKey: key, reason: input.reason });
      const [row] = await this.db
        .insert(schema.refunds)
        .values({ paymentId: payment.id, mode: 'refund', amountCents: input.amountCents, reason: input.reason, decidedByUserId: actor.userId, decidedByAgentCode: actor.agentCode ?? null, stripeRefundId: result.refundId, status: result.status, idempotencyKey: key })
        .returning();
      if (already + input.amountCents >= payment.capturedCents) await this.db.update(schema.payments).set({ status: 'refunded' }).where(eq(schema.payments.id, payment.id));
      await this.journal(rideId, 'payment_refunded', { amountCents: input.amountCents, mode: 'refund' });
      this.audit.record({ action: 'payment.refunded', entity: 'refunds', entityId: row!.id, after: { rideId, amountCents: input.amountCents, reason: input.reason, mode: 'refund' } });
      // Étape 9 : la facturation émet la note de crédit d'un remboursement réussi ; un remboursement encore en attente chez
      // Stripe la reçoit quand le webhook le confirme (`refund.updated`, `charge.refunded`).
      if (row!.status === 'succeeded') this.events.emit('payment.refunded', { refundId: row!.id, rideId, paymentId: payment.id, amountCents: input.amountCents, mode: 'refund', occurredAt: row!.createdAt });
      return this.refundView(row!);
    }

    // Crédit : plafonné au prix de la course (moins ce qui a déjà été rendu).
    const ceiling = Math.max(0, (ride.finalPriceCents ?? ride.quotedTotalCents) - already);
    if (input.amountCents > ceiling) throw new AppError('REFUND_TOO_HIGH', 'Crédit supérieur au prix de la course', 400, { refundableCents: ceiling });
    const [client] = ride.clientId ? await this.db.select({ userId: schema.clients.userId }).from(schema.clients).where(eq(schema.clients.id, ride.clientId)).limit(1) : [];
    if (!client) throw AppError.conflict('NO_CLIENT_ACCOUNT', 'Course sans compte client : crédit impossible');
    const row = await this.db.transaction(async (tx) => {
      const [credit] = await tx.insert(schema.credits).values({ userId: client.userId, amountCents: input.amountCents, remainingCents: input.amountCents, origin: 'refund', reference: ride.publicNumber, note: input.reason, expiresAt: new Date(Date.now() + (await this.settings.number('credits.validity_days', 365)) * 86_400_000) }).returning({ id: schema.credits.id });
      const [inserted] = await tx
        .insert(schema.refunds)
        .values({ paymentId: payment.id, mode: 'credit', amountCents: input.amountCents, reason: input.reason, decidedByUserId: actor.userId, decidedByAgentCode: actor.agentCode ?? null, creditId: credit!.id, status: 'succeeded', idempotencyKey: key })
        .returning();
      return inserted!;
    });
    await this.journal(rideId, 'payment_refunded', { amountCents: input.amountCents, mode: 'credit' });
    this.audit.record({ action: 'payment.credited', entity: 'refunds', entityId: row.id, after: { rideId, amountCents: input.amountCents, reason: input.reason, mode: 'credit' } });
    // Étape 9 : un remboursement en crédit donne aussi une note de crédit.
    this.events.emit('payment.refunded', { refundId: row.id, rideId, paymentId: payment.id, amountCents: input.amountCents, mode: 'credit', occurredAt: row.createdAt });
    return this.refundView(row);
  }

  private refundView(row: typeof schema.refunds.$inferSelect): RefundView {
    return { id: row.id, paymentId: row.paymentId, mode: row.mode as 'refund' | 'credit', amountCents: row.amountCents, reason: row.reason, status: row.status as RefundView['status'], createdAt: row.createdAt.toISOString() };
  }

  // --- Solde dû ---

  /**
   * Courses dont le montant dû n'est pas encaissé : capture refusée (`failed`), ou capture réussie mais plafonnée par
   * l'autorisation (`captured` avec un reste, le dépassement ajouté au solde dû). Sans ce second cas, le règlement
   * remettait le solde à zéro sans prélever le dépassement (revue 17.B).
   */
  private async unsettled(clientId: string) {
    const rows = await this.db.execute<{ payment_id: string; ride_id: string; public_number: string; due: number }>(sql`
      SELECT payment_id, ride_id, public_number, due FROM (
        SELECT p.id AS payment_id, p.ride_id, r.public_number, p.status, p.created_at,
               GREATEST(0, CASE WHEN p.kind = 'ride' THEN COALESCE(r.final_price_cents, r.quoted_total_cents) - r.credits_applied_cents ELSE r.cancellation_fee_cents END - p.captured_cents)::int AS due
        FROM payments p JOIN rides r ON r.id = p.ride_id
        WHERE p.client_id = ${clientId} AND p.status IN ('failed', 'captured') AND p.kind IN ('ride', 'cancellation_fee', 'no_show_fee')
          AND NOT EXISTS (SELECT 1 FROM payments b WHERE b.ride_id = p.ride_id AND b.kind = 'balance' AND b.status = 'captured')
      ) AS u
      WHERE u.status = 'failed' OR u.due > 0
      ORDER BY u.created_at`);
    return [...rows].map((r) => ({ paymentId: r.payment_id, rideId: r.ride_id, publicNumber: r.public_number, amountDueCents: Number(r.due) }));
  }

  async balance(userId: string): Promise<BalanceView> {
    const client = await this.clientOf(userId);
    const rides = await this.unsettled(client.id);
    return { balanceDueCents: client.balanceDueCents, rides: rides.filter((r) => r.amountDueCents > 0).map(({ rideId, publicNumber, amountDueCents }) => ({ rideId, publicNumber, amountDueCents })) };
  }

  /** Règlement du solde dû (`POST /v1/me/settle`) : un paiement hors session par course impayée ; le blocage est levé. */
  async settle(userId: string, paymentMethodId?: string): Promise<{ paidCents: number; balanceDueCents: number }> {
    const client = await this.clientOf(userId);
    const method = await this.methodForClient(client.id, paymentMethodId);
    const customer = await this.customerFor(userId);
    let paid = 0;
    for (const item of await this.unsettled(client.id)) {
      if (item.amountDueCents <= 0) continue;
      const key = `balance:${item.paymentId}`;
      const charge = await this.provider.chargeOffSession({ amountCents: item.amountDueCents, customerRef: customer, paymentMethodRef: method.stripePaymentMethodId, idempotencyKey: key, description: `Solde dû, course ${item.publicNumber}`, metadata: { ride_id: item.rideId, kind: 'balance' } });
      if (charge.status !== 'captured') this.declined(charge);
      await this.db
        .insert(schema.payments)
        .values({ rideId: item.rideId, clientId: client.id, method: 'card_app', kind: 'balance', idempotencyKey: key, stripePaymentIntentId: charge.intentId, stripePaymentMethodId: method.stripePaymentMethodId, authorizedCents: item.amountDueCents, capturedCents: item.amountDueCents, status: 'captured', capturedAt: new Date() })
        .onConflictDoNothing();
      await this.journal(item.rideId, 'balance_settled', { amountCents: item.amountDueCents });
      paid += item.amountDueCents;
    }
    const remaining = (await this.unsettled(client.id)).reduce((sum, r) => sum + r.amountDueCents, 0);
    await this.db.update(schema.clients).set({ balanceDueCents: remaining }).where(eq(schema.clients.id, client.id));
    if (paid) this.audit.record({ action: 'payment.balance_settled', entity: 'clients', entityId: client.id, after: { paidCents: paid, balanceDueCents: remaining } });
    return { paidCents: paid, balanceDueCents: remaining };
  }

  // --- Vues ---

  paymentView(row: PaymentRow, card: { brand: string; last4: string } | null = null, refundedCents = 0): PaymentView {
    return {
      id: row.id, rideId: row.rideId, kind: row.kind as PaymentView['kind'], method: row.method, status: row.status, collectedBy: row.collectedBy, authorizedCents: row.authorizedCents,
      capturedCents: row.capturedCents, refundedCents, driverConfirmedCents: row.driverConfirmedCents ?? null, card, failureCode: row.failureCode ?? null, createdAt: row.createdAt.toISOString(),
    };
  }

  /** Paiements vus par un participant : le chauffeur voit les montants, jamais la carte du client. */
  async ridePaymentsFor(rideId: string, userId: string): Promise<PaymentView[]> {
    const views = await this.ridePayments(rideId);
    const [ride] = await this.db.select({ driverUserId: schema.drivers.userId }).from(schema.rides).leftJoin(schema.drivers, eq(schema.drivers.id, schema.rides.driverId)).where(eq(schema.rides.id, rideId)).limit(1);
    return ride?.driverUserId === userId ? views.map((v) => ({ ...v, card: null })) : views;
  }

  /** Paiements d'une course (reçu du client, My Hub), carte masquée, remboursements cumulés. */
  async ridePayments(rideId: string): Promise<PaymentView[]> {
    const rows = await this.db.select().from(schema.payments).where(eq(schema.payments.rideId, rideId)).orderBy(schema.payments.createdAt);
    if (!rows.length) return [];
    const refs = rows.map((r) => r.stripePaymentMethodId).filter((r): r is string => Boolean(r));
    const cards = refs.length ? await this.db.select({ ref: schema.clientPaymentMethods.stripePaymentMethodId, brand: schema.clientPaymentMethods.brand, last4: schema.clientPaymentMethods.last4 }).from(schema.clientPaymentMethods).where(inArray(schema.clientPaymentMethods.stripePaymentMethodId, refs)) : [];
    const refunds = await this.db.select({ paymentId: schema.refunds.paymentId, total: sql<number>`sum(${schema.refunds.amountCents})::int` }).from(schema.refunds).where(and(inArray(schema.refunds.paymentId, rows.map((r) => r.id)), ne(schema.refunds.status, 'failed'))).groupBy(schema.refunds.paymentId);
    return rows.map((r) => {
      const card = cards.find((c) => c.ref === r.stripePaymentMethodId);
      return this.paymentView(r, card ? { brand: card.brand, last4: card.last4 } : null, Number(refunds.find((x) => x.paymentId === r.id)?.total ?? 0));
    });
  }

  // --- Webhooks ---

  verifyWebhook(rawBody: Buffer, signature: string): Promise<WebhookEvent> {
    return this.provider.verifyWebhook(rawBody, signature);
  }

  /** Réception : l'identifiant de l'événement est la clé ; un événement déjà reçu n'est jamais retraité. */
  async ingestWebhook(event: WebhookEvent): Promise<{ duplicate: boolean }> {
    const inserted = await this.db
      .insert(schema.webhookEvents)
      .values({ id: event.id, provider: this.provider.name, type: event.type, payload: event as unknown as Record<string, unknown> })
      .onConflictDoNothing()
      .returning({ id: schema.webhookEvents.id });
    return { duplicate: inserted.length === 0 };
  }

  /** Traitement d'un événement reçu ; un échec est gardé (`failed`) pour la file de retraitement. */
  async processWebhook(eventId: string): Promise<'processed' | 'ignored' | 'failed' | 'skipped'> {
    const [row] = await this.db.select().from(schema.webhookEvents).where(eq(schema.webhookEvents.id, eventId)).limit(1);
    if (!row || row.status === 'processed' || row.status === 'ignored') return 'skipped';
    try {
      const handled = await this.applyWebhook(row.payload as unknown as WebhookEvent);
      const status = handled ? 'processed' : 'ignored';
      await this.db.update(schema.webhookEvents).set({ status, processedAt: new Date(), attempts: row.attempts + 1, lastError: null }).where(eq(schema.webhookEvents.id, eventId));
      return status;
    } catch (error) {
      this.logger.error({ err: error, eventId, type: row.type }, 'Webhook de paiement en échec');
      await this.db.update(schema.webhookEvents).set({ status: 'failed', attempts: row.attempts + 1, lastError: error instanceof Error ? error.message.slice(0, 500) : String(error) }).where(eq(schema.webhookEvents.id, eventId));
      return 'failed';
    }
  }

  /** Événements en attente ou en échec (moins de `payments.webhook_max_attempts` essais) : repris par la file. */
  async pendingWebhooks(limit = 50): Promise<string[]> {
    const maxAttempts = await this.settings.number('payments.webhook_max_attempts', 5);
    const rows = await this.db.execute<{ id: string }>(sql`SELECT id FROM webhook_events WHERE status IN ('received', 'failed') AND attempts < ${maxAttempts} ORDER BY received_at LIMIT ${limit}`);
    return [...rows].map((r) => r.id);
  }

  private async applyWebhook(event: WebhookEvent): Promise<boolean> {
    const object = event.data.object;
    const id = String(object['id'] ?? '');
    switch (event.type) {
      case 'payment_intent.amount_capturable_updated':
      case 'payment_intent.succeeded':
      case 'payment_intent.canceled':
      case 'payment_intent.payment_failed': {
        const [payment] = await this.db.select().from(schema.payments).where(eq(schema.payments.stripePaymentIntentId, id)).limit(1);
        if (!payment) return false;
        if (event.type === 'payment_intent.succeeded') {
          const received = Number(object['amount_received'] ?? payment.capturedCents);
          if (payment.status !== 'captured' && payment.status !== 'refunded') await this.db.update(schema.payments).set({ status: 'captured', capturedCents: received, capturedAt: payment.capturedAt ?? new Date() }).where(eq(schema.payments.id, payment.id));
        } else if (event.type === 'payment_intent.canceled') {
          if (payment.status === 'authorized' || payment.status === 'pending') await this.db.update(schema.payments).set({ status: 'cancelled' }).where(eq(schema.payments.id, payment.id));
        } else if (event.type === 'payment_intent.payment_failed') {
          const error = object['last_payment_error'] as { code?: string; decline_code?: string } | undefined;
          if (payment.status === 'pending' || payment.status === 'authorized') await this.db.update(schema.payments).set({ status: 'failed', failureCode: error?.decline_code ?? error?.code ?? 'payment_failed' }).where(eq(schema.payments.id, payment.id));
        } else if (payment.status === 'pending') {
          await this.db.update(schema.payments).set({ status: 'authorized', authorizedCents: Number(object['amount_capturable'] ?? payment.authorizedCents) }).where(eq(schema.payments.id, payment.id));
        }
        return true;
      }
      case 'charge.refunded':
      case 'refund.updated': {
        const refundIds = event.type === 'refund.updated' ? [id] : ((object['refunds'] as { data?: Array<{ id: string; status: string }> } | undefined)?.data ?? []).map((r) => r.id);
        const status = event.type === 'refund.updated' ? String(object['status']) : 'succeeded';
        if (!refundIds.length) return false;
        const next = status === 'succeeded' ? 'succeeded' : status === 'failed' || status === 'canceled' ? 'failed' : 'pending';
        const changed = await this.db
          .update(schema.refunds)
          .set({ status: next })
          .where(and(inArray(schema.refunds.stripeRefundId, refundIds), ne(schema.refunds.status, next)))
          .returning({ id: schema.refunds.id, paymentId: schema.refunds.paymentId, amountCents: schema.refunds.amountCents, mode: schema.refunds.mode });
        // Étape 9 : un remboursement qui devient réussi reçoit sa note de crédit (facturation).
        if (next === 'succeeded' && changed.length) {
          const owners = await this.db.select({ id: schema.payments.id, rideId: schema.payments.rideId }).from(schema.payments).where(inArray(schema.payments.id, changed.map((r) => r.paymentId)));
          for (const r of changed) {
            const rideId = owners.find((p) => p.id === r.paymentId)?.rideId;
            if (rideId) this.events.emit('payment.refunded', { refundId: r.id, rideId, paymentId: r.paymentId, amountCents: r.amountCents, mode: r.mode === 'credit' ? 'credit' : 'refund', occurredAt: new Date() });
          }
        }
        return true;
      }
      case 'charge.dispute.created': {
        const intentId = String(object['payment_intent'] ?? '');
        const [payment] = intentId ? await this.db.select({ rideId: schema.payments.rideId }).from(schema.payments).where(eq(schema.payments.stripePaymentIntentId, intentId)).limit(1) : [];
        await this.openIncident(payment?.rideId ?? null, `Litige bancaire ouvert (${String(object['reason'] ?? 'motif inconnu')}) : ${Number(object['amount'] ?? 0)} ¢. Répondre dans le délai indiqué par Stripe.`, 'high');
        if (payment) await this.journal(payment.rideId, 'payment_disputed', { disputeId: id, amountCents: Number(object['amount'] ?? 0) });
        return true;
      }
      case 'payment_method.detached': {
        const updated = await this.db.update(schema.clientPaymentMethods).set({ deletedAt: new Date(), isDefault: false }).where(and(eq(schema.clientPaymentMethods.stripePaymentMethodId, id), isNull(schema.clientPaymentMethods.deletedAt))).returning({ id: schema.clientPaymentMethods.id });
        return updated.length > 0;
      }
      case 'account.updated': {
        const onboarded = Boolean(object['details_submitted']);
        const updated = await this.db.update(schema.drivers).set({ stripeConnectOnboarded: onboarded }).where(eq(schema.drivers.stripeConnectAccountId, id)).returning({ id: schema.drivers.id });
        return updated.length > 0;
      }
      case 'transfer.created':
      case 'transfer.reversed':
      case 'payout.failed':
        // Versements du vendredi : rapprochés avec les relevés à l'étape 9 ; l'événement est gardé dans le journal.
        this.logger.info({ type: event.type, id }, 'Événement de versement reçu');
        return true;
      default:
        return false;
    }
  }
}
