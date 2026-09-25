/**
 * Règles de tarification lues en base (settings, pricing_rules, surcharges, flat_rates et zones) et assemblées pour le
 * moteur pur du domaine (`buildPricingRules`). Cache de 60 secondes par processus ; une version (empreinte des sources)
 * est enregistrée avec chaque devis.
 */
import { buildPricingRules, schema, type PricingSources } from '@neomoov/db';
import type { PricingRules } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, lte, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { sha256Hex } from '../../common/crypto.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';

const CACHE_TTL_MS = 60_000;
export const DEFAULT_CITY = 'montreal';

export interface LoadedPricingRules {
  cityCode: string;
  timeZone: string;
  rules: PricingRules;
  /** Empreinte des sources : change dès qu'un tarif, un supplément, un forfait ou un réglage change. */
  version: string;
}

@Injectable()
export class PricingRulesService {
  private cache = new Map<string, { loadedAt: number; value: LoadedPricingRules }>();

  constructor(
    @Inject(DB) private readonly database: Database,
    private readonly settings: SettingsService,
  ) {}

  async rulesFor(cityCode = DEFAULT_CITY): Promise<LoadedPricingRules> {
    const cached = this.cache.get(cityCode);
    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached.value;
    const value = await this.load(cityCode);
    this.cache.set(cityCode, { loadedAt: Date.now(), value });
    return value;
  }

  invalidate() {
    this.cache.clear();
    this.settings.invalidate();
  }

  /**
   * Seules les lignes déjà en vigueur comptent (`valid_from` passé, `valid_to` absent ou futur) ; quand plusieurs lignes
   * se chevauchent, la plus récente gagne. Une grille datée dans le futur (hausse planifiée) attend sa date.
   */
  private async load(cityCode: string): Promise<LoadedPricingRules> {
    const db = this.database.db;
    const origin = alias(schema.zones, 'origin_zone');
    const destination = alias(schema.zones, 'destination_zone');
    const [city] = await db.select({ timeZone: schema.cities.timeZone }).from(schema.cities).where(eq(schema.cities.code, cityCode)).limit(1);
    if (!city) throw new Error(`Ville inconnue : ${cityCode}`);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: city.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const [settings, pricingRuleRows, surchargeRows, flatRateRows] = await Promise.all([
      this.settings.all(),
      db
        .select({ category: schema.pricingRules.category, baseCents: schema.pricingRules.baseCents, perKmCents: schema.pricingRules.perKmCents, perMinuteCents: schema.pricingRules.perMinuteCents, minimumCents: schema.pricingRules.minimumCents, validFrom: schema.pricingRules.validFrom })
        .from(schema.pricingRules)
        .where(and(eq(schema.pricingRules.cityCode, cityCode), lte(schema.pricingRules.validFrom, today), or(isNull(schema.pricingRules.validTo), gt(schema.pricingRules.validTo, today))))
        .orderBy(desc(schema.pricingRules.validFrom)),
      db
        .select({ code: schema.surcharges.code, amountCents: schema.surcharges.amountCents, conditions: schema.surcharges.conditions, validFrom: schema.surcharges.validFrom })
        .from(schema.surcharges)
        .where(and(eq(schema.surcharges.cityCode, cityCode), eq(schema.surcharges.active, true), lte(schema.surcharges.validFrom, today), or(isNull(schema.surcharges.validTo), gt(schema.surcharges.validTo, today))))
        .orderBy(desc(schema.surcharges.validFrom)),
      db
        .select({ code: schema.flatRates.code, category: schema.flatRates.category, originZoneCode: origin.code, destinationZoneCode: destination.code, totalCents: schema.flatRates.totalCents, bidirectional: schema.flatRates.bidirectional, validFrom: schema.flatRates.validFrom })
        .from(schema.flatRates)
        .innerJoin(origin, eq(origin.id, schema.flatRates.originZoneId))
        .innerJoin(destination, eq(destination.id, schema.flatRates.destinationZoneId))
        .where(and(lte(schema.flatRates.validFrom, today), or(isNull(schema.flatRates.validTo), gt(schema.flatRates.validTo, today))))
        .orderBy(desc(schema.flatRates.validFrom)),
    ]);
    const latestBy = <T>(rows: T[], key: (r: T) => string): T[] => {
      const seen = new Map<string, T>();
      for (const row of rows) if (!seen.has(key(row))) seen.set(key(row), row);
      return [...seen.values()];
    };
    const pricingRules = latestBy(pricingRuleRows, (r) => r.category).map(({ validFrom: _v, ...r }) => r);
    const surcharges = latestBy(surchargeRows, (r) => r.code).map(({ validFrom: _v, ...r }) => r);
    const flatRates = latestBy(flatRateRows, (r) => `${r.category}|${r.originZoneCode}|${r.destinationZoneCode}`).map(({ validFrom: _v, ...r }) => r);
    const sources: PricingSources = { timeZone: city.timeZone, settings, pricingRules, surcharges, flatRates };
    const rules = buildPricingRules(sources);
    const pricingSettings = Object.fromEntries(Object.entries(settings).filter(([k]) => k.startsWith('pricing.') || k.startsWith('rides.')));
    const version = sha256Hex(JSON.stringify({ cityCode, timeZone: city.timeZone, pricingSettings, pricingRules, surcharges, flatRates })).slice(0, 16);
    return { cityCode, timeZone: city.timeZone, rules, version };
  }
}
