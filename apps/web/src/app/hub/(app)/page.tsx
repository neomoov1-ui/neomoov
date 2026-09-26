'use client';

import { VEHICLE_CATEGORIES, type AdminDashboard, type FleetPosition } from '@neomoov/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EnumBadge, ErrorBlock, Loading, useLang } from '@/components/hub/common';
import { useAdminSocket, type DriverLocationEvent } from '@/components/hub/realtime';
import { Badge, Card, Field, Notice, PageTitle, Select, Stat, focus } from '@/components/ui/kit';
import { formatDateTime, formatMoney, formatTime } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

const FleetMap = dynamic(() => import('@/components/hub/fleet-map'), { ssr: false, loading: () => <div className="h-[420px] animate-pulse rounded-md bg-slate-100" /> });

/** Tableau de bord : indicateurs du jour, carte de la flotte en direct, alertes SOS et incidents, planifiées non confirmées. */
export default function DashboardPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [live, setLive] = useState<Record<string, DriverLocationEvent>>({});
  const [lastAlert, setLastAlert] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshSoon = () => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      void queryClient.invalidateQueries({ queryKey: ['hub', 'dashboard'] });
    }, 1500);
  };

  const connected = useAdminSocket({
    onLocation: (event) => setLive((prev) => ({ ...prev, [event.driverId]: event })),
    onRide: refreshSoon,
    onAlert: (alert) => {
      setLastAlert(t('hub.dashboard.newAlert', { type: t(`enum.incidentType.${alert.type}`, { defaultValue: alert.type }) }));
      refreshSoon();
    },
  });
  const dashboard = useQuery({ queryKey: ['hub', 'dashboard'], queryFn: () => hubApi.admin.dashboard(), refetchInterval: connected ? 60_000 : 15_000 });

  const fleet = useMemo<FleetPosition[]>(() => {
    const base = dashboard.data?.fleet ?? [];
    return base
      .map((p) => {
        const update = live[p.driverId];
        return update && update.recordedAt > p.updatedAt ? { ...p, coordinates: update.coordinates, updatedAt: update.recordedAt } : p;
      })
      .filter((p) => (!category || p.category === category) && (!status || (status === 'on_ride' ? Boolean(p.currentRideId) : p.status === status && !p.currentRideId)));
  }, [dashboard.data, live, category, status]);

  if (dashboard.isPending) return <Loading />;
  if (dashboard.isError) return <ErrorBlock error={dashboard.error} onRetry={() => void dashboard.refetch()} />;
  const d: AdminDashboard = dashboard.data;
  const c = d.counts;

  return (
    <div className="flex flex-col gap-5">
      <PageTitle
        title={t('hub.dashboard.title')}
        subtitle={t('hub.dashboard.updated', { time: formatTime(d.generatedAt, lang) })}
        actions={<Badge tone={connected ? 'success' : 'warning'}>{connected ? t('hub.shell.live') : t('hub.shell.polling')}</Badge>}
      />
      {lastAlert ? <Notice tone="danger">{lastAlert}</Notice> : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label={t('hub.dashboard.ridesToday')} value={c.ridesToday} href="/hub/courses" />
        <Stat label={t('hub.dashboard.ridesActive')} value={c.ridesActive} href="/hub/courses" />
        <Stat label={t('hub.dashboard.searching')} value={c.ridesSearching} tone={c.ridesSearching ? 'warning' : undefined} href="/hub/courses" />
        <Stat label={t('hub.dashboard.scheduled')} value={c.scheduledUpcoming} href="/hub/courses?view=scheduled" />
        <Stat label={t('hub.dashboard.unconfirmed')} value={c.scheduledUnconfirmed} tone={c.scheduledUnconfirmed ? 'danger' : undefined} />
        <Stat label={t('hub.dashboard.completedToday')} value={d.completedToday} />
        <Stat label={t('hub.dashboard.revenueToday')} value={formatMoney(d.revenueTodayCents, lang)} />
        <Stat label={t('hub.dashboard.online')} value={c.driversOnline} />
        <Stat label={t('hub.dashboard.paused')} value={c.driversPaused} />
        <Stat label={t('hub.dashboard.pendingDrivers')} value={c.driversPending} tone={c.driversPending ? 'warning' : undefined} href="/hub/chauffeurs" />
        <Stat label={t('hub.dashboard.pendingDocuments')} value={c.documentsPending} tone={c.documentsPending ? 'warning' : undefined} href="/hub/documents" />
        <Stat label={t('hub.dashboard.openIncidents')} value={c.incidentsOpen} tone={c.incidentsOpen ? 'danger' : undefined} href="/hub/incidents" />
        <Stat label={t('hub.dashboard.pendingApprovals')} value={c.approvalsPending} href="/hub/agents" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card title={t('hub.dashboard.fleet')}>
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <Field label={t('hub.rides.category')}>
              {(p) => (
                <Select {...p} value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">{t('hub.dashboard.allCategories')}</option>
                  {VEHICLE_CATEGORIES.map((code) => <option key={code} value={code}>{t(`enum.category.${code}`)}</option>)}
                </Select>
              )}
            </Field>
            <Field label={t('hub.common.status')}>
              {(p) => (
                <Select {...p} value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">{t('hub.common.all')}</option>
                  <option value="online">{t('hub.dashboard.available')}</option>
                  <option value="on_ride">{t('hub.dashboard.onRide')}</option>
                  <option value="paused">{t('enum.presence.paused')}</option>
                </Select>
              )}
            </Field>
          </div>
          <FleetMap positions={fleet} labels={{ onRide: t('hub.dashboard.onRide'), available: t('hub.dashboard.available'), paused: t('enum.presence.paused'), category: (code) => t(`enum.category.${code}`) }} />
          {fleet.length === 0 ? <p className="mt-2 text-sm text-slate-600">{t('hub.dashboard.fleetEmpty')}</p> : null}
        </Card>

        <div className="flex flex-col gap-5">
          <Card title={t('hub.dashboard.alerts')}>
            {d.alerts.length === 0 ? (
              <p className="text-sm text-slate-600">{t('hub.dashboard.noAlerts')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {d.alerts.map((a) => (
                  <li key={a.incidentId} className="rounded-md border border-slate-200 p-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <EnumBadge group="severity" value={a.severity} />
                      <strong>{t(`enum.incidentType.${a.type}`)}</strong>
                      <span className="text-xs text-slate-600">{formatDateTime(a.createdAt, lang)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2">{a.description}</p>
                    <div className="mt-1 flex gap-3">
                      <Link className={`text-brand-blue-dark underline ${focus}`} href="/hub/incidents">{t('hub.incidents.decide')}</Link>
                      {a.rideId ? <Link className={`text-brand-blue-dark underline ${focus}`} href={`/hub/courses/${a.rideId}`}>{t('hub.nav.rides')}</Link> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={t('hub.dashboard.unconfirmedTitle')}>
            {d.unconfirmed.length === 0 ? (
              <p className="text-sm text-slate-600">{t('hub.dashboard.noUnconfirmed')}</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {d.unconfirmed.map((u) => (
                  <li key={u.rideId} className="flex flex-wrap items-center justify-between gap-2">
                    <Link className={`font-semibold text-brand-blue-dark underline ${focus}`} href={`/hub/courses/${u.rideId}`}>{u.publicNumber}</Link>
                    <span>{formatDateTime(u.requestedAt, lang)}</span>
                    <span className="text-slate-600">{u.driverName ?? t('hub.common.none')}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
