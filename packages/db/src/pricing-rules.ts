/**
 * Assemble les `PricingRules` du moteur de tarification (@neomoov/domain) à partir des lignes de la base :
 * réglages, grille par catégorie, suppléments et forfaits. Fonction pure : la lecture des tables est faite par l'appelant.
 */

import type { FlatRate, PeakWindow, PricingRules } from '@neomoov/domain';

export interface PricingSources {
  timeZone: string;
  settings: Record<string, unknown>;
  pricingRules: { category: string; baseCents: number; perKmCents: number; perMinuteCents: number; minimumCents: number }[];
  surcharges: { code: string; amountCents: number; conditions: unknown }[];
  flatRates: { code: string; category: string; originZoneCode: string; destinationZoneCode: string; totalCents: number; bidirectional: boolean }[];
}

const hourOf = (hhmm: unknown, fallback: number): number => (typeof hhmm === 'string' && /^\d{2}:\d{2}$/.test(hhmm) ? Number(hhmm.slice(0, 2)) : fallback);
const minuteOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

function num(settings: Record<string, unknown>, key: string): number {
  const v = settings[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Réglage manquant ou invalide : ${key}`);
  return v;
}

export function buildPricingRules(src: PricingSources): PricingRules {
  const s = src.settings;
  const surcharge = (code: string) => src.surcharges.find((x) => x.code === code);
  const night = surcharge('night');
  const nightConditions = (night?.conditions ?? {}) as { from?: unknown; to?: unknown };
  const peakRaw = (s['pricing.peak_windows'] ?? []) as { days: number[]; from: string; to: string }[];
  const peakWindows: PeakWindow[] = peakRaw.map((w) => ({ days: w.days, startMinute: minuteOf(w.from), endMinute: w.to <= w.from ? minuteOf(w.to) + 1440 : minuteOf(w.to) }));

  const flatByPair = new Map<string, FlatRate>();
  for (const f of src.flatRates) {
    const key = `${f.originZoneCode}>${f.destinationZoneCode}`;
    const entry = flatByPair.get(key) ?? { originZone: f.originZoneCode, destinationZone: f.destinationZoneCode, bidirectional: f.bidirectional, totalCentsByCategory: {}, codeByCategory: {} };
    entry.totalCentsByCategory[f.category] = f.totalCents;
    entry.codeByCategory![f.category] = f.code;
    flatByPair.set(key, entry);
  }

  return {
    timeZone: src.timeZone,
    categories: src.pricingRules.map((r) => ({ category: r.category, baseFareCents: r.baseCents, perKmCents: r.perKmCents, perMinuteCents: r.perMinuteCents, minimumFareCents: r.minimumCents })),
    surcharges: {
      nightCents: night?.amountCents ?? 0,
      nightStartHour: hourOf(nightConditions.from, 23),
      nightEndHour: hourOf(nightConditions.to, 5),
      airportCents: surcharge('airport')?.amountCents ?? 0,
      childSeatCents: surcharge('child_seat')?.amountCents ?? 0,
      bulkyLuggageCents: surcharge('luggage')?.amountCents ?? 0,
      perStopCents: surcharge('stop')?.amountCents ?? 0,
      favouriteDriverCents: num(s, 'pricing.favourite_driver_cents'),
    },
    flexMultiplierBps: num(s, 'pricing.flex_multiplier_bps'),
    priorityMultiplierBps: num(s, 'pricing.priority_multiplier_bps'),
    peakWindows,
    flatRates: [...flatByPair.values()],
    serviceFeeCents: num(s, 'pricing.service_fee_cents'),
    regulatoryFeeCents: num(s, 'pricing.regulatory_fee_cents'),
    gstRatePpm: num(s, 'pricing.gst_rate_ppm'),
    qstRatePpm: num(s, 'pricing.qst_rate_ppm'),
    maxExtraAllowanceCents: num(s, 'pricing.max_extra_allowance_cents'),
    waitFreeSeconds: num(s, 'rides.free_wait_seconds'),
    waitPerMinuteCents: num(s, 'rides.wait_per_minute_cents'),
  };
}
