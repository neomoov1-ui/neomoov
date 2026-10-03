'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading, useErrorText, useHubUser } from '@/components/hub/common';
import { DriverExclusionsTable, ZoneExclusionsTable } from '@/components/hub/pilot-exclusions';
import { Action, Card, Checkbox, Notice, PageTitle } from '@/components/ui/kit';
import { hubApi } from '@/lib/hub-api';

/**
 * Neomoov Pilote (étape 24) : rapport des exclusions de zones dans les critères des chauffeurs et choix des zones
 * surveillées (réglage `pilot.watched_zones`, administrateur). Écran réservé au personnel (`pilot.zones.read`) : rien de
 * cette page n'est public.
 */
export default function PilotZonesPage() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const admin = useHubUser().roles.includes('admin');
  const report = useQuery({ queryKey: ['hub', 'pilot', 'zone-exclusions'], queryFn: () => hubApi.admin.pilotZoneExclusions() });
  const [watched, setWatched] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (report.data) setWatched(report.data.watchedZones);
  }, [report.data]);
  const save = useMutation({
    mutationFn: () => hubApi.admin.updateSetting('pilot.watched_zones', watched),
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ['hub', 'pilot'] });
    },
  });
  const toggle = (code: string, on: boolean) => {
    setSaved(false);
    setWatched((list) => (on ? [...new Set([...list, code])] : list.filter((c) => c !== code)));
  };

  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={t('hub.pilot.title')} />
      <Notice tone="info">{t('hub.pilot.intro')}</Notice>
      {report.isPending ? <Loading /> : report.isError ? <ErrorBlock error={report.error} onRetry={() => void report.refetch()} /> : (
        <>
          <Card title={t('hub.pilot.watched')}>
            <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
              <p className="text-sm text-slate-700">{admin ? t('hub.pilot.watchedHint') : t('hub.pilot.readOnly')}</p>
              {report.data.zones.length === 0 ? <p className="text-sm text-slate-700">{t('hub.pilot.noZones')}</p> : (
                <fieldset className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <legend className="sr-only">{t('hub.pilot.watched')}</legend>
                  {report.data.zones.map((z) => (
                    <Checkbox key={z.code} label={`${z.name} (${z.code})`} checked={watched.includes(z.code)} disabled={!admin || save.isPending} onChange={(e) => toggle(z.code, e.currentTarget.checked)} />
                  ))}
                </fieldset>
              )}
              {!watched.length ? <p className="text-sm text-slate-700">{t('hub.pilot.noneWatched')}</p> : null}
              {save.isError ? <Notice tone="danger">{errorText(save.error)}</Notice> : null}
              {saved ? <Notice tone="success">{t('hub.pilot.saved')}</Notice> : null}
              {admin ? <div><Action type="submit" busy={save.isPending}>{t('hub.pilot.save')}</Action></div> : null}
            </form>
          </Card>
          <Card title={t('hub.pilot.byZone')}><ZoneExclusionsTable report={report.data} /></Card>
          <Card title={t('hub.pilot.byDriver')}><DriverExclusionsTable report={report.data} /></Card>
        </>
      )}
    </div>
  );
}
