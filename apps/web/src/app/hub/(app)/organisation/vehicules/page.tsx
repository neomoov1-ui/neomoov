'use client';

import { VEHICLE_STATUSES, type AdminVehicle } from '@neomoov/domain';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, ListToolbar, Loading, pageLabels, usePagedList } from '@/components/hub/common';
import { OrgPage } from '@/components/hub/org-context';
import { VehiclesTable } from '@/components/hub/vehicles-table';
import { Card, PageTitle, Pagination } from '@/components/ui/kit';
import { hubApi } from '@/lib/hub-api';

/** Étape 21 : véhicules de l'organisation, même tableau que la plateforme, en lecture (les écritures viendront avec la flotte). */
export default function OrgVehiclesPage() {
  return <OrgPage permissions={['vehicles.read']}>{(orgId) => <Vehicles orgId={orgId} />}</OrgPage>;
}

function Vehicles({ orgId }: { orgId: string }) {
  const { t } = useTranslation();
  const list = usePagedList<AdminVehicle>(`org-${orgId}-vehicles`, (q) => hubApi.org.vehicles(orgId, q));
  return (
    <div>
      <PageTitle title={t('org.nav.vehicles')} />
      <Card>
        <ListToolbar filters={list.filters} setQ={list.setQ} setStatus={list.setStatus} statuses={VEHICLE_STATUSES.map((s) => ({ value: s, label: t(`enum.vehicleStatus.${s}`) }))} />
        {list.query.isPending ? <Loading /> : list.query.isError ? <ErrorBlock error={list.query.error} onRetry={() => void list.query.refetch()} /> : (
          <>
            <VehiclesTable vehicles={list.query.data.items} writable={false} onChanged={() => undefined} />
            <Pagination page={list.filters.page} pageSize={list.pageSize} total={list.query.data.total} onPage={list.setPage} labels={pageLabels(t, list.filters.page, list.pageSize, list.query.data.total)} />
          </>
        )}
      </Card>
    </div>
  );
}
