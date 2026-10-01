import { describe, expect, it } from 'vitest';
import {
  billingOverviewQuerySchema, billingOverviewSchema, billingPeriodEnd, billingPeriodMonths, billingRunReportSchema, computePlatformInvoice, DEFAULT_DUNNING_SETTINGS,
  dunningSchedule, dunningSettingsFrom, dunningStep, formatPlatformInvoiceNumber, monthlyRecurringRevenueCents, nextSubscriptionStatus, organizationAccess,
  organizationBillingSchema, organizationStatusFor, organizationWriteAllowed, PERMISSIONS, planModules, PlatformBillingError, platformInvoiceMarkPaidSchema,
  QUEBEC_TAX_RATES, SUBSCRIPTION_STATUSES, subscriptionCancelSchema, subscriptionUpsertSchema, systemRole, targetSubscriptionStatus, type DunningInvoice, type PlatformPlan,
} from '../src/index.js';

/**
 * Étape 25 : facturation de la plateforme (formules, taxes, relances, accès). Montants de la grille proposée au
 * fondateur (étude 03, section 5.2) : Solo 99 $ et 49 $ par mois ; Pro 1 500 $ et 199 $ par mois, 10 véhicules inclus
 * puis 15 $ ; Entreprise 3 500 $ et 199 $ plus 12 $ par véhicule ; licence annuelle = 10 mois payés pour 12.
 */
const pro: PlatformPlan = { code: 'pro', name: 'Pro', modules: ['vehicles', 'organization', 'vehicles', 'platform', 'self', 'inconnu'], setupFeeCents: 150_000, monthlyPriceCents: 19_900, annualPriceCents: 199_000, perActiveVehicleCents: 1_500, includedVehicles: 10, currency: 'CAD' };
const solo: PlatformPlan = { ...pro, code: 'solo', name: 'Solo', modules: ['rides'], setupFeeCents: 9_900, monthlyPriceCents: 4_900, annualPriceCents: 49_000, perActiveVehicleCents: 0, includedVehicles: 1 };
const entreprise: PlatformPlan = { ...pro, code: 'entreprise', name: 'Entreprise', setupFeeCents: 350_000, perActiveVehicleCents: 1_200, includedVehicles: 0 };
const start = new Date('2026-10-01T04:00:00Z');
const month = { start, end: new Date('2026-11-01T04:00:00Z') };
const year = { start, end: new Date('2027-10-01T04:00:00Z') };

