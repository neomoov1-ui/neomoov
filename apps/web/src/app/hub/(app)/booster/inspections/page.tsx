'use client';

import type { AdminInspectionView, MissingInspectionView } from '@neomoov/domain';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnalysisBadge, analysisRefetchInterval, PendingAnalysisNotice } from '@/components/hub/booster-analysis';
import { ErrorBlock, Loading, pageLabels, useLang } from '@/components/hub/common';
import { Action, Badge, Card, Checkbox, DataTable, Field, Input, Notice, PageTitle, Pagination, focus, type Column } from '@/components/ui/kit';
import { formatDateTime } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

const PAGE_SIZE = 25;
const SEVERITY_TONE = { ok: 'success', minor: 'warning', major: 'danger' } as const;

/**
 * Neomoov Booster (phase 1, agent G) : rapports de vérification sommaire par chauffeur et par jour (filtre : gravité
 * majeure), chauffeurs en ligne sans rapport du jour, export CSV. Le détail (photos, PDF) est sur la page du rapport.
 * Tant qu'une analyse de la page est en cours (file `agents`), la liste se relit d'elle-même.
 */
export default function InspectionsPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const params = useSearchParams();
  const [driverId, setDriverId] = useState(params.get('driverId') ?? '');
  const [date, setDate] = useState('');
  const [majorOnly, setMajorOnly] = useState(false);
  const [page, setPage] = useState(1);
  const query = { page, pageSize: PAGE_SIZE, majorOnly, ...(driverId.trim() ? { driverId: driverId.trim() } : {}), ...(date ? { date } : {}) };
  const list = useQuery({
    queryKey: ['hub', 'booster-inspections', query],
    queryFn: () => hubApi.admin.boosterInspections(query),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => analysisRefetchInterval(q.state.data?.items.map((i) => i.analysis.status)),
  });
  const missing = useQuery({ queryKey: ['hub', 'booster-missing'], queryFn: () => hubApi.admin.boosterMissingToday(), refetchInterval: 60_000 });
  const columns: Column<AdminInspectionView>[] = [
    { key: 'date', header: t('hub.booster.date'), cell: (i) => <Link href={`/hub/booster/inspections/${i.id}`} className={`text-brand-blue-dark underline ${focus}`}>{formatDateTime(i.inspectedAt, lang)}</Link> },
    { key: 'driver', header: t('hub.booster.driver'), cell: (i) => <Link href={`/hub/chauffeurs/${i.driverId}`} className={`underline ${focus}`}>{i.driverFullName ?? i.driverPublicNumber} · {i.driverPublicNumber}</Link> },
    { key: 'plate', header: t('hub.booster.plate'), cell: (i) => i.plate ?? '' },
    { key: 'odometer', header: t('hub.booster.odometer'), className: 'text-right', cell: (i) => (i.odometerKm !== null ? `${i.odometerKm.toLocaleString(lang)} km` : '') },
    { key: 'severity', header: t('hub.booster.severity'), cell: (i) => <Badge tone={SEVERITY_TONE[i.severity]}>{t(`hub.booster.severities.${i.severity}`)}</Badge> },
    { key: 'status', header: t('hub.booster.status'), cell: (i) => t(`hub.booster.statuses.${i.status}`) },
    { key: 'analysis', header: t('hub.booster.analysis'), cell: (i) => <AnalysisBadge status={i.analysis.status} /> },
    { key: 'photos', header: t('hub.booster.photos'), className: 'text-right', cell: (i) => i.photos.length },
    { key: 'archived', header: t('hub.booster.archivedAt'), cell: (i) => (i.archivedAt ? formatDateTime(i.archivedAt, lang) : '') },
  ];
  const missingColumns: Column<MissingInspectionView>[] = [
    { key: 'driver', header: t('hub.booster.driver'), cell: (m) => <Link href={`/hub/chauffeurs/${m.driverId}`} className={`text-brand-blue-dark underline ${focus}`}>{m.driverFullName ?? m.driverPublicNumber} · {m.driverPublicNumber}</Link> },
  ];
  const exportUrl = `/api/v1/admin/booster/inspections/export.csv${driverId.trim() ? `?driverId=${encodeURIComponent(driverId.trim())}` : ''}`;
  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={t('hub.booster.inspectionsTitle')} actions={<a href={exportUrl} className={`rounded-md border border-slate-300 px-3 py-2 text-sm ${focus}`}>{t('hub.booster.exportCsv')}</a>} />
      <Notice tone="info">{t('hub.booster.intro')}</Notice>
      <Card title={t('hub.booster.missingTitle')}>
        <p className="mb-2 text-sm text-slate-600">{t('hub.booster.missingIntro')}</p>
        {missing.isPending ? <Loading /> : missing.isError ? <ErrorBlock error={missing.error} onRetry={() => void missing.refetch()} /> : (
          <DataTable caption={t('hub.booster.missingTitle')} columns={missingColumns} rows={missing.data} rowKey={(m) => m.driverId} empty={t('hub.booster.missingNone')} />
        )}
      </Card>
      <Card
        title={t('hub.booster.inspections')}
        actions={(
          <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => e.preventDefault()}>
            <Field label={t('hub.booster.driverFilter')}>{(p) => <Input {...p} value={driverId} onChange={(e) => { setDriverId(e.target.value); setPage(1); }} placeholder={t('hub.booster.allDrivers')} className="w-72 font-mono text-xs" />}</Field>
            <Field label={t('hub.booster.dayFilter')}>{(p) => <Input {...p} type="date" value={date} onChange={(e) => { setDate(e.target.value); setPage(1); }} />}</Field>
            <Checkbox label={t('hub.booster.majorOnly')} checked={majorOnly} onChange={(e) => { setMajorOnly(e.target.checked); setPage(1); }} />
            <Action tone="secondary" onClick={() => { setDriverId(''); setDate(''); setMajorOnly(false); setPage(1); }}>{t('hub.booster.clear')}</Action>
          </form>
        )}
      >
        {list.isPending ? <Loading /> : list.isError ? <ErrorBlock error={list.error} onRetry={() => void list.refetch()} /> : (
          <>
            <PendingAnalysisNotice count={list.data.items.filter((i) => i.analysis.status === 'pending').length} />
            <DataTable caption={t('hub.booster.inspectionsTitle')} columns={columns} rows={list.data.items} rowKey={(i) => i.id} empty={t('hub.common.empty')} />
            <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} labels={pageLabels(t, page, PAGE_SIZE, list.data.total)} />
          </>
        )}
      </Card>
    </div>
  );
}
