'use client';

import { INCIDENT_STATUSES, type AdminIncident, type IncidentDecision } from '@neomoov/domain';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EnumBadge, ErrorBlock, ListToolbar, Loading, pageLabels, useCanWrite, useErrorText, useLang, usePagedList } from '@/components/hub/common';
import { Action, Badge, Card, DataTable, Dialog, Field, Notice, PageTitle, Pagination, Select, Textarea, focus, type Column } from '@/components/ui/kit';
import { formatDateTime } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

/** Incidents et sécurité : file (ouverts d'abord, par gravité), décisions motivées, registre des incidents de confidentialité. */
export default function IncidentsPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const writable = useCanWrite();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [deciding, setDeciding] = useState<AdminIncident | null>(null);
  const [status, setStatus] = useState<IncidentDecision['status']>('decided');
  const [decision, setDecision] = useState('');
  const list = usePagedList<AdminIncident>('incidents', (q) => hubApi.admin.incidents(q));
  const decide = useMutation({
    mutationFn: () => hubApi.admin.decideIncident(deciding!.id, { status, ...(decision.trim() ? { decision: decision.trim() } : {}) }),
    onSuccess: () => {
      setDeciding(null);
      void queryClient.invalidateQueries({ queryKey: ['hub', 'incidents'] });
    },
  });
  const columns: Column<AdminIncident>[] = [
    { key: 'created', header: t('hub.common.from'), cell: (i) => formatDateTime(i.createdAt, lang) },
    { key: 'type', header: t('hub.incidents.type'), cell: (i) => <span>{t(`enum.incidentType.${i.type}`)}{i.privacyBreach ? <span className="ml-1"><Badge tone="danger">{t('hub.incidents.privacy')}</Badge></span> : null}</span> },
    { key: 'severity', header: t('hub.incidents.severity'), cell: (i) => <EnumBadge group="severity" value={i.severity} /> },
    { key: 'status', header: t('hub.incidents.status'), cell: (i) => <EnumBadge group="incidentStatus" value={i.status} /> },
    { key: 'ride', header: t('hub.rides.number'), cell: (i) => (i.rideId ? <Link className={`text-brand-blue-dark underline ${focus}`} href={`/hub/courses/${i.rideId}`}>{i.ridePublicNumber ?? i.rideId.slice(0, 8)}</Link> : '') },
    { key: 'by', header: t('hub.incidents.reportedBy'), cell: (i) => i.reportedByKind },
    { key: 'description', header: t('hub.incidents.description'), cell: (i) => <span className="block max-w-80 whitespace-pre-wrap text-xs">{i.description}{i.decision ? <span className="mt-1 block font-semibold">{i.decision}</span> : null}</span> },
    ...(writable ? [{ key: 'decide', header: t('hub.common.actions'), cell: (i: AdminIncident) => (i.status === 'closed' ? null : <Action tone="secondary" onClick={() => { setDeciding(i); setDecision(i.decision ?? ''); setStatus(i.status === 'open' ? 'investigating' : 'decided'); decide.reset(); }}>{t('hub.incidents.decide')}</Action>) }] : []),
  ];
  return (
    <div>
      <PageTitle title={t('hub.incidents.title')} />
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
          {decide.isError ? <Notice tone="danger">{errorText(decide.error)}</Notice> : null}
          <div className="flex justify-end gap-2">
            <Action tone="secondary" onClick={() => setDeciding(null)}>{t('hub.common.cancel')}</Action>
            <Action type="submit" busy={decide.isPending}>{t('hub.common.save')}</Action>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
