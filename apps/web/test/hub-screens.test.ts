/**
 * Tests de rendu des écrans My Hub ajoutés à la finalisation (3 octobre 2026), sans navigateur ni base : notes des
 * clients (Charte d'équité), exclusions de zones de Pilote, état CRM, marque et domaines, facturation de la plateforme.
 * Données de démonstration passées aux composants d'affichage ; accessibilité contrôlée sur le balisage rendu.
 */
import type { AdminDriverRatingView, BillingOverview, CrmRecordsView, OrganizationDomainCreated, PilotZoneExclusionsView, PlatformInvoiceView, SubscriptionView } from '@neomoov/domain';
import { NEOMOOV_BRAND } from '@neomoov/domain';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { BillingOverviewView } from '../src/components/hub/billing-overview';
import { CrmRecordsList } from '../src/components/hub/crm-status';
import { RatingsTable } from '../src/components/hub/driver-ratings';
import { PlatformInvoicesTable, SubscriptionSummary } from '../src/components/hub/org-billing';
import { BrandPreview, DnsRecord } from '../src/components/hub/org-brand';
import { DriverExclusionsTable, ZoneExclusionsTable } from '../src/components/hub/pilot-exclusions';
import { a11yIssues, ADMIN, render } from './support/markup';

const RIDE = '11111111-1111-4111-8111-111111111111';
const at = '2026-10-01T14:30:00.000Z';
const ratings: AdminDriverRatingView[] = [
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', rideId: RIDE, ridePublicNumber: 'NM-2026-000123', score: 1, tags: ['late', 'traffic'], comment: 'Bouchon sur le pont', createdAt: at, excludedAt: null, excludedReason: null },
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', rideId: RIDE, ridePublicNumber: 'NM-2026-000124', score: 2, tags: [], comment: null, createdAt: at, excludedAt: at, excludedReason: 'Cause extérieure établie' },
];

describe('My Hub : notes des clients d\'un chauffeur', () => {
  it('note comptée avec son bouton d\'exclusion, note exclue avec son motif ; aucune identité de client', () => {
    const html = render(createElement(RatingsTable, { ratings, lang: 'fr-CA', onExclude: () => undefined }));
    expect(html).toContain('NM-2026-000123');
    expect(html).toContain('1 sur 5');
    expect(html).toContain('En retard, Circulation');
    expect(html).toContain('Comptée');
    expect(html).toContain('Exclue');
    expect(html).toContain('Cause extérieure établie');
    expect(html.match(/Exclure du calcul/g)).toHaveLength(1);
    expect(html).toContain(`href="/hub/courses/${RIDE}"`);
    expect(a11yIssues(html)).toEqual([]);
  });

  it('lecture seule : aucun bouton ; liste vide annoncée', () => {
    expect(render(createElement(RatingsTable, { ratings, lang: 'fr-CA' }))).not.toContain('Exclure du calcul');
    expect(render(createElement(RatingsTable, { ratings: [], lang: 'en' }), { language: 'en' })).toContain('No customer rating.');
  });
});

describe('My Hub : Neomoov Pilote, exclusions de zones', () => {
  const report: PilotZoneExclusionsView = {
    watchedZones: ['nord'],
    zones: [
      { code: 'nord', name: 'Montréal-Nord', type: 'district', watched: true, drivers: 2, enabledDrivers: 1, origin: 2, destination: 1 },
      { code: 'yul', name: 'Aéroport', type: 'airport', watched: false, drivers: 0, enabledDrivers: 0, origin: 0, destination: 0 },
    ],
    drivers: [{ driverId: '22222222-2222-4222-8222-222222222222', publicNumber: 'CH-00042', enabled: true, origin: ['nord'], destination: [], watched: ['nord'] }],
  };

  it('zones exclues ou surveillées, chauffeurs avec les noms des zones', () => {
    const zones = render(createElement(ZoneExclusionsTable, { report }));
    expect(zones).toContain('Montréal-Nord');
    expect(zones).toContain('Surveillée');
    expect(zones).not.toContain('Aéroport');
    const drivers = render(createElement(DriverExclusionsTable, { report }));
    expect(drivers).toContain('CH-00042');
    expect(drivers).toContain('href="/hub/chauffeurs/22222222-2222-4222-8222-222222222222"');
    expect(drivers).toContain('Montréal-Nord');
    expect(a11yIssues(zones + drivers)).toEqual([]);
  });
});

describe('My Hub : état CRM d\'une fiche', () => {
  it('objets, statut, erreur, et fiche jamais présentée', () => {
    const view: CrmRecordsView = { provider: 'hubspot', records: [
      { objectType: 'contact', externalId: '901', status: 'synced', attempts: 0, error: null, lastSyncedAt: at },
      { objectType: 'deal', externalId: null, status: 'error', attempts: 3, error: 'HubSpot indisponible', lastSyncedAt: null },
    ] };
    const html = render(createElement(CrmRecordsList, { view, lang: 'fr-CA' }));
    expect(html).toContain('Fournisseur : hubspot');
    expect(html).toContain('Synchronisé');
    expect(html).toContain('En erreur');
    expect(html).toContain('Tentatives : 3');
    expect(html).toContain('HubSpot indisponible');
    expect(render(createElement(CrmRecordsList, { view: { provider: 'mock', records: [] }, lang: 'fr-CA' }))).toContain('Rien n&#x27;est encore parti vers le CRM.');
  });
});

