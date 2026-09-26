'use client';

import type { ComplianceCheckView, ComplianceRunReport, RetentionJobView } from '@neomoov/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading, useCanWrite, useErrorText, useHubUser, useLang } from '@/components/hub/common';
import { Action, Badge, Card, Checkbox, DataTable, Dialog, Field, Input, Notice, PageTitle, Select, Textarea, focus, type Column } from '@/components/ui/kit';
import { formatDate, formatDateTime } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

type Status = 'pending' | 'overdue' | '';

/** Conformité (étape 14) : échéances des chauffeurs et véhicules, inspection, passe quotidienne ; conservation (Loi 25). */
export default function CompliancePage() {
  const { t } = useTranslation();
  const lang = useLang();
  const writable = useCanWrite();
  const admin = useHubUser().roles.includes('admin');
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>('');
  const [report, setReport] = useState<ComplianceRunReport | null>(null);
  const [inspecting, setInspecting] = useState<ComplianceCheckView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const checks = useQuery({ queryKey: ['hub', 'compliance', status], queryFn: () => hubApi.admin.complianceChecks(status ? { status } : {}) });
  const jobs = useQuery({ queryKey: ['hub', 'retention'], queryFn: () => hubApi.admin.retentionJobs() });
  const run = useMutation({
    mutationFn: () => hubApi.admin.runCompliance(),
    onSuccess: (data) => {
      setReport(data);
      void queryClient.invalidateQueries({ queryKey: ['hub', 'compliance'] });
    },
  });
  const [backupNote, setBackupNote] = useState('');
  const backup = useMutation({
    mutationFn: () => hubApi.admin.confirmBackup({ note: backupNote.trim() }),
    onSuccess: () => {
      setBackupNote('');
      setNotice(t('hub.compliance.backupDone'));
    },
  });
  const purge = useMutation({
    mutationFn: () => hubApi.admin.runRetention(),
    onSuccess: (data) => {
      setNotice(t('hub.compliance.purgeDone', { count: data.length }));
      void queryClient.invalidateQueries({ queryKey: ['hub', 'retention'] });
    },
  });
  const inspectable = (c: ComplianceCheckView) => c.entityType === 'vehicle' && (c.type === 'neomoov_inspection' || c.type === 'mechanical_inspection');
  const columns: Column<ComplianceCheckView>[] = [
    { key: 'entity', header: t('hub.compliance.entity'), cell: (c) => (c.entityType === 'driver'
      ? <Link className={`text-brand-blue-dark underline ${focus}`} href={`/hub/chauffeurs/${c.entityId}`}>{t('hub.compliance.entities.driver')}</Link>
      : t('hub.compliance.entities.vehicle')) },
    { key: 'type', header: t('hub.compliance.type'), cell: (c) => c.label },
    { key: 'due', header: t('hub.compliance.dueOn'), cell: (c) => formatDate(c.dueOn, lang) },
    { key: 'status', header: t('hub.compliance.status'), cell: (c) => <Badge tone={c.status === 'overdue' ? 'danger' : 'neutral'}>{t(`hub.compliance.statuses.${c.status}`)}</Badge> },
    { key: 'reminders', header: t('hub.compliance.reminders'), className: 'text-right', cell: (c) => c.remindersSent },
    { key: 'suspended', header: t('hub.compliance.suspendedAt'), cell: (c) => (c.suspendedAt ? formatDateTime(c.suspendedAt, lang) : '') },
    ...(writable ? [{ key: 'inspect', header: '', cell: (c: ComplianceCheckView) => (inspectable(c) ? <Action tone="secondary" onClick={() => { setInspecting(c); setNotice(null); }}>{t('hub.compliance.inspect')}</Action> : null) }] : []),
  ];
  const jobColumns: Column<RetentionJobView>[] = [
    { key: 'type', header: t('hub.compliance.job'), cell: (j) => <code>{j.type}</code> },
    { key: 'at', header: t('hub.compliance.executedAt'), cell: (j) => formatDateTime(j.executedAt, lang) },
    { key: 'rows', header: t('hub.compliance.rows'), className: 'text-right', cell: (j) => j.rowsProcessed },
  ];
  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={t('hub.compliance.title')} actions={admin ? <Action busy={run.isPending} onClick={() => run.mutate()}>{t('hub.compliance.run')}</Action> : null} />
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {run.isError ? <Notice tone="danger">{errorText(run.error)}</Notice> : null}
      {report ? <Notice tone="success">{t('hub.compliance.runDone', { ...report })}</Notice> : null}
      <Card
        title={t('hub.compliance.checks')}
        actions={(
          <Select aria-label={t('hub.compliance.status')} value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            <option value="">{t('hub.compliance.all')}</option>
            <option value="overdue">{t('hub.compliance.statuses.overdue')}</option>
            <option value="pending">{t('hub.compliance.statuses.pending')}</option>
          </Select>
        )}
      >
        {checks.isPending ? <Loading /> : checks.isError ? <ErrorBlock error={checks.error} onRetry={() => void checks.refetch()} /> : (
          <DataTable caption={t('hub.compliance.checks')} columns={columns} rows={checks.data} rowKey={(c) => c.id} empty={t('hub.common.empty')} />
        )}
      </Card>
      <Card title={t('hub.compliance.retention')}>
        <div className="flex flex-col gap-3">
          <Notice tone="info">{t('hub.compliance.retentionIntro')}</Notice>
          {admin ? (
            <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); backup.mutate(); }}>
              <Field label={t('hub.compliance.backupNote')}>{(p) => <Input {...p} required minLength={3} maxLength={200} value={backupNote} onChange={(e) => setBackupNote(e.target.value)} />}</Field>
              <Action type="submit" busy={backup.isPending}>{t('hub.compliance.backup')}</Action>
              <Action tone="secondary" busy={purge.isPending} onClick={() => purge.mutate()}>{t('hub.compliance.purge')}</Action>
            </form>
          ) : null}
          {backup.isError ? <Notice tone="danger">{errorText(backup.error)}</Notice> : null}
          {purge.isError ? <Notice tone="danger">{errorText(purge.error)}</Notice> : null}
          {jobs.isPending ? <Loading /> : jobs.isError ? <ErrorBlock error={jobs.error} onRetry={() => void jobs.refetch()} /> : (
            <DataTable caption={t('hub.compliance.jobs')} columns={jobColumns} rows={jobs.data} rowKey={(j) => j.id} empty={t('hub.common.empty')} />
          )}
        </div>
      </Card>
      <InspectionDialog
        key={inspecting?.id ?? 'none'}
        check={inspecting}
        onClose={() => setInspecting(null)}
        onDone={(next) => {
          setInspecting(null);
          setNotice(t('hub.compliance.saved', { date: next ? formatDate(next, lang) : '—' }));
          void queryClient.invalidateQueries({ queryKey: ['hub', 'compliance'] });
        }}
      />
    </div>
  );
}

