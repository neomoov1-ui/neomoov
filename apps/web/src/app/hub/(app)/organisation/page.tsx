'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading, useLang } from '@/components/hub/common';
import { OrgPage, useOrg } from '@/components/hub/org-context';
import { Card, Notice, PageTitle, Stat } from '@/components/ui/kit';
import { formatMoney } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

const DASHBOARD = ['dashboard.read', 'rides.read', 'drivers.read', 'statements.read'];

/** Étape 21 : tableau de bord de l'organisation (et de ses sous-organisations) : courses du jour, chauffeurs en ligne, relevés à venir. */
export default function OrgDashboardPage() {
  return <OrgPage>{(orgId) => <Dashboard orgId={orgId} />}</OrgPage>;
}

function Dashboard({ orgId }: { orgId: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { home, can } = useOrg();
  const allowed = can(...DASHBOARD);
  const overview = useQuery({ queryKey: ['org', orgId, 'overview'], queryFn: () => hubApi.org.overview(orgId), enabled: allowed, refetchInterval: 30_000 });
  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={home?.organization.name ?? t('org.dashboard.title')} subtitle={t('org.dashboard.subtree')} />
      {!allowed ? <Notice tone="info">{t('hub.common.forbidden')}</Notice> : overview.isPending ? <Loading /> : overview.isError ? <ErrorBlock error={overview.error} onRetry={() => void overview.refetch()} /> : (
        <>
          <Card title={t('org.nav.rides')}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label={t('org.dashboard.ridesToday')} value={overview.data.ridesToday} {...(can('rides.read') ? { href: '/hub/organisation/courses?view=recent' } : {})} />
              <Stat label={t('org.dashboard.ridesActive')} value={overview.data.ridesActive} tone={overview.data.ridesActive ? 'info' : 'neutral'} {...(can('rides.read') ? { href: '/hub/organisation/courses' } : {})} />
              <Stat label={t('org.dashboard.completedToday')} value={overview.data.completedToday} tone="success" />
              <Stat label={t('org.dashboard.revenueToday')} value={formatMoney(overview.data.revenueTodayCents, lang)} />
              <Stat label={t('org.dashboard.scheduled')} value={overview.data.scheduledUpcoming} {...(can('rides.read') ? { href: '/hub/organisation/courses?view=scheduled' } : {})} />
            </div>
          </Card>
          <Card title={t('org.nav.drivers')}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label={t('org.dashboard.driversActive')} value={overview.data.driversActive} {...(can('drivers.read') ? { href: '/hub/organisation/chauffeurs' } : {})} />
              <Stat label={t('org.dashboard.driversOnline')} value={overview.data.driversOnline} tone={overview.data.driversOnline ? 'success' : 'neutral'} />
              <Stat label={t('org.dashboard.driversPaused')} value={overview.data.driversPaused} />
            </div>
          </Card>
          <Card title={t('org.nav.statements')}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label={t('org.dashboard.statementsPending')} value={overview.data.statementsPending.count} {...(can('statements.read') ? { href: '/hub/organisation/releves' } : {})} />
              <Stat label={t('org.dashboard.statementsNet')} value={formatMoney(overview.data.statementsPending.netCents, lang)} />
              <Stat label={t('org.dashboard.subOrganizations')} value={overview.data.subOrganizations} {...(can('organizations.read', 'organizations.manage') ? { href: '/hub/organisation/sous-organisations' } : {})} />
              <Stat label={t('org.dashboard.members')} value={overview.data.members} {...(can('members.read', 'members.invite') ? { href: '/hub/organisation/membres' } : {})} />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
