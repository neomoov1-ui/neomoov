'use client';

import { STATEMENT_STATUSES, type AdminStatement } from '@neomoov/domain';
import { useTranslation } from 'react-i18next';
import { EnumBadge, ErrorBlock, ListToolbar, Loading, pageLabels, useLang, usePagedList } from '@/components/hub/common';
import { OrgPage } from '@/components/hub/org-context';
import { Card, DataTable, PageTitle, Pagination, type Column } from '@/components/ui/kit';
import { formatDate, formatMoney } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

/** Étape 21 : relevés hebdomadaires des chauffeurs de l'organisation (mêmes colonnes que la plateforme, en lecture). */
export default function OrgStatementsPage() {
  return <OrgPage permissions={['statements.read']}>{(orgId) => <Statements orgId={orgId} />}</OrgPage>;
}

function Statements({ orgId }: { orgId: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const list = usePagedList<AdminStatement>(`org-${orgId}-statements`, (q) => hubApi.org.statements(orgId, q));
  const columns: Column<AdminStatement>[] = [
    { key: 'period', header: t('hub.statements.period'), cell: (s) => `${formatDate(s.periodStart, lang)} → ${formatDate(s.periodEnd, lang)}` },
    { key: 'driver', header: t('hub.statements.driver'), cell: (s) => s.driverName ?? s.driverPublicNumber },
    { key: 'status', header: t('hub.statements.status'), cell: (s) => <EnumBadge group="statementStatus" value={s.status} /> },
    { key: 'credits', header: t('hub.statements.credits'), className: 'text-right', cell: (s) => formatMoney(s.creditsCents, lang) },
    { key: 'debits', header: t('hub.statements.debits'), className: 'text-right', cell: (s) => formatMoney(s.debitsCents, lang) },
    { key: 'net', header: t('hub.statements.net'), className: 'text-right font-semibold', cell: (s) => formatMoney(s.netCents, lang) },
    { key: 'issued', header: t('hub.statements.issued'), cell: (s) => formatDate(s.issuedAt, lang) },
  ];
  return (
    <div>
      <PageTitle title={t('org.nav.statements')} />
      <Card>
        <ListToolbar filters={list.filters} setQ={list.setQ} setStatus={list.setStatus} statuses={STATEMENT_STATUSES.map((s) => ({ value: s, label: t(`enum.statementStatus.${s}`) }))} />
        {list.query.isPending ? <Loading /> : list.query.isError ? <ErrorBlock error={list.query.error} onRetry={() => void list.query.refetch()} /> : (
          <>
            <DataTable caption={t('org.nav.statements')} columns={columns} rows={list.query.data.items} rowKey={(s) => s.id} empty={t('hub.common.empty')} />
            <Pagination page={list.filters.page} pageSize={list.pageSize} total={list.query.data.total} onPage={list.setPage} labels={pageLabels(t, list.filters.page, list.pageSize, list.query.data.total)} />
          </>
        )}
      </Card>
    </div>
  );
}
