'use client';

import type { BillingRunReport, PlatformPlanView } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BillingOverviewView } from '@/components/hub/billing-overview';
import { ErrorBlock, Loading, useErrorText, useLang } from '@/components/hub/common';
import { Action, Card, DataTable, Field, Input, Notice, PageTitle, type Column } from '@/components/ui/kit';
import { formatMoney } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';
import type { Language } from '@/lib/i18n-resources';

/**
 * Facturation de la plateforme (étape 25) : vue d'ensemble (revenu mensuel récurrent, abonnements par statut, impayés,
 * lectures seules et suspensions à venir), formules, et cycle quotidien lancé à la demande. L'abonnement et les factures
 * d'une organisation se gèrent dans « Organisations et accès ». Personnel de la plateforme seulement.
 */
export default function PlatformBillingPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [horizon, setHorizon] = useState(14);
  const overview = useQuery({ queryKey: ['hub', 'billing', 'overview', horizon], queryFn: () => hubApi.platformBilling.overview(horizon) });
  const plans = useQuery({ queryKey: ['hub', 'billing', 'plans'], queryFn: () => hubApi.platformBilling.plans() });
  const [report, setReport] = useState<BillingRunReport | null>(null);
  const run = useMutation({
    mutationFn: () => hubApi.platformBilling.run(),
    onSuccess: (r) => {
      setReport(r);
      void queryClient.invalidateQueries({ queryKey: ['hub', 'billing'] });
    },
  });
  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={t('hub.billing.title')} actions={<Action busy={run.isPending} onClick={() => run.mutate()}>{t('hub.billing.run')}</Action>} />
      <Notice tone="info">{t('hub.billing.intro')}</Notice>
      <p className="text-sm text-slate-700">{t('hub.billing.runHint')}</p>
      {run.isError ? <Notice tone="danger">{errorText(run.error)}</Notice> : null}
      {report ? <Notice tone={report.errors ? 'warning' : 'success'}>{t('hub.billing.runDone', { issued: report.invoicesIssued, reminders: report.reminders, readOnly: report.readOnly, suspended: report.suspended, reactivated: report.reactivated, errors: report.errors })}</Notice> : null}
      <Card title={t('hub.billing.overview')} actions={(
        <Field label={t('hub.billing.horizon')}>{(p) => <Input {...p} type="number" min={1} max={90} className="w-28" value={horizon} onChange={(e) => setHorizon(Math.max(1, Math.min(90, Number(e.target.value) || 14)))} />}</Field>
      )}>
        {overview.isPending ? <Loading /> : overview.isError ? <ErrorBlock error={overview.error} onRetry={() => void overview.refetch()} /> : <BillingOverviewView overview={overview.data} lang={lang} />}
      </Card>
      <Card title={t('hub.billing.plans')}>
        {plans.isPending ? <Loading /> : plans.isError ? <ErrorBlock error={plans.error} onRetry={() => void plans.refetch()} /> : <PlansTable plans={plans.data} lang={lang} />}
      </Card>
    </div>
  );
}

function PlansTable({ plans, lang }: { plans: PlatformPlanView[]; lang: Language }) {
  const { t } = useTranslation();
  const columns: Column<PlatformPlanView>[] = [
    { key: 'plan', header: t('hub.billing.plan'), cell: (p) => <span><span className="font-semibold">{p.name}</span> <code className="text-xs">{p.code}</code></span> },
    { key: 'monthly', header: t('hub.billing.monthly'), className: 'text-right', cell: (p) => formatMoney(p.monthlyPriceCents, lang) },
    { key: 'annual', header: t('hub.billing.annual'), className: 'text-right', cell: (p) => formatMoney(p.annualPriceCents, lang) },
    { key: 'setup', header: t('hub.billing.setupFee'), className: 'text-right', cell: (p) => formatMoney(p.setupFeeCents, lang) },
    { key: 'vehicle', header: t('hub.billing.perVehicle'), className: 'text-right', cell: (p) => formatMoney(p.perActiveVehicleCents, lang) },
    { key: 'included', header: t('hub.billing.includedVehicles'), className: 'text-right', cell: (p) => p.includedVehicles },
    { key: 'modules', header: t('hub.billing.modules'), cell: (p) => <span className="block max-w-72 text-xs">{p.modules.join(', ')}</span> },
    { key: 'active', header: t('hub.billing.active'), cell: (p) => (p.active ? t('hub.common.yes') : t('hub.common.no')) },
  ];
  return <DataTable caption={t('hub.billing.plans')} columns={columns} rows={plans} rowKey={(p) => p.code} empty={t('hub.common.empty')} />;
}
