'use client';

import type { AdminApproval } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EnumBadge, ErrorBlock, ListToolbar, Loading, pageLabels, useCanWrite, useErrorText, useLang, usePagedList } from '@/components/hub/common';
import { Action, Badge, Card, DataTable, Field, Input, Notice, PageTitle, Pagination, type Column } from '@/components/ui/kit';
import { formatDateTime } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

/** Agents IA (lecture) et file d'approbation des actions proposées ; branchement complet des agents à l'étape 13. */
export default function AgentsPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const writable = useCanWrite();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const agents = useQuery({ queryKey: ['hub', 'agents'], queryFn: () => hubApi.admin.agents() });
  const list = usePagedList<AdminApproval>('approvals', (q) => hubApi.admin.approvals(q), 25, 'pending');
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approved' | 'rejected' }) => hubApi.admin.decideApproval(id, { decision, ...(notes[id]?.trim() ? { note: notes[id]!.trim() } : {}) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hub', 'approvals'] });
      void queryClient.invalidateQueries({ queryKey: ['hub', 'agents'] });
    },
  });
  const columns: Column<AdminApproval>[] = [
    { key: 'created', header: t('hub.common.from'), cell: (a) => formatDateTime(a.createdAt, lang) },
    { key: 'agent', header: t('hub.agents.agent'), cell: (a) => a.agentCode ?? '' },
    { key: 'action', header: t('hub.agents.action'), cell: (a) => <span className="block max-w-72"><strong>{a.proposedAction}</strong><pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-slate-100 p-1 text-[11px]">{JSON.stringify(a.data, null, 1)}</pre></span> },
    { key: 'why', header: t('hub.agents.justification'), cell: (a) => <span className="block max-w-72 text-xs">{a.justification ?? ''}</span> },
    { key: 'decision', header: t('hub.common.status'), cell: (a) => <EnumBadge group="approval" value={a.decision} /> },
    ...(writable ? [{
      key: 'act', header: t('hub.common.actions'), cell: (a: AdminApproval) => a.decision !== 'pending' ? null : (
        <div className="flex min-w-48 flex-col gap-2">
          <Field label={t('hub.common.note')}>{(p) => <Input {...p} maxLength={500} value={notes[a.id] ?? ''} onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })} />}</Field>
          <div className="flex gap-2">
            <Action busy={decide.isPending && decide.variables?.id === a.id} onClick={() => decide.mutate({ id: a.id, decision: 'approved' })}>{t('hub.agents.approve')}</Action>
            <Action tone="danger" onClick={() => decide.mutate({ id: a.id, decision: 'rejected' })}>{t('hub.agents.reject')}</Action>
          </div>
        </div>
      ),
    }] : []),
  ];
  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={t('hub.agents.title')} subtitle={t('hub.agents.wiring')} />
      <Card>
        {agents.isPending ? <Loading /> : agents.isError ? <ErrorBlock error={agents.error} /> : (
          <DataTable
            rows={agents.data}
            rowKey={(a) => a.code}
            empty={t('hub.common.empty')}
            columns={[
              { key: 'name', header: t('hub.agents.agent'), cell: (a) => <span>{a.name}<span className="block text-xs text-slate-600">{a.code}</span></span> },
              { key: 'mode', header: t('hub.agents.mode'), cell: (a) => <Badge tone="info">{a.mode}</Badge> },
              { key: 'model', header: t('hub.agents.model'), cell: (a) => <code className="text-xs">{a.model}</code> },
              { key: 'effort', header: t('hub.agents.effort'), cell: (a) => a.effort },
              { key: 'runs', header: t('hub.agents.runs'), className: 'text-right', cell: (a) => a.runs7d },
              { key: 'pending', header: t('hub.agents.pending'), className: 'text-right', cell: (a) => (a.pendingApprovals ? <Badge tone="warning">{a.pendingApprovals}</Badge> : 0) },
            ]}
          />
        )}
      </Card>
      <Card title={t('hub.agents.approvals')}>
        {decide.isError ? <div className="mb-3"><Notice tone="danger">{errorText(decide.error)}</Notice></div> : null}
        {decide.isSuccess ? <div className="mb-3"><Notice tone="success">{t('hub.agents.decided')}</Notice></div> : null}
        <ListToolbar allowAll={false} filters={list.filters} setQ={list.setQ} setStatus={list.setStatus} statuses={(['pending', 'approved', 'rejected'] as const).map((s) => ({ value: s, label: t(`enum.approval.${s}`) }))} />
        {list.query.isPending ? <Loading /> : list.query.isError ? <ErrorBlock error={list.query.error} onRetry={() => void list.query.refetch()} /> : (
          <>
            <DataTable caption={t('hub.agents.approvals')} columns={columns} rows={list.query.data.items} rowKey={(a) => a.id} empty={t('hub.common.empty')} />
            <Pagination page={list.filters.page} pageSize={list.pageSize} total={list.query.data.total} onPage={list.setPage} labels={pageLabels(t, list.filters.page, list.pageSize, list.query.data.total)} />
          </>
        )}
      </Card>
    </div>
  );
}
