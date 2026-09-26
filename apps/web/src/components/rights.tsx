'use client';

/**
 * Page des droits (Loi 25) : après vérification du numéro par SMS (sans création de compte), liste des demandes avec
 * leur état et échéance, dépôt d'une nouvelle demande, liens d'export quand ils sont prêts.
 */
import type { DataRequestView } from '@neomoov/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { OtpSignIn } from '@/components/otp-sign-in';
import { Action, Badge, Card, Field, Notice, Select, Textarea } from '@/components/ui/kit';
import { formatDate } from '@/lib/format';
import type { Language } from '@/lib/i18n-resources';
import { createGuestApi } from '@/lib/site-api';

const REQUESTABLE = ['access', 'rectification', 'portability', 'consent_withdrawal'] as const;

export function Rights() {
  const { t, i18n } = useTranslation();
  const lang: Language = i18n.language === 'en' ? 'en' : 'fr-CA';
  const guest = useRef(createGuestApi()).current;
  const queryClient = useQueryClient();
  const [signedIn, setSignedIn] = useState(false);
  const [type, setType] = useState<(typeof REQUESTABLE)[number]>('access');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const requests = useQuery<DataRequestView[]>({ queryKey: ['rights', signedIn], queryFn: () => guest.api.me.dataRequests(), enabled: signedIn });

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      await guest.api.me.createDataRequest({ type, ...(details.trim() ? { details: details.trim() } : {}) });
      setDetails('');
      setMessage({ tone: 'success', text: t('rights.sent') });
      await queryClient.invalidateQueries({ queryKey: ['rights'] });
    } catch (e) {
      setMessage({ tone: 'danger', text: e instanceof Error && e.message ? e.message : t('book.errors.generic') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 py-6">
      <div>
        <h1 className="text-3xl text-brand-night">{t('rights.title')}</h1>
        <p className="mt-1 text-slate-700">{t('rights.subtitle')}</p>
      </div>
      {!signedIn ? (
        <Card>
          <OtpSignIn guest={guest} allowCreate={false} noAccountText={t('rights.noAccount')} onSignedIn={() => setSignedIn(true)}>
            <p className="text-sm">{t('rights.signIn')}</p>
          </OtpSignIn>
        </Card>
      ) : (
        <>
          <Card title={t('rights.list')}>
            {requests.isPending ? <p role="status">{t('common.loading')}</p> : requests.isError ? <Notice tone="danger">{t('common.error')}</Notice> : requests.data.length === 0 ? <p className="text-sm text-slate-600">{t('rights.empty')}</p> : (
              <ul className="flex flex-col gap-3">
                {requests.data.map((r) => (
                  <li key={r.id} className="rounded-md border border-slate-200 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong>{t(`rights.types.${r.type}`)}</strong>
                      <Badge tone={r.status === 'processed' ? 'success' : 'warning'}>{t(`rights.statuses.${r.status}`)}</Badge>
                    </div>
                    <p className="mt-1 text-slate-700">{t('rights.received', { date: formatDate(r.receivedAt, lang) })} · {r.processedAt ? t('rights.processed', { date: formatDate(r.processedAt, lang) }) : t('rights.due', { date: formatDate(r.dueOn, lang) })}</p>
                    {r.downloads ? (
                      <p className="mt-2 flex gap-3">
                        <a className="text-brand-blue-dark underline" href={r.downloads.json} target="_blank" rel="noreferrer">{t('rights.download')}</a>
                        <a className="text-brand-blue-dark underline" href={r.downloads.pdf} target="_blank" rel="noreferrer">{t('rights.downloadPdf')}</a>
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={t('rights.new')}>
            <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
              <Field label={t('rights.type')}>{(p) => <Select {...p} value={type} onChange={(e) => setType(e.target.value as typeof type)}>{REQUESTABLE.map((k) => <option key={k} value={k}>{t(`rights.types.${k}`)}</option>)}</Select>}</Field>
              <Field label={t('rights.details')}>{(p) => <Textarea {...p} maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} />}</Field>
              {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
              <div><Action type="submit" busy={busy} disabled={busy}>{t('rights.submit')}</Action></div>
            </form>
          </Card>
        </>
      )}
    </div>
  );
}
