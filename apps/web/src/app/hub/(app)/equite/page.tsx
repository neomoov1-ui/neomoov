'use client';

import type { AdminSanctionAppealView, AppealStatus, SanctionAppealDecision } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading, useCanWrite, useErrorText, useHubUser } from '@/components/hub/common';
import { Action, Badge, Card, DataTable, Dialog, Field, Notice, PageTitle, Select, Textarea, focus, type Column } from '@/components/ui/kit';
import { hubApi } from '@/lib/hub-api';

/**
 * Charte d'équité (D7) : réponses et appels des chauffeurs, les plus anciens d'abord. Une personne tranche sous 4 heures
 * ouvrables, avec un motif ; un appel est tranché par une autre personne que celle qui a décidé la sanction (l'API refuse).
 */
export default function FairnessPage() {
  const { t } = useTranslation();
  const writable = useCanWrite();
  const errorText = useErrorText();
  const me = useHubUser();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AppealStatus | ''>('open');
  const [deciding, setDeciding] = useState<AdminSanctionAppealView | null>(null);
  const [decision, setDecision] = useState<SanctionAppealDecision['decision']>('upheld');
  const [note, setNote] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['hub', 'fairness', status], queryFn: () => hubApi.admin.sanctionAppeals(status ? { status } : {}) });
  const decide = useMutation({
    mutationFn: () => hubApi.admin.decideSanctionAppeal(deciding!.id, { decision, note: note.trim() }),
    onSuccess: (appeal) => {
      setDeciding(null);
      setNote('');
      setDone(t(`hub.fairness.done.${appeal.status === 'overturned' ? 'overturned' : 'upheld'}`));
      void queryClient.invalidateQueries({ queryKey: ['hub', 'fairness'] });
    },
  });
  const columns: Column<AdminSanctionAppealView>[] = [
    { key: 'driver', header: t('hub.fairness.driver'), cell: (a) => <Link className={`text-brand-blue-dark underline ${focus}`} href={`/hub/chauffeurs/${a.driverId}`}>{a.driverName ?? a.driverPublicNumber}</Link> },
    { key: 'kind', header: t('hub.fairness.kind'), cell: (a) => t(`hub.fairness.kinds.${a.kind}`) },
    { key: 'sanction', header: t('hub.fairness.sanction'), cell: (a) => `${t(`hub.quality.types.${a.sanction.type}`)} : ${a.sanction.reason}` },
    { key: 'created', header: t('hub.fairness.created'), cell: (a) => new Date(a.createdAt).toLocaleString() },
    { key: 'status', header: t('hub.fairness.status'), cell: (a) => (a.overdue ? <Badge tone="danger">{t('hub.fairness.overdue')}</Badge> : <Badge tone={a.status === 'open' ? 'warning' : a.status === 'overturned' ? 'success' : 'neutral'}>{t(`hub.fairness.statuses.${a.status}`)}</Badge>) },
    {
      key: 'action', header: '', cell: (a) => (writable && a.status === 'open' ? (
        <Action tone="secondary" onClick={() => { setDeciding(a); setDecision('upheld'); setNote(''); decide.reset(); }}>{t('hub.fairness.decide')}</Action>
      ) : a.decisionNote ?? null),
    },
  ];
  const sameDecider = deciding?.kind === 'appeal' && deciding.sanction.decidedByUserId === me.id;
  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={t('hub.fairness.title')} />
      <Notice tone="info">{t('hub.fairness.intro')}</Notice>
      {done ? <Notice tone="success">{done}</Notice> : null}
      <Card actions={(
        <Field label={t('hub.fairness.filter')}>
          {(p) => (
            <Select {...p} value={status} onChange={(e) => setStatus(e.target.value as AppealStatus | '')}>
              <option value="open">{t('hub.fairness.statuses.open')}</option>
              <option value="">{t('hub.fairness.all')}</option>
            </Select>
          )}
        </Field>
      )}>
        {list.isPending ? <Loading /> : list.isError ? <ErrorBlock error={list.error} onRetry={() => void list.refetch()} /> : (
          <DataTable caption={t('hub.fairness.title')} columns={columns} rows={list.data} rowKey={(a) => a.id} empty={t('hub.fairness.empty')} />
        )}
      </Card>
      <Dialog open={deciding !== null} title={t('hub.fairness.decide')} onClose={() => setDeciding(null)}>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); decide.mutate(); }}>
          {deciding ? (
            <>
              <p className="text-sm"><strong>{t(`hub.fairness.kinds.${deciding.kind}`)}</strong> · {deciding.driverName ?? deciding.driverPublicNumber}</p>
              <p className="whitespace-pre-wrap text-sm">{deciding.message}</p>
              <p className="text-sm text-slate-600">{deciding.sanction.reason}</p>
            </>
          ) : null}
          {sameDecider ? <Notice tone="warning">{t('hub.fairness.sameDecider')}</Notice> : null}
          <Field label={t('hub.fairness.decision')}>
            {(p) => (
              <Select {...p} value={decision} onChange={(e) => setDecision(e.target.value as SanctionAppealDecision['decision'])}>
                {(['upheld', 'overturned'] as const).map((d) => <option key={d} value={d}>{t(`hub.fairness.statuses.${d}`)}</option>)}
              </Select>
            )}
          </Field>
          <Field label={t('hub.fairness.note')} hint={t('hub.fairness.noteHint')}>{(p) => <Textarea {...p} required minLength={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          {decide.isError ? <Notice tone="danger">{errorText(decide.error)}</Notice> : null}
          <div className="flex justify-end gap-2">
            <Action tone="secondary" onClick={() => setDeciding(null)}>{t('hub.common.cancel')}</Action>
            <Action type="submit" busy={decide.isPending} disabled={sameDecider}>{t('hub.common.save')}</Action>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
