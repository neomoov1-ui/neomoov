'use client';

import type { FleetDriver } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EnumBadge, ErrorBlock, ListToolbar, Loading, pageLabels, useErrorText, useLang, usePagedList } from '@/components/hub/common';
import { useFleetOrg } from '@/components/hub/fleet-org';
import { Action, Badge, Card, DataTable, Dialog, Field, Input, Notice, PageTitle, Pagination, Select, type Column } from '@/components/ui/kit';
import { fleetApi } from '@/lib/fleet-api';
import { formatDate, fullName } from '@/lib/format';

/** Chauffeurs rattachés (étape 23) : liste enrichie de la conformité, invitation par texto, revue des documents. */
export default function FleetDriversPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const fleet = useFleetOrg();
  const list = usePagedList(`fleet-drivers-${fleet.organizationId}`, (q) => fleetApi.drivers(fleet.organizationId, q));
  const expiring = useQuery({ queryKey: ['fleet', fleet.organizationId, 'expiring'], queryFn: () => fleetApi.expiring(fleet.organizationId, 30), enabled: fleet.can('compliance.read', 'documents.read') });
  const [inviting, setInviting] = useState(false);
  const [reviewing, setReviewing] = useState<FleetDriver | null>(null);

  const columns: Column<FleetDriver>[] = [
    { key: 'name', header: t('hub.drivers.name'), cell: (d) => <span className="font-medium">{fullName(d.firstName, d.lastName, d.publicNumber)}</span> },
    { key: 'status', header: t('fleet.drivers.status'), cell: (d) => <EnumBadge group="driverStatus" value={d.status} /> },
    {
      key: 'documents', header: t('fleet.drivers.documents'),
      cell: (d) => (
        <div className="flex flex-wrap gap-1">
          <Badge tone="success">{d.documents.approved} {t('fleet.drivers.approved')}</Badge>
          {d.documents.pending ? <Badge tone="warning">{d.documents.pending} {t('fleet.drivers.pending')}</Badge> : null}
          {d.documents.expiringSoon ? <Badge tone="danger">{d.documents.expiringSoon} {t('fleet.drivers.expiring')}</Badge> : null}
        </div>
      ),
    },
    { key: 'expiry', header: t('fleet.drivers.nextExpiry'), cell: (d) => formatDate(d.nextDocumentExpiryOn, lang) },
    { key: 'vehicle', header: t('fleet.drivers.vehicle'), cell: (d) => (d.currentVehicle ? `${d.currentVehicle.make} ${d.currentVehicle.model} · ${d.currentVehicle.plate}` : '—') },
    { key: 'inspection', header: t('fleet.drivers.nextInspection'), cell: (d) => formatDate(d.nextInspectionDueOn, lang) },
    { key: 'actions', header: '', cell: (d) => (fleet.can('documents.read') ? <Action tone="secondary" onClick={() => setReviewing(d)}>{t('fleet.drivers.documents')}</Action> : null) },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={t('fleet.drivers.title')} subtitle={fleet.name} actions={fleet.can('drivers.invite') ? <Action onClick={() => setInviting(true)}>{t('fleet.drivers.invite')}</Action> : null} />
      <ListToolbar filters={list.filters} setQ={list.setQ} />
      {list.query.isPending ? <Loading /> : list.query.isError ? <ErrorBlock error={list.query.error} onRetry={() => void list.query.refetch()} /> : (
        <>
          <DataTable columns={columns} rows={list.query.data.items} rowKey={(d) => d.id} empty={t('fleet.drivers.none')} caption={t('fleet.drivers.title')} />
          <Pagination page={list.filters.page} pageSize={list.pageSize} total={list.query.data.total} onPage={list.setPage} labels={pageLabels(t, list.filters.page, list.pageSize, list.query.data.total)} />
        </>
      )}
      {expiring.data ? (
        <Card title={t('fleet.drivers.expiringTitle')}>
          {expiring.data.length ? (
            <ul className="flex flex-col gap-1 text-sm">
              {expiring.data.map((d) => <li key={d.documentId}><EnumBadge group="documentType" value={d.type} /> {formatDate(d.expiresOn, lang)}</li>)}
            </ul>
          ) : <p className="text-sm text-slate-600">{t('fleet.drivers.expiringNone')}</p>}
        </Card>
      ) : null}
      <InviteDialog open={inviting} onClose={() => setInviting(false)} />
      {reviewing ? <DocumentsDialog driver={reviewing} onClose={() => setReviewing(null)} /> : null}
    </div>
  );
}

