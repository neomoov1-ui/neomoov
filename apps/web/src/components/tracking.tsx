'use client';

/** Suivi partagé d'une course (`/suivi/{token}`) : état, chauffeur, véhicule, position en direct pendant l'approche et la course. */
import type { PublicTrackingView } from '@neomoov/domain';
import { useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { useTranslation } from 'react-i18next';
import { Badge, Card, Notice } from '@/components/ui/kit';
import { formatDateTime, formatTime } from '@/lib/format';
import type { Language } from '@/lib/i18n-resources';
import { ApiError, publicApi } from '@/lib/site-api';

const PositionMap = dynamic(() => import('@/components/position-map'), { ssr: false, loading: () => <div className="h-72 animate-pulse rounded-md bg-slate-100" /> });
const LIVE = ['assigned', 'en_route', 'arrived', 'in_progress'];

export function Tracking({ token }: { token: string }) {
  const { t, i18n } = useTranslation();
  const lang: Language = i18n.language === 'en' ? 'en' : 'fr-CA';
  const track = useQuery<PublicTrackingView>({
    queryKey: ['track', token],
    queryFn: () => publicApi.public.track(token),
    refetchInterval: (q) => (q.state.data && LIVE.includes(q.state.data.state) ? 10_000 : 60_000),
    retry: (count, error) => !(error instanceof ApiError && (error.status === 404 || error.status === 410)) && count < 2,
  });

  if (track.isPending) return <p role="status" className="py-10">{t('common.loading')}</p>;
  if (track.isError) {
    const gone = track.error instanceof ApiError && track.error.status === 410;
    return <div className="py-10"><Notice tone="warning">{gone ? t('track.expired') : t('track.notFound')}</Notice></div>;
  }
  const v = track.data;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl text-brand-night">{t('track.title', { number: v.publicNumber })}</h1>
        <Badge tone={LIVE.includes(v.state) ? 'success' : 'neutral'}>{t(`enum.rideState.${v.state}`)}</Badge>
      </div>
      <Card>
        <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-2 text-sm">
          <dt className="font-semibold">{t('track.pickup')}</dt><dd>{formatDateTime(v.requestedAt, lang)}</dd>
          <dt className="font-semibold">{t('track.destination')}</dt><dd>{v.destination.address}</dd>
          <dt className="font-semibold">{t('track.driver')}</dt><dd>{v.driver ? v.driver.firstName : t('track.waiting')}</dd>
          {v.driver ? (<><dt className="font-semibold">{t('track.vehicle')}</dt><dd>{`${v.driver.vehicle.make} ${v.driver.vehicle.model} · ${v.driver.vehicle.colour} · ${v.driver.vehicle.plate}`}</dd></>) : null}
        </dl>
        {v.etaSeconds !== null && LIVE.includes(v.state) ? <p className="mt-3 text-lg font-bold">{t('track.eta', { minutes: Math.max(1, Math.round(v.etaSeconds / 60)) })}</p> : null}
      </Card>
      {v.driverPosition ? (
        <Card title={t('track.live')}>
          <PositionMap lat={v.driverPosition.lat} lng={v.driverPosition.lng} label={v.driver?.firstName ?? ''} />
        </Card>
      ) : null}
      <p className="text-xs text-slate-600" aria-live="polite">{t('track.updated', { time: formatTime(v.updatedAt, lang) })}</p>
    </div>
  );
}
