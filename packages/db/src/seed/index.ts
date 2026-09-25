/**
 * pnpm db:seed : données de départ idempotentes. Chaque enregistrement est vérifié par son code ou son téléphone ;
 * rien n'est écrasé, les données réelles ne sont jamais touchées. Peut être relancé autant de fois que nécessaire.
 */

import '../env.js';
import { eq, sql } from 'drizzle-orm';
import { createDatabase, databaseUrlFromEnv, type Database } from '../index.js';
import * as s from '../schema/index.js';
import { AGENTS, CITY, DEMO_USERS, FEATURE_FLAGS, FLAT_RATES, PACKS, PRICING_RULES, PROMOTIONS, SETTINGS, SURCHARGES, VEHICLE_CATEGORIES, ZONES } from './data.js';

const TODAY = new Date().toISOString().slice(0, 10);

export async function seed(db: Database): Promise<Record<string, number>> {
  const created: Record<string, number> = {};
  const count = (k: string) => { created[k] = (created[k] ?? 0) + 1; };

  await db.insert(s.cities).values({ code: CITY.code, name: CITY.name, timeZone: CITY.timeZone }).onConflictDoNothing();
  const org = await db.insert(s.organizations).values({ code: 'neomoov', name: 'Neomoov', type: 'platform' }).onConflictDoNothing().returning({ id: s.organizations.id });
  if (org.length) count('organizations');

  for (const z of ZONES) {
    const r = await db.insert(s.zones).values({ cityCode: CITY.code, code: z.code, name: z.name, type: z.type, geometry: z.geometry }).onConflictDoNothing().returning({ id: s.zones.id });
    if (r.length) count('zones');
  }
  const zoneIds = new Map((await db.select({ id: s.zones.id, code: s.zones.code }).from(s.zones)).map((z) => [z.code, z.id]));

  for (const c of VEHICLE_CATEGORIES) {
    const r = await db.insert(s.vehicleCategories).values({ code: c.code, name: c.name, rank: c.rank, seats: c.seats, minYear: c.minYear, allowedModels: [...c.allowedModels], description: c.description, active: c.active }).onConflictDoNothing().returning({ code: s.vehicleCategories.code });
    if (r.length) count('vehicle_categories');
  }

  for (const p of PRICING_RULES) {
    const existing = await db.select({ id: s.pricingRules.id }).from(s.pricingRules).where(sql`${s.pricingRules.cityCode} = ${CITY.code} AND ${s.pricingRules.category} = ${p.category} AND ${s.pricingRules.validTo} IS NULL`).limit(1);
    if (!existing.length) { await db.insert(s.pricingRules).values({ cityCode: CITY.code, ...p, validFrom: TODAY }); count('pricing_rules'); }
  }

  for (const su of SURCHARGES) {
    const existing = await db.select({ id: s.surcharges.id }).from(s.surcharges).where(sql`${s.surcharges.cityCode} = ${CITY.code} AND ${s.surcharges.code} = ${su.code}`).limit(1);
    if (!existing.length) { await db.insert(s.surcharges).values({ cityCode: CITY.code, code: su.code, amountCents: su.amountCents, perUnit: su.perUnit, conditions: su.conditions, validFrom: TODAY }); count('surcharges'); }
  }

  for (const f of FLAT_RATES) {
    const origin = zoneIds.get(f.origin), destination = zoneIds.get(f.destination);
    if (!origin || !destination) throw new Error(`Zone manquante pour le forfait ${f.code}`);
    const r = await db.insert(s.flatRates).values({ code: f.code, category: f.category, originZoneId: origin, destinationZoneId: destination, totalCents: f.totalCents, bidirectional: true, validFrom: TODAY }).onConflictDoNothing().returning({ id: s.flatRates.id });
    if (r.length) count('flat_rates');
  }

  for (const p of PACKS) {
    const r = await db.insert(s.packs).values({ code: p.code, name: p.name, ridesIncluded: p.ridesIncluded, priceCents: p.priceCents, validityDays: p.validityDays, rolloverAllowed: p.rolloverAllowed, priorities: p.priorities, sortOrder: p.sortOrder }).onConflictDoNothing().returning({ code: s.packs.code });
    if (r.length) count('packs');
  }

  for (const p of PROMOTIONS) {
    const r = await db.insert(s.promotions).values({ code: p.code, name: p.name, type: p.type, value: p.value, maxDiscountCents: p.maxDiscountCents, conditions: p.conditions, waivesFees: p.waivesFees, globalLimit: p.globalLimit, perClientLimit: p.perClientLimit, budgetCents: p.budgetCents, validFrom: new Date() }).onConflictDoNothing().returning({ id: s.promotions.id });
    if (r.length) count('promotions');
  }

  for (const st of SETTINGS) {
    const r = await db.insert(s.settings).values({ key: st.key, scope: 'global', value: st.value as object, description: st.description }).onConflictDoNothing().returning({ key: s.settings.key });
    if (r.length) count('settings');
  }

  for (const f of FEATURE_FLAGS) {
    const r = await db.insert(s.featureFlags).values({ code: f.code, active: f.active, targeting: { description: f.description } }).onConflictDoNothing().returning({ code: s.featureFlags.code });
    if (r.length) count('feature_flags');
  }

  for (const a of AGENTS) {
    const r = await db.insert(s.agents).values({ code: a.code, name: a.name, mode: a.mode, effort: a.effort, tools: [...a.tools], thresholds: a.thresholds }).onConflictDoNothing().returning({ code: s.agents.code });
    if (r.length) count('agents');
  }

  // Utilisateurs de démonstration.
  const upsertUser = async (u: { phone: string; email?: string; firstName: string; lastName: string; role: 'admin' | 'operator' | 'driver' | 'client' }) => {
    const existing = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.phone, u.phone)).limit(1);
    if (existing[0]) return { id: existing[0].id, created: false };
    const [row] = await db.insert(s.users).values({ phone: u.phone, email: u.email ?? null, firstName: u.firstName, lastName: u.lastName, primaryRole: u.role, termsAcceptedAt: new Date(), privacyPolicyVersion: '1.0' }).returning({ id: s.users.id });
    await db.insert(s.userRoles).values({ userId: row!.id, role: u.role }).onConflictDoNothing();
    count('users');
    return { id: row!.id, created: true };
  };

  await upsertUser({ ...DEMO_USERS.admin, role: 'admin' });
  await upsertUser({ ...DEMO_USERS.operator, role: 'operator' });

  for (const d of DEMO_USERS.drivers) {
    const user = await upsertUser({ phone: d.phone, email: d.email, firstName: d.firstName, lastName: d.lastName, role: 'driver' });
    if (!user.created) continue;
    const [publicNumber] = await db.execute<{ n: string }>(sql`SELECT next_driver_public_number() AS n`);
    const [driver] = await db.insert(s.drivers).values({ userId: user.id, publicNumber: publicNumber!.n, status: 'active', qualification: 'saaq_authorized', acceptsCash: true, acceptsInterac: true, activatedAt: new Date() }).returning({ id: s.drivers.id });
    const [vehicle] = await db.insert(s.vehicles).values({ driverId: driver!.id, category: d.vehicle.category, make: d.vehicle.make, model: d.vehicle.model, year: d.vehicle.year, colour: d.vehicle.colour, plate: d.vehicle.plate, seats: d.vehicle.seats, status: 'active', lastInspectionOn: TODAY, nextInspectionDueOn: new Date(Date.now() + 180 * 86_400_000).toISOString().slice(0, 10) }).returning({ id: s.vehicles.id });
    await db.update(s.drivers).set({ currentVehicleId: vehicle!.id }).where(eq(s.drivers.id, driver!.id));
    const inOneYear = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
    for (const type of ['licence', 'training', 'background_check', 'insurance', 'registration', 'mechanical_check', 'profile_photo'] as const) {
      await db.insert(s.driverDocuments).values({ driverId: driver!.id, type, fileKey: `demo/${d.phone}/${type}.pdf`, status: 'approved', issuedOn: TODAY, expiresOn: inOneYear, verifiedAt: new Date() });
    }
    await db.insert(s.driverBalances).values({ driverId: driver!.id }).onConflictDoNothing();
    count('drivers');
  }

  for (const c of DEMO_USERS.clients) {
    const user = await upsertUser({ phone: c.phone, firstName: c.firstName, lastName: c.lastName, role: 'client' });
    if (!user.created) continue;
    await db.insert(s.clients).values({ userId: user.id });
    count('clients');
  }

  return created;
}

if (process.argv[1] && /seed[\\/]index\.(ts|js)$/.test(process.argv[1])) {
  const { db, close } = createDatabase({ url: databaseUrlFromEnv(), max: 1 });
  try {
    const created = await seed(db);
    console.log(Object.keys(created).length ? `Données créées : ${JSON.stringify(created)}` : 'Rien à créer : les données de départ existent déjà.');
  } finally {
    await close();
  }
}
