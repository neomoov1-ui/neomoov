'use client';

import type { AdminReport } from '@neomoov/domain';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading, useLang } from '@/components/hub/common';
import { Card, Field, Input, PageTitle, Stat, focus } from '@/components/ui/kit';
import { formatDate, formatMoney, formatPercent, montrealDate } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

/** Rapports : indicateurs d'une période (heure de Montréal), courbe quotidienne, export CSV. */
export default function ReportsPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const [from, setFrom] = useState(montrealDate(-29));
  const [to, setTo] = useState(montrealDate());
  const report = useQuery({ queryKey: ['hub', 'report', from, to], queryFn: () => hubApi.admin.report(from, to), enabled: from <= to });
  const csv = `/api/v1/admin/reports.csv?from=${from}&to=${to}`;

  return (
    <div className="flex flex-col gap-5">
      <PageTitle
        title={t('hub.reports.title')}
        actions={<a href={csv} download className={`rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-brand-ink hover:bg-brand-tint ${focus}`}>{t('hub.common.exportCsv')}</a>}
      />
      <Card>
        <div className="grid gap-3 sm:grid-cols-2 md:max-w-lg">
          <Field label={t('hub.common.from')}>{(p) => <Input {...p} type="date" max={to} value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
          <Field label={t('hub.common.to')}>{(p) => <Input {...p} type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
        </div>
      </Card>
      {report.isPending ? <Loading /> : report.isError ? <ErrorBlock error={report.error} onRetry={() => void report.refetch()} /> : <ReportView report={report.data} />}
    </div>
  );

  function ReportView({ report: r }: { report: AdminReport }) {
    const k = r.totals;
    return (
      <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          <Stat label={t('hub.reports.requested')} value={k.ridesRequested} />
          <Stat label={t('hub.reports.completed')} value={k.ridesCompleted} />
          <Stat label={t('hub.reports.cancelled')} value={k.ridesCancelled} />
          <Stat label={t('hub.reports.noDriver')} value={k.noDriver} tone={k.noDriver ? 'warning' : undefined} />
          <Stat label={t('hub.reports.noShow')} value={k.noShow} />
          <Stat label={t('hub.reports.revenue')} value={formatMoney(k.revenueCents, lang)} />
          <Stat label={t('hub.reports.tips')} value={formatMoney(k.tipsCents, lang)} />
          <Stat label={t('hub.reports.rating')} value={k.averageRating === null ? '' : k.averageRating.toFixed(2)} />
          <Stat label={t('hub.reports.newClients')} value={k.newClients} />
          <Stat label={t('hub.reports.newDrivers')} value={k.newDrivers} />
          <Stat label={t('hub.reports.activeDrivers')} value={k.activeDrivers} />
          <Stat label={t('hub.reports.cancellationRate')} value={formatPercent(k.cancellationRatePct, lang)} />
          <Stat label={t('hub.reports.noDriverRate')} value={formatPercent(k.noDriverRatePct, lang)} />
        </div>
        <Card title={t('hub.reports.chart')}>
          <DailyChart daily={r.daily} />
        </Card>
      </>
    );
  }

  function DailyChart({ daily }: { daily: AdminReport['daily'] }) {
    const max = Math.max(1, ...daily.map((d) => Math.max(d.completed, d.cancelled)));
    const width = Math.max(320, daily.length * 18);
    const height = 180;
    const bar = Math.max(4, Math.floor(width / Math.max(1, daily.length) / 2) - 2);
    return (
      <div className="overflow-x-auto">
        <svg role="img" aria-label={t('hub.reports.chart')} viewBox={`0 0 ${width} ${height + 24}`} className="h-56 w-full min-w-[320px]">
          {daily.map((d, i) => {
            const x = (i * width) / daily.length;
            const hc = (d.completed / max) * height;
            const hx = (d.cancelled / max) * height;
            return (
              <g key={d.date}>
                <title>{`${formatDate(d.date, lang)} : ${t('hub.reports.completed')} ${d.completed}, ${t('hub.reports.cancelled')} ${d.cancelled}, ${formatMoney(d.revenueCents, lang)}`}</title>
                <rect x={x + 1} y={height - hc} width={bar} height={hc} fill="#0b5fb5" />
                <rect x={x + bar + 2} y={height - hx} width={bar} height={hx} fill="#b45309" />
              </g>
            );
          })}
          <line x1={0} x2={width} y1={height} y2={height} stroke="#94a3b8" />
          {daily.length ? <text x={0} y={height + 18} fontSize="11" fill="#334155">{formatDate(daily[0]!.date, lang)}</text> : null}
          {daily.length > 1 ? <text x={width} y={height + 18} fontSize="11" fill="#334155" textAnchor="end">{formatDate(daily[daily.length - 1]!.date, lang)}</text> : null}
        </svg>
        <p className="mt-2 flex gap-4 text-xs">
          <span><span aria-hidden className="mr-1 inline-block h-3 w-3 bg-[#0b5fb5]" />{t('hub.reports.completed')}</span>
          <span><span aria-hidden className="mr-1 inline-block h-3 w-3 bg-[#b45309]" />{t('hub.reports.cancelled')}</span>
        </p>
        <table className="sr-only">
          <caption>{t('hub.reports.daily')}</caption>
          <thead><tr><th scope="col">{t('hub.common.from')}</th><th scope="col">{t('hub.reports.completed')}</th><th scope="col">{t('hub.reports.cancelled')}</th></tr></thead>
          <tbody>{daily.map((d) => <tr key={d.date}><td>{d.date}</td><td>{d.completed}</td><td>{d.cancelled}</td></tr>)}</tbody>
        </table>
      </div>
    );
  }
}
