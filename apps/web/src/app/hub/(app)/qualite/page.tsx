'use client';

import type { QualityReviewView, QualityRunResult } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading, useCanWrite, useErrorText } from '@/components/hub/common';
import { Action, Badge, Card, Checkbox, DataTable, Notice, PageTitle, focus, type Column } from '@/components/ui/kit';
import { hubApi } from '@/lib/hub-api';

const RANK = { warning: 1, restriction: 2, suspension: 3 } as const;

/** Qualité des chauffeurs (5.11) : mesures, sanction proposée par la règle, couverture ; passe de l'agent à la demande. */
export default function QualityPage() {
  const { t } = useTranslation();
  const writable = useCanWrite();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [onlyFlagged, setOnlyFlagged] = useState(true);
  const [result, setResult] = useState<QualityRunResult | null>(null);
  const review = useQuery({ queryKey: ['hub', 'quality'], queryFn: () => hubApi.admin.quality() });
  const run = useMutation({
    mutationFn: () => hubApi.admin.runQuality(),
    onSuccess: (data) => {
      setResult(data);
      void queryClient.invalidateQueries({ queryKey: ['hub', 'quality'] });
    },
  });
  const type = (value: keyof typeof RANK | null) => (value ? t(`hub.quality.types.${value}`) : t('hub.quality.none'));
  const tone = (value: keyof typeof RANK | null) => (value === 'suspension' ? 'danger' : value === 'restriction' ? 'warning' : value === 'warning' ? 'info' : 'neutral');
  const columns: Column<QualityReviewView>[] = [
    { key: 'driver', header: t('hub.quality.driver'), cell: (r) => <Link className={`text-brand-blue-dark underline ${focus}`} href={`/hub/chauffeurs/${r.driverId}`}>{r.name ?? r.publicNumber}</Link> },
    { key: 'status', header: t('hub.quality.status'), cell: (r) => r.status },
    { key: 'rating', header: t('hub.quality.rating'), className: 'text-right', cell: (r) => (r.metrics.ratingAverage === null ? '—' : `${r.metrics.ratingAverage.toFixed(2)} (${r.metrics.ratingCount})`) },
    { key: 'late', header: t('hub.quality.late'), className: 'text-right', cell: (r) => r.metrics.lateCancellations7d },
    { key: 'incidents', header: t('hub.quality.incidents'), className: 'text-right', cell: (r) => r.metrics.seriousIncidents },
    { key: 'proposal', header: t('hub.quality.proposal'), cell: (r) => <Badge tone={tone(r.proposal?.type ?? null)}>{type(r.proposal?.type ?? null)}</Badge> },
    { key: 'coverage', header: t('hub.quality.coverage'), cell: (r) => (r.pendingApproval ? <Link className={`text-brand-blue-dark underline ${focus}`} href="/hub/agents">{t('hub.quality.pending')}</Link> : type(r.covered)) },
  ];
  const rows = (review.data ?? [])
    .filter((r) => !onlyFlagged || r.proposal || r.covered)
    .sort((a, b) => (RANK[b.proposal?.type ?? 'warning'] * (b.proposal ? 1 : 0)) - (RANK[a.proposal?.type ?? 'warning'] * (a.proposal ? 1 : 0)));
  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={t('hub.quality.title')} actions={writable ? <Action busy={run.isPending} onClick={() => run.mutate()}>{t('hub.quality.run')}</Action> : null} />
      <Notice tone="info">{t('hub.quality.intro')}</Notice>
      {run.isError ? <Notice tone="danger">{errorText(run.error)}</Notice> : null}
      {result ? <Notice tone="success">{t('hub.quality.runDone', { evaluated: result.evaluated, proposed: result.proposed, reinstated: result.reinstated })}</Notice> : null}
      <Card actions={<Checkbox label={t('hub.quality.onlyFlagged')} checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />}>
        {review.isPending ? <Loading /> : review.isError ? <ErrorBlock error={review.error} onRetry={() => void review.refetch()} /> : (
          <DataTable caption={t('hub.quality.title')} columns={columns} rows={rows} rowKey={(r) => r.driverId} empty={t('hub.common.empty')} />
        )}
      </Card>
    </div>
  );
}
