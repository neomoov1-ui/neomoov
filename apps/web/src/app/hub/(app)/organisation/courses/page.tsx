'use client';

import { RIDE_STATES, type AdminRideListItem } from '@neomoov/domain';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, ListToolbar, Loading, RideStateBadge, pageLabels, useLang, usePagedList } from '@/components/hub/common';
import { OrgPage, useOrg } from '@/components/hub/org-context';
import { Card, DataTable, PageTitle, Pagination, cx, focus, type Column } from '@/components/ui/kit';
import { formatDateTime, formatMoney } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

type View = 'active' | 'scheduled' | 'recent';
const VIEWS: View[] = ['active', 'scheduled', 'recent'];

/** Étape 21 : courses de l'organisation et de ses sous-organisations, mêmes vues, filtres et colonnes que la plateforme. */
export default function OrgRidesPage() {
  return <OrgPage permissions={['rides.read']}>{(orgId) => <Rides orgId={orgId} />}</OrgPage>;
}

function Rides({ orgId }: { orgId: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { can } = useOrg();
  const [view, setView] = useState<View>('active');
  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get('view');
    if (VIEWS.includes(initial as View)) setView(initial as View);
  }, []);
  const list = usePagedList<AdminRideListItem>(`org-${orgId}-rides-${view}`, (q) => hubApi.org.rides(orgId, { ...q, view, ...(q.status ? { state: q.status as AdminRideListItem['state'] } : {}) }));
  const columns: Column<AdminRideListItem>[] = [
    { key: 'number', header: t('hub.rides.number'), cell: (r) => <Link href={`/hub/organisation/courses/${r.id}`} className={`font-semibold text-brand-blue-dark underline ${focus}`}>{r.publicNumber}</Link> },
    { key: 'state', header: t('hub.rides.state'), cell: (r) => <RideStateBadge state={r.state} /> },
    { key: 'when', header: t('hub.rides.when'), cell: (r) => formatDateTime(r.requestedAt ?? r.createdAt, lang) },
    { key: 'route', header: t('hub.rides.route'), cell: (r) => <span className="block max-w-72"><span className="block truncate">{r.origin}</span><span className="block truncate text-slate-600">{r.destination}</span></span> },
    { key: 'client', header: t('hub.rides.client'), cell: (r) => r.clientName ?? '' },
    { key: 'driver', header: t('hub.rides.driver'), cell: (r) => (r.driverName ? <span>{r.driverName}<span className="block text-xs text-slate-600">{r.driverPublicNumber}</span></span> : <span className="text-slate-600">{t('hub.common.none')}</span>) },
    { key: 'price', header: t('hub.rides.price'), className: 'text-right', cell: (r) => formatMoney(r.finalPriceCents ?? r.quotedTotalCents, lang) },
    { key: 'payment', header: t('hub.rides.payment'), cell: (r) => t(`enum.paymentMethod.${r.paymentMethod}`) },
  ];
  return (
    <div>
      <PageTitle title={t('org.rides.title')} actions={can('rides.create') ? <Link href="/hub/organisation/courses/nouvelle" className={cx('rounded-md bg-brand-blue-dark px-3 py-2 text-sm font-semibold text-white hover:bg-brand-night', focus)}>{t('org.newRide.title')}</Link> : null} />
      <div role="tablist" aria-label={t('org.rides.title')} className="mb-3 flex gap-1">
        {VIEWS.map((v) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} className={cx('rounded-md px-3 py-1.5 text-sm font-semibold', focus, view === v ? 'bg-brand-night text-white' : 'bg-white text-brand-ink hover:bg-brand-tint')}>
            {t(`hub.rides.views.${v}`)}
          </button>
        ))}
      </div>
      <Card>
        <ListToolbar filters={list.filters} setQ={list.setQ} setStatus={list.setStatus} statuses={RIDE_STATES.map((s) => ({ value: s, label: t(`enum.rideState.${s}`) }))} />
        {list.query.isPending ? <Loading /> : list.query.isError ? <ErrorBlock error={list.query.error} onRetry={() => void list.query.refetch()} /> : (
          <>
            <DataTable caption={t('org.rides.title')} columns={columns} rows={list.query.data.items} rowKey={(r) => r.id} empty={t('hub.common.empty')} />
            <Pagination page={list.filters.page} pageSize={list.pageSize} total={list.query.data.total} onPage={list.setPage} labels={pageLabels(t, list.filters.page, list.pageSize, list.query.data.total)} />
          </>
        )}
      </Card>
    </div>
  );
}
