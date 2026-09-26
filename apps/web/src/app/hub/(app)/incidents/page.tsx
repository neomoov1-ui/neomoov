'use client';

import {
  INCIDENT_SEVERITIES, INCIDENT_STATUSES, MANUAL_INCIDENT_TYPES, type AdminIncident, type GuaranteeDecision, type GuaranteeResult, type IncidentDecision, type IncidentSeverity, type ManualIncidentType,
} from '@neomoov/domain';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EnumBadge, ErrorBlock, ListToolbar, Loading, pageLabels, useCanWrite, useErrorText, useHubUser, useLang, usePagedList } from '@/components/hub/common';
import { BreachFields, PrivacyBreachDialog, emptyDraft, inputOf, type BreachDraft } from '@/components/hub/privacy-breach';
import { Action, Badge, Card, Checkbox, DataTable, Dialog, Field, Input, Notice, PageTitle, Pagination, Select, Textarea, focus, type Column } from '@/components/ui/kit';
import { formatDateTime, formatMoney } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

/**
 * Incidents et sécurité : file (ouverts d'abord, par gravité), décisions motivées, incidents ouverts à la main et
 * registre des incidents de confidentialité (Loi 25 : fiche, suites à donner, modèle de notification, export).
 */
export default function IncidentsPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const writable = useCanWrite();
  const admin = useHubUser().roles.includes('admin');
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [registerFor, setRegisterFor] = useState<AdminIncident | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<AdminIncident | null>(null);
  const [status, setStatus] = useState<IncidentDecision['status']>('decided');
  const [decision, setDecision] = useState('');
  const [hold, setHold] = useState<NonNullable<IncidentDecision['safetyHold']>>('lift');
  const [guaranteeFor, setGuaranteeFor] = useState<AdminIncident | null>(null);
  const [guaranteeResult, setGuaranteeResult] = useState<GuaranteeResult | null>(null);
  const list = usePagedList<AdminIncident>('incidents', (q) => hubApi.admin.incidents(q));
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['hub', 'incidents'] });
  const decide = useMutation({
    mutationFn: () => hubApi.admin.decideIncident(deciding!.id, { status, ...(decision.trim() ? { decision: decision.trim() } : {}), ...(deciding!.safetyHold === 'active' && status !== 'investigating' ? { safetyHold: hold } : {}) }),
    onSuccess: () => {
      setDeciding(null);
      void queryClient.invalidateQueries({ queryKey: ['hub', 'incidents'] });
    },
  });
  const columns: Column<AdminIncident>[] = [
    { key: 'created', header: t('hub.common.from'), cell: (i) => formatDateTime(i.createdAt, lang) },
    { key: 'type', header: t('hub.incidents.type'), cell: (i) => <span>{t(`enum.incidentType.${i.type}`)}{i.privacyBreach ? <span className="ml-1"><Badge tone="danger">{i.privacyReference ?? t('hub.incidents.privacy')}</Badge></span> : null}</span> },
    { key: 'severity', header: t('hub.incidents.severity'), cell: (i) => <EnumBadge group="severity" value={i.severity} /> },
    { key: 'status', header: t('hub.incidents.status'), cell: (i) => <span className="flex flex-wrap gap-1"><EnumBadge group="incidentStatus" value={i.status} />{i.safetyHold ? <Badge tone={i.safetyHold === 'lifted' ? 'neutral' : 'danger'}>{t(`hub.incidents.hold.${i.safetyHold}`)}</Badge> : null}</span> },
    { key: 'ride', header: t('hub.rides.number'), cell: (i) => (i.rideId ? <Link className={`text-brand-blue-dark underline ${focus}`} href={`/hub/courses/${i.rideId}`}>{i.ridePublicNumber ?? i.rideId.slice(0, 8)}</Link> : '') },
    { key: 'by', header: t('hub.incidents.reportedBy'), cell: (i) => i.reportedByKind },
    { key: 'description', header: t('hub.incidents.description'), cell: (i) => <span className="block max-w-80 whitespace-pre-wrap text-xs">{i.description}{i.decision ? <span className="mt-1 block font-semibold">{i.decision}</span> : null}</span> },
    ...(writable ? [{ key: 'decide', header: t('hub.common.actions'), cell: (i: AdminIncident) => (
      <span className="flex flex-wrap gap-2">
        {i.type === 'model_guarantee' && (i.status === 'open' || i.status === 'investigating') ? <Action tone="secondary" onClick={() => { setGuaranteeFor(i); setGuaranteeResult(null); }}>{t('hub.incidents.guarantee.action')}</Action> : null}
        {i.status === 'closed' ? null : <Action tone="secondary" onClick={() => { setDeciding(i); setDecision(i.decision ?? ''); setHold('lift'); setStatus(i.status === 'open' ? 'investigating' : 'decided'); decide.reset(); }}>{t('hub.incidents.decide')}</Action>}
        {/* Le registre se garde au moins cinq ans : la fiche reste ouverte après la clôture (revue à 30 jours, avis tardifs). */}
        <Action tone="ghost" onClick={() => setRegisterFor(i)}>{i.privacyBreach ? t('hub.incidents.register') : t('hub.incidents.addToRegister')}</Action>
      </span>
    ) }] : []),
  ];
  const guaranteeText = (r: GuaranteeResult) => (r.outcome === 'rejected'
    ? t('hub.incidents.guarantee.rejected')
    : [t('hub.incidents.guarantee.done', { amount: formatMoney(r.refundedCents, lang) }), r.driverFareProtected ? t('hub.incidents.guarantee.protected') : '', r.sanctionProposed ? t('hub.incidents.guarantee.sanction') : ''].filter(Boolean).join(' '));
  return (
    <div>
      <PageTitle
        title={t('hub.incidents.title')}
        actions={(
          <div className="flex flex-wrap gap-2">
            {admin ? <a href={`/api/v1${hubApi.admin.privacyRegisterCsvPath()}`} download className={`rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-brand-ink hover:bg-brand-tint ${focus}`}>{t('hub.incidents.exportRegister')}</a> : null}
            {writable ? <Action onClick={() => { setCreating(true); setNotice(null); }}>{t('hub.incidents.create')}</Action> : null}
          </div>
        )}
      />
      {notice ? <div className="mb-3"><Notice tone="success">{notice}</Notice></div> : null}
      {guaranteeResult ? <div className="mb-3"><Notice tone="success">{guaranteeText(guaranteeResult)}</Notice></div> : null}
      <Card>
        <ListToolbar
          filters={list.filters} setQ={list.setQ} setStatus={list.setStatus}
          statuses={[...INCIDENT_STATUSES.map((s) => ({ value: s, label: t(`enum.incidentStatus.${s}`) })), { value: 'privacy', label: t('hub.incidents.privacyOnly') }]}
        />
        {list.query.isPending ? <Loading /> : list.query.isError ? <ErrorBlock error={list.query.error} onRetry={() => void list.query.refetch()} /> : (
          <>
            <DataTable caption={t('hub.incidents.title')} columns={columns} rows={list.query.data.items} rowKey={(i) => i.id} empty={t('hub.common.empty')} />
            <Pagination page={list.filters.page} pageSize={list.pageSize} total={list.query.data.total} onPage={list.setPage} labels={pageLabels(t, list.filters.page, list.pageSize, list.query.data.total)} />
          </>
        )}
      </Card>
      <Dialog open={deciding !== null} title={t('hub.incidents.decide')} onClose={() => setDeciding(null)}>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); decide.mutate(); }}>
          {deciding ? <p className="whitespace-pre-wrap text-sm">{deciding.description}</p> : null}
          <Field label={t('hub.incidents.status')}>
            {(p) => (
              <Select {...p} value={status} onChange={(e) => setStatus(e.target.value as IncidentDecision['status'])}>
                {(['investigating', 'decided', 'closed'] as const).map((s) => <option key={s} value={s}>{t(`enum.incidentStatus.${s}`)}</option>)}
              </Select>
            )}
          </Field>
          <Field label={t('hub.incidents.decision')}>{(p) => <Textarea {...p} required={status !== 'investigating'} minLength={3} maxLength={2000} value={decision} onChange={(e) => setDecision(e.target.value)} />}</Field>
          {deciding?.safetyHold === 'active' && status !== 'investigating' ? (
            <Field label={t('hub.incidents.hold.field')} hint={t('hub.incidents.hold.hint')}>
              {(p) => (
                <Select {...p} value={hold} onChange={(e) => setHold(e.target.value as NonNullable<IncidentDecision['safetyHold']>)}>
                  {(['lift', 'keep'] as const).map((o) => <option key={o} value={o}>{t(`hub.incidents.hold.${o}`)}</option>)}
                </Select>
              )}
            </Field>
          ) : null}
          {decide.isError ? <Notice tone="danger">{errorText(decide.error)}</Notice> : null}
          <div className="flex justify-end gap-2">
            <Action tone="secondary" onClick={() => setDeciding(null)}>{t('hub.common.cancel')}</Action>
            <Action type="submit" busy={decide.isPending}>{t('hub.common.save')}</Action>
          </div>
        </form>
      </Dialog>
      <CreateIncidentDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(incident) => {
          setCreating(false);
          setNotice(incident.privacyReference ? t('hub.privacy.saved', { reference: incident.privacyReference }) : t('hub.incidents.created'));
          refresh();
        }}
      />
      <PrivacyBreachDialog incident={registerFor} onClose={() => setRegisterFor(null)} onSaved={refresh} />
      <GuaranteeDialog
        key={guaranteeFor?.id ?? 'none'}
        incident={guaranteeFor}
        onClose={() => setGuaranteeFor(null)}
        onDone={(result) => {
          setGuaranteeFor(null);
          setGuaranteeResult(result);
          void queryClient.invalidateQueries({ queryKey: ['hub', 'incidents'] });
        }}
      />
    </div>
  );
}

