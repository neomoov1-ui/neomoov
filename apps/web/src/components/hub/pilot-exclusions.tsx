'use client';

/**
 * Neomoov Pilote (étape 24), écran du personnel : zones exclues par les critères des chauffeurs, par zone puis par
 * chauffeur, et zones surveillées (surveillance de la discrimination indirecte). Tableaux exportés pour les tests de rendu.
 */
import type { PilotZoneExclusionsView } from '@neomoov/domain';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { Badge, DataTable, focus, type Column } from '@/components/ui/kit';

type ZoneRow = PilotZoneExclusionsView['zones'][number];
type DriverRow = PilotZoneExclusionsView['drivers'][number];

export function ZoneExclusionsTable({ report }: { report: PilotZoneExclusionsView }) {
  const { t } = useTranslation();
  const columns: Column<ZoneRow>[] = [
    { key: 'zone', header: t('hub.pilot.zone'), cell: (z) => <span><span className="font-semibold">{z.name}</span> <code className="text-xs">{z.code}</code></span> },
    { key: 'type', header: t('hub.pilot.type'), cell: (z) => z.type },
    { key: 'watched', header: t('hub.pilot.watched'), cell: (z) => (z.watched ? <Badge tone="warning">{t('hub.pilot.watchedBadge')}</Badge> : null) },
    { key: 'drivers', header: t('hub.pilot.drivers'), className: 'text-right', cell: (z) => z.drivers },
    { key: 'enabled', header: t('hub.pilot.enabledDrivers'), className: 'text-right', cell: (z) => z.enabledDrivers },
    { key: 'origin', header: t('hub.pilot.origin'), className: 'text-right', cell: (z) => z.origin },
    { key: 'destination', header: t('hub.pilot.destination'), className: 'text-right', cell: (z) => z.destination },
  ];
  return <DataTable caption={t('hub.pilot.byZone')} columns={columns} rows={report.zones.filter((z) => z.drivers > 0 || z.watched)} rowKey={(z) => z.code} empty={t('hub.pilot.emptyZones')} />;
}

export function DriverExclusionsTable({ report }: { report: PilotZoneExclusionsView }) {
  const { t } = useTranslation();
  const names = new Map(report.zones.map((z) => [z.code, z.name]));
  const label = (codes: string[]) => codes.map((c) => names.get(c) ?? c).join(', ');
  const columns: Column<DriverRow>[] = [
    { key: 'driver', header: t('hub.pilot.driver'), cell: (d) => <Link href={`/hub/chauffeurs/${d.driverId}`} className={`text-brand-blue-dark underline ${focus}`}>{d.publicNumber}</Link> },
    { key: 'enabled', header: t('hub.pilot.enabled'), cell: (d) => <Badge tone={d.enabled ? 'success' : 'neutral'}>{d.enabled ? t('hub.pilot.on') : t('hub.pilot.off')}</Badge> },
    { key: 'origin', header: t('hub.pilot.originZones'), cell: (d) => label(d.origin) },
    { key: 'destination', header: t('hub.pilot.destinationZones'), cell: (d) => label(d.destination) },
    { key: 'watched', header: t('hub.pilot.watchedZones'), cell: (d) => (d.watched.length ? <Badge tone="danger">{label(d.watched)}</Badge> : null) },
  ];
  return <DataTable caption={t('hub.pilot.byDriver')} columns={columns} rows={report.drivers} rowKey={(d) => d.driverId} empty={t('hub.pilot.emptyDrivers')} />;
}
