'use client';

import type { AdminPerformanceLogView } from '@neomoov/domain';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnalysisBadge, analysisRefetchInterval, PendingAnalysisNotice } from '@/components/hub/booster-analysis';
import { ErrorBlock, Loading, pageLabels, useLang } from '@/components/hub/common';
import { Action, Card, DataTable, Field, Input, Notice, PageTitle, Pagination, Select, Stat, focus, type Column } from '@/components/ui/kit';
import { formatDate, formatMoney } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

const PAGE_SIZE = 25;

/**
 * Neomoov Booster (phase 1, agent G) : rapports de performance des chauffeurs (liste, PDF) et récapitulatif par chauffeur.
 * Tant qu'une lecture des captures de la page est en cours (file `agents`), la liste se relit d'elle-même.
 */
export default function PerformancePage() {
  const { t } = useTranslation();
  const lang = useLang();
  const params = useSearchParams();
  const [driverId, setDriverId] = useState(params.get('driverId') ?? '');
  const [page, setPage] = useState(1);
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [date, setDate] = useState('');
  const trimmed = driverId.trim();
  const list = useQuery({
    queryKey: ['hub', 'booster-performance', trimmed, page],
    queryFn: () => hubApi.admin.boosterPerformanceLogs({ page, pageSize: PAGE_SIZE, ...(trimmed ? { driverId: trimmed } : {}) }),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => analysisRefetchInterval(q.state.data?.items.map((l) => l.reading.status)),
  });
  const recap = useQuery({ queryKey: ['hub', 'booster-recap', trimmed, period, date], queryFn: () => hubApi.admin.boosterPerformanceRecap({ driverId: trimmed, period, ...(date ? { date } : {}) }), enabled: trimmed.length === 36 });
  const money = (cents: number | null) => (cents === null ? '' : formatMoney(cents, lang));
  const columns: Column<AdminPerformanceLogView>[] = [
    { key: 'date', header: t('hub.booster.date'), cell: (l) => formatDate(l.date, lang) },
    { key: 'driver', header: t('hub.booster.driver'), cell: (l) => <Link href={`/hub/chauffeurs/${l.driverId}`} className={`underline ${focus}`}>{l.driverFullName ?? l.driverPublicNumber} · {l.driverPublicNumber}</Link> },
    { key: 'status', header: t('hub.booster.status'), cell: (l) => t(`hub.booster.statuses.${l.status}`) },
    { key: 'source', header: t('hub.booster.source'), cell: (l) => t(`hub.booster.sources.${l.source}`) },
    { key: 'reading', header: t('hub.booster.reading'), cell: (l) => <AnalysisBadge status={l.reading.status} /> },
    { key: 'minutes', header: t('hub.booster.minutes'), className: 'text-right', cell: (l) => l.summary.basisMinutes ?? '' },
    { key: 'km', header: t('hub.booster.km'), className: 'text-right', cell: (l) => l.summary.distanceKm ?? '' },
    { key: 'rides', header: t('hub.booster.rides'), className: 'text-right', cell: (l) => l.ridesCount ?? '' },
    { key: 'gross', header: t('hub.booster.gross'), className: 'text-right', cell: (l) => money(l.summary.grossCents) },
    { key: 'net', header: t('hub.booster.net'), className: 'text-right', cell: (l) => money(l.summary.netCents) },
    { key: 'perHour', header: t('hub.booster.perHour'), className: 'text-right', cell: (l) => money(l.summary.netPerHourCents) },
    { key: 'pdf', header: '', cell: (l) => (l.formats.includes('pdf') ? <a href={`/api/v1/admin/booster/performance/${encodeURIComponent(l.id)}/pdf`} className={`text-brand-blue-dark underline ${focus}`}>PDF</a> : null) },
    { key: 'jpeg', header: '', cell: (l) => (l.formats.includes('jpeg') ? <a href={`/api/v1/admin/booster/performance/${encodeURIComponent(l.id)}/jpeg`} className={`text-brand-blue-dark underline ${focus}`}>JPEG</a> : null) },
  ];
  const exportUrl = `/api/v1/admin/booster/performance/export.csv${trimmed ? `?driverId=${encodeURIComponent(trimmed)}` : ''}`;
  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={t('hub.booster.performanceTitle')} actions={<a href={exportUrl} className={`rounded-md border border-slate-300 px-3 py-2 text-sm ${focus}`}>{t('hub.booster.exportCsv')}</a>} />
      <Card title={t('hub.booster.recap')}>
        <form className="mb-3 flex flex-wrap items-end gap-3" onSubmit={(e) => e.preventDefault()}>
          <Field label={t('hub.booster.driverFilter')}>{(p) => <Input {...p} value={driverId} onChange={(e) => { setDriverId(e.target.value); setPage(1); }} placeholder={t('hub.booster.allDrivers')} className="w-72 font-mono text-xs" />}</Field>
          <Field label={t('hub.booster.period')}>{(p) => <Select {...p} value={period} onChange={(e) => setPeriod(e.target.value as 'week' | 'month')}><option value="week">{t('hub.booster.periods.week')}</option><option value="month">{t('hub.booster.periods.month')}</option></Select>}</Field>
          <Field label={t('hub.booster.recapDate')}>{(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Action tone="secondary" onClick={() => { setDriverId(''); setDate(''); setPage(1); }}>{t('hub.booster.clear')}</Action>
        </form>
        {trimmed.length !== 36 ? <Notice tone="info">{t('hub.booster.recapHint')}</Notice> : recap.isPending ? <Loading /> : recap.isError ? <ErrorBlock error={recap.error} onRetry={() => void recap.refetch()} /> : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={`${recap.data.label} · ${formatDate(recap.data.start, lang)} → ${formatDate(recap.data.end, lang)}`} value={t('hub.booster.sessions', { count: recap.data.totals.sessions })} />
            <Stat label={`${t('hub.booster.minutes')} / ${t('hub.booster.km')} / ${t('hub.booster.rides')}`} value={`${recap.data.totals.minutes} / ${recap.data.totals.distanceKm} / ${recap.data.totals.rides}`} />
            <Stat label={`${t('hub.booster.gross')} / ${t('hub.booster.costs')}`} value={`${money(recap.data.totals.grossCents)} / ${money(recap.data.totals.costsCents)}`} />
            <Stat label={`${t('hub.booster.net')} · ${t('hub.booster.perHour')} · ${t('hub.booster.perKm')}`} value={`${money(recap.data.totals.netCents)} · ${money(recap.data.totals.netPerHourCents)} · ${money(recap.data.totals.netPerKmCents)}`} tone={recap.data.totals.netCents >= 0 ? 'success' : 'danger'} />
          </div>
        )}
      </Card>
      <Card title={t('hub.booster.performance')}>
        {list.isPending ? <Loading /> : list.isError ? <ErrorBlock error={list.error} onRetry={() => void list.refetch()} /> : (
          <>
            <PendingAnalysisNotice count={list.data.items.filter((l) => l.reading.status === 'pending').length} />
            <DataTable caption={t('hub.booster.performanceTitle')} columns={columns} rows={list.data.items} rowKey={(l) => l.id} empty={t('hub.common.empty')} />
            <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} labels={pageLabels(t, page, PAGE_SIZE, list.data.total)} />
          </>
        )}
      </Card>
    </div>
  );
}
