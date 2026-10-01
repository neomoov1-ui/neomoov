'use client';

import { DRIVER_STATUSES, type AdminDriverListItem } from '@neomoov/domain';
import { useTranslation } from 'react-i18next';
import { EnumBadge, ErrorBlock, ListToolbar, Loading, pageLabels, useLang, usePagedList } from '@/components/hub/common';
import { OrgPage } from '@/components/hub/org-context';
import { Badge, Card, DataTable, PageTitle, Pagination, type Column } from '@/components/ui/kit';
import { formatDate } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

/** Étape 21 : chauffeurs de l'organisation et de ses sous-organisations (mêmes colonnes que la plateforme). */
export default function OrgDriversPage() {
  return <OrgPage permissions={['drivers.read']}>{(orgId) => <Drivers orgId={orgId} />}</OrgPage>;
}

function Drivers({ orgId }: { orgId: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const list = usePagedList<AdminDriverListItem>(`org-${orgId}-drivers`, (q) => hubApi.org.drivers(orgId, q));
  const columns: Column<AdminDriverListItem>[] = [
    { key: 'number', header: t('hub.drivers.number'), cell: (d) => <span className="font-semibold">{d.publicNumber}</span> },
    { key: 'name', header: t('hub.drivers.name'), cell: (d) => [d.firstName, d.lastName].filter(Boolean).join(' ') },
    { key: 'phone', header: t('hub.drivers.phone'), cell: (d) => d.phone ?? '' },
    { key: 'status', header: t('hub.drivers.status'), cell: (d) => <EnumBadge group="driverStatus" value={d.status} /> },
    { key: 'online', header: t('hub.drivers.online'), cell: (d) => (d.isOnline ? <Badge tone="success">{t('hub.common.yes')}</Badge> : t('hub.common.no')) },
    { key: 'docs', header: t('hub.drivers.docsPending'), className: 'text-right', cell: (d) => (d.documentsPending ? <Badge tone="warning">{d.documentsPending}</Badge> : 0) },
    { key: 'rating', header: t('hub.drivers.rating'), className: 'text-right', cell: (d) => (d.ratingCount ? `${d.rating.toFixed(2)} (${d.ratingCount})` : '') },
    { key: 'rides', header: t('hub.drivers.rides'), className: 'text-right', cell: (d) => d.rideCount },
    { key: 'since', header: t('hub.drivers.since'), cell: (d) => formatDate(d.createdAt, lang) },
  ];
  return (
    <div>
      <PageTitle title={t('org.nav.drivers')} />
      <Card>
        <ListToolbar filters={list.filters} setQ={list.setQ} setStatus={list.setStatus} statuses={DRIVER_STATUSES.map((s) => ({ value: s, label: t(`enum.driverStatus.${s}`) }))} />
        {list.query.isPending ? <Loading /> : list.query.isError ? <ErrorBlock error={list.query.error} onRetry={() => void list.query.refetch()} /> : (
          <>
            <DataTable caption={t('org.nav.drivers')} columns={columns} rows={list.query.data.items} rowKey={(d) => d.id} empty={t('hub.common.empty')} />
            <Pagination page={list.filters.page} pageSize={list.pageSize} total={list.query.data.total} onPage={list.setPage} labels={pageLabels(t, list.filters.page, list.pageSize, list.query.data.total)} />
          </>
        )}
      </Card>
    </div>
  );
}
