'use client';

import { PERFORMANCE_TARGETS, type AdminMetrics, type DurationStats } from '@neomoov/domain';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading, useLang } from '@/components/hub/common';
import { Badge, Card, DataTable, PageTitle, Stat } from '@/components/ui/kit';
import { formatDateTime, formatTime } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

type Route = AdminMetrics['api']['routes'][number];
type QueueItem = AdminMetrics['queues']['items'][number];
type Circuit = AdminMetrics['providers']['circuits'][number];

/**
 * Métriques d'exploitation (prompt 15, tâche 6) : courses par état, temps d'attribution, latences de l'API, files,
 * échecs de paiement et erreurs des fournisseurs, avec les cibles de la section 2.2. Lecture pour tout le personnel.
 */
export default function MetricsPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const metrics = useQuery({ queryKey: ['hub', 'metrics'], queryFn: () => hubApi.admin.metrics(), refetchInterval: 30_000 });

  if (metrics.isPending) return <Loading />;
  if (metrics.isError) return <ErrorBlock error={metrics.error} onRetry={() => void metrics.refetch()} />;
  const m = metrics.data;
  const number = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 });
  const seconds = (value: number | null) => (value === null ? t('hub.metrics.none') : t('hub.metrics.seconds', { value: number.format(value) }));
  const millis = (value: number | null) => (value === null ? t('hub.metrics.none') : t('hub.metrics.ms', { value: number.format(value) }));
  const overTarget = (value: number | null, target: number) => (value === null ? undefined : value > target ? ('danger' as const) : undefined);
  const activeRides = m.rides.byState.filter((s) => s.current).reduce((total, s) => total + s.count, 0);
  const openCircuits = m.providers.circuits.filter((c) => c.state !== 'closed').length;
  const durations: Array<{ key: string; label: string; stats: DurationStats }> = [
    { key: 'assignment', label: t('hub.metrics.assignment'), stats: m.rides.assignmentSeconds },
    { key: 'firstOffer', label: t('hub.metrics.firstOffer'), stats: m.rides.firstOfferSeconds },
  ];
  const firstOfferMet = m.rides.firstOfferSeconds.p95 === null ? null : m.rides.firstOfferSeconds.p95 <= PERFORMANCE_TARGETS.firstOfferSeconds;
  const apiMet = m.api.p95Ms === null ? null : m.api.p95Ms <= PERFORMANCE_TARGETS.apiP95Ms;
  const target = (met: boolean | null) => (met === null ? null : <Badge tone={met ? 'success' : 'danger'}>{met ? t('hub.metrics.targetMet') : t('hub.metrics.targetMissed')}</Badge>);

  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={t('hub.metrics.title')} subtitle={`${t('hub.metrics.subtitle')} ${t('hub.metrics.updated', { time: formatTime(m.generatedAt, lang) })}`} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t('hub.metrics.activeRides')} value={activeRides} href="/hub/courses" />
        <Stat label={t('hub.metrics.firstOfferP95')} value={seconds(m.rides.firstOfferSeconds.p95)} tone={overTarget(m.rides.firstOfferSeconds.p95, PERFORMANCE_TARGETS.firstOfferSeconds)} />
        <Stat label={t('hub.metrics.assignmentP95')} value={seconds(m.rides.assignmentSeconds.p95)} />
        <Stat label={t('hub.metrics.apiP95')} value={millis(m.api.p95Ms)} tone={overTarget(m.api.p95Ms, PERFORMANCE_TARGETS.apiP95Ms)} />
        <Stat label={t('hub.metrics.failedJobs')} value={m.queues.failed} tone={m.queues.failed ? 'warning' : undefined} />
        <Stat label={t('hub.metrics.failedPayments')} value={m.payments.failed} tone={m.payments.failed ? 'warning' : undefined} />
        <Stat label={t('hub.metrics.notificationErrors')} value={m.providers.notificationErrors} tone={m.providers.notificationErrors ? 'warning' : undefined} />
        <Stat label={t('hub.metrics.openCircuits')} value={openCircuits} tone={openCircuits ? 'danger' : undefined} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title={t('hub.metrics.assignmentTitle')} actions={target(firstOfferMet)}>
          <DataTable
            caption={t('hub.metrics.assignmentTitle')}
            rows={durations}
            rowKey={(row) => row.key}
            empty={t('hub.metrics.none')}
            columns={[
              { key: 'measure', header: t('hub.metrics.measure'), cell: (row) => row.label },
              { key: 'samples', header: t('hub.metrics.samples'), cell: (row) => number.format(row.stats.count), className: 'text-right' },
              { key: 'p50', header: t('hub.metrics.median'), cell: (row) => seconds(row.stats.p50), className: 'text-right' },
              { key: 'p95', header: t('hub.metrics.p95'), cell: (row) => seconds(row.stats.p95), className: 'text-right' },
              { key: 'max', header: t('hub.metrics.max'), cell: (row) => seconds(row.stats.max), className: 'text-right' },
            ]}
          />
          <p className="mt-2 text-xs text-slate-600">{t('hub.metrics.assignmentHint', { target: PERFORMANCE_TARGETS.firstOfferSeconds })}</p>
        </Card>

        <Card title={t('hub.metrics.ridesTitle')}>
          <DataTable
            caption={t('hub.metrics.ridesTitle')}
            rows={m.rides.byState}
            rowKey={(row) => row.state}
            empty={t('hub.metrics.none')}
            columns={[
              { key: 'state', header: t('hub.metrics.state'), cell: (row) => t(`enum.rideState.${row.state}`, { defaultValue: row.state }) },
              { key: 'count', header: t('hub.metrics.count'), cell: (row) => number.format(row.count), className: 'text-right' },
              { key: 'window', header: t('hub.metrics.window'), cell: (row) => (row.current ? t('hub.metrics.current') : t('hub.metrics.last24h')) },
            ]}
          />
        </Card>
      </div>

      <Card title={t('hub.metrics.apiTitle')} actions={target(apiMet)}>
        <p className="mb-3 text-sm text-slate-700">
          {t('hub.metrics.apiHint', { instance: m.api.instance, minutes: Math.round(m.api.windowSeconds / 60), requests: number.format(m.api.requests), errors: number.format(m.api.errors), target: PERFORMANCE_TARGETS.apiP95Ms })}
        </p>
        <DataTable<Route>
          caption={t('hub.metrics.apiTitle')}
          rows={m.api.routes}
          rowKey={(row) => `${row.method} ${row.route}`}
          empty={t('hub.metrics.noRequests')}
          columns={[
            { key: 'method', header: t('hub.metrics.method'), cell: (row) => row.method },
            { key: 'route', header: t('hub.metrics.route'), cell: (row) => <code className="break-all text-xs">{row.route}</code> },
            { key: 'requests', header: t('hub.metrics.requests'), cell: (row) => number.format(row.count), className: 'text-right' },
            { key: 'errors', header: t('hub.metrics.errors'), cell: (row) => number.format(row.errors), className: 'text-right' },
            { key: 'p50', header: t('hub.metrics.median'), cell: (row) => millis(row.p50Ms), className: 'text-right' },
            { key: 'p95', header: t('hub.metrics.p95'), cell: (row) => millis(row.p95Ms), className: 'text-right' },
            { key: 'max', header: t('hub.metrics.max'), cell: (row) => millis(row.maxMs), className: 'text-right' },
          ]}
        />
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title={t('hub.metrics.queuesTitle')} actions={<Badge tone="neutral">{t('hub.metrics.mode', { mode: t(`hub.metrics.modes.${m.queues.mode}`) })}</Badge>}>
          <DataTable<QueueItem>
            caption={t('hub.metrics.queuesTitle')}
            rows={m.queues.items}
            rowKey={(row) => row.name}
            empty={t('hub.metrics.none')}
            columns={[
              { key: 'name', header: t('hub.metrics.queue'), cell: (row) => <code className="text-xs">{row.name}</code> },
              { key: 'waiting', header: t('hub.metrics.waiting'), cell: (row) => number.format(row.waiting), className: 'text-right' },
              { key: 'active', header: t('hub.metrics.active'), cell: (row) => number.format(row.active), className: 'text-right' },
              { key: 'failed', header: t('hub.metrics.failed'), cell: (row) => (row.failed ? <Badge tone="warning">{number.format(row.failed)}</Badge> : '0'), className: 'text-right' },
              { key: 'dropped', header: t('hub.metrics.dropped'), cell: (row) => (row.dropped === undefined ? t('hub.metrics.none') : number.format(row.dropped)), className: 'text-right' },
            ]}
          />
        </Card>

        <div className="flex flex-col gap-5">
          <Card title={t('hub.metrics.paymentsTitle')}>
            <DataTable
              caption={t('hub.metrics.paymentsTitle')}
              rows={m.payments.byCode}
              rowKey={(row) => row.code}
              empty={t('hub.metrics.noFailures')}
              columns={[
                { key: 'code', header: t('hub.metrics.code'), cell: (row) => <code className="text-xs">{row.code}</code> },
                { key: 'count', header: t('hub.metrics.count'), cell: (row) => number.format(row.count), className: 'text-right' },
              ]}
            />
          </Card>
          <Card title={t('hub.metrics.notificationsTitle')}>
            <DataTable
              caption={t('hub.metrics.notificationsTitle')}
              rows={m.providers.notificationErrorsByChannel}
              rowKey={(row) => row.channel}
              empty={t('hub.metrics.noNotificationErrors')}
              columns={[
                { key: 'channel', header: t('hub.metrics.channel'), cell: (row) => t(`hub.metrics.channels.${row.channel}`, { defaultValue: row.channel }) },
                { key: 'count', header: t('hub.metrics.count'), cell: (row) => number.format(row.count), className: 'text-right' },
              ]}
            />
          </Card>
        </div>
      </div>

      <Card title={t('hub.metrics.providersTitle')}>
        <DataTable<Circuit>
          caption={t('hub.metrics.providersTitle')}
          rows={m.providers.circuits}
          rowKey={(row) => row.name}
          empty={t('hub.metrics.noCircuits')}
          columns={[
            { key: 'name', header: t('hub.metrics.circuit'), cell: (row) => <code className="text-xs">{row.name}</code> },
            { key: 'state', header: t('hub.metrics.state'), cell: (row) => <Badge tone={row.state === 'closed' ? 'success' : row.state === 'open' ? 'danger' : 'warning'}>{t(`hub.metrics.circuitStates.${row.state}`)}</Badge> },
            { key: 'failures', header: t('hub.metrics.totalFailures'), cell: (row) => number.format(row.totalFailures), className: 'text-right' },
            { key: 'openings', header: t('hub.metrics.openings'), cell: (row) => number.format(row.openings), className: 'text-right' },
            { key: 'last', header: t('hub.metrics.lastFailure'), cell: (row) => (row.lastFailureAt ? formatDateTime(row.lastFailureAt, lang) : t('hub.metrics.none')) },
          ]}
        />
      </Card>
    </div>
  );
}

