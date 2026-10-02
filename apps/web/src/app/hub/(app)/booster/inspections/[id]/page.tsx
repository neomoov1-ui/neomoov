'use client';

import { BODY_ZONE_LABELS, INSPECTION_ITEM_LABELS, INSPECTION_ITEMS, type AdminInspectionView } from '@neomoov/domain';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading, useLang } from '@/components/hub/common';
import { Badge, Card, DataTable, Notice, PageTitle, focus, type Column } from '@/components/ui/kit';
import { formatDateTime } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

const SEVERITY_TONE = { ok: 'success', minor: 'warning', major: 'danger' } as const;
const STATE_TONE = { ok: 'success', minor: 'warning', major: 'danger', na: 'neutral' } as const;
type ItemRow = { item: (typeof INSPECTION_ITEMS)[number]; state: 'ok' | 'minor' | 'major' | 'na'; note: string | null };

/** Image privée lue par la passerelle (jeton du personnel), affichée depuis une URL `blob:` locale ; jamais de lien public. */
function PrivateImage({ src, alt }: { src: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current: string | null = null;
    fetch(src, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        current = URL.createObjectURL(await res.blob());
        setUrl(current);
      })
      .catch(() => setFailed(true));
    return () => {
      if (current) URL.revokeObjectURL(current);
    };
  }, [src]);
  if (failed) return <div className="flex h-40 items-center justify-center rounded-md bg-slate-100 text-xs text-slate-500">{alt}</div>;
  if (!url) return <div className="h-40 animate-pulse rounded-md bg-slate-100" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} className="h-40 w-full rounded-md object-cover" />;
}

