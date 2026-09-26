'use client';

import { SANCTION_TYPES, type AdminDocument, type DocumentReview } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EnumBadge, ErrorBlock, Loading, useCanWrite, useErrorText, useLang } from '@/components/hub/common';
import { DocumentViewer } from '@/components/hub/document-viewer';
import { VehiclesTable } from '@/components/hub/vehicles-table';
import { Action, Card, Checkbox, DataTable, Dialog, Field, Input, Notice, PageTitle, Select, Textarea, focus } from '@/components/ui/kit';
import { formatDate, formatDateTime, fullName } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

type Panel = null | 'suspend' | 'sanction';

/** Fiche complète d'un chauffeur : identité (numéros de taxes masqués), documents avec visionneuse, véhicules, sanctions, notes. */
export default function DriverDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const lang = useLang();
  const writable = useCanWrite();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [panel, setPanel] = useState<Panel>(null);
  const [viewing, setViewing] = useState<AdminDocument | null>(null);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const detail = useQuery({ queryKey: ['hub', 'driver', id], queryFn: () => hubApi.admin.driver(id) });
  const onDone = () => {
    setPanel(null);
    setViewing(null);
    setMessage(t('hub.common.saved'));
    void queryClient.invalidateQueries({ queryKey: ['hub', 'driver', id] });
  };
  const action = useMutation({ mutationFn: (run: () => Promise<unknown>) => run(), onSuccess: onDone });
  const review = useMutation({ mutationFn: ({ documentId, body }: { documentId: string; body: DocumentReview }) => hubApi.admin.reviewDocument(documentId, body), onSuccess: onDone });
  const addNote = useMutation({ mutationFn: () => hubApi.admin.noteDriver(id, note.trim()), onSuccess: () => { setNote(''); onDone(); } });

  if (detail.isPending) return <Loading />;
  if (detail.isError) return <ErrorBlock error={detail.error} onRetry={() => void detail.refetch()} />;
  const { driver: d, vehicles, documents, notes, sanctions, stats } = detail.data;
  const yesNo = (v: boolean) => (v ? t('hub.common.yes') : t('hub.common.no'));

  return (
    <div className="flex flex-col gap-5">
      <PageTitle
        title={`${fullName(d.firstName, d.lastName, d.publicNumber)} · ${d.publicNumber}`}
        subtitle={<Link href="/hub/chauffeurs" className={`text-brand-blue-dark underline ${focus}`}>{t('hub.common.back')}</Link>}
        actions={<EnumBadge group="driverStatus" value={d.status} />}
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {action.isError && !panel ? <Notice tone="danger">{errorText(action.error)}</Notice> : null}
      {writable ? (
        <div className="flex flex-wrap gap-2">
          {d.status === 'pending' ? <Action busy={action.isPending} onClick={() => action.mutate(() => hubApi.admin.activateDriver(id))}>{t('hub.drivers.activate')}</Action> : null}
          {d.status === 'suspended' || d.status === 'restricted' ? <Action busy={action.isPending} onClick={() => action.mutate(() => hubApi.admin.reactivateDriver(id))}>{t('hub.drivers.reactivate')}</Action> : null}
          {d.status === 'active' || d.status === 'restricted' ? <Action tone="danger" onClick={() => setPanel('suspend')}>{t('hub.drivers.suspend')}</Action> : null}
          <Action tone="secondary" onClick={() => setPanel('sanction')}>{t('hub.drivers.sanction')}</Action>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title={t('hub.drivers.name')} className="lg:col-span-2">
          <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[11rem_1fr]">
            <dt className="font-semibold">{t('hub.drivers.phone')}</dt><dd>{d.phone ?? ''}</dd>
            <dt className="font-semibold">{t('hub.drivers.email')}</dt><dd>{d.email ?? ''}</dd>
            <dt className="font-semibold">{t('hub.drivers.qualification')}</dt><dd>{d.qualification ? t(`enum.qualification.${d.qualification}`) : ''}</dd>
            <dt className="font-semibold">{t('hub.drivers.gst')}</dt><dd>{d.gstNumber ?? ''}</dd>
            <dt className="font-semibold">{t('hub.drivers.qst')}</dt><dd>{d.qstNumber ?? ''}</dd>
            <dt className="font-semibold">{t('hub.drivers.languages')}</dt><dd>{d.spokenLanguages.join(', ')}</dd>
            <dt className="font-semibold">{t('hub.drivers.experience')}</dt><dd>{d.experienceYears ?? ''}</dd>
            <dt className="font-semibold">{t('hub.drivers.training')}</dt><dd>{d.trainingCertified ? t('hub.drivers.certified') : t('hub.drivers.notCertified')}</dd>
            <dt className="font-semibold">{t('hub.drivers.paymentModes')}</dt>
            <dd>{`${t('enum.paymentMethod.cash')} ${yesNo(d.paymentModes.cash)} · ${t('enum.paymentMethod.interac')} ${yesNo(d.paymentModes.interac)} · ${t('enum.paymentMethod.terminal')} ${yesNo(d.paymentModes.terminal)}`}</dd>
            <dt className="font-semibold">{t('hub.drivers.payout')}</dt><dd>{d.payout.onboarded ? t('hub.drivers.payoutReady') : t('hub.drivers.payoutMissing')}</dd>
            <dt className="font-semibold">{t('hub.drivers.activatedAt')}</dt><dd>{formatDateTime(d.activatedAt, lang)}</dd>
            <dt className="font-semibold">{t('hub.drivers.programs')}</dt>
            <dd>
              {writable ? (
                <Checkbox
                  label={t('hub.drivers.rLuxeEv')}
                  checked={d.rLuxeEvTenant}
                  disabled={action.isPending}
                  onChange={(e) => action.mutate(() => hubApi.admin.setDriverPrograms(id, { rLuxeEvTenant: e.currentTarget.checked }))}
                />
              ) : (
                `${t('hub.drivers.rLuxeEv')} : ${yesNo(d.rLuxeEvTenant)}`
              )}
            </dd>
          </dl>
        </Card>
        <Card title={t('hub.drivers.stats')}>
          <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm">
            <dt>{t('hub.drivers.completed')}</dt><dd className="font-bold">{stats.completedRides}</dd>
            <dt>{t('hub.drivers.cancellations30d')}</dt><dd className="font-bold">{stats.cancellations30d}</dd>
            <dt>{t('hub.drivers.incidents')}</dt><dd className="font-bold">{stats.incidents}</dd>
            <dt>{t('hub.drivers.rating')}</dt><dd className="font-bold">{d.ratingCount ? d.rating.toFixed(2) : ''}</dd>
          </dl>
        </Card>
      </div>

      <Card title={t('hub.drivers.documents')}>
        <DataTable
          rows={documents}
          rowKey={(doc) => doc.id}
          empty={t('hub.common.empty')}
          columns={[
            { key: 'type', header: t('hub.documents.type'), cell: (doc) => t(`enum.documentType.${doc.type}`) },
            { key: 'status', header: t('hub.common.status'), cell: (doc) => <EnumBadge group="documentStatus" value={doc.status} /> },
            { key: 'expires', header: t('hub.documents.expires'), cell: (doc) => formatDate(doc.expiresOn, lang) },
            { key: 'uploaded', header: t('hub.documents.uploaded'), cell: (doc) => formatDate(doc.uploadedAt, lang) },
            { key: 'view', header: t('hub.common.actions'), cell: (doc) => <Action tone="secondary" onClick={() => setViewing(doc)}>{t('hub.documents.view')}</Action> },
          ]}
        />
      </Card>

      <Card title={t('hub.drivers.vehicles')}>
        <VehiclesTable vehicles={vehicles} writable={writable} onChanged={onDone} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={t('hub.drivers.sanctions')}>
          {sanctions.length === 0 ? <p className="text-sm text-slate-600">{t('hub.common.none')}</p> : (
            <ul className="flex flex-col gap-2 text-sm">
              {sanctions.map((s) => (
                <li key={s.id}>
                  <strong>{t(`enum.sanctionType.${s.type}`)}</strong> · {formatDate(s.startsAt, lang)}{s.endsAt ? ` · ${t('hub.drivers.until', { date: formatDate(s.endsAt, lang) })}` : ''}
                  <p className="text-slate-700">{s.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t('hub.drivers.notes')}>
          <ul className="mb-3 flex flex-col gap-2 text-sm">
            {notes.length === 0 ? <li className="text-slate-600">{t('hub.common.none')}</li> : notes.map((n) => (
              <li key={n.id} className="rounded-md bg-brand-mist p-2">
                <p className="whitespace-pre-wrap">{n.body}</p>
                <p className="mt-1 text-xs text-slate-600">{n.authorName ?? ''} · {formatDateTime(n.createdAt, lang)}</p>
              </li>
            ))}
          </ul>
          {writable ? (
            <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (note.trim().length >= 2) addNote.mutate(); }}>
              <Field label={t('hub.common.note')}>{(p) => <Textarea {...p} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
              {addNote.isError ? <Notice tone="danger">{errorText(addNote.error)}</Notice> : null}
              <div><Action type="submit" busy={addNote.isPending} disabled={note.trim().length < 2}>{t('hub.drivers.addNote')}</Action></div>
            </form>
          ) : null}
        </Card>
      </div>

      <DocumentViewer
        document={viewing}
        onClose={() => setViewing(null)}
        canReview={writable}
        busy={review.isPending}
        error={review.isError ? errorText(review.error) : null}
        onReview={(body) => viewing && review.mutate({ documentId: viewing.id, body })}
      />
      <SuspendDialog open={panel === 'suspend'} onClose={() => setPanel(null)} busy={action.isPending} error={action.isError ? errorText(action.error) : null} onSubmit={(reason) => action.mutate(() => hubApi.admin.suspendDriver(id, reason))} />
      <SanctionDialog
        open={panel === 'sanction'} onClose={() => setPanel(null)} busy={action.isPending} error={action.isError ? errorText(action.error) : null}
        onSubmit={(type, reason, endsOn) => action.mutate(() => hubApi.admin.sanctionDriver(id, { type, reason, ...(endsOn ? { endsAt: new Date(`${endsOn}T23:59:00`).toISOString() } : {}) }))}
      />
    </div>
  );
}

function SuspendDialog({ open, onClose, onSubmit, busy, error }: { open: boolean; onClose: () => void; onSubmit: (reason: string) => void; busy: boolean; error: string | null }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  return (
    <Dialog open={open} title={t('hub.drivers.suspend')} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); onSubmit(reason.trim()); }}>
        <Field label={t('hub.common.reason')}>{(p) => <Textarea {...p} required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Action tone="secondary" onClick={onClose}>{t('hub.common.cancel')}</Action>
          <Action type="submit" tone="danger" busy={busy}>{t('hub.drivers.suspend')}</Action>
        </div>
      </form>
    </Dialog>
  );
}

function SanctionDialog({ open, onClose, onSubmit, busy, error }: { open: boolean; onClose: () => void; onSubmit: (type: (typeof SANCTION_TYPES)[number], reason: string, endsOn: string) => void; busy: boolean; error: string | null }) {
  const { t } = useTranslation();
  const [type, setType] = useState<(typeof SANCTION_TYPES)[number]>('warning');
  const [reason, setReason] = useState('');
  const [endsOn, setEndsOn] = useState('');
  return (
    <Dialog open={open} title={t('hub.drivers.sanction')} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); onSubmit(type, reason.trim(), endsOn); }}>
        <Field label={t('hub.drivers.sanctionType')}>
          {(p) => <Select {...p} value={type} onChange={(e) => setType(e.target.value as typeof type)}>{SANCTION_TYPES.map((s) => <option key={s} value={s}>{t(`enum.sanctionType.${s}`)}</option>)}</Select>}
        </Field>
        <Field label={t('hub.common.reason')}>{(p) => <Textarea {...p} required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        {type !== 'warning' ? <Field label={t('hub.common.to')}>{(p) => <Input {...p} type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />}</Field> : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Action tone="secondary" onClick={onClose}>{t('hub.common.cancel')}</Action>
          <Action type="submit" tone="danger" busy={busy}>{t('hub.common.confirm')}</Action>
        </div>
      </form>
    </Dialog>
  );
}
