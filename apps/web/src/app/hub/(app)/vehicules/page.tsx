'use client';

import { VEHICLE_STATUSES, type AdminVehicle } from '@neomoov/domain';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, ListToolbar, Loading, pageLabels, useCanWrite, usePagedList } from '@/components/hub/common';
import { VehiclesTable } from '@/components/hub/vehicles-table';
import { Card, PageTitle, Pagination } from '@/components/ui/kit';
import { hubApi } from '@/lib/hub-api';

export default function VehiclesPage() {
  const { t } = useTranslation();
  const writable = useCanWrite();
  const queryClient = useQueryClient();
  const list = usePagedList<AdminVehicle>('vehicles', (q) => hubApi.admin.vehicles(q));
  return (
    <div>
      <PageTitle title={t('hub.vehicles.title')} />
      <Card>
        <ListToolbar filters={list.filters} setQ={list.setQ} setStatus={list.setStatus} statuses={VEHICLE_STATUSES.map((s) => ({ value: s, label: t(`enum.vehicleStatus.${s}`) }))} />
        {list.query.isPending ? <Loading /> : list.query.isError ? <ErrorBlock error={list.query.error} onRetry={() => void list.query.refetch()} /> : (
          <>
            <VehiclesTable vehicles={list.query.data.items} writable={writable} onChanged={() => void queryClient.invalidateQueries({ queryKey: ['hub', 'vehicles'] })} />
            <Pagination page={list.filters.page} pageSize={list.pageSize} total={list.query.data.total} onPage={list.setPage} labels={pageLabels(t, list.filters.page, list.pageSize, list.query.data.total)} />
          </>
        )}
      </Card>
    </div>
  );
}
