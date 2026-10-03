'use client';

/**
 * Abonnement d'une organisation cliente à la plateforme (étape 25), dans « Organisations et accès » : formule et statut,
 * création ou changement de formule (à la prochaine facture), résiliation, factures de la plateforme avec leur PDF et le
 * règlement hors plateforme (virement, chèque, Interac). Personnel de la plateforme (`billing.view`, `billing.manage`).
 */
import { BILLING_PERIODS, type BillingPeriod, type OrganizationView, type PlatformInvoiceView, type PlatformPlanView, type SubscriptionView } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Action, Badge, Card, DataTable, Dialog, Field, Input, Notice, Select, focus, type BadgeTone, type Column } from '@/components/ui/kit';
import { formatDate, formatMoney, montrealToIso } from '@/lib/format';
import { ApiError, hubApi } from '@/lib/hub-api';
import type { Language } from '@/lib/i18n-resources';
import { ErrorBlock, Loading, useErrorText, useLang } from './common';
import { CrmStatus } from './crm-status';

const SUBSCRIPTION_TONES: Record<SubscriptionView['status'], BadgeTone> = { trialing: 'info', active: 'success', past_due: 'warning', read_only: 'danger', suspended: 'danger', cancelled: 'neutral' };
const INVOICE_TONES: Record<PlatformInvoiceView['status'], BadgeTone> = { draft: 'neutral', open: 'info', paid: 'success', past_due: 'danger', void: 'neutral' };
const notFound = (error: unknown) => error instanceof ApiError && error.status === 404;

export function OrgBillingPanel({ org }: { org: OrganizationView }) {
  const { t } = useTranslation();
  const lang = useLang();
  const queryClient = useQueryClient();
  const subscription = useQuery({ queryKey: ['hub', 'billing', org.id, 'subscription'], queryFn: () => hubApi.platformBilling.subscription(org.id), retry: false });
  const plans = useQuery({ queryKey: ['hub', 'billing', 'plans'], queryFn: () => hubApi.platformBilling.plans() });
  const [message, setMessage] = useState<string | null>(null);
  const refresh = (text: string) => {
    setMessage(text);
    void queryClient.invalidateQueries({ queryKey: ['hub', 'billing', org.id] });
  };
  const none = subscription.isError && notFound(subscription.error);
  return (
    <div className="flex flex-col gap-4">
      {message ? <Notice tone="success">{message}</Notice> : null}
      <Card title={t('hub.billing.subscription')}>
        {subscription.isPending ? <Loading /> : subscription.isError && !none ? <ErrorBlock error={subscription.error} onRetry={() => void subscription.refetch()} /> : (
          <div className="flex flex-col gap-4">
            {subscription.data ? <SubscriptionSummary subscription={subscription.data} lang={lang} /> : <p className="text-sm text-slate-700">{t('hub.billing.none')}</p>}
            {plans.data ? <SubscriptionForm organizationId={org.id} current={subscription.data ?? null} plans={plans.data} onDone={refresh} /> : plans.isError ? <ErrorBlock error={plans.error} /> : null}
          </div>
        )}
      </Card>
      <Invoices organizationId={org.id} onDone={refresh} />
      <Card title={t('hub.crm.title')}><CrmStatus kind="organizations" entityId={org.id} /></Card>
    </div>
  );
}

/** Résumé de l'abonnement ; exporté pour les tests de rendu. */
export function SubscriptionSummary({ subscription: s, lang }: { subscription: SubscriptionView; lang: Language }) {
  const { t } = useTranslation();
  return (
    <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[14rem_1fr]" data-testid="subscription-summary">
      <dt className="font-semibold">{t('hub.billing.plan')}</dt><dd>{s.plan.name} <code className="text-xs">{s.planCode}</code></dd>
      <dt className="font-semibold">{t('hub.billing.status')}</dt><dd><Badge tone={SUBSCRIPTION_TONES[s.status]}>{t(`hub.billing.statuses.${s.status}`)}</Badge></dd>
      <dt className="font-semibold">{t('hub.billing.period')}</dt><dd>{t(`hub.billing.periods.${s.billingPeriod}`)}</dd>
      <dt className="font-semibold">{t('hub.billing.currentPeriod')}</dt><dd>{`${formatDate(s.currentPeriodStart, lang)} → ${formatDate(s.currentPeriodEnd, lang)}`}</dd>
      {s.trialEndsAt ? <><dt className="font-semibold">{t('hub.billing.trialEnds')}</dt><dd>{formatDate(s.trialEndsAt, lang)}</dd></> : null}
      <dt className="font-semibold">{t('hub.billing.activeVehicles')}</dt><dd>{s.activeVehicles}</dd>
      <dt className="font-semibold">{t('hub.billing.mrr')}</dt><dd>{formatMoney(s.monthlyRecurringRevenueCents, lang)}</dd>
      {s.stripeCustomerId ? <><dt className="font-semibold">{t('hub.billing.stripeCustomer')}</dt><dd><code>{s.stripeCustomerId}</code></dd></> : null}
    </dl>
  );
}

