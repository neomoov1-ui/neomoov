'use client';

/** Véhicules d'un chauffeur ou de toute la flotte : statut et prochaine inspection modifiables par l'opérateur. */
import { VEHICLE_STATUSES, type AdminVehicle } from '@neomoov/domain';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Action, DataTable, Dialog, Field, Input, Notice, Select } from '@/components/ui/kit';
import { formatDate } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';
import { EnumBadge, useErrorText, useLang } from './common';

export function VehiclesTable({ vehicles, writable, onChanged }: { vehicles: AdminVehicle[]; writable: boolean; onChanged: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const errorText = useErrorText();
  const [editing, setEditing] = useState<AdminVehicle | null>(null);
  const [status, setStatus] = useState('');
  const [inspection, setInspection] = useState('');
  const save = useMutation({
    mutationFn: () => hubApi.admin.reviewVehicle(editing!.id, { status: status as AdminVehicle['status'], ...(inspection ? { nextInspectionDueOn: inspection } : {}) }),
    onSuccess: () => {
      setEditing(null);
      onChanged();
    },
  });
  return (
    <>
      <DataTable
        rows={vehicles}
        rowKey={(v) => v.id}
        empty={t('hub.common.empty')}
        columns={[
          { key: 'vehicle', header: t('hub.vehicles.vehicle'), cell: (v) => `${v.make} ${v.model} ${v.year} · ${v.colour}` },
          { key: 'driver', header: t('hub.documents.driver'), cell: (v) => `${v.driverName ?? ''} (${v.driverPublicNumber})` },
          { key: 'category', header: t('hub.rides.category'), cell: (v) => t(`enum.category.${v.category}`) },
          { key: 'plate', header: t('hub.vehicles.plate'), cell: (v) => v.plate },
          { key: 'seats', header: t('hub.vehicles.seats'), className: 'text-right', cell: (v) => v.seats },
          { key: 'status', header: t('hub.common.status'), cell: (v) => <EnumBadge group="vehicleStatus" value={v.status} /> },
          { key: 'inspection', header: t('hub.vehicles.inspection'), cell: (v) => formatDate(v.nextInspectionDueOn, lang) },
          ...(writable ? [{ key: 'edit', header: t('hub.common.actions'), cell: (v: AdminVehicle) => <Action tone="secondary" onClick={() => { setEditing(v); setStatus(v.status); setInspection(v.nextInspectionDueOn ?? ''); }}>{t('hub.vehicles.review')}</Action> }] : []),
        ]}
      />
      <Dialog open={editing !== null} title={t('hub.vehicles.review')} onClose={() => setEditing(null)}>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <Field label={t('hub.common.status')}>
            {(p) => <Select {...p} value={status} onChange={(e) => setStatus(e.target.value)}>{VEHICLE_STATUSES.map((s) => <option key={s} value={s}>{t(`enum.vehicleStatus.${s}`)}</option>)}</Select>}
          </Field>
          <Field label={t('hub.vehicles.inspection')}>{(p) => <Input {...p} type="date" value={inspection} onChange={(e) => setInspection(e.target.value)} />}</Field>
          {save.isError ? <Notice tone="danger">{errorText(save.error)}</Notice> : null}
          <div className="flex justify-end gap-2">
            <Action tone="secondary" onClick={() => setEditing(null)}>{t('hub.common.cancel')}</Action>
            <Action type="submit" busy={save.isPending}>{t('hub.common.save')}</Action>
          </div>
        </form>
      </Dialog>
    </>
  );
}