function InspectionDialog({ check, onClose, onDone }: { check: ComplianceCheckView | null; onClose: () => void; onDone: (nextDueOn: string | null) => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [inspectedOn, setInspectedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [passed, setPassed] = useState(true);
  const [odometer, setOdometer] = useState('');
  const [notes, setNotes] = useState('');
  const save = useMutation({
    mutationFn: () => hubApi.admin.recordInspection(check!.entityId, { inspectedOn, passed, ...(odometer ? { odometerKm: Number(odometer) } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}) }),
    onSuccess: (data) => onDone(data.nextInspectionDueOn),
  });
  return (
    <Dialog open={check !== null} title={t('hub.compliance.inspectTitle')} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {check ? <p className="text-sm">{check.label}</p> : null}
        <Field label={t('hub.compliance.inspectedOn')}>{(p) => <Input {...p} type="date" required value={inspectedOn} onChange={(e) => setInspectedOn(e.target.value)} />}</Field>
        <Checkbox label={t('hub.compliance.passed')} checked={passed} onChange={(e) => setPassed(e.target.checked)} />
        <Field label={t('hub.compliance.odometer')}>{(p) => <Input {...p} type="number" min={0} max={2_000_000} value={odometer} onChange={(e) => setOdometer(e.target.value)} />}</Field>
        <Field label={t('hub.compliance.notes')}>{(p) => <Textarea {...p} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        {save.isError ? <Notice tone="danger">{errorText(save.error)}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Action tone="secondary" onClick={onClose}>{t('hub.common.cancel')}</Action>
          <Action type="submit" busy={save.isPending}>{t('hub.common.save')}</Action>
        </div>
      </form>
    </Dialog>
  );
}