function SubscriptionForm({ organizationId, current, plans, onDone }: { organizationId: string; current: SubscriptionView | null; plans: PlatformPlanView[]; onDone: (message: string) => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const active = plans.filter((p) => p.active);
  const [planCode, setPlanCode] = useState(current?.planCode ?? active[0]?.code ?? '');
  const [period, setPeriod] = useState<BillingPeriod>(current?.billingPeriod ?? 'monthly');
  const [trialDays, setTrialDays] = useState('0');
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const creating = current === null || current.status === 'cancelled';
  const upsert = useMutation({
    mutationFn: () => hubApi.platformBilling.upsertSubscription(organizationId, { planCode, billingPeriod: period, ...(creating ? { trialDays: Math.max(0, Math.min(90, Number(trialDays) || 0)) } : {}) }),
    onSuccess: (r) => onDone([r.created ? t('hub.billing.created') : t('hub.billing.changed'), r.invoice ? t('hub.billing.firstInvoice', { number: r.invoice.number }) : ''].filter(Boolean).join(' ')),
  });
  const cancel = useMutation({ mutationFn: () => hubApi.platformBilling.cancelSubscription(organizationId, reason.trim()), onSuccess: () => { setCancelling(false); setReason(''); onDone(t('hub.billing.cancelled')); } });
  return (
    <>
      <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_10rem_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); if (planCode) upsert.mutate(); }}>
        <Field label={t('hub.billing.plan')} hint={creating ? undefined : t('hub.billing.changeHint')}>
          {(p) => <Select {...p} required value={planCode} onChange={(e) => setPlanCode(e.target.value)}>{active.map((plan) => <option key={plan.code} value={plan.code}>{plan.name}</option>)}</Select>}
        </Field>
        <Field label={t('hub.billing.period')}>
          {(p) => <Select {...p} value={period} onChange={(e) => setPeriod(e.target.value as BillingPeriod)}>{BILLING_PERIODS.map((b) => <option key={b} value={b}>{t(`hub.billing.periods.${b}`)}</option>)}</Select>}
        </Field>
        {creating ? <Field label={t('hub.billing.trialDays')} hint={t('hub.billing.trialHint')}>{(p) => <Input {...p} type="number" min={0} max={90} value={trialDays} onChange={(e) => setTrialDays(e.target.value)} />}</Field> : <span />}
        <Action type="submit" busy={upsert.isPending} disabled={!planCode}>{creating ? t('hub.billing.create') : t('hub.billing.change')}</Action>
      </form>
      {upsert.isError ? <Notice tone="danger">{errorText(upsert.error)}</Notice> : null}
      {!creating ? <div><Action tone="danger" onClick={() => { setCancelling(true); cancel.reset(); }}>{t('hub.billing.cancel')}</Action></div> : null}
      <Dialog open={cancelling} title={t('hub.billing.cancelTitle')} onClose={() => setCancelling(false)}>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (reason.trim().length >= 3) cancel.mutate(); }}>
          <Notice tone="warning">{t('hub.billing.cancelHint')}</Notice>
          <Field label={t('hub.common.reason')}>{(p) => <Input {...p} required minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          {cancel.isError ? <Notice tone="danger">{errorText(cancel.error)}</Notice> : null}
          <div className="flex justify-end gap-2">
            <Action tone="secondary" onClick={() => setCancelling(false)}>{t('hub.common.cancel')}</Action>
            <Action type="submit" tone="danger" busy={cancel.isPending} disabled={reason.trim().length < 3}>{t('hub.billing.cancel')}</Action>
          </div>
        </form>
      </Dialog>
    </>
  );
}