function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const fleet = useFleetOrg();
  const [phone, setPhone] = useState('');
  const [firstName, setFirstName] = useState('');
  const [language, setLanguage] = useState<'fr' | 'en'>('fr');
  const invite = useMutation({ mutationFn: () => fleetApi.inviteDriver(fleet.organizationId, { phone, language, ...(firstName ? { firstName } : {}) }) });
  return (
    <Dialog open={open} title={t('fleet.drivers.invite')} onClose={() => { invite.reset(); onClose(); }}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); invite.mutate(); }}>
        <Field label={t('fleet.drivers.phone')}>{(p) => <Input {...p} required pattern="\+[1-9][0-9]{6,14}" value={phone} onChange={(e) => setPhone(e.target.value.trim())} />}</Field>
        <Field label={t('fleet.drivers.firstName')}>{(p) => <Input {...p} maxLength={60} value={firstName} onChange={(e) => setFirstName(e.target.value)} />}</Field>
        <Field label={t('fleet.drivers.language')}>
          {(p) => <Select {...p} value={language} onChange={(e) => setLanguage(e.target.value as 'fr' | 'en')}><option value="fr">Français</option><option value="en">English</option></Select>}
        </Field>
        {invite.isSuccess ? <Notice tone="success">{t('fleet.drivers.sent', { phone: invite.data.phone })}</Notice> : null}
        {invite.isError ? <Notice tone="danger">{errorText(invite.error)}</Notice> : null}
        <Action type="submit" busy={invite.isPending}>{t('fleet.drivers.send')}</Action>
      </form>
    </Dialog>
  );
}

function DocumentsDialog({ driver, onClose }: { driver: FleetDriver; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const errorText = useErrorText();
  const fleet = useFleetOrg();
  const queryClient = useQueryClient();
  const docs = useQuery({ queryKey: ['fleet', fleet.organizationId, 'documents', driver.id], queryFn: () => fleetApi.driverDocuments(fleet.organizationId, driver.id) });
  const [note, setNote] = useState('');
  const review = useMutation({
    mutationFn: (input: { id: string; decision: 'approved' | 'rejected' }) => fleetApi.reviewDocument(fleet.organizationId, input.id, { decision: input.decision, ...(input.decision === 'rejected' ? { note } : {}) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['fleet', fleet.organizationId, 'documents', driver.id] }),
  });
  return (
    <Dialog open title={t('fleet.drivers.review.title', { name: fullName(driver.firstName, driver.lastName, driver.publicNumber) })} onClose={onClose} wide>
      <Notice tone="info">{t('fleet.drivers.review.final')}</Notice>
      {docs.isPending ? <Loading /> : docs.isError ? <ErrorBlock error={docs.error} /> : (
        <ul className="mt-3 flex flex-col gap-3">
          {docs.data.map((d) => (
            <li key={d.id} className="rounded border border-slate-200 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <EnumBadge group="documentType" value={d.type} /> <EnumBadge group="documentStatus" value={d.status} /> <span>{formatDate(d.expiresOn, lang)}</span>
                {d.orgReview ? <Badge tone="info">{t('fleet.drivers.review.orgReviewed', { decision: d.orgReview.decision })}</Badge> : null}
              </div>
              {d.status === 'pending' && fleet.can('documents.review') ? (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <Action tone="secondary" busy={review.isPending} onClick={() => review.mutate({ id: d.id, decision: 'approved' })}>{t('fleet.drivers.review.approve')}</Action>
                  <Field label={t('fleet.drivers.review.note')}>{(p) => <Input {...p} minLength={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
                  <Action tone="danger" disabled={note.trim().length < 3} busy={review.isPending} onClick={() => review.mutate({ id: d.id, decision: 'rejected' })}>{t('fleet.drivers.review.reject')}</Action>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {review.isError ? <Notice tone="danger">{errorText(review.error)}</Notice> : null}
    </Dialog>
  );
}
