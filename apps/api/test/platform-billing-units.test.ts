/**
 * Étape 25 : pièces de la facturation de la plateforme testées sans base : gabarits des avis (fr-CA et en), PDF de la
 * facture, et passe quotidienne (heure de la passe, comptes du rapport, erreurs isolées, réglages incohérents).
 */
import type { PlatformInvoiceView } from '@neomoov/domain';
import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../src/config/env.js';
import { hasTemplate, renderNotification } from '../src/modules/notifications/templates.js';
import { BillingJobsService } from '../src/modules/platform-billing/billing-jobs.service.js';
import type { PlatformBillingService } from '../src/modules/platform-billing/platform-billing.service.js';
import { renderPlatformInvoicePdf } from '../src/modules/platform-billing/platform-invoice-pdf.js';
import type { SettingsService } from '../src/common/settings.service.js';
import type { QueueService } from '../src/infra/queue.module.js';

const DATA = {
  number: 'PF-2026-000001', totalCents: 195_343, planName: 'Pro', dueAt: '2026-10-01T04:00:00.000Z', hostedInvoiceUrl: 'https://invoice.stripe.com/i/abc', organizationName: 'Taxi Laval',
  reminder: 2, daysOverdue: 7, readOnlyAt: '2026-10-31T04:00:00.000Z', suspendAt: '2026-11-15T05:00:00.000Z',
};

describe('avis de facturation (gabarits)', () => {
  it('cinq gabarits, en français et en anglais, montants et dates du Québec, lien de paiement', () => {
    for (const code of ['billing.invoice_issued', 'billing.reminder', 'billing.read_only', 'billing.suspended', 'billing.reactivated']) {
      expect(hasTemplate(code), code).toBe(true);
      for (const language of ['fr', 'en']) {
        const rendered = renderNotification(code, DATA, language);
        expect(rendered.body.length, `${code} ${language}`).toBeGreaterThan(40);
        expect(rendered.html).toContain(language === 'en' ? 'lang="en"' : 'lang="fr-CA"');
      }
    }
    const issued = renderNotification('billing.invoice_issued', DATA, 'fr');
    expect(issued.title).toBe('Facture PF-2026-000001 de la plateforme Neomoov');
    expect(issued.subject).toBe('Facture PF-2026-000001 de la plateforme Neomoov · Neomoov');
    expect(issued.body).toMatch(/1\s953,43\s\$/);
    expect(issued.body).toContain('1 octobre 2026');
    expect(issued.body).toContain('Payer en ligne : https://invoice.stripe.com/i/abc');
    const reminder = renderNotification('billing.reminder', DATA, 'en');
    expect(reminder.title).toBe('Reminder: invoice PF-2026-000001 unpaid');
    expect(reminder.body).toContain('Reminder 2: invoice PF-2026-000001 (Taxi Laval) for $1,953.43 has been overdue for 7 days');
    expect(reminder.body).toContain('read-only on October 31, 2026');
    expect(renderNotification('billing.read_only', DATA, 'fr').body).toContain('suspendue le 15 novembre 2026');
    expect(renderNotification('billing.suspended', { ...DATA, hostedInvoiceUrl: null }, 'fr').body).not.toContain('Payer en ligne');
    expect(renderNotification('billing.reactivated', { organizationName: '' }, 'en').body).toBe('Thank you: your payment has been received. Your organization has full access to the platform again.');
    // Données manquantes : jamais d'erreur, des champs vides.
    expect(renderNotification('billing.reminder', {}, 'fr').body).toContain('0,00');
  });
});

describe('PDF de la facture de la plateforme', () => {
  const invoice: PlatformInvoiceView = {
    id: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222', subscriptionId: '33333333-3333-4333-8333-333333333333', number: 'PF-2026-000001',
    periodStart: '2026-10-01T04:00:00.000Z', periodEnd: '2026-11-01T04:00:00.000Z',
    lines: [{ code: 'subscription', label: 'Abonnement mensuel, formule Pro', quantity: 1, unitCents: 19_900, amountCents: 19_900 }, { code: 'active_vehicles', label: 'Véhicules actifs au-delà des 10 inclus (2 × 1 mois)', quantity: 2, unitCents: 1_500, amountCents: 3_000 }],
    subtotalCents: 22_900, gstCents: 1_145, qstCents: 2_284, totalCents: 26_329, currency: 'CAD', status: 'open', issuedAt: '2026-10-01T05:00:00.000Z', dueAt: '2026-10-01T05:00:00.000Z',
    paidAt: null, paymentMethod: null, paymentReference: null, remindersSent: 0, hostedInvoiceUrl: 'https://invoice.stripe.com/i/abc', stripeInvoiceId: 'in_1', pdfAvailable: false, createdAt: '2026-10-01T05:00:00.000Z',
  };
  const base = { rates: { gstRatePpm: 50_000, qstRatePpm: 99_750 }, timeZone: 'America/Toronto', seller: { name: 'Neomoov', address: 'Montréal (Québec)', gstNumber: null, qstNumber: null }, creationDate: new Date('2026-10-01T00:00:00Z') };

  it('à payer, payée hors plateforme ou par Stripe, annulée : un PDF lisible à chaque fois', async () => {
    const variants: PlatformInvoiceView[] = [
      invoice,
      { ...invoice, hostedInvoiceUrl: null, dueAt: '2026-10-15T05:00:00.000Z' },
      { ...invoice, status: 'paid', paidAt: '2026-10-02T15:00:00.000Z', paymentMethod: 'offline', paymentReference: 'VIR-2026-10-02' },
      { ...invoice, status: 'paid', paidAt: '2026-10-02T15:00:00.000Z', paymentMethod: 'stripe' },
      { ...invoice, status: 'void' },
    ];
    for (const [i, variant] of variants.entries()) {
      const pdf = await renderPlatformInvoicePdf({ ...base, invoice: variant, customer: i % 2 ? { name: 'Flotte A inc.', gstNumber: '123456789 RT0001', qstNumber: null } : { name: 'Flotte A inc.', gstNumber: null, qstNumber: null } });
      expect(pdf.subarray(0, 5).toString(), `variante ${i}`).toBe('%PDF-');
      expect(pdf.length).toBeGreaterThan(1_000);
    }
  });
});