/** Détail d'un rapport de vérification sommaire : identification, éléments de l'article 65, zones, analyse, photos, PDF. */
export default function InspectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const lang = useLang();
  const labelLang = i18n.language === 'en' ? 'en' : 'fr';
  const detail = useQuery({ queryKey: ['hub', 'booster-inspection', id], queryFn: () => hubApi.admin.boosterInspection(id) });
  if (detail.isPending) return <Loading />;
  if (detail.isError) return <ErrorBlock error={detail.error} onRetry={() => void detail.refetch()} />;
  const r: AdminInspectionView = detail.data;
  const rows: ItemRow[] = INSPECTION_ITEMS.map((item) => ({ item, state: r.items[item].state, note: r.items[item].note }));
  const columns: Column<ItemRow>[] = [
    { key: 'item', header: t('hub.booster.item'), cell: (x) => INSPECTION_ITEM_LABELS[x.item][labelLang] },
    { key: 'state', header: t('hub.booster.state'), cell: (x) => <Badge tone={STATE_TONE[x.state]}>{t(`hub.booster.itemStates.${x.state}`)}</Badge> },
    { key: 'note', header: t('hub.booster.observation'), cell: (x) => x.note ?? '' },
  ];
  const pair = (label: string, value: string) => (
    <div className="contents"><dt className="font-semibold">{label}</dt><dd>{value}</dd></div>
  );
  return (
    <div className="flex flex-col gap-5">
      <PageTitle
        title={`${t('hub.booster.inspectionsTitle')} · ${formatDateTime(r.inspectedAt, lang)}`}
        subtitle={<Link href="/hub/booster/inspections" className={`text-brand-blue-dark underline ${focus}`}>{t('hub.booster.backToList')}</Link>}
        actions={(
          <div className="flex items-center gap-3">
            <Badge tone={SEVERITY_TONE[r.severity]}>{t(`hub.booster.severities.${r.severity}`)}</Badge>
            {r.formats.includes('pdf') ? <a href={`/api/v1/admin/booster/inspections/${encodeURIComponent(r.id)}/pdf`} className={`rounded-md bg-brand-blue px-3 py-2 text-sm font-semibold text-white ${focus}`}>{t('hub.booster.pdf')}</a> : <span className="text-xs text-slate-500">{t('hub.booster.pdfPending')}</span>}
          </div>
        )}
      />
      {r.severity === 'major' ? <Notice tone="danger">{t('hub.booster.majorWarning')}</Notice> : null}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={t('hub.booster.identification')}>
          <dl className="grid grid-cols-[11rem_1fr] gap-x-2 gap-y-1 text-sm">
            {pair(t('hub.booster.driver'), `${r.driverFullName ?? ''} (${r.driverPublicNumber})`)}
            {pair(t('hub.booster.driverName'), r.driverName ?? '')}
            {pair(t('hub.booster.licence'), r.licenceNumberLast4 ? `…${r.licenceNumberLast4}` : '')}
            {pair(t('hub.booster.plate'), r.plate ?? '')}
            {pair(t('hub.booster.accessory'), r.accessoryNumber ?? '')}
            {pair(t('hub.booster.odometer'), r.odometerKm !== null ? `${r.odometerKm.toLocaleString(lang)} km` : '')}
            {pair(t('hub.booster.energy'), r.energyPercent !== null ? `${r.energyPercent} %` : '')}
            {pair(t('hub.booster.warningLight'), r.warningLightOn ? r.warningLightReason ?? t('hub.common.yes') : t('hub.booster.none'))}
            {pair(t('hub.booster.status'), t(`hub.booster.statuses.${r.status}`))}
            {pair(t('hub.booster.confirmedAt'), r.confirmedAt ? formatDateTime(r.confirmedAt, lang) : '')}
          </dl>
          <p className={`mt-3 text-sm font-semibold ${r.allItemsChecked ? 'text-emerald-700' : 'text-red-700'}`}>{t(r.allItemsChecked ? 'hub.booster.allChecked' : 'hub.booster.incomplete')}</p>
        </Card>
        <Card title={t('hub.booster.zones')}>
          {r.bodyZones.length === 0 ? <p className="text-sm text-slate-600">{t('hub.booster.noZone')}</p> : (
            <ul className="flex flex-col gap-1 text-sm">
              {r.bodyZones.map((z) => <li key={z.zone}><strong>{BODY_ZONE_LABELS[z.zone][labelLang]}</strong> : {z.description}</li>)}
            </ul>
          )}
          <h3 className="mt-4 text-sm font-semibold">{t('hub.booster.notes')}</h3>
          <p className="whitespace-pre-wrap text-sm text-slate-700">{r.notes ?? t('hub.booster.none')}</p>
          <h3 className="mt-4 text-sm font-semibold">{t('hub.booster.analysis')}</h3>
          <p className="text-sm text-slate-700">
            {r.analysis.status === 'done' ? t('hub.booster.analysisDone', { percent: Math.round((r.analysis.confidence ?? 0) * 100) }) : r.analysis.status === 'failed' ? t('hub.booster.analysisFailed') : t('hub.booster.analysisNone')}
            {r.analysis.summary ? <><br />{r.analysis.summary}</> : null}
          </p>
        </Card>
      </div>
      <Card title={t('hub.booster.items')}>
        <DataTable caption={t('hub.booster.items')} columns={columns} rows={rows} rowKey={(x) => x.item} empty={t('hub.common.empty')} />
      </Card>
      <Card title={t('hub.booster.photos')}>
        {r.photos.length === 0 ? <p className="text-sm text-slate-600">{t('hub.common.none')}</p> : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {r.photos.map((p) => (
              <figure key={p.index}>
                <PrivateImage src={`/api/v1/admin/booster/inspections/${encodeURIComponent(r.id)}/photos/${p.index}`} alt={t('hub.booster.photo', { index: p.index + 1, kind: t(`hub.booster.photoKinds.${p.kind}`) })} />
                <figcaption className="mt-1 text-xs text-slate-600">{t('hub.booster.photo', { index: p.index + 1, kind: t(`hub.booster.photoKinds.${p.kind}`) })}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
