/**
 * Étape 23 (module Flotte) : relevés hebdomadaires des organisations. Une organisation cliente reçoit chaque semaine la
 * somme des lignes `fleet_share` des relevés émis de ses chauffeurs (sa part : loyer ou pourcentage), versée sur son
 * compte Stripe Connect (`organizations.stripe_account_id`, parcours d'ouverture repris de celui des chauffeurs) ; sans
 * compte Connect en service, le relevé reste « émis » et se règle hors plateforme (virement, Interac), constaté par
 * `settleOffline` et repris dans l'export des virements. Uniquement les courses Neomoov (décision D1).
 *
 * Le calcul se fait par la plateforme (hors contexte : les relevés des chauffeurs d'une organisation peuvent avoir été
 * produits par la passe de la plateforme) ; les lectures et le règlement hors plateforme côté organisation passent par
 * la transaction restreinte de la route (les relevés d'une autre organisation sont introuvables : 404).
 */
import { schema } from '@neomoov/db';
import type { OrganizationStatementView, StatementPeriod, StatementSettleOffline } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { APP_LOGGER } from '../../common/logger.js';
import { withoutOrgScope } from '../../common/org-scope.context.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AuditService, type AuditEntry } from '../audit/audit.service.js';

type Row = typeof schema.organizationStatements.$inferSelect;

export interface OrganizationPayReport {
  issued: number;
  paid: number;
  failed: number;
  /** Organisations sans compte Connect en service : relevé laissé à régler hors plateforme. */
  offline: number;
}

