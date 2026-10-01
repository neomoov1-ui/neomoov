/**
 * Versements et prélèvements des relevés (section 5.6 et 5.8, prompt 09 tâche 3). Net positif : transfert Stripe
 * Connect ; net négatif : prélèvement hors session sur la méthode enregistrée par le chauffeur ; une clé d'idempotence
 * par relevé (et par tentative de prélèvement). Échec : relevé `failed`, nouvelle tentative le lundi, puis suspension
 * automatique (solde négatif au-delà du seuil après la reprise, ou impayé depuis plus de 7 jours) ; réactivation
 * automatique dès que le solde est régularisé. `driver_balances` reflète les relevés non réglés.
 * Étape 26 : avec un fournisseur sans versements par la plateforme (Square, aucun équivalent de Connect), un relevé
 * positif reste « émis », à verser hors plateforme : il figure dans l'export des virements à faire
 * (`GET /v1/admin/payouts/offline`, CSV), puis les finances le clôturent par `settle-offline` avec la référence du virement.
 */
import { schema } from '@neomoov/db';
import { evaluateSuspension, type AdminBalance, type AdminStatementDetail, type OfflinePayout, type StatementSettleOffline } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNotNull, lt, ne, or, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { APP_LOGGER, currentCorrelationId } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AuditService } from '../audit/audit.service.js';
import type { UserActor } from '../auth/actor.js';
import { csvDocument, csvLine } from '../ledgers/csv.js';
import { PaymentsService } from '../payments/payments.service.js';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';
import { PresenceService } from '../rides/presence.service.js';
import { StatementsService } from './statements.service.js';

/** Délai minimal entre deux tentatives automatiques d'un même relevé (la reprise du lundi ne s'emballe pas). */
const RETRY_SPACING_MS = 20 * 3_600_000;
/** Séparateur des exports CSV (même convention que les registres : point-virgule, montants en cents). */
const CSV_SEPARATOR = ';';

