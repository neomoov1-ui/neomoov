'use client';

import { SEV_STATUSES, type AdminInvoice, type SevStatusReport } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, ListToolbar, Loading, pageLabels, useErrorText, useHubUser, useLang, usePagedList } from '@/components/hub/common';
import { Action, Badge, Card, DataTable, Notice, PageTitle, Pagination, Stat, focus, type BadgeTone, type Column } from '@/components/ui/kit';
import { formatDateTime, formatMoney } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

const SEV_TONES: Record<string, BadgeTone> = { acknowledged: 'success', sent: 'info', pending: 'warning', error: 'danger' };
const KIND_TONES: Record<string, BadgeTone> = { ride: 'neutral', cancellation: 'warning', no_show: 'warning', credit_note: 'info' };
/** Rôles admis à reprendre une transmission (les mêmes que l'API). */
const RETRY_ROLES = ['admin', 'operator', 'finance'];
const RETRYABLE = new Set(['pending', 'error']);

/**
 * Factures et notes de crédit (numéro, nature, fournisseur, total, mode de paiement, PDF) et transmission au SEV :
 * compteurs par état, santé de l'adaptateur, dernières erreurs, reprise d'une facture en attente ou en erreur.
 */
export default function InvoicesPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const canRetry = useHubUser().roles.some((r) => RETRY_ROLES.includes(r));
  const list = usePagedList<AdminInvoice>('invoices', (q) => hubApi.admin.invoices(q));
  const sev = useQuery({ queryKey: ['hub', 'sev'], queryFn: () => hubApi.invoicing.sevStatus(), refetchInterval: 30_000 });
  const retry = useMutation({
    mutationFn: (invoiceId: string) => hubApi.invoicing.retrySev(invoiceId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['hub', 'invoices'] });
      void queryClient.invalidateQueries({ queryKey: ['hub', 'sev'] });
    },
  });
  const retryButton = (invoiceId: string, status: string) =>
    canRetry && RETRYABLE.has(status) ? (
      <Action tone="secondary" busy={retry.isPending && retry.variables === invoiceId} onClick={() => retry.mutate(invoiceId)}>{t('hub.sev.retry')}</Action>
    ) : null;

  const columns: Column<AdminInvoice>[] = [
    { key: 'number', header: t('hub.invoices.number'), cell: (i) => <code>{i.number}</code> },
    { key: 'kind', header: t('hub.sev.kind'), cell: (i) => <Badge tone={KIND_TONES[i.kind] ?? 'neutral'}>{t(`enum.invoiceKind.${i.kind}`)}</Badge> },
    { key: 'ride', header: t('hub.invoices.ride'), cell: (i) => <Link className={`text-brand-blue-dark underline ${focus}`} href={`/hub/courses/${i.rideId}`}>{i.rideId.slice(0, 8)}</Link> },
    { key: 'supplier', header: t('hub.invoices.supplier'), cell: (i) => i.supplierName },
    { key: 'total', header: t('hub.invoices.total'), className: 'text-right', cell: (i) => formatMoney(i.totalCents, lang) },
    { key: 'payment', header: t('hub.invoices.payment'), cell: (i) => t(`enum.paymentMethod.${i.paymentMethod}`) },
    { key: 'sev', header: t('hub.invoices.sev'), cell: (i) => <span><Badge tone={SEV_TONES[i.sevStatus] ?? 'neutral'}>{t(`enum.sevStatus.${i.sevStatus}`)}</Badge>{i.sevTransactionId ? <span className="block text-xs text-slate-600">{i.sevTransactionId}</span> : null}</span> },
    { key: 'issued', header: t('hub.invoices.issued'), cell: (i) => formatDateTime(i.issuedAt, lang) },
    {
      key: 'actions', header: t('hub.common.actions'), cell: (i) => (
        <div className="flex flex-wrap items-center gap-2">
          <a className={`text-brand-blue-dark underline ${focus}`} href={hubApi.invoicing.adminInvoicePdfUrl(i.id)} target="_blank" rel="noreferrer">{t('hub.sev.pdf')}</a>
          {retryButton(i.id, i.sevStatus)}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={t('hub.invoices.title')} subtitle={t('hub.sev.subtitle')} />
      <Card title={t('hub.sev.title')}>
        {retry.isError ? <div className="mb-3"><Notice tone="danger">{errorText(retry.error)}</Notice></div> : null}
        {retry.isSuccess ? <div className="mb-3"><Notice tone={retry.data.sevStatus === 'acknowledged' ? 'success' : 'warning'}>{t('hub.sev.retried', { number: retry.data.number, status: t(`enum.sevStatus.${retry.data.sevStatus}`) })}</Notice></div> : null}
        {sev.isPending ? <Loading /> : sev.isError ? <ErrorBlock error={sev.error} onRetry={() => void sev.refetch()} /> : <SevPanel report={sev.data} retryButton={retryButton} />}
      </Card>
      <Card>
        <ListToolbar filters={list.filters} setQ={list.setQ} setStatus={list.setStatus} statuses={SEV_STATUSES.map((s) => ({ value: s, label: t(`enum.sevStatus.${s}`) }))} />
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

function SevPanel({ report, retryButton }: { report: SevStatusReport; retryButton: (invoiceId: string, status: string) => ReactNode }) {
  const { t } = useTranslation();
  const lang = useLang();
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {SEV_STATUSES.map((s) => <Stat key={s} label={t(`enum.sevStatus.${s}`)} value={report.counts[s]} {...(s === 'error' && report.counts.error > 0 ? { tone: 'danger' as const } : s === 'pending' && report.counts.pending > 0 ? { tone: 'warning' as const } : {})} />)}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>{t('hub.sev.adapter', { name: report.adapter.name })}</span>
        <Badge tone={report.adapter.healthy ? 'success' : 'danger'}>{report.adapter.healthy ? t('hub.sev.healthy') : t('hub.sev.down')}</Badge>
        {report.adapter.detail ? <span className="text-slate-600">{report.adapter.detail}</span> : null}
        <span className="text-slate-600">{t('hub.sev.maxAttempts', { count: report.maxAttempts })}</span>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-brand-night">{t('hub.sev.lastErrors')}</h3>
        <DataTable
          caption={t('hub.sev.lastErrors')}
          rows={report.lastErrors}
          rowKey={(e) => `${e.invoiceId}-${e.attempt}`}
          empty={t('hub.sev.noErrors')}
          columns={[
            { key: 'number', header: t('hub.invoices.number'), cell: (e) => <code>{e.number}</code> },
            { key: 'status', header: t('hub.common.status'), cell: (e) => <Badge tone={SEV_TONES[e.sevStatus] ?? 'neutral'}>{t(`enum.sevStatus.${e.sevStatus}`)}</Badge> },
            { key: 'attempt', header: t('hub.sev.attempt'), className: 'text-right', cell: (e) => e.attempt },
            { key: 'error', header: t('hub.sev.error'), cell: (e) => <span className="block max-w-80 text-xs">{e.error}</span> },
            { key: 'when', header: t('hub.sev.when'), cell: (e) => formatDateTime(e.occurredAt, lang) },
            { key: 'retry', header: t('hub.common.actions'), cell: (e) => retryButton(e.invoiceId, e.sevStatus) },
          ]}
        />
      </div>
    </div>
  );
}
