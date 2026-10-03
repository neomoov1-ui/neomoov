'use client';

/** Facturation de la plateforme (étape 25) : vue d'ensemble, partagée par la page et les tests de rendu. */
import { SUBSCRIPTION_STATUSES, type BillingOverview } from '@neomoov/domain';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { Badge, DataTable, Stat, focus, type Column } from '@/components/ui/kit';
import { formatDate, formatMoney } from '@/lib/format';
import type { Language } from '@/lib/i18n-resources';

/** Revenu mensuel récurrent, impayés, abonnements par statut, lectures seules et suspensions à venir. */
export function BillingOverviewView({ overview: o, lang }: { overview: BillingOverview; lang: Language }) {
  const { t } = useTranslation();
  const columns: Column<BillingOverview['upcoming'][number]>[] = [
    { key: 'org', header: t('hub.billing.organization'), cell: (u) => <Link href="/hub/organisations" className={`text-brand-blue-dark underline ${focus}`}>{u.organizationName}</Link> },
    { key: 'invoice', header: t('hub.billing.invoice'), cell: (u) => <code>{u.invoiceNumber}</code> },
    { key: 'total', header: t('hub.billing.total'), className: 'text-right', cell: (u) => formatMoney(u.totalCents, lang) },
    { key: 'due', header: t('hub.billing.dueAt'), cell: (u) => formatDate(u.dueAt, lang) },
    { key: 'late', header: t('hub.billing.daysOverdue'), className: 'text-right', cell: (u) => u.daysOverdue },
    { key: 'next', header: t('hub.billing.nextAction'), cell: (u) => <Badge tone={u.nextAction === 'suspend' ? 'danger' : 'warning'}>{t(`hub.billing.nextActions.${u.nextAction}`)}</Badge> },
    { key: 'at', header: t('hub.billing.at'), cell: (u) => formatDate(u.at, lang) },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label={t('hub.billing.mrr')} value={formatMoney(o.monthlyRecurringRevenueCents, lang)} />
        <Stat label={t('hub.billing.unpaid')} value={o.unpaid.count} tone={o.unpaid.count ? 'warning' : undefined} />
        <Stat label={t('hub.billing.unpaidAmount')} value={formatMoney(o.unpaid.totalCents, lang)} />
        <Stat label={t('hub.billing.overdue')} value={o.unpaid.overdueCount} tone={o.unpaid.overdueCount ? 'danger' : undefined} />
        <Stat label={t('hub.billing.overdueAmount')} value={formatMoney(o.unpaid.overdueCents, lang)} />
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-brand-ink">{t('hub.billing.byStatus')}</h3>
        <ul className="flex flex-wrap gap-2 text-sm">
          {SUBSCRIPTION_STATUSES.map((s) => <li key={s}><Badge tone="neutral">{`${t(`hub.billing.statuses.${s}`)} : ${o.subscriptions[s] ?? 0}`}</Badge></li>)}
        </ul>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-brand-ink">{t('hub.billing.upcoming')}</h3>
        <DataTable caption={t('hub.billing.upcoming')} columns={columns} rows={o.upcoming} rowKey={(u) => `${u.invoiceId}-${u.nextAction}`} empty={t('hub.billing.noneUpcoming')} />
      </div>
    </div>
  );
}
