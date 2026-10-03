/**
 * Redevance Neomoov (décision du fondateur du 3 octobre 2026) côté finances : total d'une période, par mode de paiement
 * et par taux, lu dans `platform_fees` (une ligne par course terminée, écrite à la fin de course). La période porte sur
 * le jour local (heure de Montréal) de la fin de course.
 */
import type { PlatformFeeSummary } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AppError } from '../../common/app-error.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';

const MAX_DAYS = 366;

@Injectable()
export class PlatformFeesService {
  constructor(
    @Inject(DB) private readonly database: Database,
    private readonly settings: SettingsService,
  ) {}

  async summary(from: string, to: string): Promise<PlatformFeeSummary> {
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
    if (days < 0 || days > MAX_DAYS) throw new AppError('PERIOD_INVALID', `Période de 1 à ${MAX_DAYS + 1} jours, début avant la fin`, 400, { from, to });
    const tz = await this.settings.string('service.time_zone', 'America/Toronto');
    const rows = await this.database.db.execute<{ channel: string; rate_bps: number; rides: number; total: number; base: number }>(sql`
      SELECT pf.payment_channel AS channel, pf.rate_bps, count(*)::int AS rides, coalesce(sum(pf.amount_cents), 0)::int AS total, coalesce(sum(pf.base_cents), 0)::int AS base
      FROM platform_fees pf JOIN rides r ON r.id = pf.ride_id
      WHERE (r.state_timestamps->>'completed')::timestamptz >= (${from}::date::timestamp AT TIME ZONE ${tz})
        AND (r.state_timestamps->>'completed')::timestamptz < ((${to}::date + 1)::timestamp AT TIME ZONE ${tz})
      GROUP BY pf.payment_channel, pf.rate_bps
      ORDER BY pf.rate_bps DESC`);
    const summary: PlatformFeeSummary = {
      from, to, rides: 0, totalCents: 0, baseCents: 0, platform: { rides: 0, totalCents: 0 }, direct: { rides: 0, totalCents: 0 }, byRate: [],
    };
    for (const row of rows) {
      const rides = Number(row.rides);
      const total = Number(row.total);
      summary.rides += rides;
      summary.totalCents += total;
      summary.baseCents += Number(row.base);
      const channel = row.channel === 'direct' ? summary.direct : summary.platform;
      channel.rides += rides;
      channel.totalCents += total;
      const rate = summary.byRate.find((r) => r.rateBps === Number(row.rate_bps));
      if (rate) {
        rate.rides += rides;
        rate.totalCents += total;
      } else summary.byRate.push({ rateBps: Number(row.rate_bps), rides, totalCents: total });
    }
    return summary;
  }
}
