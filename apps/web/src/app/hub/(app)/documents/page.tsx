'use client';

import { DOCUMENT_STATUSES, type AdminDocument, type DocumentReview } from '@neomoov/domain';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EnumBadge, ErrorBlock, ListToolbar, Loading, pageLabels, useCanWrite, useErrorText, useLang, usePagedList } from '@/components/hub/common';
import { DocumentViewer } from '@/components/hub/document-viewer';
import { Action, Card, DataTable, Notice, PageTitle, Pagination, focus, type Column } from '@/components/ui/kit';
import { formatDate } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

/** File des documents à vérifier (les plus anciens d'abord) : visionneuse, validation ou refus motivé. */
export default function DocumentsPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const writable = useCanWrite();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [viewing, setViewing] = useState<AdminDocument | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const list = usePagedList<AdminDocument>('documents', (q) => hubApi.admin.documents({ ...q, status: q.status || 'pending' }));
  const review = useMutation({
    mutationFn: ({ documentId, body }: { documentId: string; body: DocumentReview }) => hubApi.admin.reviewDocument(documentId, body),
    onSuccess: () => {
      setViewing(null);
      setMessage(t('hub.common.saved'));
      void queryClient.invalidateQueries({ queryKey: ['hub', 'documents'] });
    },
  });
  const columns: Column<AdminDocument>[] = [
    { key: 'type', header: t('hub.documents.type'), cell: (d) => t(`enum.documentType.${d.type}`) },
    { key: 'driver', header: t('hub.documents.driver'), cell: (d) => <Link className={`text-brand-blue-dark underline ${focus}`} href={`/hub/chauffeurs/${d.driverId}`}>{d.driverName ?? d.driverPublicNumber}</Link> },
    { key: 'status', header: t('hub.common.status'), cell: (d) => <EnumBadge group="documentStatus" value={d.status} /> },
    { key: 'expires', header: t('hub.documents.expires'), cell: (d) => formatDate(d.expiresOn, lang) },
    { key: 'uploaded', header: t('hub.documents.uploaded'), cell: (d) => formatDate(d.uploadedAt, lang) },
    { key: 'view', header: t('hub.common.actions'), cell: (d) => <Action tone="secondary" onClick={() => setViewing(d)}>{t('hub.documents.view')}</Action> },
  ];
  return (
    <div>
      <PageTitle title={t('hub.documents.title')} />
      {message ? <div className="mb-3"><Notice tone="success">{message}</Notice></div> : null}
      <Card>
        <ListToolbar filters={{ ...list.filters, status: list.filters.status || 'pending' }} setQ={list.setQ} setStatus={list.setStatus} statuses={DOCUMENT_STATUSES.map((s) => ({ value: s, label: t(`enum.documentStatus.${s}`) }))} />
        {list.query.isPending ? <Loading /> : list.query.isError ? <ErrorBlock error={list.query.error} onRetry={() => void list.query.refetch()} /> : (
          <>
            <DataTable caption={t('hub.documents.title')} columns={columns} rows={list.query.data.items} rowKey={(d) => d.id} empty={t('hub.common.empty')} />
            <Pagination page={list.filters.page} pageSize={list.pageSize} total={list.query.data.total} onPage={list.setPage} labels={pageLabels(t, list.filters.page, list.pageSize, list.query.data.total)} />
          </>
        )}
      </Card>
      <DocumentViewer document={viewing} onClose={() => setViewing(null)} canReview={writable} busy={review.isPending} error={review.isError ? errorText(review.error) : null} onReview={(body) => viewing && review.mutate({ documentId: viewing.id, body })} />
    </div>
  );
}
