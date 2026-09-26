'use client';

import type { FailedJobView } from '@neomoov/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading, useCanWrite, useErrorText, useLang } from '@/components/hub/common';
import { Action, Card, DataTable, Notice, PageTitle, type Column } from '@/components/ui/kit';
import { formatDateTime } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

type QueueRow = { name: string; waiting: number; active: number; failed: number };

/** Files de tâches (prompt 15, tâche 5) : état, tâches en échec et relance, après une panne de fournisseur. */
export default function QueuesPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const writable = useCanWrite();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const stats = useQuery({ queryKey: ['hub', 'queues'], queryFn: () => hubApi.admin.queues(), refetchInterval: 15_000 });
  const failed = useQuery({ queryKey: ['hub', 'queues', selected], queryFn: () => hubApi.admin.failedJobs(selected!), enabled: selected !== null });
  const retry = useMutation({
    mutationFn: (jobId?: string) => hubApi.admin.retryJobs(selected!, jobId),
    onSuccess: (data) => {
      setNotice(t('hub.queues.retried', { count: data.retried }));
      void queryClient.invalidateQueries({ queryKey: ['hub', 'queues'] });
    },
  });
  const columns: Column<QueueRow>[] = [
    { key: 'name', header: t('hub.queues.name'), cell: (q) => <code>{q.name}</code> },
    { key: 'waiting', header: t('hub.queues.waiting'), className: 'text-right', cell: (q) => q.waiting },
    { key: 'active', header: t('hub.queues.active'), className: 'text-right', cell: (q) => q.active },
    { key: 'failed', header: t('hub.queues.failed'), className: 'text-right font-semibold', cell: (q) => q.failed },
    { key: 'show', header: '', cell: (q) => (q.failed > 0 ? <Action tone="secondary" onClick={() => { setSelected(q.name); setNotice(null); }}>{t('hub.queues.showFailed')}</Action> : null) },
  ];
  const failedColumns: Column<FailedJobView>[] = [
    { key: 'job', header: t('hub.queues.job'), cell: (j) => <span className="text-xs"><code>{j.name}</code><br />{j.id}</span> },
    { key: 'reason', header: t('hub.queues.reason'), cell: (j) => <span className="block max-w-96 whitespace-pre-wrap text-xs">{j.failedReason ?? ''}</span> },
    { key: 'attempts', header: t('hub.queues.attempts'), className: 'text-right', cell: (j) => j.attempts },
    { key: 'failedAt', header: t('hub.queues.failedAt'), cell: (j) => (j.failedAt ? formatDateTime(j.failedAt, lang) : '') },
    ...(writable ? [{ key: 'retry', header: '', cell: (j: FailedJobView) => <Action tone="secondary" busy={retry.isPending && retry.variables === j.id} onClick={() => retry.mutate(j.id)}>{t('hub.queues.retry')}</Action> }] : []),
  ];
  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={t('hub.queues.title')} subtitle={stats.data ? t('hub.queues.mode', { mode: stats.data.mode }) : undefined} />
      <Notice tone="info">{t('hub.queues.intro')}</Notice>
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {retry.isError ? <Notice tone="danger">{errorText(retry.error)}</Notice> : null}
      <Card>
        {stats.isPending ? <Loading /> : stats.isError ? <ErrorBlock error={stats.error} onRetry={() => void stats.refetch()} /> : (
          <DataTable caption={t('hub.queues.title')} columns={columns} rows={stats.data.queues} rowKey={(q) => q.name} empty={t('hub.common.empty')} />
        )}
      </Card>
      {selected ? (
        <Card title={<code>{selected}</code>} actions={writable ? <Action busy={retry.isPending && retry.variables === undefined} onClick={() => retry.mutate(undefined)}>{t('hub.queues.retryAll')}</Action> : null}>
          {failed.isPending ? <Loading /> : failed.isError ? <ErrorBlock error={failed.error} onRetry={() => void failed.refetch()} /> : (
            <DataTable caption={selected} columns={failedColumns} rows={failed.data} rowKey={(j) => j.id} empty={t('hub.queues.noFailed')} />
          )}
        </Card>
      ) : null}
    </div>
  );
}
