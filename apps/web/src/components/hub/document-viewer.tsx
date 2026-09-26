'use client';

/**
 * Visionneuse d'un document de chauffeur : le fichier est lu par la passerelle (jeton du personnel), converti en URL
 * `blob:` locale et affiché (image ou PDF). Jamais de lien public vers le stockage.
 */
import type { AdminDocument, DocumentReview } from '@neomoov/domain';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Action, Dialog, Field, Input, Notice, Textarea } from '@/components/ui/kit';
import { formatDate } from '@/lib/format';
import { useLang } from './common';

export function DocumentViewer({ document, onClose, onReview, canReview, busy, error }: { document: AdminDocument | null; onClose: () => void; onReview?: (review: DocumentReview) => void; canReview: boolean; busy?: boolean; error?: string | null }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [file, setFile] = useState<{ url: string; type: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [reason, setReason] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [number, setNumber] = useState('');

  useEffect(() => {
    if (!document) return;
    let url: string | null = null;
    setFile(null);
    setFailed(false);
    setReason('');
    setExpiresOn(document.expiresOn ?? '');
    setNumber(document.number ?? '');
    fetch(`/api/v1/admin/documents/${encodeURIComponent(document.id)}/content`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        url = URL.createObjectURL(blob);
        setFile({ url, type: blob.type });
      })
      .catch(() => setFailed(true));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [document]);

  return (
    <Dialog open={document !== null} title={document ? t('hub.documents.viewer', { type: t(`enum.documentType.${document.type}`) }) : ''} onClose={onClose} wide>
      {document ? (
        <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="min-h-64 rounded-md bg-slate-100 p-2">
            {failed ? <Notice tone="warning">{t('hub.documents.unreadable')}</Notice> : !file ? <p role="status" className="p-4 text-sm">{t('hub.common.loading')}</p> : file.type.startsWith('image/') ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={file.url} alt={t(`enum.documentType.${document.type}`)} className="mx-auto max-h-[60vh] w-auto" />
            ) : file.type === 'application/pdf' ? (
              <iframe src={file.url} title={t(`enum.documentType.${document.type}`)} className="h-[60vh] w-full" />
            ) : (
              <a href={file.url} download className="text-brand-blue-dark underline">{t('hub.documents.download')}</a>
            )}
          </div>
          <div className="flex flex-col gap-3 text-sm">
            <dl className="grid grid-cols-[7rem_1fr] gap-x-2 gap-y-1">
              <dt className="font-semibold">{t('hub.documents.driver')}</dt><dd>{document.driverName} ({document.driverPublicNumber})</dd>
              <dt className="font-semibold">{t('hub.documents.number')}</dt><dd>{document.number ?? ''}</dd>
              <dt className="font-semibold">{t('hub.documents.issued')}</dt><dd>{formatDate(document.issuedOn, lang)}</dd>
              <dt className="font-semibold">{t('hub.documents.expires')}</dt><dd>{formatDate(document.expiresOn, lang)}</dd>
              <dt className="font-semibold">{t('hub.common.status')}</dt><dd>{t(`enum.documentStatus.${document.status}`)}</dd>
            </dl>
            {document.rejectionReason ? <Notice tone="warning">{document.rejectionReason}</Notice> : null}
            {canReview && onReview ? (
              <form className="flex flex-col gap-2" onSubmit={(e) => e.preventDefault()}>
                <Field label={t('hub.documents.number')}>{(p) => <Input {...p} maxLength={60} value={number} onChange={(e) => setNumber(e.target.value)} />}</Field>
                <Field label={t('hub.documents.expires')}>{(p) => <Input {...p} type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />}</Field>
                <Field label={t('hub.common.reason')}>{(p) => <Textarea {...p} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
                {error ? <Notice tone="danger">{error}</Notice> : null}
                <div className="flex flex-wrap gap-2">
                  <Action busy={busy} disabled={busy} onClick={() => onReview({ decision: 'approved', ...(expiresOn ? { expiresOn } : {}), ...(number.trim() ? { number: number.trim() } : {}) })}>{t('hub.documents.approve')}</Action>
                  <Action tone="danger" disabled={busy || reason.trim().length < 3} onClick={() => onReview({ decision: 'rejected', reason: reason.trim() })}>{t('hub.documents.reject')}</Action>
                </div>
              </form>
            ) : null}
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
