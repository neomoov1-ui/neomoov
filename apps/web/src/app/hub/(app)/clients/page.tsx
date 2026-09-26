'use client';

import type { AdminClient } from '@neomoov/domain';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, ListToolbar, Loading, pageLabels, useLang, usePagedList } from '@/components/hub/common';
import { Card, DataTable, PageTitle, Pagination, type Column } from '@/components/ui/kit';
import { formatDate, fullName } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

export default function ClientsPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const list = usePagedList<AdminClient>('clients', (q) => hubApi.admin.clients(q));
  const columns: Column<AdminClient>[] = [
    { key: 'name', header: t('hub.clients.name'), cell: (c) => fullName(c.firstName, c.lastName) },
    { key: 'phone', header: t('hub.clients.phone'), cell: (c) => c.phone ?? '' },
    { key: 'email', header: t('hub.clients.email'), cell: (c) => c.email ?? '' },
    { key: 'rides', header: t('hub.clients.rides'), className: 'text-right', cell: (c) => c.rideCount },
    { key: 'status', header: t('hub.common.status'), cell: (c) => c.status },
    { key: 'since', header: t('hub.clients.since'), cell: (c) => formatDate(c.createdAt, lang) },
  ];
  return (
    <div>
      <PageTitle title={t('hub.clients.title')} />
      <Card>
        <ListToolbar filters={list.filters} setQ={list.setQ} />
        {list.query.isPending ? <Loading /> : list.query.isError ? <ErrorBlock error={list.query.error} onRetry={() => void list.query.refetch()} /> : (
          <>
            <DataTable caption={t('hub.clients.title')} columns={columns} rows={list.query.data.items} rowKey={(c) => c.id} empty={t('hub.common.empty')} />
            <Pagination page={list.filters.page} pageSize={list.pageSize} total={list.query.data.total} onPage={list.setPage} labels={pageLabels(t, list.filters.page, list.pageSize, list.query.data.total)} />
          </>
        )}
      </Card>
    </div>
  );
}