describe('passe quotidienne (BillingJobsService)', () => {
  const env = { NODE_ENV: 'test', TIMEZONE: 'America/Toronto' } as AppEnv;
  const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() } as unknown as Logger;
  const settings = (runHour = 5) => ({ number: vi.fn(async () => runHour) }) as unknown as SettingsService;
  const queues = () => ({ mode: 'memory', process: vi.fn() }) as unknown as QueueService & { process: ReturnType<typeof vi.fn> };
  const transition = (status: string, over: Record<string, boolean> = {}) => ({ status, escalated: false, postponed: false, reactivated: false, ...over });

  function billing(over: Partial<Record<keyof PlatformBillingService, unknown>> = {}) {
    return {
      endedTrials: vi.fn(async () => ['t1', 't2']),
      endTrial: vi.fn(async (id: string) => (id === 't1' ? { id: 'inv' } : null)),
      dueRenewals: vi.fn(async () => ['r1', 'r2', 'r3']),
      renew: vi.fn(async (id: string) => { if (id === 'r3') throw new Error('formule invalide'); return id === 'r1' ? 2 : 0; }),
      unpushedInvoices: vi.fn(async () => ['p1', 'p2']),
      pushInvoiceById: vi.fn(async (id: string) => id === 'p1'),
      dunningSettings: vi.fn(async () => ({ reminderDays: [3, 7, 14], readOnlyDays: 30, suspendedDays: 45 })),
      unpaidInvoices: vi.fn(async () => ['i1', 'i2']),
      dunInvoice: vi.fn(async (id: string) => (id === 'i1' ? { pastDue: true, reminded: true } : { pastDue: false, reminded: false })),
      dunnedSubscriptions: vi.fn(async () => ['s1', 's2', 's3', 's4']),
      applyStatus: vi.fn(async (id: string) => ({
        s1: transition('read_only', { escalated: true }), s2: transition('read_only', { postponed: true }), s3: transition('suspended', { escalated: true }), s4: transition('active', { reactivated: true }),
      })[id]),
      ...over,
    } as unknown as PlatformBillingService;
  }

  it('rapport : chaque étape comptée, une erreur isolée n\'arrête pas la passe', async () => {
    const jobs = new BillingJobsService(billing(), queues(), settings(), env, logger);
    expect(await jobs.run(new Date('2026-10-01T09:00:00Z'))).toEqual({
      trialsEnded: 1, renewed: 1, invoicesIssued: 3, pushed: 1, pastDue: 1, reminders: 1, readOnly: 1, suspended: 1, postponed: 1, reactivated: 1, errors: 1,
    });
  });

  it('réglages incohérents : ni relance ni suspension, une erreur visible', async () => {
    const fake = billing({ dunningSettings: vi.fn(async () => { throw new Error('billing.reminder_days'); }) });
    const report = await new BillingJobsService(fake, queues(), settings(), env, logger).run(new Date());
    expect(report).toMatchObject({ errors: 2, reminders: 0, suspended: 0 });
    expect((fake as unknown as { dunInvoice: ReturnType<typeof vi.fn> }).dunInvoice).not.toHaveBeenCalled();
  });

  it('passe horaire : le cycle seulement à l\'heure de la passe (heure de Montréal) ; enregistrement unique de la file', async () => {
    const q = queues();
    const jobs = new BillingJobsService(billing({ endedTrials: vi.fn(async () => []), dueRenewals: vi.fn(async () => []), unpushedInvoices: vi.fn(async () => []), unpaidInvoices: vi.fn(async () => []), dunnedSubscriptions: vi.fn(async () => []) }), q, settings(5), env, logger);
    expect(await jobs.tick(new Date('2026-10-01T08:30:00Z'))).toBeNull();
    expect(await jobs.tick(new Date('2026-10-01T09:30:00Z'))).toMatchObject({ errors: 0, invoicesIssued: 0 });
    jobs.onModuleInit();
    expect(q.process).not.toHaveBeenCalled();
    jobs.register({ everyMs: 3_600_000 });
    jobs.register({ everyMs: 3_600_000 });
    expect(q.process).toHaveBeenCalledTimes(1);
    expect(q.process.mock.calls[0]![2]).toMatchObject({ everyMs: 3_600_000, jobName: 'tick', concurrency: 1 });
    const production = new BillingJobsService(billing(), queues(), settings(), { ...env, NODE_ENV: 'development' } as AppEnv, logger);
    production.onModuleInit();
  });
});
