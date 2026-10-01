/**
 * Rentabilité nette du chauffeur (étape 24, amendement v1.2 section 7.5) : revenus Neomoov (tarifs et pourboires des
 * courses, frais d'annulation qui lui reviennent), revenus des autres plateformes saisis à la main par le chauffeur (un
 * total, sans logo ni nom de plateforme : Pilote ne lit rien ailleurs, décision D1), coûts saisis par poste et packs
 * Neomoov achetés. Montants en cents ; le net peut être négatif.
 */

export const DRIVER_COST_ITEMS = ['vehicle', 'insurance', 'energy', 'maintenance', 'phone', 'other'] as const;
export type DriverCostItem = (typeof DRIVER_COST_ITEMS)[number];

export interface ProfitabilityLine {
  fareCents: number;
  tipCents: number;
  /** Frais d'annulation ou de non-présentation : un revenu, pas une course. */
  fee?: boolean;
}

export type ProfitabilityCosts = Partial<Record<DriverCostItem, number>> & { packsCents?: number };

export interface NetProfitability {
  rides: number;
  revenue: { neomoovCents: number; externalCents: number; totalCents: number };
  costs: { items: Record<DriverCostItem, number>; packsCents: number; totalCents: number };
  netCents: number;
  /** Net sur revenus totaux, en %, à un dixième près ; null sans revenu. */
  marginPercent: number | null;
  /** Part de Neomoov dans les revenus totaux, en %, à un dixième près ; null sans revenu. */
  neomoovSharePercent: number | null;
}

const positive = (value: number | undefined): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0);

/** Rentabilité nette d'une période : revenus Neomoov et externes, coûts saisis et packs, net, marge et part de Neomoov. */
export function netProfitability(lines: readonly ProfitabilityLine[], costs: ProfitabilityCosts, externalRevenueCents: number): NetProfitability {
  const neomoovCents = lines.reduce((sum, l) => sum + positive(l.fareCents) + positive(l.tipCents), 0);
  const externalCents = positive(externalRevenueCents);
  const totalRevenue = neomoovCents + externalCents;
  const items = Object.fromEntries(DRIVER_COST_ITEMS.map((k) => [k, positive(costs[k])])) as Record<DriverCostItem, number>;
  const packsCents = positive(costs.packsCents);
  const totalCosts = DRIVER_COST_ITEMS.reduce((sum, k) => sum + items[k], 0) + packsCents;
  const netCents = totalRevenue - totalCosts;
  const percent = (part: number): number | null => (totalRevenue > 0 ? Math.round((part * 1000) / totalRevenue) / 10 : null);
  return {
    rides: lines.filter((l) => !l.fee).length,
    revenue: { neomoovCents, externalCents, totalCents: totalRevenue },
    costs: { items, packsCents, totalCents: totalCosts },
    netCents,
    marginPercent: percent(netCents),
    neomoovSharePercent: percent(neomoovCents),
  };
}
