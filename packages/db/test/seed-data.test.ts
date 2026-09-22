import { computeQuote } from '@neomoov/domain';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPricingRules } from '../src/pricing-rules.js';
import { FLAT_RATES, PACKS, PRICING_RULES, SETTINGS, SURCHARGES, VEHICLE_CATEGORIES, ZONES } from '../src/seed/data.js';

const rules = buildPricingRules({
  timeZone: 'America/Toronto',
  settings: Object.fromEntries(SETTINGS.map((s) => [s.key, s.value])),
  pricingRules: PRICING_RULES.map((p) => ({ ...p })),
  surcharges: SURCHARGES.map((s) => ({ ...s })),
  flatRates: FLAT_RATES.map((f) => ({ code: f.code, category: f.category, originZoneCode: f.origin, destinationZoneCode: f.destination, totalCents: f.totalCents, bidirectional: true })),
});

describe('données de départ et moteur de tarification', () => {
  it('redonne l\'exemple de contrôle du cahier des charges : 8 km et 18 min en Neo Premium = 24,55 $ et 31,56 $', () => {
    const q = computeQuote({ category: 'neo_premium', distanceMeters: 8000, durationSeconds: 1080, pickupAt: new Date('2026-09-22T14:00:00-04:00') }, rules);
    expect(q.fareCents).toBe(2455);
    expect(q.serviceFeeCents).toBe(200);
    expect(q.regulatoryFeeCents).toBe(90);
    expect(q.totalCents).toBe(3156);
    expect(q.maxConsentedCents).toBe(5156);
  });

  it('applique les forfaits aéroport dans les deux sens', () => {
    const aller = computeQuote({ category: 'neo_prestige', distanceMeters: 20_000, durationSeconds: 1500, pickupAt: new Date('2026-09-22T14:00:00-04:00'), originZone: 'centre-ville', destinationZone: 'yul', airport: true }, rules);
    const retour = computeQuote({ category: 'neo_xl', distanceMeters: 20_000, durationSeconds: 1500, pickupAt: new Date('2026-09-22T14:00:00-04:00'), originZone: 'yul', destinationZone: 'centre-ville', airport: true }, rules);
    expect(aller.flatRate).toBe(true);
    expect(aller.totalCents).toBe(6900);
    expect(retour.totalCents).toBe(7500);
  });

  it('refuse Flex en heure de pointe et l\'accepte hors pointe', () => {
    const peak = new Date('2026-09-22T08:00:00-04:00');
    const offPeak = new Date('2026-09-22T14:00:00-04:00');
    expect(() => computeQuote({ category: 'neo_premium', distanceMeters: 8000, durationSeconds: 1080, pickupAt: peak, options: { flex: true } }, rules)).toThrow();
    const q = computeQuote({ category: 'neo_premium', distanceMeters: 8000, durationSeconds: 1080, pickupAt: offPeak, options: { flex: true } }, rules);
    expect(q.fareCents).toBeLessThan(2455);
  });

  it('ajoute le supplément de nuit entre 23 h et 5 h', () => {
    const night = computeQuote({ category: 'neo_premium', distanceMeters: 8000, durationSeconds: 1080, pickupAt: new Date('2026-09-22T23:30:00-04:00') }, rules);
    expect(night.fareCents).toBe(2455 + 200);
  });
});

describe('catalogue', () => {
  it('a quatre catégories aux rangs uniques, Neo Limo inactive', () => {
    expect(new Set(VEHICLE_CATEGORIES.map((c) => c.rank)).size).toBe(4);
    expect(VEHICLE_CATEGORIES.find((c) => c.code === 'neo_limo')?.active).toBe(false);
  });

  it('a les cinq packs de la section 5.7', () => {
    expect(PACKS.map((p) => [p.code, p.ridesIncluded, p.priceCents, p.validityDays])).toEqual([
      ['discovery', 10, 2900, 28], ['essential', 25, 5900, 28], ['pro', 50, 9900, 28], ['elite', 100, 16900, 28], ['unlimited', null, 19900, 7],
    ]);
  });

  it('a des zones fermées (premier point égal au dernier) et des codes uniques', () => {
    for (const z of ZONES) { const ring = z.geometry.coordinates[0]!; expect(ring[0]).toEqual(ring[ring.length - 1]); expect(ring.length).toBeGreaterThanOrEqual(4); }
    expect(new Set(ZONES.map((z) => z.code)).size).toBe(ZONES.length);
    for (const f of FLAT_RATES) { expect(ZONES.some((z) => z.code === f.origin)).toBe(true); expect(ZONES.some((z) => z.code === f.destination)).toBe(true); }
  });
});

describe('migrations', () => {
  const dir = join(import.meta.dirname, '..', 'drizzle');
  const ups = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const downs = readdirSync(join(dir, 'down')).filter((f) => f.endsWith('.sql')).sort();

  it('chaque migration a son inverse', () => {
    expect(downs).toEqual(ups);
  });

  it('le journal liste les migrations dans l\'ordre', () => {
    const journal = JSON.parse(readFileSync(join(dir, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] };
    expect(journal.entries.map((e) => `${e.tag}.sql`)).toEqual(ups);
  });

  it('la migration initiale active PostGIS avant les tables et ne met aucun type geography entre guillemets', () => {
    const sql = readFileSync(join(dir, ups[0]!), 'utf8');
    expect(sql.indexOf('CREATE EXTENSION IF NOT EXISTS postgis')).toBeLessThan(sql.indexOf('CREATE TABLE'));
    expect(sql).not.toMatch(/"geography\(/);
    expect(sql).toMatch(/geography\(point,4326\)/);
    expect(sql).toMatch(/USING gist/);
  });

  it('la migration 0001 protège les tables en ajout seul et partitionne driver_locations', () => {
    const sql = readFileSync(join(dir, ups[1]!), 'utf8');
    expect(sql).toContain('audit_log_append_only');
    expect(sql).toContain('ride_events_append_only');
    expect(sql).toContain('PARTITION BY RANGE (recorded_at)');
    expect(sql).toContain('next_invoice_supplier_sequence');
    expect(sql).toContain('ST_DWithin');
  });
});
