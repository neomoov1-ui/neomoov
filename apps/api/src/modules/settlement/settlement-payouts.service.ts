/**
 * Versements et prélèvements des relevés (section 5.6 et 5.8, prompt 09 tâche 3). Net positif : transfert Stripe
 * Connect ; net négatif : prélèvement hors session sur la méthode enregistrée par le chauffeur ; une clé d'idempotence
 * par relevé (et par tentative de prélèvement). Échec : relevé `failed`, nouvelle tentative le lundi, puis suspension
 * automatique (solde négatif au-delà du seuil après la reprise, ou impayé depuis plus de 7 jours) ; réactivation
 * automatique dès que le solde est régularisé. `driver_balances` reflète les relevés non réglés.
 */
import { schema } from '@neomoov/db';
import { evaluateSuspension, type AdminBalance, type AdminStatementDetail } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, lt, ne, or, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AuditService } from '../audit/audit.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';
import { PresenceService } from '../rides/presence.service.js';
import { StatementsService } from './statements.service.js';

/** Délai minimal entre deux tentatives automatiques d'un même relevé (la reprise du lundi ne s'emballe pas). */
const RETRY_SPACING_MS = 20 * 3_600_000;

@Injectable()
export class SettlementPayoutsService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly settings: SettingsService,
    private readonly payments: PaymentsService,
    private readonly statements: StatementsService,
    private readonly presence: PresenceService,
    private readonly outbox: NotificationsOutbox,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.database.db;
  }

  /**
   * Règlement d'un relevé émis (ou nouvel essai d'un relevé en échec). Rejoué, il ne verse ni ne prélève jamais deux
   * fois : le statut est relu sous verrou et Stripe reçoit la même clé pour le même versement.
   */
  async settle(id: string, now = new Date()): Promise<AdminStatementDetail> {
    const [row] = await this.db.select().from(schema.weeklyStatements).where(eq(schema.weeklyStatements.id, id)).limit(1);
    if (!row) throw AppError.notFound('STATEMENT_NOT_FOUND', 'Relevé introuvable');
    if (row.status === 'draft') throw AppError.conflict('STATEMENT_NOT_ISSUED', 'Émettez le relevé avant de le régler');
    if (row.status === 'paid' || row.status === 'charged') return this.statements.detail(id);
    const [driver] = await this.db.select().from(schema.drivers).where(eq(schema.drivers.id, row.driverId)).limit(1);
    if (!driver) throw AppError.notFound('DRIVER_NOT_FOUND', 'Chauffeur introuvable');
    const attempts = row.attempts + 1;
    let outcome: { status: 'paid' | 'charged' | 'failed'; transferRef?: string; chargeRef?: string; failureCode?: string };
    if (row.netCents === 0) outcome = { status: 'paid' };
    else if (row.netCents > 0) {
      if (!driver.stripeConnectAccountId || !driver.stripeConnectOnboarded) outcome = { status: 'failed', failureCode: 'payout_account_missing' };
      else {
        try {
          const { transferId } = await this.provider.transfer({
            accountRef: driver.stripeConnectAccountId, amountCents: row.netCents, idempotencyKey: `statement:${id}:payout`, description: `Relevé Neomoov ${row.periodStart} au ${row.periodEnd}`,
          });
          outcome = { status: 'paid', transferRef: transferId };
        } catch (error) {
          this.logger.error({ err: error, statementId: id }, 'Versement du relevé refusé');
          outcome = { status: 'failed', failureCode: 'transfer_failed' };
        }
      }
    } else if (!driver.stripeDebitPaymentMethodId) outcome = { status: 'failed', failureCode: 'debit_method_missing' };
    else {
      const charge = await this.provider.chargeOffSession({
        amountCents: -row.netCents, customerRef: await this.payments.customerFor(driver.userId), paymentMethodRef: driver.stripeDebitPaymentMethodId,
        idempotencyKey: `statement:${id}:charge:${attempts}`, description: `Relevé Neomoov ${row.periodStart} au ${row.periodEnd}`, metadata: { statement_id: id },
      });
      outcome = charge.status === 'captured' || charge.status === 'authorized' ? { status: 'charged', chargeRef: charge.intentId } : { status: 'failed', failureCode: charge.failureCode ?? charge.status };
    }
    const settled = outcome.status !== 'failed';
    // Seul un relevé encore à régler change d'état : deux règlements simultanés n'écrivent qu'une fois.
    const changed = await this.db
      .update(schema.weeklyStatements)
      .set({
        status: outcome.status, attempts, failureCode: outcome.failureCode ?? null, ...(settled ? { settledAt: now } : {}),
        ...(outcome.transferRef ? { stripeTransferId: outcome.transferRef } : {}), ...(outcome.chargeRef ? { stripeChargeId: outcome.chargeRef } : {}),
      })
      .where(and(eq(schema.weeklyStatements.id, id), inArray(schema.weeklyStatements.status, ['issued', 'failed'])))
      .returning({ id: schema.weeklyStatements.id });
    this.audit.record({ action: settled ? 'statement.settled' : 'statement.settlement_failed', entity: 'weekly_statements', entityId: id, after: { status: outcome.status, netCents: row.netCents, attempts, failureCode: outcome.failureCode ?? null } });
    if (!settled) {
      await this.outbox.queue({ recipientUserId: driver.userId, template: 'statement.settlement_failed', data: { statementId: id, netCents: row.netCents, reason: outcome.failureCode ?? null } });
      // Revue finale : l'exploitation est prévenue de chaque règlement en échec (courriel), pas seulement le chauffeur.
      await this.outbox.queueForStaff('alert.settlement_failed', { statementId: id, netCents: row.netCents, reason: outcome.failureCode ?? null, attempts });
    } else if (changed.length && row.netCents > 0) {
      // Versement réussi : le chauffeur est prévenu une seule fois (état changé par ce règlement).
      await this.outbox.queue({ recipientUserId: driver.userId, template: 'statement.paid', data: { statementId: id, netCents: row.netCents } });
    }
    await this.refreshBalance(row.driverId, now);
    return this.statements.detail(id);
  }

  /** Relevés émis d'une période, réglés à la suite (vendredi). */
  async settleIssued(periodStart: string, now = new Date()): Promise<number> {
    const rows = await this.db.select({ id: schema.weeklyStatements.id }).from(schema.weeklyStatements).where(and(eq(schema.weeklyStatements.periodStart, periodStart), eq(schema.weeklyStatements.status, 'issued')));
    for (const r of rows) await this.settle(r.id, now).catch((error: unknown) => this.logger.error({ err: error, statementId: r.id }, 'Règlement du relevé impossible'));
    return rows.length;
  }

  /** Reprise du lundi : relevés en échec dont la dernière tentative date de plus de 20 heures. */
  async retryFailed(now = new Date()): Promise<number> {
    const rows = await this.db
      .select({ id: schema.weeklyStatements.id })
      .from(schema.weeklyStatements)
      .where(and(eq(schema.weeklyStatements.status, 'failed'), lt(schema.weeklyStatements.updatedAt, new Date(now.getTime() - RETRY_SPACING_MS))));
    for (const r of rows) await this.settle(r.id, now).catch((error: unknown) => this.logger.error({ err: error, statementId: r.id }, 'Nouvel essai du relevé impossible'));
    return rows.length;
  }

  /**
   * Solde du chauffeur : somme des relevés non réglés (en échec). Suspension automatique quand la règle du domaine le
   * dit, après la nouvelle tentative (seuil dépassé) ou au-delà du délai (impayé) ; réactivation dès le solde régularisé.
   */
  async refreshBalance(driverId: string, now = new Date()): Promise<void> {
    const unpaid = await this.db
      .select({ netCents: schema.weeklyStatements.netCents, attempts: schema.weeklyStatements.attempts, issuedAt: schema.weeklyStatements.issuedAt })
      .from(schema.weeklyStatements)
      .where(and(eq(schema.weeklyStatements.driverId, driverId), eq(schema.weeklyStatements.status, 'failed')));
    const balanceCents = unpaid.reduce((s, r) => s + r.netCents, 0);
    const owed = unpaid.filter((r) => r.netCents < 0);
    const unpaidSince = owed.length ? new Date(Math.min(...owed.map((r) => (r.issuedAt ?? now).getTime()))) : null;
    const [current] = await this.db.select().from(schema.driverBalances).where(eq(schema.driverBalances.driverId, driverId)).limit(1);
    const [threshold, graceDays] = await Promise.all([this.settings.number('settlement.negative_balance_threshold_cents', 15_000), this.settings.number('settlement.unpaid_grace_days', 7)]);
    const verdict = evaluateSuspension({ balanceCents, unpaidSince }, now, { negativeBalanceThresholdCents: threshold, unpaidGraceDays: graceDays });
    const retried = owed.some((r) => r.attempts >= 2);
    const suspend = verdict.suspend && (verdict.reason === 'overdue' || retried);
    const wasSuspended = Boolean(current?.suspendedForBalanceAt);
    const suspendedAt = suspend ? (current?.suspendedForBalanceAt ?? now) : owed.length && wasSuspended ? current!.suspendedForBalanceAt : null;
    await this.db
      .insert(schema.driverBalances)
      .values({ driverId, balanceCents, unpaidSince, suspendedForBalanceAt: suspendedAt })
      .onConflictDoUpdate({ target: schema.driverBalances.driverId, set: { balanceCents, unpaidSince, suspendedForBalanceAt: suspendedAt } });
    const [driver] = await this.db.select({ userId: schema.drivers.userId }).from(schema.drivers).where(eq(schema.drivers.id, driverId)).limit(1);
    if (!driver) return;
    if (suspendedAt && !wasSuspended) {
      await this.presence.setStatus(driver.userId, { status: 'offline' }).catch(() => undefined);
      await this.outbox.queue({ recipientUserId: driver.userId, template: 'balance.suspended', data: { balanceCents, reason: verdict.reason } });
      this.audit.record({ action: 'driver.suspended_for_balance', entity: 'drivers', entityId: driverId, after: { balanceCents, reason: verdict.reason } });
    } else if (!suspendedAt && wasSuspended) {
      await this.outbox.queue({ recipientUserId: driver.userId, template: 'balance.reactivated', data: { balanceCents } });
      this.audit.record({ action: 'driver.reactivated_after_balance', entity: 'drivers', entityId: driverId, after: { balanceCents } });
    }
  }

  /** Revue quotidienne des soldes impayés (délai de 7 jours dépassé sans nouvelle tentative réussie). */
  async reviewBalances(now = new Date()): Promise<number> {
    const rows = await this.db
      .selectDistinct({ driverId: schema.weeklyStatements.driverId })
      .from(schema.weeklyStatements)
      .where(or(eq(schema.weeklyStatements.status, 'failed'), sql`${schema.weeklyStatements.driverId} IN (SELECT driver_id FROM driver_balances WHERE suspended_for_balance_at IS NOT NULL)`));
    for (const r of rows) await this.refreshBalance(r.driverId, now);
    return rows.length;
  }

  /** `GET /v1/admin/balances` : soldes non nuls ou chauffeurs suspendus, les plus endettés d'abord. */
  async balances(): Promise<AdminBalance[]> {
    const rows = await this.db
      .select({ b: schema.driverBalances, publicNumber: schema.drivers.publicNumber, first: schema.users.firstName, last: schema.users.lastName })
      .from(schema.driverBalances)
      .innerJoin(schema.drivers, eq(schema.drivers.id, schema.driverBalances.driverId))
      .innerJoin(schema.users, eq(schema.users.id, schema.drivers.userId))
      .where(or(ne(schema.driverBalances.balanceCents, 0), isNotNull(schema.driverBalances.suspendedForBalanceAt)))
      .orderBy(schema.driverBalances.balanceCents, desc(schema.driverBalances.updatedAt))
      .limit(500);
    return rows.map(({ b, publicNumber, first, last }) => ({
      driverId: b.driverId, driverPublicNumber: publicNumber, driverName: [first, last].filter(Boolean).join(' ') || null, balanceCents: b.balanceCents,
      unpaidSince: b.unpaidSince?.toISOString() ?? null, suspendedForBalanceAt: b.suspendedForBalanceAt?.toISOString() ?? null, lastStatementId: b.lastStatementId ?? null,
    }));
  }
}
