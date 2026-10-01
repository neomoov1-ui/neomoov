'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EnumBadge, ErrorBlock, Loading, useLang } from '@/components/hub/common';
import { useFleetOrg } from '@/components/hub/fleet-org';
import { Badge, Card, DataTable, Field, Input, PageTitle, Stat } from '@/components/ui/kit';
import { fleetApi } from '@/lib/fleet-api';
import { formatDate, formatMoney } from '@/lib/format';

type Report = Awaited<ReturnType<typeof fleetApi.weeklyReport>>;
type Owner = Awaited<ReturnType<typeof fleetApi.ownerDashboard>>;

/** Rapports de la flotte (étape 23) : semaine par chauffeur et par véhicule ; tableau de bord du propriétaire de véhicule. */
export default function FleetReportsPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const fleet = useFleetOrg();
  const [periodStart, setPeriodStart] = useState('');
  const monday = periodStart && new Date(`${periodStart}T12:00:00Z`).getUTCDay() === 1 ? periodStart : undefined;
  const report = useQuery({ queryKey: ['fleet', fleet.organizationId, 'weekly', monday], queryFn: () => fleetApi.weeklyReport(fleet.organizationId, monday), enabled: fleet.can('reports.read') });
  const owner = useQuery({ queryKey: ['fleet', fleet.organizationId, 'owner', monday], queryFn: () => fleetApi.ownerDashboard(fleet.organizationId, monday), enabled: fleet.can('vehicles.owner.read') });
  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={t('fleet.reports.title')} subtitle={fleet.name} />
      <div className="max-w-xs">
        <Field label={t('fleet.reports.week')}>{(p) => <Input {...p} type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />}</Field>
      </div>
      {fleet.can('reports.read') ? (report.isPending ? <Loading /> : report.isError ? <ErrorBlock error={report.error} onRetry={() => void report.refetch()} /> : <Weekly report={report.data} lang={lang} />) : null}
      {fleet.can('vehicles.owner.read') ? (owner.isPending ? <Loading /> : owner.isError ? <ErrorBlock error={owner.error} /> : <OwnerVehicles data={owner.data} lang={lang} />) : null}
    </div>
  );
}

function Weekly({ report, lang }: { report: Report; lang: ReturnType<typeof useLang> }) {
  const { t } = useTranslation();
  return (
    <>
      <p className="text-sm text-slate-600">{formatDate(report.periodStart, lang)} → {formatDate(report.periodEnd, lang)}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t('fleet.reports.rides')} value={report.totals.rides} />
        <Stat label={t('fleet.reports.fare')} value={formatMoney(report.totals.fareCents, lang)} />
        <Stat label={t('fleet.reports.share')} value={formatMoney(report.totals.shareCents, lang)} />
      </div>
      <Card title={t('fleet.reports.byDriver')}>
        <DataTable
          rows={report.byDriver} rowKey={(r) => r.driverId} empty="—" caption={t('fleet.reports.byDriver')}
          columns={[
            { key: 'driver', header: t('fleet.reports.byDriver'), cell: (r) => r.driverName ?? r.publicNumber },
            { key: 'rides', header: t('fleet.reports.rides'), cell: (r) => r.rides },
            { key: 'fare', header: t('fleet.reports.fare'), cell: (r) => formatMoney(r.fareCents, lang) },
            { key: 'share', header: t('fleet.reports.share'), cell: (r) => formatMoney(r.shareCents, lang) },
          ]}
        />
      </Card>
      <Card title={t('fleet.reports.byVehicle')}>
        <DataTable
          rows={report.byVehicle} rowKey={(r) => r.vehicleId} empty="—" caption={t('fleet.reports.byVehicle')}
          columns={[
            { key: 'vehicle', header: t('fleet.reports.byVehicle'), cell: (r) => `${r.make} ${r.model} · ${r.plate}` },
            { key: 'rides', header: t('fleet.reports.rides'), cell: (r) => r.rides },
            { key: 'fare', header: t('fleet.reports.fare'), cell: (r) => formatMoney(r.fareCents, lang) },
          ]}
        />
      </Card>
    </>
  );
}

function OwnerVehicles({ data, lang }: { data: Owner; lang: ReturnType<typeof useLang> }) {
  const { t } = useTranslation();
  const tone = { ok: 'success', due_soon: 'warning', overdue: 'danger' } as const;
  return (
    <Card title={t('fleet.reports.owner')}>
      {data.vehicles.length ? (
        <ul className="flex flex-col gap-3 text-sm">
          {data.vehicles.map((v) => (
            <li key={v.vehicleId} className="rounded border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{v.make} {v.model} · {v.plate}</span> <EnumBadge group="vehicleStatus" value={v.status} />
                <span>{v.driverName ?? '—'}</span> <span>{t('fleet.reports.rides')} : {v.rides}</span> <span>{formatMoney(v.fareCents, lang)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {v.maintenanceDue.map((d) => <Badge key={d.kind} tone={tone[d.status]}>{t(`fleet.vehicles.kinds.${d.kind}`)} · {t(`fleet.vehicles.dueStatus.${d.status}`)}</Badge>)}
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-slate-600">{t('fleet.reports.ownerNone')}</p>}
    </Card>
  );
}