describe('computePlatformInvoice', () => {
  it('première facture mensuelle : frais d\'installation, abonnement, TPS et TVQ sur le sous-total', () => {
    const invoice = computePlatformInvoice(pro, { billingPeriod: 'monthly' }, 3, month, true);
    expect(invoice.lines.map((l) => l.code)).toEqual(['setup_fee', 'subscription']);
    expect(invoice.lines[0]).toMatchObject({ label: 'Frais d\'installation, formule Pro', quantity: 1, unitCents: 150_000, amountCents: 150_000 });
    expect(invoice.subtotalCents).toBe(169_900);
    // 1 699,00 $ : TPS 84,95 $, TVQ 169,48 $ (16 947,525 cents arrondis au cent supérieur), total 1 953,43 $.
    expect(invoice.gstCents).toBe(8_495);
    expect(invoice.qstCents).toBe(16_948);
    expect(invoice.totalCents).toBe(195_343);
    expect(invoice.periodStart).toBe(start);
    expect(invoice.periodEnd).toBe(month.end);
  });

  it('facture de fin de période : véhicules au-delà des inclus, par mois de la période ; aucune ligne sans dépassement', () => {
    const monthly = computePlatformInvoice(pro, { billingPeriod: 'monthly' }, 13, month, false);
    expect(monthly.lines.map((l) => l.code)).toEqual(['subscription', 'active_vehicles']);
    expect(monthly.lines[1]).toMatchObject({ quantity: 3, unitCents: 1_500, amountCents: 4_500 });
    expect(monthly.lines[1]!.label).toBe('Véhicules actifs au-delà des 10 inclus (3 × 1 mois)');
    expect(monthly.subtotalCents).toBe(24_400);
    const annual = computePlatformInvoice(pro, { billingPeriod: 'annual' }, 12, year, false);
    expect(annual.lines[0]).toMatchObject({ code: 'subscription', label: 'Licence annuelle, formule Pro', amountCents: 199_000 });
    expect(annual.lines[1]).toMatchObject({ quantity: 24, amountCents: 36_000 });
    expect(computePlatformInvoice(pro, { billingPeriod: 'monthly' }, 10, month, false).lines).toHaveLength(1);
    // Entreprise : aucun véhicule inclus, 12 $ par véhicule actif.
    const big = computePlatformInvoice(entreprise, { billingPeriod: 'monthly' }, 40, month, true);
    expect(big.lines.map((l) => [l.code, l.amountCents])).toEqual([['setup_fee', 350_000], ['subscription', 19_900], ['active_vehicles', 48_000]]);
    // Formule sans prix par véhicule : jamais de ligne de véhicules ; sans frais d'installation, pas de ligne non plus.
    expect(computePlatformInvoice(solo, { billingPeriod: 'monthly' }, 4, month, true).lines.map((l) => l.code)).toEqual(['setup_fee', 'subscription']);
    expect(computePlatformInvoice({ ...solo, setupFeeCents: 0 }, { billingPeriod: 'monthly' }, 4, month, true).lines.map((l) => l.code)).toEqual(['subscription']);
    // Taux de taxes fournis par les réglages.
    expect(computePlatformInvoice(solo, { billingPeriod: 'monthly' }, 1, month, false, { gstRatePpm: 0, qstRatePpm: 0 }).totalCents).toBe(4_900);
    expect(QUEBEC_TAX_RATES).toEqual({ gstRatePpm: 50_000, qstRatePpm: 99_750 });
  });

  it('refuse une période vide, un nombre de véhicules invalide, une autre devise ou une formule mal renseignée', () => {
    expect(() => computePlatformInvoice(pro, { billingPeriod: 'monthly' }, 1, { start, end: start }, false)).toThrow(PlatformBillingError);
    expect(() => computePlatformInvoice(pro, { billingPeriod: 'monthly' }, -1, month, false)).toThrow(/véhicules/);
    expect(() => computePlatformInvoice(pro, { billingPeriod: 'monthly' }, 1.5, month, false)).toThrow(/véhicules/);
    expect(() => computePlatformInvoice({ ...pro, currency: 'USD' }, { billingPeriod: 'monthly' }, 1, month, false)).toThrow(/devise USD/);
    expect(() => computePlatformInvoice({ ...pro, includedVehicles: 2.5 }, { billingPeriod: 'monthly' }, 1, month, false)).toThrow(/includedVehicles/);
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
  it('un mois ou un an plus tard, au jour d\'ancrage, ramené au dernier jour du mois quand il n\'existe pas', () => {
    expect(billingPeriodEnd(new Date('2026-10-01T04:00:00Z'), 'monthly').toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(billingPeriodEnd(new Date('2026-01-31T12:30:15.250Z'), 'monthly').toISOString()).toBe('2026-02-28T12:30:15.250Z');
    // L'ancrage au 31 ramène le renouvellement suivant au 31 mars, pas au 28.
    expect(billingPeriodEnd(new Date('2026-02-28T12:00:00Z'), 'monthly', 31).toISOString()).toBe('2026-03-31T12:00:00.000Z');
    expect(billingPeriodEnd(new Date('2026-12-15T00:00:00Z'), 'monthly').toISOString()).toBe('2027-01-15T00:00:00.000Z');
    expect(billingPeriodEnd(new Date('2026-10-01T00:00:00Z'), 'annual').toISOString()).toBe('2027-10-01T00:00:00.000Z');
    expect(billingPeriodEnd(new Date('2028-02-29T00:00:00Z'), 'annual').toISOString()).toBe('2029-02-28T00:00:00.000Z');
    expect(billingPeriodMonths('monthly')).toBe(1);
    expect(billingPeriodMonths('annual')).toBe(12);
  });
});

describe('relances', () => {
  const dueAt = new Date('2026-11-01T04:00:00Z');
  const at = (days: number) => new Date(dueAt.getTime() + days * 86_400_000);
  const open = (remindersSent: number): DunningInvoice => ({ status: 'open', dueAt, remindersSent });

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
    const short = { reminderDays: [1], readOnlyDays: 5, suspendedDays: 10 };
    expect(dunningStep(open(0), at(2), short)).toMatchObject({ action: 'remind', reminder: 1 });
    expect(dunningStep(open(1), at(5), short).action).toBe('read_only');
  });

  it('calendrier d\'une facture : rappels, lecture seule et suspension', () => {
    const schedule = dunningSchedule(dueAt);
    expect(schedule.reminders.map((d) => d.toISOString())).toEqual([at(3), at(7), at(14)].map((d) => d.toISOString()));
    expect(schedule.readOnlyAt).toEqual(at(30));
    expect(schedule.suspendAt).toEqual(at(45));
    expect(dunningSchedule(dueAt, { reminderDays: [], readOnlyDays: 2, suspendedDays: 4 }).suspendAt).toEqual(at(4));
  });

  it('réglages lus en base : défauts, validation des rappels croissants avant la lecture seule, suspension après elle', () => {
    expect(dunningSettingsFrom({})).toEqual(DEFAULT_DUNNING_SETTINGS);
    expect(dunningSettingsFrom({ reminderDays: [2, 5], readOnlyDays: 20, suspendedDays: 40 })).toEqual({ reminderDays: [2, 5], readOnlyDays: 20, suspendedDays: 40 });
    expect(dunningSettingsFrom({ reminderDays: [] })).toEqual({ reminderDays: [], readOnlyDays: 30, suspendedDays: 45 });
    for (const bad of [{ reminderDays: 'abc' }, { reminderDays: [3, 3] }, { reminderDays: [0] }, { reminderDays: [1.5] }, { reminderDays: [7, 3] }]) {
      expect(() => dunningSettingsFrom(bad), JSON.stringify(bad)).toThrow(/reminder_days/);
    }
    for (const bad of [{ readOnlyDays: 0 }, { suspendedDays: 30 }, { readOnlyDays: 50 }, { suspendedDays: '45' }]) {
      expect(() => dunningSettingsFrom(bad), JSON.stringify(bad)).toThrow(/suspended_days/);
    }
    expect(() => dunningSettingsFrom({ reminderDays: [3, 30] })).toThrow(/précèdent/);
    try {
      dunningSettingsFrom({ readOnlyDays: -1 });
      expect.unreachable();
    } catch (error) {
      expect((error as PlatformBillingError).code).toBe('INVALID_SETTINGS');
    }
  });
});

describe('statut de l\'abonnement', () => {
  const dueAt = new Date('2026-11-01T04:00:00Z');
  const at = (days: number) => new Date(dueAt.getTime() + days * 86_400_000);
  const invoice = (status: DunningInvoice['status'] = 'open'): DunningInvoice => ({ status, dueAt, remindersSent: 0 });

  it('la facture impayée la plus en retard décide ; l\'essai et la résiliation ne bougent pas', () => {
    expect(targetSubscriptionStatus('active', [], at(100))).toBe('active');
    expect(targetSubscriptionStatus('active', [invoice()], at(-2))).toBe('active');
    expect(targetSubscriptionStatus('active', [invoice()], at(1))).toBe('past_due');
    expect(targetSubscriptionStatus('past_due', [invoice('past_due')], at(31))).toBe('read_only');
    expect(targetSubscriptionStatus('read_only', [invoice('paid'), invoice()], at(46))).toBe('suspended');
    expect(targetSubscriptionStatus('suspended', [invoice('paid')], at(46))).toBe('active');
    expect(targetSubscriptionStatus('trialing', [invoice()], at(46))).toBe('trialing');
    expect(targetSubscriptionStatus('cancelled', [invoice()], at(46))).toBe('cancelled');
  });

  it('jamais de suspension pendant une course : reportée, la lecture seule s\'applique quand même ; un paiement réactive', () => {
    expect(nextSubscriptionStatus('active', 'past_due', { activeRide: false })).toEqual({ status: 'past_due', escalated: true, postponed: false, reactivated: false });
    expect(nextSubscriptionStatus('past_due', 'read_only', { activeRide: true })).toEqual({ status: 'read_only', escalated: true, postponed: false, reactivated: false });
    expect(nextSubscriptionStatus('read_only', 'suspended', { activeRide: false })).toEqual({ status: 'suspended', escalated: true, postponed: false, reactivated: false });
    expect(nextSubscriptionStatus('read_only', 'suspended', { activeRide: true })).toEqual({ status: 'read_only', escalated: false, postponed: true, reactivated: false });
    // Passe manquée pendant 45 jours : la lecture seule tout de suite, la suspension après la course.
    expect(nextSubscriptionStatus('past_due', 'suspended', { activeRide: true })).toEqual({ status: 'read_only', escalated: true, postponed: true, reactivated: false });
    expect(nextSubscriptionStatus('suspended', 'active', { activeRide: false })).toEqual({ status: 'active', escalated: false, postponed: false, reactivated: true });
    expect(nextSubscriptionStatus('read_only', 'past_due', { activeRide: false })).toMatchObject({ status: 'past_due', reactivated: true });
    expect(nextSubscriptionStatus('past_due', 'active', { activeRide: false })).toEqual({ status: 'active', escalated: false, postponed: false, reactivated: false });
    expect(nextSubscriptionStatus('active', 'active', { activeRide: false })).toEqual({ status: 'active', escalated: false, postponed: false, reactivated: false });
    expect(nextSubscriptionStatus('trialing', 'suspended', { activeRide: false }).status).toBe('trialing');
    expect(nextSubscriptionStatus('active', 'cancelled', { activeRide: false }).status).toBe('active');
  });

  it('accès d\'une organisation selon son statut : lecture seule, suspendue ou fermée, plus d\'écriture', () => {
    expect(organizationWriteAllowed('trial')).toBe(true);
    expect(organizationWriteAllowed('active')).toBe(true);
    expect(organizationWriteAllowed('read_only')).toBe(false);
    expect(organizationWriteAllowed('suspended')).toBe(false);
    expect(organizationWriteAllowed('closed')).toBe(false);
    expect(organizationAccess('read_only')).toEqual({ read: true, write: false });
    expect(organizationAccess('active')).toEqual({ read: true, write: true });
    expect(organizationAccess('suspended')).toEqual({ read: false, write: false });
    expect(organizationAccess('closed')).toEqual({ read: false, write: false });
    expect(Object.fromEntries(SUBSCRIPTION_STATUSES.map((s) => [s, organizationStatusFor(s)]))).toEqual({
      trialing: 'trial', active: 'active', past_due: 'active', read_only: 'read_only', suspended: 'suspended', cancelled: 'read_only',
    });
  });
});

describe('formules, revenu récurrent, numéros, permissions', () => {
  it('modules d\'une formule : connus, sans ceux de la plateforme ni l\'espace du chauffeur, dédoublonnés et triés', () => {
    expect(planModules(pro)).toEqual(['organization', 'vehicles']);
    expect(planModules({ modules: [] })).toEqual([]);
  });

  it('revenu mensuel récurrent : licence annuelle ramenée au mois, véhicules en sus ; rien pour un essai, une suspension, une résiliation', () => {
    expect(monthlyRecurringRevenueCents(pro, { billingPeriod: 'monthly', status: 'active', activeVehicles: 12 })).toBe(22_900);
    expect(monthlyRecurringRevenueCents(pro, { billingPeriod: 'annual', status: 'past_due', activeVehicles: 2 })).toBe(16_583);
    expect(monthlyRecurringRevenueCents(pro, { billingPeriod: 'monthly', status: 'read_only', activeVehicles: 0 })).toBe(19_900);
    for (const status of ['trialing', 'suspended', 'cancelled'] as const) expect(monthlyRecurringRevenueCents(pro, { billingPeriod: 'monthly', status, activeVehicles: 12 })).toBe(0);
  });

  it('numéro de facture et permissions du catalogue', () => {
    expect(formatPlatformInvoiceNumber(2026, 7)).toBe('PF-2026-000007');
    expect(formatPlatformInvoiceNumber(2027, 1_234_567)).toBe('PF-2027-1234567');
    expect(PERMISSIONS['billing.view']).toMatchObject({ module: 'organization', sensitive: false, platformOnly: false });
    expect(PERMISSIONS['billing.manage']).toMatchObject({ module: 'organization', sensitive: true, platformOnly: false });
    expect(systemRole('org_owner')!.permissions).toEqual(expect.arrayContaining(['billing.view', 'billing.manage']));
    expect(systemRole('platform_admin')!.permissions).toEqual(expect.arrayContaining(['billing.view', 'billing.manage']));
  });
});

describe('schémas de l\'API', () => {
  it('création ou changement de formule, résiliation, règlement hors plateforme, vue d\'ensemble', () => {
    expect(subscriptionUpsertSchema.parse({ planCode: ' pro ' })).toEqual({ planCode: 'pro', billingPeriod: 'monthly' });
    expect(subscriptionUpsertSchema.safeParse({ planCode: 'pro', billingPeriod: 'weekly' }).success).toBe(false);
    expect(subscriptionUpsertSchema.safeParse({ planCode: 'pro', trialDays: 91 }).success).toBe(false);
    expect(subscriptionCancelSchema.safeParse({ reason: 'ok' }).success).toBe(false);
    expect(platformInvoiceMarkPaidSchema.parse({ reference: 'VIR-2026-10-01', paidAt: '2026-10-01T12:00:00-04:00' }).reference).toBe('VIR-2026-10-01');
    expect(billingOverviewQuerySchema.parse({})).toEqual({ horizonDays: 14 });
    expect(billingOverviewQuerySchema.parse({ horizonDays: '30' })).toEqual({ horizonDays: 30 });
    const counts = Object.fromEntries(SUBSCRIPTION_STATUSES.map((s) => [s, 0]));
    expect(billingOverviewSchema.safeParse({ monthlyRecurringRevenueCents: 0, subscriptions: counts, unpaid: { count: 0, totalCents: 0, overdueCount: 0, overdueCents: 0 }, upcoming: [] }).success).toBe(true);
    expect(billingRunReportSchema.safeParse({ trialsEnded: 0, renewed: 0, invoicesIssued: 0, pushed: 0, pastDue: 0, reminders: 0, readOnly: 0, suspended: 0, postponed: 0, reactivated: 0, errors: 0 }).success).toBe(true);
    // La vue de l'organisation ne montre aucun identifiant Stripe.
    expect(Object.keys(organizationBillingSchema.shape.invoices.element.shape)).not.toContain('stripeInvoiceId');
  });
});
