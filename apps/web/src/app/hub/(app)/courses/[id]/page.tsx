'use client';

import type { AdminDriverListItem } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading, RideStateBadge, useCanWrite, useDebounced, useErrorText, useLang } from '@/components/hub/common';
import { Action, Badge, Card, Checkbox, DataTable, Dialog, Field, Input, Notice, PageTitle, Select, Textarea, focus } from '@/components/ui/kit';
import { formatDateTime, formatMoney } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

type Panel = null | 'assign' | 'reassign' | 'hold' | 'cancel';
const CLOSED = ['completed', 'rated', 'disputed', 'no_driver', 'cancelled_by_client', 'cancelled_by_driver', 'no_show', 'interrupted', 'expired'];

/** Fiche d'une course : détail, répartition (offres), chronologie, et actions de l'opérateur. */
export default function RideDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const lang = useLang();
  const writable = useCanWrite();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [panel, setPanel] = useState<Panel>(null);
  const [done, setDone] = useState<string | null>(null);

  const ride = useQuery({ queryKey: ['hub', 'ride', id], queryFn: () => hubApi.admin.ride(id), refetchInterval: 20_000 });
  const summary = useQuery({ queryKey: ['hub', 'ride', id, 'summary'], queryFn: () => hubApi.admin.rideSummary(id) });
  const events = useQuery({ queryKey: ['hub', 'ride', id, 'events'], queryFn: () => hubApi.admin.rideEvents(id), refetchInterval: 20_000 });
  const dispatch = useQuery({ queryKey: ['hub', 'ride', id, 'dispatch'], queryFn: () => hubApi.admin.rideDispatch(id) });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['hub', 'ride', id] });
  const action = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: () => {
      setPanel(null);
      setDone(t('hub.rides.done'));
      refresh();
    },
  });

  if (ride.isPending) return <Loading />;
  if (ride.isError) return <ErrorBlock error={ride.error} onRetry={() => void ride.refetch()} />;
  const r = ride.data;
  const s = summary.data;
  const open = !CLOSED.includes(r.state);

  return (
    <div className="flex flex-col gap-5">
      <PageTitle
        title={t('hub.rides.detail', { number: s?.publicNumber ?? '' })}
        subtitle={<Link href="/hub/courses" className={`text-brand-blue-dark underline ${focus}`}>{t('hub.common.back')}</Link>}
        actions={<RideStateBadge state={r.state} />}
      />
      {done ? <Notice tone="success">{done}</Notice> : null}

      {writable && open ? (
        <div className="flex flex-wrap gap-2">
          <Action onClick={() => setPanel('assign')}>{t('hub.rides.assign')}</Action>
          {r.driver ? <Action tone="secondary" onClick={() => setPanel('reassign')}>{t('hub.rides.reassign')}</Action> : null}
          <Action tone="secondary" onClick={() => setPanel('hold')}>{t('hub.rides.hold')}</Action>
          <Action tone="secondary" onClick={() => action.mutate(() => hubApi.admin.releaseRide(id))}>{t('hub.rides.release')}</Action>
          <Action tone="danger" onClick={() => setPanel('cancel')}>{t('hub.rides.cancel')}</Action>
        </div>
      ) : null}
      {action.isError && !panel ? <Notice tone="danger">{errorText(action.error)}</Notice> : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={t('hub.rides.route')}>
          <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="font-semibold">{t('hub.rides.origin')}</dt><dd>{r.origin.address}</dd>
            {r.stops.map((stop, i) => (<div key={i} className="contents"><dt className="font-semibold">+{i + 1}</dt><dd>{stop.address}</dd></div>))}
            <dt className="font-semibold">{t('hub.rides.destination')}</dt><dd>{r.destination.address}</dd>
            <dt className="font-semibold">{t('hub.rides.when')}</dt><dd>{formatDateTime(r.requestedAt, lang)}</dd>
            <dt className="font-semibold">{t('hub.rides.type')}</dt><dd>{t(`enum.rideType.${r.type}`)}</dd>
            <dt className="font-semibold">{t('hub.rides.category')}</dt><dd>{t(`enum.category.${r.category}`)}</dd>
          </dl>
        </Card>
        <Card title={t('hub.rides.client')}>
          <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="font-semibold">{t('hub.rides.client')}</dt><dd>{s?.clientName ?? ''} <span className="text-slate-600">{s?.clientPhone ?? ''}</span></dd>
            <dt className="font-semibold">{t('hub.rides.driver')}</dt>
            <dd>{r.driver ? `${r.driver.firstName} (${r.driver.vehicle.make} ${r.driver.vehicle.model}, ${r.driver.vehicle.plate})` : t('hub.common.none')}</dd>
            <dt className="font-semibold">{t('hub.rides.quoted')}</dt><dd>{formatMoney(r.quote.totalCents, lang)}</dd>
            <dt className="font-semibold">{t('hub.rides.final')}</dt><dd>{r.finalPriceCents === null ? '' : formatMoney(r.finalPriceCents, lang)}</dd>
            <dt className="font-semibold">{t('hub.rides.payment')}</dt><dd>{t(`enum.paymentMethod.${r.paymentMethod}`)}</dd>
          </dl>
        </Card>
      </div>

      {dispatch.data && dispatch.data.offers.length > 0 ? (
        <Card title={t('hub.rides.views.active')}>
          <DataTable
            rows={dispatch.data.offers}
            rowKey={(o) => o.id}
            empty={t('hub.common.empty')}
            columns={[
              { key: 'wave', header: '#', cell: (o) => o.wave },
              { key: 'driver', header: t('hub.rides.driver'), cell: (o) => <Link className={`text-brand-blue-dark underline ${focus}`} href={`/hub/chauffeurs/${o.driverId}`}>{o.driverId.slice(0, 8)}</Link> },
              { key: 'state', header: t('hub.rides.state'), cell: (o) => <Badge>{o.state}</Badge> },
              { key: 'fare', header: t('hub.rides.price'), cell: (o) => formatMoney(o.proposedTotalCents ?? o.driverFareCents, lang) },
              { key: 'sent', header: t('hub.rides.when'), cell: (o) => formatDateTime(o.sentAt, lang) },
            ]}
          />
        </Card>
      ) : null}

      <Card title={t('hub.rides.timeline')}>
        {events.isPending ? <Loading /> : events.isError ? <ErrorBlock error={events.error} /> : events.data.length === 0 ? <p className="text-sm text-slate-600">{t('hub.rides.noEvents')}</p> : (
          <ol className="flex flex-col gap-2 border-l-2 border-slate-200 pl-4 text-sm">
            {events.data.map((e) => (
              <li key={e.id}>
                <span className="text-xs text-slate-600">{formatDateTime(e.occurredAt, lang)}</span>
                <span className="ml-2 font-semibold">{e.type}</span>
                {e.toState ? <span className="ml-2"><RideStateBadge state={e.toState} /></span> : null}
                <span className="ml-2 text-xs text-slate-600">{e.actorKind}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <AssignDialog open={panel === 'assign'} onClose={() => setPanel(null)} busy={action.isPending} error={action.isError ? errorText(action.error) : null} onSubmit={(driverId, note) => action.mutate(() => hubApi.admin.assignRide(id, { driverId, ...(note ? { note } : {}) }))} />
      <ReasonDialog
        open={panel === 'reassign'} title={t('hub.rides.reassign')} onClose={() => setPanel(null)} busy={action.isPending} error={action.isError ? errorText(action.error) : null}
        checkbox={t('hub.rides.excludeDriver')} onSubmit={(reason, checked) => action.mutate(() => hubApi.admin.reassignRide(id, { reason, excludeDriver: checked }))}
      />
      <ReasonDialog open={panel === 'hold'} title={t('hub.rides.hold')} onClose={() => setPanel(null)} busy={action.isPending} error={action.isError ? errorText(action.error) : null} onSubmit={(reason) => action.mutate(() => hubApi.admin.holdRide(id, reason))} />
      <ReasonDialog
        open={panel === 'cancel'} title={t('hub.rides.cancel')} danger onClose={() => setPanel(null)} busy={action.isPending} error={action.isError ? errorText(action.error) : null}
        checkbox={t('hub.rides.chargeFee')} onSubmit={(reason, checked) => action.mutate(() => hubApi.admin.cancelRide(id, { reason, chargeFee: checked }))}
      />
    </div>
  );
}

function ReasonDialog({ open, title, onClose, onSubmit, busy, error, checkbox, danger }: { open: boolean; title: string; onClose: () => void; onSubmit: (reason: string, checked: boolean) => void; busy: boolean; error: string | null; checkbox?: string; danger?: boolean }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [checked, setChecked] = useState(false);
  return (
    <Dialog open={open} title={title} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); onSubmit(reason.trim(), checked); }}>
        <Field label={t('hub.common.reason')}>{(p) => <Textarea {...p} required minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        {checkbox ? <Checkbox label={checkbox} checked={checked} onChange={(e) => setChecked(e.target.checked)} /> : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Action tone="secondary" onClick={onClose}>{t('hub.common.cancel')}</Action>
          <Action type="submit" tone={danger ? 'danger' : 'primary'} busy={busy} disabled={busy}>{t('hub.common.confirm')}</Action>
        </div>
      </form>
    </Dialog>
  );
}

/** Attribution manuelle : recherche d'un chauffeur actif (nom, numéro, téléphone), note facultative. */
function AssignDialog({ open, onClose, onSubmit, busy, error }: { open: boolean; onClose: () => void; onSubmit: (driverId: string, note: string) => void; busy: boolean; error: string | null }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [driverId, setDriverId] = useState('');
  const [note, setNote] = useState('');
  const search = useDebounced(q.trim());
  const drivers = useQuery({ queryKey: ['hub', 'assign-drivers', search], queryFn: () => hubApi.admin.drivers({ status: 'active', pageSize: 20, ...(search ? { q: search } : {}) }), enabled: open });
  const label = (d: AdminDriverListItem) => `${[d.firstName, d.lastName].filter(Boolean).join(' ')} · ${d.publicNumber}${d.isOnline ? ` · ${t('hub.drivers.online')}` : ''}`;
  return (
    <Dialog open={open} title={t('hub.rides.assign')} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (driverId) onSubmit(driverId, note.trim()); }}>
        <Field label={t('hub.common.search')}>{(p) => <Input {...p} type="search" value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
        <Field label={t('hub.rides.driver')}>
          {(p) => (
            <Select {...p} required value={driverId} onChange={(e) => setDriverId(e.target.value)}>
              <option value="">…</option>
              {(drivers.data?.items ?? []).map((d) => <option key={d.id} value={d.id}>{label(d)}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('hub.common.note')}>{(p) => <Input {...p} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Action tone="secondary" onClick={onClose}>{t('hub.common.cancel')}</Action>
          <Action type="submit" busy={busy} disabled={busy || !driverId}>{t('hub.rides.assign')}</Action>
        </div>
      </form>
    </Dialog>
  );
}
