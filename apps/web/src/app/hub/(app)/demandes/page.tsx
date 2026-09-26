'use client';

import type { AdminDataRequest } from '@neomoov/domain';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, ListToolbar, Loading, pageLabels, useLang, usePagedList } from '@/components/hub/common';
import { Badge, Card, DataTable, PageTitle, Pagination, type Column } from '@/components/ui/kit';
import { formatDate, formatDateTime } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

const TONES = { open: 'warning', overdue: 'danger', done: 'success' } as const;

/** Demandes de droits (Loi 25) : échéance de 30 jours, retards signalés, suite donnée. */
export default function DataRequestsPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const list = usePagedList<AdminDataRequest>('data-requests', (q) => hubApi.admin.dataRequests(q));
  const columns: Column<AdminDataRequest>[] = [
    { key: 'type', header: t('hub.dataRequests.type'), cell: (r) => t(`rights.types.${r.type}`, { defaultValue: r.type }) },
    { key: 'status', header: t('hub.common.status'), cell: (r) => <Badge tone={TONES[r.status]}>{t(`hub.dataRequests.statuses.${r.status}`)}</Badge> },
    { key: 'received', header: t('hub.dataRequests.received'), cell: (r) => formatDateTime(r.receivedAt, lang) },
    { key: 'due', header: t('hub.dataRequests.due'), cell: (r) => formatDate(r.dueOn, lang) },
    { key: 'processed', header: t('hub.dataRequests.processed'), cell: (r) => formatDateTime(r.processedAt, lang) },
    { key: 'outcome', header: t('hub.dataRequests.outcome'), cell: (r) => <span className="text-xs">{r.outcome ?? ''}</span> },
    { key: 'user', header: 'ID', cell: (r) => <code className="text-xs">{r.userId.slice(0, 8)}</code> },
  ];
  return (
    <div>
      <PageTitle title={t('hub.dataRequests.title')} />
      <Card>
        <ListToolbar filters={list.filters} setQ={list.setQ} setStatus={list.setStatus} statuses={(['open', 'overdue', 'done'] as const).map((s) => ({ value: s, label: t(`hub.dataRequests.statuses.${s}`) }))} />
        {list.query.isPending ? <Loading /> : list.query.isError ? <ErrorBlock error={list.query.error} onRetry={() => void list.query.refetch()} /> : (
          <>
            <DataTable caption={t('hub.dataRequests.title')} columns={columns} rows={list.query.data.items} rowKey={(r) => r.id} empty={t('hub.common.empty')} />
            <Pagination page={list.filters.page} pageSize={list.pageSize} total={list.query.data.total} onPage={list.setPage} labels={pageLabels(t, list.filters.page, list.pageSize, list.query.data.total)} />
          </>
        )}
      </Card>
    </div>
  );
}