@Injectable()
export class OrganizationStatementsService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.database.db;
  }

  /**
   * Relevés d'organisation d'une période, à partir des relevés de chauffeurs émis (jamais un brouillon) : créés ou mis à
   * jour tant qu'ils ne sont pas réglés, puis versés. Rejouable : un relevé réglé ne change plus, un transfert porte une
   * clé d'idempotence par relevé et par essai.
   */
  async issueAndPay(period: Pick<StatementPeriod, 'startDate' | 'endDate'>, now = new Date()): Promise<OrganizationPayReport> {
    return withoutOrgScope(async () => {
      const report: OrganizationPayReport = { issued: 0, paid: 0, failed: 0, offline: 0 };
      const shares = await this.db.execute<{ organization_id: string; statement_id: string; driver_id: string; share: number }>(sql`
        SELECT ws.organization_id, ws.id AS statement_id, ws.driver_id, sum(sl.amount_cents)::int AS share
        FROM weekly_statements ws
        JOIN statement_lines sl ON sl.statement_id = ws.id AND sl.kind = 'fleet_share'
        JOIN organizations o ON o.id = ws.organization_id AND o.parent_id IS NOT NULL
        WHERE ws.period_start = ${period.startDate}::date AND ws.status <> 'draft'
        GROUP BY ws.organization_id, ws.id, ws.driver_id
        ORDER BY ws.organization_id, ws.driver_id`);
      const byOrg = new Map<string, Array<{ driverId: string; statementId: string; shareCents: number }>>();
      for (const s of shares) {
        const list = byOrg.get(s.organization_id) ?? [];
        list.push({ driverId: s.driver_id, statementId: s.statement_id, shareCents: Number(s.share) });
        byOrg.set(s.organization_id, list);
      }
      for (const [organizationId, lines] of byOrg) {
        const shareCents = lines.reduce((sum, l) => sum + l.shareCents, 0);
        const values = { lines, shareCents, driverCount: new Set(lines.map((l) => l.driverId)).size };
        const [row] = await this.db
          .insert(schema.organizationStatements)
          .values({ organizationId, periodStart: period.startDate, periodEnd: period.endDate, status: 'issued', issuedAt: now, ...values })
          .onConflictDoUpdate({
            target: [schema.organizationStatements.organizationId, schema.organizationStatements.periodStart],
            set: { ...values, updatedAt: now },
            setWhere: sql`${schema.organizationStatements.status} IN ('issued', 'failed')`,
          })
          .returning({ id: schema.organizationStatements.id });
        if (row) report.issued += 1;
      }
      const due = await this.db.select().from(schema.organizationStatements).where(and(eq(schema.organizationStatements.periodStart, period.startDate), inArray(schema.organizationStatements.status, ['issued', 'failed'])));
      for (const statement of due) {
        const outcome = await this.pay(statement, now);
        report[outcome] += 1;
      }
      return report;
    });
  }

  /**
   * Reprise (passe du lundi) : versements en échec, et relevés encore à verser d'une organisation qui a ouvert son compte
   * Connect depuis (les autres restent à régler hors plateforme, sans changement).
   */
  async retryFailed(now = new Date()): Promise<OrganizationPayReport> {
    return withoutOrgScope(async () => {
      const report: OrganizationPayReport = { issued: 0, paid: 0, failed: 0, offline: 0 };
      const pending = await this.db
        .select()
        .from(schema.organizationStatements)
        .where(inArray(schema.organizationStatements.status, ['issued', 'failed']))
        .orderBy(schema.organizationStatements.periodStart)
        .limit(200);
      for (const statement of pending) report[await this.pay(statement, now)] += 1;
      return report;
    });
  }

  /** Versement d'un relevé d'organisation par Stripe Connect (simulé en test) ; sans compte en service : hors plateforme. */
  private async pay(statement: Row, now: Date): Promise<'paid' | 'failed' | 'offline'> {
    const [org] = await this.db.select({ accountRef: schema.organizations.stripeAccountId, onboarded: schema.organizations.stripeAccountOnboarded }).from(schema.organizations).where(eq(schema.organizations.id, statement.organizationId)).limit(1);
    if (statement.shareCents === 0) {
      await this.db.update(schema.organizationStatements).set({ status: 'paid', settledAt: now }).where(and(eq(schema.organizationStatements.id, statement.id), inArray(schema.organizationStatements.status, ['issued', 'failed'])));
      return 'paid';
    }
    if (!org?.accountRef || !org.onboarded) return 'offline';
    const attempts = statement.attempts + 1;
    try {
      const { transferId } = await this.provider.transfer({
        accountRef: org.accountRef, amountCents: statement.shareCents, idempotencyKey: `organization-statement:${statement.id}:payout:${attempts}`,
        description: `Part de l'organisation, relevé Neomoov ${statement.periodStart} au ${statement.periodEnd}`,
      });
      await this.db
        .update(schema.organizationStatements)
        .set({ status: 'paid', stripeTransferId: transferId, attempts, failureCode: null, settledAt: now })
        .where(and(eq(schema.organizationStatements.id, statement.id), inArray(schema.organizationStatements.status, ['issued', 'failed'])));
      this.journal({ action: 'organization_statement.paid', entity: 'organization_statements', entityId: statement.id, after: { shareCents: statement.shareCents, transferId } }, statement.organizationId);
      return 'paid';
    } catch (error) {
      this.logger.error({ err: error, organizationStatementId: statement.id }, 'Versement à l\'organisation refusé');
      await this.db.update(schema.organizationStatements).set({ status: 'failed', attempts, failureCode: 'transfer_failed' }).where(eq(schema.organizationStatements.id, statement.id));
      this.journal({ action: 'organization_statement.payout_failed', entity: 'organization_statements', entityId: statement.id, after: { shareCents: statement.shareCents, attempts } }, statement.organizationId);
      return 'failed';
    }
  }

  /** Journal d'audit d'une action de la plateforme pour une organisation : visible dans le journal de celle-ci. */
  private journal(entry: AuditEntry, organizationId: string): void {
    void this.audit.write([entry], { actor: null, ip: null, correlationId: null, organizationId }).catch(() => undefined);
  }

  // --- Côté organisation (transaction restreinte de la route) ---

  async list(limit = 52): Promise<OrganizationStatementView[]> {
    const rows = await this.db.select().from(schema.organizationStatements).orderBy(desc(schema.organizationStatements.periodStart)).limit(limit);
    return this.views(rows);
  }

  async detail(id: string): Promise<OrganizationStatementView> {
    const [row] = await this.db.select().from(schema.organizationStatements).where(eq(schema.organizationStatements.id, id)).limit(1);
    if (!row) throw AppError.notFound('ORGANIZATION_STATEMENT_NOT_FOUND', 'Relevé d\'organisation introuvable');
    return (await this.views([row]))[0]!;
  }

  /** Règlement constaté hors plateforme (pas de compte Connect, ou versement manuel) ; rejoué avec la même référence, sans effet. */
  async settleOffline(id: string, input: StatementSettleOffline, actor: { userId: string }, now = new Date()): Promise<OrganizationStatementView> {
    const [row] = await this.db.select().from(schema.organizationStatements).where(eq(schema.organizationStatements.id, id)).limit(1);
    if (!row) throw AppError.notFound('ORGANIZATION_STATEMENT_NOT_FOUND', 'Relevé d\'organisation introuvable');
    if (row.status === 'settled_offline' && row.offlineSettlement?.reference === input.reference) return this.detail(id);
    if (row.status !== 'issued' && row.status !== 'failed') throw AppError.conflict('ORGANIZATION_STATEMENT_SETTLED', 'Ce relevé est déjà réglé', { status: row.status });
    const offlineSettlement = { method: input.method, reference: input.reference, note: input.note ?? null, byUserId: actor.userId };
    await this.db.update(schema.organizationStatements).set({ status: 'settled_offline', settledAt: now, failureCode: null, offlineSettlement }).where(eq(schema.organizationStatements.id, id));
    this.audit.record({ action: 'organization_statement.settled_offline', entity: 'organization_statements', entityId: id, after: { method: input.method, reference: input.reference, shareCents: row.shareCents } });
    return this.detail(id);
  }

  /** Export des virements (CSV, séparateur « ; ») : un relevé par ligne, pour le rapprochement bancaire de l'organisation. */
  async exportCsv(): Promise<string> {
    const rows = await this.db.select().from(schema.organizationStatements).orderBy(desc(schema.organizationStatements.periodStart)).limit(520);
    const cell = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ['periode_debut', 'periode_fin', 'statut', 'part_cents', 'chauffeurs', 'transfert_stripe', 'moyen_hors_plateforme', 'reference', 'regle_le'];
    const lines = rows.map((r) => [r.periodStart, r.periodEnd, r.status, r.shareCents, r.driverCount, r.stripeTransferId, r.offlineSettlement?.method, r.offlineSettlement?.reference, r.settledAt?.toISOString()].map(cell).join(';'));
    return [header.join(';'), ...lines].join('\n') + '\n';
  }

  private async views(rows: Row[]): Promise<OrganizationStatementView[]> {
    const driverIds = [...new Set(rows.flatMap((r) => r.lines.map((l) => l.driverId)))];
    const drivers = driverIds.length
      ? await this.db
          .select({ id: schema.drivers.id, publicNumber: schema.drivers.publicNumber, first: schema.users.firstName, last: schema.users.lastName })
          .from(schema.drivers)
          .leftJoin(schema.users, eq(schema.users.id, schema.drivers.userId))
          .where(inArray(schema.drivers.id, driverIds))
      : [];
    const byId = new Map(drivers.map((d) => [d.id, d]));
    return rows.map((r) => ({
      id: r.id, organizationId: r.organizationId, periodStart: r.periodStart, periodEnd: r.periodEnd, status: r.status as OrganizationStatementView['status'], shareCents: r.shareCents,
      driverCount: r.driverCount,
      lines: r.lines.map((l) => {
        const d = byId.get(l.driverId);
        return { driverId: l.driverId, statementId: l.statementId, shareCents: l.shareCents, driverPublicNumber: d?.publicNumber ?? '', driverName: [d?.first, d?.last].filter(Boolean).join(' ') || null };
      }),
      transferRef: r.stripeTransferId, failureCode: r.failureCode, offlineSettlement: r.offlineSettlement ?? null, issuedAt: r.issuedAt.toISOString(), settledAt: r.settledAt?.toISOString() ?? null,
    }));
  }
}