function Invoices({ organizationId, onDone }: { organizationId: string; onDone: (message: string) => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const errorText = useErrorText();
  const invoices = useQuery({ queryKey: ['hub', 'billing', organizationId, 'invoices'], queryFn: () => hubApi.platformBilling.invoices(organizationId) });
  const [paying, setPaying] = useState<PlatformInvoiceView | null>(null);
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState('');
  const markPaid = useMutation({
    mutationFn: () => hubApi.platformBilling.markPaid(paying!.id, { reference: reference.trim(), ...(paidOn ? { paidAt: montrealToIso(paidOn, '00:00') } : {}) }),
    onSuccess: () => { setPaying(null); setReference(''); setPaidOn(''); onDone(t('hub.billing.markPaidDone')); },
  });
  return (
    <Card title={t('hub.billing.invoices')}>
      {invoices.isPending ? <Loading /> : invoices.isError ? <ErrorBlock error={invoices.error} onRetry={() => void invoices.refetch()} /> : (
        <PlatformInvoicesTable invoices={invoices.data} lang={lang} onMarkPaid={(invoice) => { setPaying(invoice); markPaid.reset(); }} />
      )}
      <Dialog open={paying !== null} title={t('hub.billing.markPaidTitle')} onClose={() => setPaying(null)}>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (reference.trim().length >= 2) markPaid.mutate(); }}>
          {paying ? <p className="text-sm"><strong>{paying.number}</strong> · {formatMoney(paying.totalCents, lang)}</p> : null}
          <Field label={t('hub.billing.reference')}>{(p) => <Input {...p} required minLength={2} maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} />}</Field>
          <Field label={t('hub.billing.paidAt')} hint={t('hub.billing.paidAtHint')}>{(p) => <Input {...p} type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />}</Field>
          {markPaid.isError ? <Notice tone="danger">{errorText(markPaid.error)}</Notice> : null}
          <div className="flex justify-end gap-2">
            <Action tone="secondary" onClick={() => setPaying(null)}>{t('hub.common.cancel')}</Action>
            <Action type="submit" busy={markPaid.isPending} disabled={reference.trim().length < 2}>{t('hub.common.confirm')}</Action>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}

/** Factures de la plateforme ; sans `onMarkPaid`, lecture seule. Exporté pour les tests de rendu. */
export function PlatformInvoicesTable({ invoices, lang, onMarkPaid }: { invoices: PlatformInvoiceView[]; lang: Language; onMarkPaid?: (invoice: PlatformInvoiceView) => void }) {
  const { t } = useTranslation();
  const columns: Column<PlatformInvoiceView>[] = [
    { key: 'number', header: t('hub.billing.number'), cell: (i) => <code>{i.number}</code> },
    { key: 'period', header: t('hub.billing.currentPeriod'), cell: (i) => `${formatDate(i.periodStart, lang)} → ${formatDate(i.periodEnd, lang)}` },
    { key: 'total', header: t('hub.billing.total'), className: 'text-right', cell: (i) => formatMoney(i.totalCents, lang) },
    { key: 'status', header: t('hub.billing.status'), cell: (i) => <Badge tone={INVOICE_TONES[i.status]}>{t(`hub.billing.invoiceStatuses.${i.status}`)}</Badge> },
    { key: 'due', header: t('hub.billing.dueAt'), cell: (i) => formatDate(i.dueAt, lang) },
    { key: 'paid', header: t('hub.billing.paid'), cell: (i) => (i.paidAt ? `${formatDate(i.paidAt, lang)}${i.paymentMethod ? ` · ${t(`hub.billing.methods.${i.paymentMethod}`)}` : ''}${i.paymentReference ? ` · ${i.paymentReference}` : ''}` : '') },
    { key: 'reminders', header: t('hub.billing.reminders'), className: 'text-right', cell: (i) => i.remindersSent },
    {
      key: 'actions', header: <span className="sr-only">{t('hub.common.actions')}</span>, cell: (i) => (
        <div className="flex flex-wrap gap-2">
          {i.pdfAvailable ? <a href={`/api/v1${hubApi.platformBilling.invoicePdfPath(i.id)}`} target="_blank" rel="noopener" className={`rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-brand-ink hover:bg-brand-tint ${focus}`}>{t('hub.billing.pdf')}</a> : null}
          {onMarkPaid && (i.status === 'open' || i.status === 'past_due') ? <Action tone="secondary" onClick={() => onMarkPaid(i)}>{t('hub.billing.markPaid')}</Action> : null}
        </div>
      ),
    },
  ];
  return <DataTable caption={t('hub.billing.invoices')} columns={columns} rows={invoices} rowKey={(i) => i.id} empty={t('hub.billing.noInvoices')} />;
}
