'use client';

/**
 * Droits sur les données (Loi 25) : après vérification du numéro par SMS (sans création de compte), liste des demandes
 * avec leur état et échéance, dépôt d'une nouvelle demande, liens d'export quand ils sont prêts, et suppression du compte
 * (`DELETE /v1/me` : accès coupé tout de suite, anonymisation par le worker). Deux pages : `/droits` (tous les droits)
 * et `/supprimer-mon-compte` (adresse de suppression déclarée aux magasins : la démarche et ce qui est gardé d'abord).
 */
import type { AppConfig, DataRequestView } from '@neomoov/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { OtpSignIn } from '@/components/otp-sign-in';
import { Action, Badge, Card, Checkbox, Field, Notice, Select, Textarea, focus } from '@/components/ui/kit';
import { formatDate } from '@/lib/format';
import type { Language } from '@/lib/i18n-resources';
import { createGuestApi, errorCode } from '@/lib/site-api';

const REQUESTABLE = ['access', 'rectification', 'portability', 'consent_withdrawal'] as const;
type Guest = ReturnType<typeof createGuestApi>;

export function Rights({ mode = 'rights' }: { mode?: 'rights' | 'deletion' }) {
  const { t, i18n } = useTranslation();
  const lang: Language = i18n.language === 'en' ? 'en' : 'fr-CA';
  const guest = useRef(createGuestApi()).current;
  const queryClient = useQueryClient();
  const [signedIn, setSignedIn] = useState(false);
  const [deletedRequestId, setDeletedRequestId] = useState<string | null>(null);
  const [type, setType] = useState<(typeof REQUESTABLE)[number]>('access');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const deletion = mode === 'deletion';
  const config = useQuery<AppConfig>({ queryKey: ['config'], queryFn: () => guest.api.config.get(), staleTime: 300_000, enabled: deletion });
  const requests = useQuery<DataRequestView[]>({ queryKey: ['rights', signedIn], queryFn: () => guest.api.me.dataRequests(), enabled: signedIn && !deletion && !deletedRequestId });

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
        <h1 className="text-3xl text-brand-night">{deletion ? t('rights.deletion.title') : t('rights.title')}</h1>
        <p className="mt-1 text-slate-700">{deletion ? t('rights.deletion.subtitle') : t('rights.subtitle')}</p>
      </div>
      {deletedRequestId ? (
        <Card>
          <div className="flex flex-col gap-2" role="status">
            <h2 className="text-xl text-brand-night">{t('rights.deletion.doneTitle')}</h2>
            <p className="text-sm">{t('rights.deletion.doneBody')}</p>
            <p className="text-xs text-slate-600">{t('rights.deletion.reference', { id: deletedRequestId })}</p>
          </div>
        </Card>
      ) : (
        <>
          {deletion ? <DeletionInfo supportEmail={config.data?.support.email ?? null} /> : null}
          {!signedIn ? (
            <Card>
              <OtpSignIn guest={guest} allowCreate={false} noAccountText={t('rights.noAccount')} onSignedIn={() => setSignedIn(true)}>
                <p className="text-sm">{deletion ? t('rights.deletion.signIn') : t('rights.signIn')}</p>
              </OtpSignIn>
            </Card>
          ) : null}
          {signedIn && !deletion ? (
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
          ) : null}
          {signedIn ? <DeletionForm guest={guest} onDeleted={setDeletedRequestId} /> : null}
          {deletion ? (
            <p className="text-sm"><Link href="/droits" className={`text-brand-blue-dark underline ${focus}`}>{t('rights.deletion.otherRights')}</Link></p>
          ) : !signedIn ? (
            <Card title={t('rights.deletion.title')}>
              <p className="text-sm">{t('rights.deletion.teaser')}</p>
              <p className="mt-2 text-sm"><Link href="/supprimer-mon-compte" className={`font-semibold text-brand-blue-dark underline ${focus}`}>{t('rights.deletion.link')}</Link></p>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Démarche, données supprimées et données gardées (exigences de Google Play pour l'adresse de suppression). */
function DeletionInfo({ supportEmail }: { supportEmail: string | null }) {
  const { t } = useTranslation();
  const list = (key: string) => t(key, { returnObjects: true }) as string[];
  return (
    <Card>
      <div className="flex flex-col gap-3 text-sm">
        <section aria-labelledby="deletion-steps">
          <h2 id="deletion-steps" className="text-lg text-brand-night">{t('rights.deletion.stepsTitle')}</h2>
          <ol className="mt-1 list-decimal space-y-1 pl-5">{list('rights.deletion.steps').map((s) => <li key={s}>{s}</li>)}</ol>
        </section>
        <section aria-labelledby="deletion-erased">
          <h2 id="deletion-erased" className="text-lg text-brand-night">{t('rights.deletion.erasedTitle')}</h2>
          <ul className="mt-1 list-disc space-y-1 pl-5">{list('rights.deletion.erased').map((s) => <li key={s}>{s}</li>)}</ul>
        </section>
        <section aria-labelledby="deletion-kept">
          <h2 id="deletion-kept" className="text-lg text-brand-night">{t('rights.deletion.keptTitle')}</h2>
          <ul className="mt-1 list-disc space-y-1 pl-5">{list('rights.deletion.kept').map((s) => <li key={s}>{s}</li>)}</ul>
        </section>
        <p>{t('rights.deletion.inApp')}</p>
        <p>{supportEmail ? t('rights.deletion.noSms', { email: supportEmail }) : t('rights.deletion.noSmsNoEmail')}</p>
      </div>
    </Card>
  );
}

/** Confirmation explicite, motif facultatif ; un compte du personnel se supprime par un administrateur (403). */
function DeletionForm({ guest, onDeleted }: { guest: Guest; onDeleted: (requestId: string) => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const result = await guest.api.me.remove(reason.trim() || undefined);
      onDeleted(result.requestId);
    } catch (e) {
      setError(errorCode(e) === 'STAFF_ACCOUNT' ? t('rights.deletion.staff') : e instanceof Error && e.message ? e.message : t('book.errors.generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t('rights.deletion.formTitle')}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void remove(); }}>
        <Notice tone="warning">{t('rights.deletion.upcoming')}</Notice>
        <Field label={t('rights.deletion.reason')}>{(p) => <Textarea {...p} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        <Checkbox label={t('rights.deletion.confirm')} checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div><Action type="submit" tone="danger" busy={busy} disabled={busy || !confirmed}>{t('rights.deletion.submit')}</Action></div>
      </form>
    </Card>
  );
}
