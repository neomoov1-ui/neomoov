/**
 * Étape 23 (module Flotte) : part de l'organisation d'un chauffeur sur son relevé hebdomadaire, selon les règles de
 * partage de son organisation (loyer fixe par semaine, ou pourcentage du tarif chauffeur des courses Neomoov du relevé).
 * Une ligne `fleet_share` (débit) par règle appliquée. Un chauffeur de la plateforme (sans organisation cliente) n'en a
 * jamais. Lu dans la transaction du relevé : sous le contexte d'une organisation, ses règles seules sont visibles.
 */
import { schema } from '@neomoov/db';
import { revenueShare, type RevenueShareMode, type ShareRide, type StatementLine, type StatementPeriod } from '@neomoov/domain';
import { Injectable } from '@nestjs/common';
import { and, eq, gte, isNull, lte, or } from 'drizzle-orm';
import type { Database } from '../../infra/db.module.js';

type Executor = Pick<Database['db'], 'select'>;

@Injectable()
export class FleetShareService {
  /** Lignes de partage d'un relevé ; `rides` : les courses terminées que porte ce relevé (jour local et tarif chauffeur). */
  async lines(tx: Executor, driver: { id: string; organizationId: string | null }, period: StatementPeriod, rides: readonly ShareRide[]): Promise<StatementLine[]> {
    if (!driver.organizationId) return [];
    const earliest = rides.reduce((min, r) => (r.date < min ? r.date : min), period.startDate);
    const r = schema.revenueShareRules;
    const rows = await tx
      .select({ id: r.id, driverId: r.driverId, mode: r.mode, weeklyRentCents: r.weeklyRentCents, percentagePpm: r.percentagePpm, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo })
      .from(r)
      .where(and(eq(r.organizationId, driver.organizationId), or(isNull(r.driverId), eq(r.driverId, driver.id)), lte(r.effectiveFrom, period.endDate), or(isNull(r.effectiveTo), gte(r.effectiveTo, earliest))));
    if (!rows.length) return [];
    const share = revenueShare(rows.map((row) => ({ ...row, mode: row.mode as RevenueShareMode })), driver.id, period, rides);
    const at = new Date(`${period.endDate}T12:00:00Z`);
    return share.lines.map((line) => ({ kind: 'fleet_share', amountCents: line.amountCents, occurredAt: at, label: line.label }));
  }
}
