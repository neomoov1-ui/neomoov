import { computePlatformInvoice, dunningSettingsFrom, planModules } from '@neomoov/domain';
import { describe, expect, it } from 'vitest';
import { PLANS, SETTINGS } from '../src/seed/data.js';

const setting = (key: string) => SETTINGS.find((s) => s.key === key)?.value;

describe('formules de la plateforme (étape 25)', () => {
  it('grille proposée : Solo, Pro, Entreprise ; licence annuelle = 10 mois payés pour 12', () => {
    expect(PLANS.map((p) => [p.code, p.setupFeeCents, p.monthlyPriceCents, p.perActiveVehicleCents, p.includedVehicles])).toEqual([
      ['solo', 9_900, 4_900, 0, 1], ['pro', 150_000, 19_900, 1_500, 10], ['entreprise', 350_000, 19_900, 1_200, 0],
    ]);
    for (const p of PLANS) expect(p.annualPriceCents, p.code).toBe(p.monthlyPriceCents * 10);
  });

  it('modules connus (aucun module de la plateforme) et organisation toujours incluse (abonnement, membres)', () => {
    for (const p of PLANS) {
      expect(planModules({ ...p, modules: [...p.modules] }), p.code).toEqual([...p.modules].sort());
      expect(p.modules, p.code).toContain('organization');
    }
  });

  it('première facture Pro mensuelle : 1 500 $ + 199 $, taxes en sus', () => {
    const pro = PLANS.find((p) => p.code === 'pro')!;
    const invoice = computePlatformInvoice({ ...pro, modules: [...pro.modules], currency: 'CAD' }, { billingPeriod: 'monthly' }, 0, { start: new Date('2026-10-01T04:00:00Z'), end: new Date('2026-11-01T04:00:00Z') }, true);
    expect(invoice.subtotalCents).toBe(169_900);
    expect(invoice.totalCents).toBe(195_343);
  });

  it('réglages des relances valides : rappels à 3, 7 et 14 jours, lecture seule à 30, suspension à 45', () => {
    expect(dunningSettingsFrom({ reminderDays: setting('billing.reminder_days'), readOnlyDays: setting('billing.read_only_days'), suspendedDays: setting('billing.suspended_days') }))
      .toEqual({ reminderDays: [3, 7, 14], readOnlyDays: 30, suspendedDays: 45 });
    expect(setting('billing.payment_terms_days')).toBe(0);
    expect(setting('billing.run_hour')).toBe(5);
  });
});
