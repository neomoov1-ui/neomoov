import { describe, expect, it } from 'vitest';
import {
  computePlatformInvoice, DEFAULT_DUNNING_SETTINGS, dunningStep, formatPlatformInvoiceNumber, monthlyRecurringRevenueCents, organizationAccess, organizationStatusFor,
  organizationWriteAllowed, periodEnd, periodMonths, planModules, PlatformBillingError, QUEBEC_TAX_RATES, type PlatformPlan,
} from '../src/platform-billing/billing.js';

/** Étape 25 : facturation de la plateforme (formules, taxes, relances, accès). Prix de la grille proposée (étude 03, section 5.2). */
const pro: PlatformPlan = { code: 'pro', name: 'Pro', modules: ['fleet', 'admin', 'fleet'], setupFeeCents: 150_000, monthlyPriceCents: 19_900, annualPriceCents: 199_000, perActiveVehicleCents: 1_500, includedVehicles: 10, currency: 'CAD' };
const solo: PlatformPlan = { ...pro, code: 'solo', name: 'Solo', modules: ['booking'], setupFeeCents: 9_900, monthlyPriceCents: 4_900, annualPriceCents: 49_000, perActiveVehicleCents: 0, includedVehicles: 1 };
const start = new Date('2026-10-01T00:00:00Z');
const month = { start, end: new Date('2026-11-01T00:00:00Z') };
const year = { start, end: new Date('2027-10-01T00:00:00Z') };

describe('computePlatformInvoice', () => {
  it('première facture mensuelle : frais d\'installation, abonnement, TPS et TVQ sur le sous-total', () => {
    const invoice = computePlatformInvoice(pro, { billingPeriod: 'monthly' }, 3, month, true);
    expect(invoice.lines.map((l) => l.code)).toEqual(['setup_fee', 'subscription']);
    expect(invoice.subtotalCents).toBe(169_900);
    // 1 699,00 $ : TPS 84,95 $, TVQ 169,48 $ (169 475,25 cents arrondis), total 1 953,43 $.
    expect(invoice.gstCents).toBe(8_495);
    expect(invoice.qstCents).toBe(16_948);
    expect(invoice.totalCents).toBe(195_343);
    expect(invoice.periodStart).toBe(start);
  });

  it('facture de fin de période : véhicules au-delà des inclus, par mois de la période ; aucune ligne sans dépassement', () => {
    const monthly = computePlatformInvoice(pro, { billingPeriod: 'monthly' }, 13, month, false);
    expect(monthly.lines.map((l) => l.code)).toEqual(['subscription', 'active_vehicles']);
    expect(monthly.lines[1]).toMatchObject({ quantity: 3, unitCents: 1_500, amountCents: 4_500 });
    expect(monthly.lines[1]!.label).toContain('3 × 1 mois');
    expect(monthly.subtotalCents).toBe(24_400);
    const annual = computePlatformInvoice(pro, { billingPeriod: 'annual' }, 12, year, false);
    expect(annual.lines[0]).toMatchObject({ code: 'subscription', amountCents: 199_000 });
    expect(annual.lines[0]!.label).toContain('Licence annuelle');
    expect(annual.lines[1]).toMatchObject({ quantity: 24, amountCents: 36_000 });
    const within = computePlatformInvoice(pro, { billingPeriod: 'monthly' }, 10, month, false);
    expect(within.lines).toHaveLength(1);
    // Formule sans prix par véhicule : jamais de ligne de véhicules ; sans frais d'installation, pas de ligne non plus.
    expect(computePlatformInvoice(solo, { billingPeriod: 'monthly' }, 4, month, true).lines.map((l) => l.code)).toEqual(['setup_fee', 'subscription']);
    expect(computePlatformInvoice({ ...solo, setupFeeCents: 0 }, { billingPeriod: 'monthly' }, 4, month, true).lines.map((l) => l.code)).toEqual(['subscription']);
    // Taux de taxes fournis par les réglages.
    const custom = computePlatformInvoice(solo, { billingPeriod: 'monthly' }, 1, month, false, { gstPpm: 0, qstPpm: 0 });
    expect(custom.totalCents).toBe(4_900);
    expect(QUEBEC_TAX_RATES).toEqual({ gstPpm: 50_000, qstPpm: 99_750 });
  });

  it('refuse une période vide, un nombre de véhicules invalide ou une formule mal renseignée', () => {
    expect(() => computePlatformInvoice(pro, { billingPeriod: 'monthly' }, 1, { start, end: start }, false)).toThrow(PlatformBillingError);
    expect(() => computePlatformInvoice(pro, { billingPeriod: 'monthly' }, -1, month, false)).toThrow(/véhicules/);
    expect(() => computePlatformInvoice(pro, { billingPeriod: 'monthly' }, 1.5, month, false)).toThrow(/véhicules/);
    try {
      computePlatformInvoice({ ...pro, monthlyPriceCents: -1 }, { billingPeriod: 'monthly' }, 1, month, false);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(PlatformBillingError);
      expect((error as PlatformBillingError).code).toBe('INVALID_PLAN');
      expect((error as PlatformBillingError).name).toBe('PlatformBillingError');
    }
  });
});