/** Référence d'un versement hors plateforme, à reprendre comme libellé du virement puis dans `settle-offline`. */
export function offlinePayoutReference(periodStart: string, driverPublicNumber: string): string {
  return `NM-${periodStart.replace(/-/g, '')}-${driverPublicNumber}`;
}

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
    if (row.netCents > 0 && !this.provider.capabilities.connect) {
      // Étape 26 (Square) : aucun versement par la plateforme. Le relevé reste à régler, sans tentative ni alerte d'échec :
      // il est listé dans l'export des virements à faire et clôturé par `settle-offline`.
      this.audit.record({ action: 'statement.offline_payout_due', entity: 'weekly_statements', entityId: id, after: { netCents: row.netCents, provider: this.provider.name } });
      return this.statements.detail(id);
    }
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
      // Une erreur du fournisseur (réseau, panne) donne un relevé en échec, repris le lundi : laissé « émis », il n'était
      // plus jamais prélevé ni compté dans le solde du chauffeur (revue 17.B).
      try {
        const charge = await this.provider.chargeOffSession({
          amountCents: -row.netCents, customerRef: await this.payments.customerFor(driver.userId), paymentMethodRef: driver.stripeDebitPaymentMethodId,
          idempotencyKey: `statement:${id}:charge:${attempts}`, description: `Relevé Neomoov ${row.periodStart} au ${row.periodEnd}`, metadata: { statement_id: id },
        });
        outcome = charge.status === 'captured' || charge.status === 'authorized' ? { status: 'charged', chargeRef: charge.intentId } : { status: 'failed', failureCode: charge.failureCode ?? charge.status };
      } catch (error) {
        this.logger.error({ err: error, statementId: id }, 'Prélèvement du relevé en erreur');
        outcome = { status: 'failed', failureCode: 'charge_failed' };
      }
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

  /**
   * Règlement constaté hors plateforme par les finances (revue finale, E5) : un relevé négatif payé par Interac,
   * virement ou espèces, ou un net positif versé à la main, sort de la boucle des essais et de la suspension. Le relevé
   * passe à `charged` (le chauffeur a payé) ou `paid` (Neomoov a versé), avec le moyen, la référence et l'auteur ;
   * rejoué avec la même référence, il ne change rien ; le solde est recalculé (réactivation automatique).
   */
  async settleOffline(id: string, actor: { userId: string }, input: StatementSettleOffline, now = new Date()): Promise<AdminStatementDetail> {
    const [row] = await this.db.select().from(schema.weeklyStatements).where(eq(schema.weeklyStatements.id, id)).limit(1);
    if (!row) throw AppError.notFound('STATEMENT_NOT_FOUND', 'Relevé introuvable');
    if (row.status === 'draft') throw AppError.conflict('STATEMENT_NOT_ISSUED', 'Émettez le relevé avant de le régler');
    if (row.status === 'paid' || row.status === 'charged') {
      if (row.offlineSettlement?.reference === input.reference) return this.statements.detail(id);
      throw AppError.conflict('STATEMENT_ALREADY_SETTLED', 'Ce relevé est déjà réglé', { status: row.status });
    }
    const offlineSettlement = { method: input.method, reference: input.reference, note: input.note ?? null, byUserId: actor.userId };
    const status = row.netCents < 0 ? 'charged' : 'paid';
    const changed = await this.db
      .update(schema.weeklyStatements)
      .set({ status, settledAt: now, failureCode: null, offlineSettlement })
      .where(and(eq(schema.weeklyStatements.id, id), inArray(schema.weeklyStatements.status, ['issued', 'failed'])))
      .returning({ id: schema.weeklyStatements.id });
    if (!changed.length) return this.statements.detail(id);
    this.audit.record({ action: 'statement.settled_offline', entity: 'weekly_statements', entityId: id, before: { status: row.status, failureCode: row.failureCode }, after: { status, netCents: row.netCents, method: input.method, reference: input.reference, note: input.note ?? null } });
    const [driver] = await this.db.select({ userId: schema.drivers.userId }).from(schema.drivers).where(eq(schema.drivers.id, row.driverId)).limit(1);
    if (driver && row.netCents > 0) await this.outbox.queue({ recipientUserId: driver.userId, template: 'statement.paid', data: { statementId: id, netCents: row.netCents } });
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

  /**
   * Versements à faire hors plateforme (étape 26) : relevés émis ou en échec au net positif, pas encore réglés, les plus
   * anciens d'abord. Avec Stripe Connect, la liste ne contient que les versements en échec (compte manquant, refus).
   */
  async offlinePayouts(): Promise<OfflinePayout[]> {
    const rows = await this.db
      .select({ s: schema.weeklyStatements, publicNumber: schema.drivers.publicNumber, interacEmail: schema.drivers.interacEmail, first: schema.users.firstName, last: schema.users.lastName })
      .from(schema.weeklyStatements)
      .innerJoin(schema.drivers, eq(schema.drivers.id, schema.weeklyStatements.driverId))
      .innerJoin(schema.users, eq(schema.users.id, schema.drivers.userId))
      .where(and(inArray(schema.weeklyStatements.status, ['issued', 'failed']), gt(schema.weeklyStatements.netCents, 0)))
      .orderBy(asc(schema.weeklyStatements.periodStart), asc(schema.drivers.publicNumber))
      .limit(2_000);
    return rows.map(({ s, publicNumber, interacEmail, first, last }) => ({
      statementId: s.id, driverId: s.driverId, driverPublicNumber: publicNumber, driverName: [first, last].filter(Boolean).join(' ') || null, interacEmail: interacEmail ?? null,
      periodStart: s.periodStart, periodEnd: s.periodEnd, amountCents: s.netCents, reference: offlinePayoutReference(s.periodStart, publicNumber),
      status: s.status as OfflinePayout['status'], issuedAt: s.issuedAt?.toISOString() ?? null,
    }));
  }

  /** Nom du fichier CSV des versements à faire. */
  offlinePayoutsFileName(now = new Date()): string {
    return `neomoov-versements-a-faire-${now.toISOString().slice(0, 10)}.csv`;
  }

  /** Export CSV des virements à faire (une ligne par relevé, puis le total) ; le téléchargement est journalisé. */
  async offlinePayoutsCsv(actor: UserActor): Promise<string> {
    const payouts = await this.offlinePayouts();
    const lines = [csvLine(['chauffeur', 'nom', 'courriel_interac', 'periode_debut', 'periode_fin', 'montant_cents', 'reference', 'releve', 'etat'], CSV_SEPARATOR)];
    for (const p of payouts) lines.push(csvLine([p.driverPublicNumber, p.driverName, p.interacEmail, p.periodStart, p.periodEnd, p.amountCents, p.reference, p.statementId, p.status], CSV_SEPARATOR));
    lines.push(csvLine(['TOTAL', payouts.length, null, null, null, payouts.reduce((sum, p) => sum + p.amountCents, 0), null, null, null], CSV_SEPARATOR));
    await this.audit.write([{ action: 'statement.offline_payouts_exported', entity: 'weekly_statements', entityId: null, after: { count: payouts.length, format: 'csv' } }], { actor, ip: null, correlationId: currentCorrelationId() ?? null });
    return csvDocument(lines);
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