describe('My Hub : marque et domaines d\'une organisation', () => {
  it('aperçu aux couleurs de la marque ; enregistrement DNS montré une fois', () => {
    const preview = render(createElement(BrandPreview, { colors: NEOMOOV_BRAND.colors, name: 'Taxi Alpha' }));
    expect(preview).toContain('Taxi Alpha');
    expect(preview).toContain('background:#0B5FB5');
    const created: OrganizationDomainCreated = {
      id: '33333333-3333-4333-8333-333333333333', organizationId: '44444444-4444-4444-8444-444444444444', domain: 'reservation.alpha.ca', kind: 'booking', verifiedAt: null, createdAt: at,
      verificationToken: 'jeton', dnsRecord: { type: 'TXT', name: '_neomoov-verification.reservation.alpha.ca', value: 'neomoov-verification=jeton' },
    };
    const dns = render(createElement(DnsRecord, { created }));
    expect(dns).toContain('_neomoov-verification.reservation.alpha.ca');
    expect(dns).toContain('neomoov-verification=jeton');
    expect(dns).toContain('il ne sera plus affiché');
    expect(a11yIssues(preview + dns)).toEqual([]);
  });
});

describe('My Hub : facturation de la plateforme', () => {
  const plan = { code: 'pro', name: 'Pro', modules: ['rides'], setupFeeCents: 0, monthlyPriceCents: 10_000, annualPriceCents: 100_000, perActiveVehicleCents: 1_000, includedVehicles: 5, currency: 'CAD', active: true };
  const subscription: SubscriptionView = {
    id: '55555555-5555-4555-8555-555555555555', organizationId: '44444444-4444-4444-8444-444444444444', planCode: 'pro', plan, status: 'past_due', billingPeriod: 'monthly',
    startedAt: at, currentPeriodStart: at, currentPeriodEnd: '2026-11-01T14:30:00.000Z', trialEndsAt: null, activeVehicles: 7, monthlyRecurringRevenueCents: 12_000, cancelledAt: null,
    stripeCustomerId: null, stripeSubscriptionId: null, createdAt: at,
  };
  const invoice = (status: PlatformInvoiceView['status'], id: string): PlatformInvoiceView => ({
    id, organizationId: subscription.organizationId, subscriptionId: subscription.id, number: `PF-2026-00000${id.slice(0, 1)}`, periodStart: at, periodEnd: at, lines: [],
    subtotalCents: 10_000, gstCents: 500, qstCents: 998, totalCents: 11_498, currency: 'CAD', status, issuedAt: at, dueAt: at, paidAt: status === 'paid' ? at : null,
    paymentMethod: status === 'paid' ? 'offline' : null, paymentReference: status === 'paid' ? 'VIR-1' : null, remindersSent: 1, hostedInvoiceUrl: null, stripeInvoiceId: null, pdfAvailable: true, createdAt: at,
  });

  it('abonnement en retard ; factures : PDF par la passerelle, règlement hors plateforme seulement pour une facture à payer', () => {
    const summary = render(createElement(SubscriptionSummary, { subscription, lang: 'fr-CA' }));
    expect(summary).toContain('En retard');
    expect(summary).toContain('Pro');
    const table = render(createElement(PlatformInvoicesTable, { invoices: [invoice('past_due', '66666666-6666-4666-8666-666666666666'), invoice('paid', '77777777-7777-4777-8777-777777777777')], lang: 'fr-CA', onMarkPaid: () => undefined }));
    // Un seul bouton : la facture en retard ; la facture payée montre son mode et sa référence.
    expect(table.match(/Règlement hors plateforme/g)).toHaveLength(1);
    expect(table).toContain('href="/api/v1/admin/platform-invoices/66666666-6666-4666-8666-666666666666/pdf"');
    expect(table).toContain('Hors plateforme · VIR-1');
    expect(a11yIssues(summary + table)).toEqual([]);
  });

  it('vue d\'ensemble : revenu mensuel, impayés, statuts et actions à venir', () => {
    const overview: BillingOverview = {
      monthlyRecurringRevenueCents: 12_000,
      subscriptions: { trialing: 1, active: 3, past_due: 1, read_only: 0, suspended: 0, cancelled: 2 },
      unpaid: { count: 2, totalCents: 22_996, overdueCount: 1, overdueCents: 11_498 },
      upcoming: [{ organizationId: subscription.organizationId, organizationName: 'Taxi Alpha', invoiceId: '66666666-6666-4666-8666-666666666666', invoiceNumber: 'PF-2026-000006', totalCents: 11_498, dueAt: at, daysOverdue: 9, nextAction: 'read_only', at }],
    };
    const html = render(createElement(BillingOverviewView, { overview, lang: 'fr-CA' }), { user: ADMIN });
    expect(html).toContain('Taxi Alpha');
    expect(html).toContain('Lecture seule');
    expect(html).toContain('Actif : 3');
    expect(a11yIssues(html)).toEqual([]);
  });
});
