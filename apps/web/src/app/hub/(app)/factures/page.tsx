'use client';

import type { AdminInvoice } from '@neomoov/domain';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, ListToolbar, Loading, pageLabels, useLang, usePagedList } from '@/components/hub/common';
import { Badge, Card, DataTable, PageTitle, Pagination, focus, type Column } from '@/components/ui/kit';
import { formatDateTime, formatMoney } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

const SEV_TONES: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = { accepted: 'success', sent: 'warning', pending: 'warning', rejected: 'danger', failed: 'danger' };

/** Factures (numéro, fournisseur, total, mode de paiement) et état de transmission au SEV (Revenu Québec). */
export default function InvoicesPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const list = usePagedList<AdminInvoice>('invoices', (q) => hubApi.admin.invoices(q));
  const columns: Column<AdminInvoice>[] = [
    { key: 'number', header: t('hub.invoices.number'), cell: (i) => <code>{i.number}</code> },
    { key: 'ride', header: t('hub.invoices.ride'), cell: (i) => <Link className={`text-brand-blue-dark underline ${focus}`} href={`/hub/courses/${i.rideId}`}>{i.rideId.slice(0, 8)}</Link> },
    { key: 'supplier', header: t('hub.invoices.supplier'), cell: (i) => i.supplierName },
    { key: 'total', header: t('hub.invoices.total'), className: 'text-right', cell: (i) => formatMoney(i.totalCents, lang) },
    { key: 'payment', header: t('hub.invoices.payment'), cell: (i) => t(`enum.paymentMethod.${i.paymentMethod}`) },
    { key: 'sev', header: t('hub.invoices.sev'), cell: (i) => <span><Badge tone={SEV_TONES[i.sevStatus] ?? 'neutral'}>{i.sevStatus}</Badge>{i.sevTransactionId ? <span className="block text-xs text-slate-600">{i.sevTransactionId}</span> : null}</span> },
    { key: 'issued', header: t('hub.invoices.issued'), cell: (i) => formatDateTime(i.issuedAt, lang) },
  ];
  return (
    <div>
      <PageTitle title={t('hub.invoices.title')} subtitle={t('hub.common.nextStep', { step: 9 })} />
      <Card>
        <ListToolbar filters={list.filters} setQ={list.setQ} />
        {list.query.isPending ? <Loading /> : list.query.isError ? <ErrorBlock error={list.query.error} onRetry={() => void list.query.refetch()} /> : (
          <>
            <DataTable caption={t('hub.invoices.title')} columns={columns} rows={list.query.data.items} rowKey={(i) => i.id} empty={t('hub.common.empty')} />
            <Pagination page={list.filters.page} pageSize={list.pageSize} total={list.query.data.total} onPage={list.setPage} labels={pageLabels(t, list.filters.page, list.pageSize, list.query.data.total)} />
          </>
        )}
      </Card>
    </div>
  );
}
