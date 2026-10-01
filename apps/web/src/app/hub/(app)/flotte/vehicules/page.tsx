'use client';

import type { AdminVehicle } from '@neomoov/domain';
import { MAINTENANCE_KINDS } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EnumBadge, ErrorBlock, ListToolbar, Loading, pageLabels, useErrorText, useLang, usePagedList } from '@/components/hub/common';
import { useFleetOrg } from '@/components/hub/fleet-org';
import { Action, Badge, DataTable, Dialog, Field, Input, Notice, PageTitle, Pagination, Select, type Column } from '@/components/ui/kit';
import { fleetApi } from '@/lib/fleet-api';
import { formatDate, formatMoney, fullName, montrealDate } from '@/lib/format';

/** Véhicules de l'organisation (étape 23) : ajout, affectation à un chauffeur, entretien et échéances. */
export default function FleetVehiclesPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const fleet = useFleetOrg();
  const list = usePagedList(`fleet-vehicles-${fleet.organizationId}`, (q) => fleetApi.vehicles(fleet.organizationId, q));
  const [adding, setAdding] = useState(false);
  const [assigning, setAssigning] = useState<AdminVehicle | null>(null);
  const [maintaining, setMaintaining] = useState<AdminVehicle | null>(null);

  const columns: Column<AdminVehicle>[] = [
    { key: 'vehicle', header: t('fleet.vehicles.model'), cell: (v) => <span className="font-medium">{v.make} {v.model} ({v.year})</span> },
    { key: 'plate', header: t('fleet.vehicles.plate'), cell: (v) => v.plate },
    { key: 'category', header: t('fleet.vehicles.category'), cell: (v) => <EnumBadge group="category" value={v.category} /> },
    { key: 'status', header: t('fleet.drivers.status'), cell: (v) => <EnumBadge group="vehicleStatus" value={v.status} /> },
    { key: 'holder', header: t('fleet.vehicles.holder'), cell: (v) => v.driverName ?? v.driverPublicNumber },
    { key: 'inspection', header: t('fleet.drivers.nextInspection'), cell: (v) => formatDate(v.nextInspectionDueOn, lang) },
    {
      key: 'actions', header: '',
      cell: (v) => (
        <div className="flex flex-wrap gap-2">
          {fleet.can('vehicles.assign') ? <Action tone="secondary" onClick={() => setAssigning(v)}>{t('fleet.vehicles.assign')}</Action> : null}
          <Action tone="secondary" onClick={() => setMaintaining(v)}>{t('fleet.vehicles.maintenance')}</Action>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={t('fleet.vehicles.title')} subtitle={fleet.name} actions={fleet.can('vehicles.manage') ? <Action onClick={() => setAdding(true)}>{t('fleet.vehicles.add')}</Action> : null} />
      <ListToolbar filters={list.filters} setQ={list.setQ} />
      {list.query.isPending ? <Loading /> : list.query.isError ? <ErrorBlock error={list.query.error} onRetry={() => void list.query.refetch()} /> : (
        <>
          <DataTable columns={columns} rows={list.query.data.items} rowKey={(v) => v.id} empty={t('fleet.vehicles.none')} caption={t('fleet.vehicles.title')} />
          <Pagination page={list.filters.page} pageSize={list.pageSize} total={list.query.data.total} onPage={list.setPage} labels={pageLabels(t, list.filters.page, list.pageSize, list.query.data.total)} />
        </>
      )}
      {adding ? <AddVehicleDialog onClose={() => setAdding(false)} /> : null}
      {assigning ? <AssignDialog vehicle={assigning} onClose={() => setAssigning(null)} /> : null}
      {maintaining ? <MaintenanceDialog vehicle={maintaining} onClose={() => setMaintaining(null)} /> : null}
    </div>
  );
}

/** Chauffeurs de l'organisation pour les listes de choix (première page de 100). */
function useDriverOptions() {
  const fleet = useFleetOrg();
  return useQuery({ queryKey: ['fleet', fleet.organizationId, 'driver-options'], queryFn: () => fleetApi.drivers(fleet.organizationId, { page: 1, pageSize: 100 }) });
}

function AddVehicleDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const fleet = useFleetOrg();
  const queryClient = useQueryClient();
  const drivers = useDriverOptions();
  const [form, setForm] = useState({ driverId: '', make: '', model: '', year: '2025', colour: '', plate: '', seats: '4', odometerKm: '' });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const create = useMutation({
    mutationFn: () => fleetApi.createVehicle(fleet.organizationId, {
      driverId: form.driverId, make: form.make, model: form.model, year: Number(form.year), colour: form.colour, plate: form.plate, seats: Number(form.seats),
      ...(form.odometerKm ? { odometerKm: Number(form.odometerKm) } : {}),
    }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['hub', `fleet-vehicles-${fleet.organizationId}`] }),
  });
  return (
    <Dialog open title={t('fleet.vehicles.add')} onClose={onClose}>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <Field label={t('fleet.vehicles.holder')}>
          {(p) => (
            <Select {...p} required value={form.driverId} onChange={set('driverId')}>
              <option value="" />
              {(drivers.data?.items ?? []).map((d) => <option key={d.id} value={d.id}>{fullName(d.firstName, d.lastName, d.publicNumber)}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('fleet.vehicles.make')}>{(p) => <Input {...p} required minLength={2} value={form.make} onChange={set('make')} />}</Field>
        <Field label={t('fleet.vehicles.model')}>{(p) => <Input {...p} required value={form.model} onChange={set('model')} />}</Field>
        <Field label={t('fleet.vehicles.year')}>{(p) => <Input {...p} required type="number" min={2015} max={2100} value={form.year} onChange={set('year')} />}</Field>
        <Field label={t('fleet.vehicles.colour')}>{(p) => <Input {...p} required minLength={2} value={form.colour} onChange={set('colour')} />}</Field>
        <Field label={t('fleet.vehicles.plate')}>{(p) => <Input {...p} required pattern="[A-Za-z0-9 -]{2,12}" value={form.plate} onChange={set('plate')} />}</Field>
        <Field label={t('fleet.vehicles.seats')}>{(p) => <Input {...p} required type="number" min={1} max={8} value={form.seats} onChange={set('seats')} />}</Field>
        <Field label={t('fleet.vehicles.odometer')}>{(p) => <Input {...p} type="number" min={0} value={form.odometerKm} onChange={set('odometerKm')} />}</Field>
        <div className="sm:col-span-2 flex flex-col gap-2">
          {create.isSuccess ? <Notice tone="success">{t('fleet.vehicles.pendingInspection')}</Notice> : null}
          {create.isError ? <Notice tone="danger">{errorText(create.error)}</Notice> : null}
          <Action type="submit" busy={create.isPending}>{t('fleet.vehicles.create')}</Action>
        </div>
      </form>
    </Dialog>
  );
}

function AssignDialog({ vehicle, onClose }: { vehicle: AdminVehicle; onClose: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const fleet = useFleetOrg();
  const queryClient = useQueryClient();
  const drivers = useDriverOptions();
  const [driverId, setDriverId] = useState('');
  const assign = useMutation({
    mutationFn: () => fleetApi.assignVehicle(fleet.organizationId, vehicle.id, driverId),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['hub', `fleet-vehicles-${fleet.organizationId}`] }); onClose(); },
  });
  return (
    <Dialog open title={`${t('fleet.vehicles.assign')} · ${vehicle.plate}`} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); assign.mutate(); }}>
        <Field label={t('fleet.vehicles.assignTo')}>
          {(p) => (
            <Select {...p} required value={driverId} onChange={(e) => setDriverId(e.target.value)}>
              <option value="" />
              {(drivers.data?.items ?? []).map((d) => <option key={d.id} value={d.id}>{fullName(d.firstName, d.lastName, d.publicNumber)}</option>)}
            </Select>
          )}
        </Field>
        {assign.isError ? <Notice tone="danger">{errorText(assign.error)}</Notice> : null}
        <Action type="submit" busy={assign.isPending}>{t('fleet.vehicles.assign')}</Action>
      </form>
    </Dialog>
  );
}

