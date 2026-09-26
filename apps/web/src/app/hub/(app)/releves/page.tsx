'use client';

import type { AdminStatement } from '@neomoov/domain';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, ListToolbar, Loading, pageLabels, useLang, usePagedList } from '@/components/hub/common';
import { Badge, Card, DataTable, Notice, PageTitle, Pagination, focus, type Column } from '@/components/ui/kit';
import { formatDate, formatMoney } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

/** Relevés hebdomadaires des chauffeurs (lecture) ; génération, aperçu et émission arrivent avec l'étape 9. */
export default function StatementsPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const list = usePagedList<AdminStatement>('statements', (q) => hubApi.admin.statements(q));
  const columns: Column<AdminStatement>[] = [
    { key: 'period', header: t('hub.statements.period'), cell: (s) => `${formatDate(s.periodStart, lang)} → ${formatDate(s.periodEnd, lang)}` },
    { key: 'driver', header: t('hub.statements.driver'), cell: (s) => <Link className={`text-brand-blue-dark underline ${focus}`} href={`/hub/chauffeurs/${s.driverId}`}>{s.driverName ?? s.driverPublicNumber}</Link> },
    { key: 'status', header: t('hub.statements.status'), cell: (s) => <Badge>{s.status}</Badge> },
    { key: 'credits', header: t('hub.statements.credits'), className: 'text-right', cell: (s) => formatMoney(s.creditsCents, lang) },
    { key: 'debits', header: t('hub.statements.debits'), className: 'text-right', cell: (s) => formatMoney(s.debitsCents, lang) },
    { key: 'net', header: t('hub.statements.net'), className: 'text-right font-semibold', cell: (s) => formatMoney(s.netCents, lang) },
    { key: 'issued', header: t('hub.statements.issued'), cell: (s) => formatDate(s.issuedAt, lang) },
  ];
  return (
    <div>
      <PageTitle title={t('hub.statements.title')} />
      <div className="mb-3"><Notice tone="info">{t('hub.statements.generation')}</Notice></div>
      <Card>
        <ListToolbar filters={list.filters} setQ={list.setQ} />
        {list.query.isPending ? <Loading /> : list.query.isError ? <ErrorBlock error={list.query.error} onRetry={() => void list.query.refetch()} /> : (
          <>
            <DataTable caption={t('hub.statements.title')} columns={columns} rows={list.query.data.items} rowKey={(s) => s.id} empty={t('hub.common.empty')} />
            <Pagination page={list.filters.page} pageSize={list.pageSize} total={list.query.data.total} onPage={list.setPage} labels={pageLabels(t, list.filters.page, list.pageSize, list.query.data.total)} />
          </>
        )}
      </Card>
    </div>
  );
}