/** Garantie modèle (prompt 08) : validée (remboursement intégral, tarif du chauffeur maintenu ou sanction proposée) ou refusée. */
function GuaranteeDialog({ incident, onClose, onDone }: { incident: AdminIncident | null; onClose: () => void; onDone: (result: GuaranteeResult) => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [outcome, setOutcome] = useState<GuaranteeResult['outcome']>('validated');
  const [motive, setMotive] = useState('');
  const [atFault, setAtFault] = useState(false);
  const [refundMode, setRefundMode] = useState<NonNullable<GuaranteeDecision['refundMode']>>('refund');
  const decide = useMutation({
    mutationFn: () => hubApi.admin.decideGuarantee(incident!.id, { outcome, decision: motive.trim(), driverAtFault: outcome === 'validated' && atFault, refundMode }),
    onSuccess: onDone,
  });
  const validated = outcome === 'validated';
  return (
    <Dialog open={incident !== null} title={t('hub.incidents.guarantee.title')} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); decide.mutate(); }}>
        {incident ? <p className="whitespace-pre-wrap text-sm">{incident.description}</p> : null}
        <Field label={t('hub.incidents.guarantee.outcome')}>
          {(p) => (
            <Select {...p} value={outcome} onChange={(e) => setOutcome(e.target.value as GuaranteeResult['outcome'])}>
              {(['validated', 'rejected'] as const).map((o) => <option key={o} value={o}>{t(`hub.incidents.guarantee.outcomes.${o}`)}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('hub.incidents.guarantee.motive')}>{(p) => <Textarea {...p} required minLength={3} maxLength={2000} value={motive} onChange={(e) => setMotive(e.target.value)} />}</Field>
        {validated ? (
          <>
            <Field label={t('hub.incidents.guarantee.refundMode')} hint={t('hub.incidents.guarantee.directHint')}>
              {(p) => (
                <Select {...p} value={refundMode} onChange={(e) => setRefundMode(e.target.value as NonNullable<GuaranteeDecision['refundMode']>)}>
                  {(['refund', 'credit'] as const).map((m) => <option key={m} value={m}>{t(`hub.incidents.guarantee.refundModes.${m}`)}</option>)}
                </Select>
              )}
            </Field>
            <Checkbox label={t('hub.incidents.guarantee.driverAtFault')} checked={atFault} onChange={(e) => setAtFault(e.target.checked)} />
          </>
        ) : null}
        {decide.isError ? <Notice tone="danger">{errorText(decide.error)}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Action tone="secondary" onClick={onClose}>{t('hub.common.cancel')}</Action>
          <Action type="submit" busy={decide.isPending}>{t('hub.common.save')}</Action>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Incident ouvert à la main (plainte reçue par téléphone, objet perdu, incident de confidentialité). Un incident de
 * confidentialité s'inscrit au registre dès sa création avec les rubriques du jour même ; la fiche se complète ensuite.
 */
function CreateIncidentDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (incident: AdminIncident) => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [type, setType] = useState<ManualIncidentType>('complaint');
  const [severity, setSeverity] = useState<IncidentSeverity>('medium');
  const [description, setDescription] = useState('');
  const [rideId, setRideId] = useState('');
  const [draft, setDraft] = useState<BreachDraft>(() => emptyDraft());
  const privacy = type === 'privacy';
  const create = useMutation({
    mutationFn: () => hubApi.admin.createIncident({ type, severity, description: description.trim(), ...(rideId.trim() ? { rideId: rideId.trim() } : {}), ...(privacy ? { privacyBreach: inputOf(draft) } : {}) }),
    onSuccess: (incident) => {
      setDescription('');
      setRideId('');
      setDraft(emptyDraft());
      onCreated(incident);
    },
  });
  return (
    <Dialog open={open} title={t('hub.incidents.create')} onClose={onClose} wide={privacy}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('hub.incidents.type')}>
            {(p) => (
              <Select {...p} value={type} onChange={(e) => setType(e.target.value as ManualIncidentType)}>
                {MANUAL_INCIDENT_TYPES.map((v) => <option key={v} value={v}>{t(`enum.incidentType.${v}`)}</option>)}
              </Select>
            )}
          </Field>
          <Field label={t('hub.incidents.severity')}>
            {(p) => (
              <Select {...p} value={severity} onChange={(e) => setSeverity(e.target.value as IncidentSeverity)}>
                {INCIDENT_SEVERITIES.map((v) => <option key={v} value={v}>{t(`enum.severity.${v}`)}</option>)}
              </Select>
            )}
          </Field>
        </div>
        <Field label={t('hub.incidents.description')}>{(p) => <Textarea {...p} required minLength={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
        <Field label={t('hub.incidents.rideId')}>
          {(p) => <Input {...p} value={rideId} onChange={(e) => setRideId(e.target.value)} pattern="[0-9a-fA-F-]{36}" />}
        </Field>
        {privacy ? (
          <>
            <Notice tone="warning">{t('hub.incidents.privacyHint')}</Notice>
            <BreachFields draft={draft} onChange={setDraft} essential />
          </>
        ) : null}
        {create.isError ? <Notice tone="danger">{errorText(create.error)}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Action tone="secondary" onClick={onClose}>{t('hub.common.cancel')}</Action>
          <Action type="submit" busy={create.isPending}>{t('hub.incidents.create')}</Action>
        </div>
      </form>
    </Dialog>
  );
}
