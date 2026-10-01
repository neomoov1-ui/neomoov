'use client';

import type { FleetLive } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading, RideStateBadge, useErrorText, useLang } from '@/components/hub/common';
import { useFleetOrg } from '@/components/hub/fleet-org';
import { Action, Badge, Card, Field, Input, Notice, PageTitle, Select } from '@/components/ui/kit';
import { fleetApi } from '@/lib/fleet-api';
import { formatDateTime, fullName } from '@/lib/format';

type LiveRide = FleetLive['rides'][number];

/** Répartition interne (étape 23) : attribuer ou réattribuer les courses de l'organisation à ses chauffeurs ; mode réseau. */
export default function FleetDispatchPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const fleet = useFleetOrg();
  const live = useQuery({ queryKey: ['fleet', fleet.organizationId, 'live'], queryFn: () => fleetApi.live(fleet.organizationId), refetchInterval: 15_000 });
  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={t('fleet.dispatch.title')} subtitle={fleet.name} />
      <Notice tone="info">{t('fleet.dispatch.newRide')}</Notice>
      <Card title={t('fleet.dispatch.open')}>
        {live.isPending ? <Loading /> : live.isError ? <ErrorBlock error={live.error} onRetry={() => void live.refetch()} /> : live.data.rides.length ? (
          <ul className="flex flex-col gap-3">
            {live.data.rides.map((r) => <RideRow key={r.id} ride={r} lang={lang} />)}
          </ul>
        ) : <p className="text-sm text-slate-600">{t('fleet.live.none')}</p>}
      </Card>
      {fleet.can('rides.read', 'dispatch.network.share') ? <NetworkSettings /> : null}
    </div>
  );
}

function RideRow({ ride, lang }: { ride: LiveRide; lang: ReturnType<typeof useLang> }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const fleet = useFleetOrg();
  const queryClient = useQueryClient();
  const drivers = useQuery({ queryKey: ['fleet', fleet.organizationId, 'driver-options'], queryFn: () => fleetApi.drivers(fleet.organizationId, { page: 1, pageSize: 100 }) });
  const [driverId, setDriverId] = useState('');
  const [reason, setReason] = useState('');
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['fleet', fleet.organizationId, 'live'] });
  const assign = useMutation({ mutationFn: () => fleetApi.assignRide(fleet.organizationId, ride.id, driverId), onSuccess: refresh });
  const reassign = useMutation({ mutationFn: () => fleetApi.reassignRide(fleet.organizationId, ride.id, reason), onSuccess: refresh });
  const open = ride.state === 'requested' || ride.state === 'offering';
  return (
    <li className="rounded border border-slate-200 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{ride.publicNumber}</span> <RideStateBadge state={ride.state} /> <span>{formatDateTime(ride.requestedAt, lang)}</span>
        <span className="text-slate-600">{ride.origin.address} → {ride.destination.address}</span>
        {ride.networkShared ? <Badge tone="info">{t('fleet.live.network')}</Badge> : null}
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        {open && fleet.can('rides.assign') ? (
          <>
            <Field label={t('fleet.dispatch.driver')}>
              {(p) => (
                <Select {...p} value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                  <option value="" />
                  {(drivers.data?.items ?? []).filter((d) => d.status === 'active' || d.status === 'restricted').map((d) => <option key={d.id} value={d.id}>{fullName(d.firstName, d.lastName, d.publicNumber)}</option>)}
                </Select>
              )}
            </Field>
            <Action disabled={!driverId} busy={assign.isPending} onClick={() => assign.mutate()}>{t('fleet.dispatch.assign')}</Action>
          </>
        ) : null}
        {!open && fleet.can('rides.reassign') && ['assigned', 'en_route', 'arrived'].includes(ride.state) ? (
          <>
            <Field label={t('fleet.dispatch.reason')}>{(p) => <Input {...p} minLength={3} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
            <Action tone="secondary" disabled={reason.trim().length < 3} busy={reassign.isPending} onClick={() => reassign.mutate()}>{t('fleet.dispatch.reassign')}</Action>
          </>
        ) : null}
      </div>
      {assign.isError || reassign.isError ? <Notice tone="danger">{errorText(assign.error ?? reassign.error)}</Notice> : null}
    </li>
  );
}

function NetworkSettings() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const fleet = useFleetOrg();
  const queryClient = useQueryClient();
  const key = ['fleet', fleet.organizationId, 'settings'];
  const settings = useQuery({ queryKey: key, queryFn: () => fleetApi.settings(fleet.organizationId) });
  const [mode, setMode] = useState<'isolated' | 'neomoov_network'>('isolated');
  const [delay, setDelay] = useState('15');
  useEffect(() => {
    if (settings.data) {
      setMode(settings.data.networkMode);
      setDelay(String(settings.data.networkAfterMinutes));
    }
  }, [settings.data]);
  const save = useMutation({ mutationFn: () => fleetApi.updateSettings(fleet.organizationId, { networkMode: mode, networkAfterMinutes: Number(delay) }), onSuccess: (data) => queryClient.setQueryData(key, data) });
  const editable = fleet.can('dispatch.network.share');
  return (
    <Card title={t('fleet.dispatch.settings')}>
      {settings.isPending ? <Loading /> : settings.isError ? <ErrorBlock error={settings.error} /> : (
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <Field label={t('fleet.dispatch.settings')}>
            {(p) => (
              <Select {...p} disabled={!editable} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                <option value="isolated">{t('fleet.dispatch.isolated')}</option>
                <option value="neomoov_network">{t('fleet.dispatch.network')}</option>
              </Select>
            )}
          </Field>
          <Field label={t('fleet.dispatch.delay')}>{(p) => <Input {...p} disabled={!editable} type="number" min={1} max={1440} value={delay} onChange={(e) => setDelay(e.target.value)} />}</Field>
          {editable ? <Action type="submit" busy={save.isPending}>{t('fleet.dispatch.save')}</Action> : null}
          {save.isError ? <Notice tone="danger">{errorText(save.error)}</Notice> : null}
        </form>
      )}
    </Card>
  );
}
