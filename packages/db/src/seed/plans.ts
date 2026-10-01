/**
 * Étape 25 : formules de la plateforme (Solo, Pro, Entreprise) et leurs prix proposés. Une formule déjà en base n'est
 * jamais réécrite (prix ajustés dans My Hub ou par une migration de données), sauf une formule créée avant l'étape 25
 * sans aucun prix : elle reçoit ceux des données de départ.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../index.js';
import * as s from '../schema/index.js';
import { PLANS } from './data.js';

export async function seedPlans(db: Database): Promise<number> {
  let created = 0;
  for (const p of PLANS) {
    const prices = {
      setupFeeCents: p.setupFeeCents, monthlyPriceCents: p.monthlyPriceCents, annualPriceCents: p.annualPriceCents,
      perActiveVehicleCents: p.perActiveVehicleCents, includedVehicles: p.includedVehicles, currency: 'CAD',
    };
    const inserted = await db.insert(s.plans).values({ code: p.code, name: p.name, modules: [...p.modules], limits: p.limits, ...prices }).onConflictDoNothing().returning({ code: s.plans.code });
    if (inserted.length) {
      created += 1;
      continue;
    }
    await db.update(s.plans).set(prices).where(and(eq(s.plans.code, p.code), sql`${s.plans.monthlyPriceCents} = 0 AND ${s.plans.annualPriceCents} = 0 AND ${s.plans.setupFeeCents} = 0`));
  }
  return created;
}
