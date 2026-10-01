'use client';

import type { FleetPosition } from '@neomoov/domain';
import { useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { useTranslation } from 'react-i18next';
import { EnumBadge, ErrorBlock, Loading, RideStateBadge, useLang } from '@/components/hub/common';
import { useFleetOrg } from '@/components/hub/fleet-org';
import { Badge, Card, PageTitle } from '@/components/ui/kit';
import { fleetApi } from '@/lib/fleet-api';
import { formatDateTime } from '@/lib/format';

const FleetMap = dynamic(() => import('@/components/hub/fleet-map'), { ssr: false, loading: () => <div className="h-[420px] animate-pulse rounded-md bg-slate-100" /> });

/** Carte en direct de l'organisation (étape 23) : ses chauffeurs en ligne et ses courses en cours, actualisées toutes les 15 secondes. */
export default function FleetLivePage() {
  const { t } = useTranslation();
  const lang = useLang();
  const fleet = useFleetOrg();
  const live = useQuery({ queryKey: ['fleet', fleet.organizationId, 'live'], queryFn: () => fleetApi.live(fleet.organizationId), refetchInterval: 15_000 });
  const positions: FleetPosition[] = (live.data?.drivers ?? []).map((d) => ({
    driverId: d.driverId, publicNumber: d.publicNumber, firstName: d.firstName, status: d.status === 'busy' ? 'paused' : 'online', category: d.vehicle?.category ?? null,
    coordinates: d.coordinates, currentRideId: d.status === 'on_ride' ? (d.rideId ?? d.driverId) : null, updatedAt: d.updatedAt,
  }));
  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={t('fleet.live.title')} subtitle={t('fleet.live.refresh')} />
      {live.isPending ? <Loading /> : live.isError ? <ErrorBlock error={live.error} onRetry={() => void live.refetch()} /> : (
        <>
          <Card title={`${t('fleet.live.drivers')} (${live.data.drivers.length})`}>
            <FleetMap positions={positions} labels={{ onRide: t('fleet.live.onRide'), available: t('fleet.live.available'), paused: t('fleet.live.busy'), category: (c) => t(`enum.category.${c}`) }} />
          </Card>
          <Card title={`${t('fleet.live.rides')} (${live.data.rides.length})`}>
            {live.data.rides.length ? (
              <ul className="flex flex-col gap-2 text-sm">
                {live.data.rides.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.publicNumber}</span> <RideStateBadge state={r.state} /> <EnumBadge group="category" value={r.category} />
                    <span>{formatDateTime(r.requestedAt, lang)}</span> <span className="text-slate-600">{r.origin.address} → {r.destination.address}</span>
                    {r.networkShared ? <Badge tone="info">{t('fleet.live.network')}</Badge> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-slate-600">{t('fleet.live.none')}</p>}
          </Card>
        </>
      )}
    </div>
  );
}
