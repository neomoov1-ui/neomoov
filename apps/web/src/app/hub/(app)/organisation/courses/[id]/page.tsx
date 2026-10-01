'use client';

import { RIDE_STATES } from '@neomoov/domain';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading, RideStateBadge, useLang } from '@/components/hub/common';
import { OrgPage } from '@/components/hub/org-context';
import { Card, Notice, PageTitle, focus } from '@/components/ui/kit';
import { formatDateTime, formatMoney } from '@/lib/format';
import { ApiError, hubApi } from '@/lib/hub-api';

/** Étape 21 : fiche d'une course de l'organisation (404 hors de son sous-arbre : « introuvable »). */
export default function OrgRidePage() {
  return <OrgPage permissions={['rides.read']}>{(orgId) => <Ride orgId={orgId} />}</OrgPage>;
}

function Ride({ orgId }: { orgId: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { id } = useParams<{ id: string }>();
  const ride = useQuery({ queryKey: ['org', orgId, 'ride', id], queryFn: () => hubApi.org.ride(orgId, id), retry: false });
  const back = <Link href="/hub/organisation/courses" className={`text-sm text-brand-blue-dark underline ${focus}`}>{t('org.rides.back')}</Link>;
  if (ride.isPending) return <Loading />;
  if (ride.isError) return <div className="flex flex-col gap-3">{back}{ride.error instanceof ApiError && ride.error.status === 404 ? <Notice tone="warning">{t('org.rides.notFound')}</Notice> : <ErrorBlock error={ride.error} onRetry={() => void ride.refetch()} />}</div>;
  const r = ride.data;
  const steps = RIDE_STATES.filter((s) => r.timestamps[s]).map((s) => ({ state: s, at: r.timestamps[s]! })).sort((a, b) => a.at.localeCompare(b.at));
  return (
    <div className="flex flex-col gap-4">
      {back}
      <PageTitle title={`${t('org.rides.detail')} · ${t(`enum.rideType.${r.type}`)}`} actions={<RideStateBadge state={r.state} />} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('org.rides.route')}>
          <dl className="grid gap-2 text-sm">
            <div><dt className="font-semibold">{t('hub.rides.origin')}</dt><dd>{r.origin.address}</dd></div>
            <div><dt className="font-semibold">{t('hub.rides.destination')}</dt><dd>{r.destination.address}</dd></div>
            <div><dt className="font-semibold">{t('org.rides.when')}</dt><dd>{formatDateTime(r.requestedAt, lang) || t('hub.common.none')}</dd></div>
            <div><dt className="font-semibold">{t('hub.rides.category')}</dt><dd>{t(`enum.category.${r.category}`)}</dd></div>
          </dl>
        </Card>
        <Card title={t('org.rides.price')}>
          <dl className="grid gap-2 text-sm">
            <div><dt className="font-semibold">{t('org.rides.price')}</dt><dd>{formatMoney(r.finalPriceCents ?? r.quote.totalCents, lang)}</dd></div>
            <div><dt className="font-semibold">{t('org.rides.payment')}</dt><dd>{t(`enum.paymentMethod.${r.paymentMethod}`)}</dd></div>
            <div><dt className="font-semibold">{t('org.rides.driver')}</dt><dd>{r.driver ? `${r.driver.firstName} · ${r.driver.vehicle.make} ${r.driver.vehicle.model} · ${r.driver.vehicle.plate}` : t('hub.common.none')}</dd></div>
          </dl>
        </Card>
      </div>
      <Card title={t('org.rides.timeline')}>
        <ol className="flex flex-col gap-1 text-sm">
          {steps.map((s) => <li key={s.state} className="flex gap-3"><span className="w-44 text-slate-600">{formatDateTime(s.at, lang)}</span><span>{t(`enum.rideState.${s.state}`)}</span></li>)}
        </ol>
      </Card>
    </div>
  );
}