describe('périodes', () => {
  it('un mois ou un an plus tard, dernier jour du mois quand le jour n\'existe pas', () => {
    expect(periodEnd(new Date('2026-10-01T00:00:00Z'), 'monthly').toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(periodEnd(new Date('2026-01-31T12:00:00Z'), 'monthly').toISOString()).toBe('2026-02-28T12:00:00.000Z');
    expect(periodEnd(new Date('2026-12-15T00:00:00Z'), 'monthly').toISOString()).toBe('2027-01-15T00:00:00.000Z');
    expect(periodEnd(new Date('2026-10-01T00:00:00Z'), 'annual').toISOString()).toBe('2027-10-01T00:00:00.000Z');
    expect(periodEnd(new Date('2028-02-29T00:00:00Z'), 'annual').toISOString()).toBe('2029-02-28T00:00:00.000Z');
    expect(periodMonths('monthly')).toBe(1);
    expect(periodMonths('annual')).toBe(12);
  });
});

describe('dunningStep', () => {
  const dueAt = new Date('2026-11-01T00:00:00Z');
  const at = (days: number) => new Date(dueAt.getTime() + days * 86_400_000);
  const open = (remindersSent: number) => ({ status: 'open' as const, dueAt, remindersSent });

  it('rappels à +3, +7 et +14 jours, chacun une fois ; lecture seule à +30 ; suspension à +45', () => {
    expect(dunningStep(open(0), at(-1))).toEqual({ action: 'none', daysOverdue: -1, pastDue: false, reminder: null });
    expect(dunningStep(open(0), at(1))).toEqual({ action: 'none', daysOverdue: 1, pastDue: true, reminder: null });
    expect(dunningStep(open(0), at(3))).toEqual({ action: 'remind', daysOverdue: 3, pastDue: true, reminder: 1 });
    expect(dunningStep(open(1), at(3)).action).toBe('none');
    expect(dunningStep(open(1), at(7))).toMatchObject({ action: 'remind', reminder: 2 });
    expect(dunningStep(open(2), at(14))).toMatchObject({ action: 'remind', reminder: 3 });
    expect(dunningStep(open(3), at(20)).action).toBe('none');
    // Un rappel manqué est rattrapé dès la passe suivante (jamais deux d'un coup : la passe suivante enverra le prochain).
    expect(dunningStep(open(0), at(9))).toMatchObject({ action: 'remind', reminder: 1 });
    expect(dunningStep({ ...open(3), status: 'past_due' }, at(30))).toMatchObject({ action: 'read_only', daysOverdue: 30 });
    expect(dunningStep(open(0), at(44)).action).toBe('read_only');
    expect(dunningStep(open(3), at(45)).action).toBe('suspend');
    expect(dunningStep(open(0), at(400)).action).toBe('suspend');
    for (const status of ['paid', 'void', 'draft'] as const) expect(dunningStep({ status, dueAt, remindersSent: 0 }, at(60))).toEqual({ action: 'none', daysOverdue: 0, pastDue: false, reminder: null });
    expect(DEFAULT_DUNNING_SETTINGS).toEqual({ reminderDays: [3, 7, 14], readOnlyDays: 30, suspendedDays: 45 });
    // Réglages : délais plus courts.
    expect(dunningStep(open(0), at(2), { reminderDays: [1], readOnlyDays: 5, suspendedDays: 10 })).toMatchObject({ action: 'remind', reminder: 1 });
    expect(dunningStep(open(1), at(5), { reminderDays: [1], readOnlyDays: 5, suspendedDays: 10 }).action).toBe('read_only');
  });
});

describe('accès et formules', () => {
  it('une organisation en lecture seule, suspendue ou fermée ne peut plus écrire', () => {
    expect(organizationWriteAllowed('trial')).toBe(true);
    expect(organizationWriteAllowed('active')).toBe(true);
    expect(organizationWriteAllowed('read_only')).toBe(false);
    expect(organizationWriteAllowed('suspended')).toBe(false);
    expect(organizationWriteAllowed('closed')).toBe(false);
    expect(organizationAccess('read_only')).toEqual({ read: true, write: false });
    expect(organizationAccess('active')).toEqual({ read: true, write: true });
    expect(organizationAccess('suspended')).toEqual({ read: false, write: false });
    expect(organizationAccess('closed')).toEqual({ read: false, write: false });
  });

  it('modules d\'une formule, statut d\'organisation, revenu récurrent, numéro de facture', () => {
    expect(planModules(pro)).toEqual(['admin', 'fleet']);
    expect(organizationStatusFor('trialing')).toBe('trial');
    expect(organizationStatusFor('active')).toBe('active');
    expect(organizationStatusFor('past_due')).toBe('active');
    expect(organizationStatusFor('read_only')).toBe('read_only');
    expect(organizationStatusFor('suspended')).toBe('suspended');
    expect(organizationStatusFor('cancelled')).toBe('closed');
    expect(monthlyRecurringRevenueCents(pro, { billingPeriod: 'monthly', status: 'active', activeVehicles: 12 })).toBe(22_900);
    expect(monthlyRecurringRevenueCents(pro, { billingPeriod: 'annual', status: 'past_due', activeVehicles: 2 })).toBe(16_583);
    expect(monthlyRecurringRevenueCents(pro, { billingPeriod: 'monthly', status: 'suspended', activeVehicles: 12 })).toBe(0);
    expect(monthlyRecurringRevenueCents(pro, { billingPeriod: 'monthly', status: 'cancelled', activeVehicles: 12 })).toBe(0);
    expect(formatPlatformInvoiceNumber(2026, 7)).toBe('PF-2026-000007');
  });
});
