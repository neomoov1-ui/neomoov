'use client';

import { validateRing, type ZoneGeometry } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading, useCanWrite, useErrorText } from '@/components/hub/common';
import { Action, Badge, Card, Field, Input, Notice, PageTitle, cx, focus } from '@/components/ui/kit';
import { hubApi } from '@/lib/hub-api';

const ZoneMap = dynamic(() => import('@/components/hub/zone-map'), { ssr: false, loading: () => <div className="h-[480px] animate-pulse rounded-md bg-slate-100" /> });

/** Zones tarifaires et de service : visualisation, et éditeur de polygone validé (fermé, sans auto-intersection). */
export default function ZonesPage() {
  const { t } = useTranslation();
  const writable = useCanWrite();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const zones = useQuery({ queryKey: ['hub', 'zones'], queryFn: () => hubApi.admin.zones() });
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<[number, number][] | null>(null);
  const [name, setName] = useState('');

  const zone = zones.data?.find((z) => z.code === selected) ?? null;
  const shapes = useMemo(() => (zones.data ?? []).map((z: ZoneGeometry) => ({ code: z.code, name: z.name, ring: (z.geometry.coordinates[0] ?? []).slice(0, -1) })), [zones.data]);
  const closed = draft && draft.length >= 3 ? [...draft, draft[0]!] : null;
  const check = closed ? validateRing(closed) : null;

  const save = useMutation({
    mutationFn: () => hubApi.admin.updateZone(zone!.code, { ...(name.trim() && name.trim() !== zone!.name ? { name: name.trim() } : {}), geometry: { type: 'Polygon', coordinates: [closed!] } }),
    onSuccess: () => {
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ['hub', 'zones'] });
    },
  });

  if (zones.isPending) return <Loading />;
  if (zones.isError) return <ErrorBlock error={zones.error} onRetry={() => void zones.refetch()} />;

  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={t('hub.zones.title')} subtitle={t('hub.zones.subtitle')} />
      <div className="grid gap-5 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <Card>
          <ul className="flex flex-col gap-1" aria-label={t('hub.zones.title')}>
            {zones.data.map((z) => (
              <li key={z.code}>
                <button
                  type="button"
                  aria-pressed={selected === z.code}
                  onClick={() => { setSelected(z.code); setDraft(null); setName(z.name); save.reset(); }}
                  className={cx('flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm', focus, selected === z.code ? 'bg-brand-tint font-semibold' : 'hover:bg-brand-mist')}
                >
                  <span>{z.name}<span className="block text-xs text-slate-600">{z.code} · {z.type}</span></span>
                  {z.active ? <Badge tone="success">{t('hub.zones.active')}</Badge> : null}
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          {zone && writable ? (
            <div className="mb-3 flex flex-wrap items-end gap-2">
              {draft === null ? (
                <Action onClick={() => { setDraft([]); save.reset(); }}>{t('hub.zones.edit')}</Action>
              ) : (
                <>
                  <Field label={t('hub.zones.name')}>{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
                  <Action tone="secondary" disabled={!draft.length} onClick={() => setDraft(draft.slice(0, -1))}>{t('hub.zones.undo')}</Action>
                  <Action tone="secondary" onClick={() => setDraft([])}>{t('hub.zones.reset')}</Action>
                  <Action busy={save.isPending} disabled={!check?.valid || save.isPending} onClick={() => save.mutate()}>{t('hub.zones.save')}</Action>
                  <Action tone="ghost" onClick={() => setDraft(null)}>{t('hub.common.cancel')}</Action>
                  <span className="text-sm text-slate-700" role="status">{t('hub.zones.points', { count: draft.length })}</span>
                </>
              )}
            </div>
          ) : null}
          {check && !check.valid ? <div className="mb-3"><Notice tone="warning">{t(`hub.zones.refusal.${check.reason}`)}</Notice></div> : null}
          {save.isError ? <div className="mb-3"><Notice tone="danger">{errorText(save.error)}</Notice></div> : null}
          {save.isSuccess ? <div className="mb-3"><Notice tone="success">{t('hub.zones.saved')}</Notice></div> : null}
          <ZoneMap zones={shapes} selected={selected} draft={draft} onAddPoint={(lng, lat) => setDraft((d) => (d ? [...d, [lng, lat]] : d))} />
        </Card>
      </div>
    </div>
  );
}
