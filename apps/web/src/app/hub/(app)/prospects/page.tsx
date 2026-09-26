'use client';

import type { AdminLead, LeadStatus } from '@neomoov/domain';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, ListToolbar, Loading, pageLabels, useCanWrite, useErrorText, useLang, usePagedList } from '@/components/hub/common';
import { Badge, Card, DataTable, Notice, PageTitle, Pagination, Select, type Column } from '@/components/ui/kit';
import { formatDateTime, fullName } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

const STATUSES: LeadStatus[] = ['new', 'contacted', 'converted', 'discarded'];

/** Prospects reçus par l'API publique (préinscriptions de chauffeurs, entreprises, partenaires) et leur suivi. */
export default function LeadsPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const writable = useCanWrite();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const list = usePagedList<AdminLead>('leads', (q) => hubApi.admin.leads(q));
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: LeadStatus }) => hubApi.admin.setLeadStatus(id, status),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['hub', 'leads'] }),
  });
  const columns: Column<AdminLead>[] = [
    { key: 'received', header: t('hub.leads.received'), cell: (l) => formatDateTime(l.createdAt, lang) },
    { key: 'kind', header: t('hub.leads.kind'), cell: (l) => <Badge tone="info">{t(`enum.leadKind.${l.kind}`)}</Badge> },
    { key: 'name', header: t('hub.clients.name'), cell: (l) => fullName(l.firstName, l.lastName) },
    { key: 'contact', header: t('hub.leads.contact'), cell: (l) => <span>{l.phone ?? ''}<span className="block text-xs text-slate-600">{l.email ?? ''}</span></span> },
    { key: 'city', header: t('hub.leads.city'), cell: (l) => l.city ?? '' },
    { key: 'message', header: t('hub.leads.message'), cell: (l) => <span className="block max-w-72 whitespace-pre-wrap text-xs">{l.message ?? ''}</span> },
    { key: 'source', header: t('hub.leads.source'), cell: (l) => l.source },
    {
      key: 'status',
      header: t('hub.common.status'),
      cell: (l) => writable ? (
        <Select aria-label={t('hub.common.status')} value={l.status} onChange={(e) => update.mutate({ id: l.id, status: e.target.value as LeadStatus })} className="min-w-32">
          {STATUSES.map((s) => <option key={s} value={s}>{t(`enum.leadStatus.${s}`)}</option>)}
        </Select>
      ) : t(`enum.leadStatus.${l.status}`),
    },
  ];
  return (
    <div>
      <PageTitle title={t('hub.leads.title')} />
      {update.isError ? <div className="mb-3"><Notice tone="danger">{errorText(update.error)}</Notice></div> : null}
      <Card>
        <ListToolbar filters={list.filters} setQ={list.setQ} setStatus={list.setStatus} statuses={STATUSES.map((s) => ({ value: s, label: t(`enum.leadStatus.${s}`) }))} />
        {list.query.isPending ? <Loading /> : list.query.isError ? <ErrorBlock error={list.query.error} onRetry={() => void list.query.refetch()} /> : (
          <>
            <DataTable caption={t('hub.leads.title')} columns={columns} rows={list.query.data.items} rowKey={(l) => l.id} empty={t('hub.common.empty')} />
            <Pagination page={list.filters.page} pageSize={list.pageSize} total={list.query.data.total} onPage={list.setPage} labels={pageLabels(t, list.filters.page, list.pageSize, list.query.data.total)} />
          </>
        )}
      </Card>
    </div>
  );
}
