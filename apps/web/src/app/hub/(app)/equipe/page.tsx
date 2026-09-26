'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading, useLang } from '@/components/hub/common';
import { Badge, Card, DataTable, PageTitle } from '@/components/ui/kit';
import { formatDate, fullName } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

/** Équipe de My Hub : rôles et état du second facteur (création et réinitialisation par l'API d'administration). */
export default function StaffPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const staff = useQuery({ queryKey: ['hub', 'staff'], queryFn: () => hubApi.admin.staff() });
  return (
    <div>
      <PageTitle title={t('hub.staff.title')} />
      <Card>
        {staff.isPending ? <Loading /> : staff.isError ? <ErrorBlock error={staff.error} onRetry={() => void staff.refetch()} /> : (
          <DataTable
            caption={t('hub.staff.title')}
            rows={staff.data}
            rowKey={(s) => s.id}
            empty={t('hub.common.empty')}
            columns={[
              { key: 'name', header: t('hub.clients.name'), cell: (s) => fullName(s.firstName, s.lastName) },
              { key: 'email', header: t('hub.staff.email'), cell: (s) => s.email ?? '' },
              { key: 'roles', header: t('hub.staff.roles'), cell: (s) => <span className="flex flex-wrap gap-1">{s.roles.map((r) => <Badge key={r} tone="info">{t(`enum.role.${r}`)}</Badge>)}</span> },
              { key: 'mfa', header: t('hub.staff.mfa'), cell: (s) => (s.mfaEnrolled ? <Badge tone="success">{t('hub.staff.enrolled')}</Badge> : <Badge tone="warning">{t('hub.staff.notEnrolled')}</Badge>) },
              { key: 'status', header: t('hub.common.status'), cell: (s) => s.status },
              { key: 'since', header: t('hub.drivers.since'), cell: (s) => formatDate(s.createdAt, lang) },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