function MaintenanceDialog({ vehicle, onClose }: { vehicle: AdminVehicle; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const errorText = useErrorText();
  const fleet = useFleetOrg();
  const queryClient = useQueryClient();
  const key = ['fleet', fleet.organizationId, 'maintenance', vehicle.id];
  const view = useQuery({ queryKey: key, queryFn: () => fleetApi.maintenance(fleet.organizationId, vehicle.id) });
  const [form, setForm] = useState({ kind: 'inspection', performedOn: montrealDate(), odometerKm: '', cost: '', nextDueOn: '', nextDueKm: '', notes: '' });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const add = useMutation({
    mutationFn: () => fleetApi.addMaintenance(fleet.organizationId, vehicle.id, {
      kind: form.kind, performedOn: form.performedOn, ...(form.odometerKm ? { odometerKm: Number(form.odometerKm) } : {}), ...(form.cost ? { costCents: Math.round(Number(form.cost) * 100) } : {}),
      ...(form.nextDueOn ? { nextDueOn: form.nextDueOn } : {}), ...(form.nextDueKm ? { nextDueKm: Number(form.nextDueKm) } : {}), ...(form.notes ? { notes: form.notes } : {}),
    }),
    onSuccess: (data) => queryClient.setQueryData(key, data),
  });
  const tone = { ok: 'success', due_soon: 'warning', overdue: 'danger' } as const;
  return (
    <Dialog open wide title={t('fleet.vehicles.maintenanceTitle', { plate: vehicle.plate })} onClose={onClose}>
      {view.isPending ? <Loading /> : view.isError ? <ErrorBlock error={view.error} /> : (
        <div className="flex flex-col gap-3 text-sm">
          <p className="font-semibold">{t('fleet.vehicles.due')}</p>
          <div className="flex flex-wrap gap-2">
            {view.data.due.map((d) => <Badge key={d.kind} tone={tone[d.status]}>{t(`fleet.vehicles.kinds.${d.kind}`)} · {d.dueOn ? formatDate(d.dueOn, lang) : `${d.dueKm} km`} · {t(`fleet.vehicles.dueStatus.${d.status}`)}</Badge>)}
          </div>
          <p className="text-xs text-slate-600">{t('fleet.vehicles.ai')}</p>
          <ul className="flex flex-col gap-1">
            {view.data.records.map((r) => <li key={r.id}>{formatDate(r.performedOn, lang)} · {t(`fleet.vehicles.kinds.${r.kind}`)}{r.odometerKm !== null ? ` · ${r.odometerKm} km` : ''}{r.costCents !== null ? ` · ${formatMoney(r.costCents, lang)}` : ''}</li>)}
          </ul>
        </div>
      )}
      {fleet.can('vehicles.maintenance.manage') ? (
        <form className="mt-4 grid gap-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <Field label={t('fleet.vehicles.kind')}>
            {(p) => <Select {...p} value={form.kind} onChange={set('kind')}>{MAINTENANCE_KINDS.map((k) => <option key={k} value={k}>{t(`fleet.vehicles.kinds.${k}`)}</option>)}</Select>}
          </Field>
          <Field label={t('fleet.vehicles.performedOn')}>{(p) => <Input {...p} required type="date" value={form.performedOn} onChange={set('performedOn')} />}</Field>
          <Field label={t('fleet.vehicles.odometer')}>{(p) => <Input {...p} type="number" min={0} value={form.odometerKm} onChange={set('odometerKm')} />}</Field>
          <Field label={t('fleet.vehicles.cost')}>{(p) => <Input {...p} type="number" min={0} step="0.01" value={form.cost} onChange={set('cost')} />}</Field>
          <Field label={t('fleet.vehicles.nextDueOn')}>{(p) => <Input {...p} type="date" value={form.nextDueOn} onChange={set('nextDueOn')} />}</Field>
          <Field label={t('fleet.vehicles.nextDueKm')}>{(p) => <Input {...p} type="number" min={0} value={form.nextDueKm} onChange={set('nextDueKm')} />}</Field>
          <div className="sm:col-span-3 flex flex-col gap-2">
            {add.isError ? <Notice tone="danger">{errorText(add.error)}</Notice> : null}
            <Action type="submit" busy={add.isPending}>{t('fleet.vehicles.record')}</Action>
          </div>
        </form>
      ) : null}
    </Dialog>
  );
}
