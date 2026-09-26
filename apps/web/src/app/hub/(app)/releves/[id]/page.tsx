'use client';

import { OFFLINE_SETTLEMENT_METHODS, type OfflineSettlementMethod, type StatementLineView, type StatementSettleOffline } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EnumBadge, ErrorBlock, Loading, useErrorText, useHubUser, useLang } from '@/components/hub/common';
import { Action, Card, DataTable, Dialog, Field, Input, Notice, PageTitle, Select, focus, type Column } from '@/components/ui/kit';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { FINANCE_ROLES, hubApi } from '@/lib/hub-api';

/** Lundi (AAAA-MM-JJ) de la semaine d'une date, heure locale du navigateur. */
function mondayOf(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Détail d'un relevé : lignes, totaux, règlement ; émission, règlement, ajustement motivé et PDF (étape 9). */
export default function StatementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const lang = useLang();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const finance = useHubUser().roles.some((r) => FINANCE_ROLES.includes(r));
  const [adjusting, setAdjusting] = useState(false);
  const [settlingOffline, setSettlingOffline] = useState(false);
  const router = useRouter();
  // Correction d'un relevé émis : brouillon de la semaine en cours pour ce chauffeur (créé vide s'il le faut), puis ajustement.
  const correction = useMutation({
    mutationFn: (driverId: string) => hubApi.admin.generateStatements({ periodStart: mondayOf(new Date()), driverId, allowEmpty: true }),
    onSuccess: (data) => {
      const draft = data.statements[0];
      if (draft?.id) router.push(`/hub/releves/${draft.id}`);
    },
  });
  const detail = useQuery({ queryKey: ['hub', 'statement', id], queryFn: () => hubApi.admin.statement(id) });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['hub', 'statement', id] });
    void queryClient.invalidateQueries({ queryKey: ['hub', 'statements'] });
    void queryClient.invalidateQueries({ queryKey: ['hub', 'balances'] });
  };
  const action = useMutation({ mutationFn: (run: () => Promise<unknown>) => run(), onSuccess: refresh });
  const adjust = useMutation({
    mutationFn: (body: { direction: 'credit' | 'debit'; amountCents: number; reason: string }) => hubApi.admin.adjustStatement(id, body),
    onSuccess: () => { setAdjusting(false); refresh(); },
  });

  const offline = useMutation({
    mutationFn: (body: StatementSettleOffline) => hubApi.admin.settleStatementOffline(id, body),
    onSuccess: () => { setSettlingOffline(false); refresh(); },
  });

  if (detail.isPending) return <Loading />;
  if (detail.isError) return <ErrorBlock error={detail.error} onRetry={() => void detail.refetch()} />;
  const s = detail.data;
  const columns: Column<StatementLineView>[] = [
    { key: 'date', header: t('hub.statements.date'), cell: (l) => formatDate(l.occurredAt, lang) },
    { key: 'label', header: t('hub.statements.label'), cell: (l) => (l.rideId ? <Link className={`text-brand-blue-dark underline ${focus}`} href={`/hub/courses/${l.rideId}`}>{l.label}</Link> : l.label) },
    { key: 'amount', header: t('hub.statements.amount'), className: 'text-right', cell: (l) => formatMoney(l.amountCents, lang) },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageTitle
        title={`${t('hub.statements.detailTitle', { start: formatDate(s.periodStart, lang), end: formatDate(s.periodEnd, lang) })} · ${s.driverName ?? s.driverPublicNumber}`}
        subtitle={<Link href="/hub/releves" className={`text-brand-blue-dark underline ${focus}`}>{t('hub.common.back')}</Link>}
        actions={<EnumBadge group="statementStatus" value={s.status} />}
      />
      {action.isError ? <Notice tone="danger">{errorText(action.error)}</Notice> : null}
      {correction.isError ? <Notice tone="danger">{errorText(correction.error)}</Notice> : null}
      {finance && s.status !== 'draft' ? <Notice tone="info">{t('hub.statements.correctionHint')}</Notice> : null}

      <div className="flex flex-wrap items-center gap-2">
        {finance && s.status === 'draft' ? <Action busy={action.isPending} onClick={() => action.mutate(() => hubApi.admin.issueStatement(id))}>{t('hub.statements.issue')}</Action> : null}
        {finance && (s.status === 'issued' || s.status === 'failed') ? <Action busy={action.isPending} onClick={() => action.mutate(() => hubApi.admin.payStatement(id))}>{t('hub.statements.pay')}</Action> : null}
        {finance && (s.status === 'issued' || s.status === 'failed') ? <Action tone="secondary" onClick={() => setSettlingOffline(true)}>{t('hub.statements.settleOffline')}</Action> : null}
        {finance && s.status === 'draft' ? <Action tone="secondary" onClick={() => setAdjusting(true)}>{t('hub.statements.adjust')}</Action> : null}
        {finance && s.status !== 'draft' ? <Action tone="secondary" busy={correction.isPending} onClick={() => correction.mutate(s.driverId)}>{t('hub.statements.prepareCorrection')}</Action> : null}
        {s.pdfAvailable ? (
          <a className={`rounded-md px-3 py-2 text-sm font-semibold text-brand-blue-dark underline ${focus}`} href={`/api/v1${hubApi.admin.statementPdfPath(id)}`} target="_blank" rel="noreferrer">{t('hub.statements.pdf')}</a>
        ) : s.status !== 'draft' ? <span className="text-sm text-neutral-600">{t('hub.statements.pdfPending')}</span> : null}
      </div>
      {s.status === 'draft' ? <Notice tone="info">{`${t('hub.statements.issueHint')} ${t('hub.statements.adjustHint')}`}</Notice> : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title={t('hub.statements.lines')} className="lg:col-span-2">
          <DataTable caption={t('hub.statements.lines')} columns={columns} rows={s.lines} rowKey={(l) => `${l.kind}-${l.rideId ?? l.packPurchaseId ?? l.label}-${l.occurredAt}`} empty={t('hub.common.empty')} />
        </Card>
        <Card title={t('hub.statements.net')}>
          <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm">
            <dt>{t('hub.statements.credits')}</dt><dd className="text-right">{formatMoney(s.creditsCents, lang)}</dd>
            <dt>{t('hub.statements.debits')}</dt><dd className="text-right">{formatMoney(-s.debitsCents, lang)}</dd>
            <dt className="font-bold">{t('hub.statements.net')}</dt><dd className="text-right font-bold">{formatMoney(s.netCents, lang)}</dd>
            <dt>{t('hub.statements.issued')}</dt><dd className="text-right">{formatDateTime(s.issuedAt, lang)}</dd>
            <dt>{t('hub.statements.settledAt')}</dt><dd className="text-right">{formatDateTime(s.settledAt, lang)}</dd>
            <dt>{t('hub.statements.attempts')}</dt><dd className="text-right">{s.attempts}</dd>
            {s.failureCode ? <><dt>{t('hub.statements.failure')}</dt><dd className="text-right"><code>{s.failureCode}</code></dd></> : null}
            {s.transferRef ? <><dt>{t('hub.statements.transfer')}</dt><dd className="text-right"><code>{s.transferRef}</code></dd></> : null}
            {s.chargeRef ? <><dt>{t('hub.statements.charge')}</dt><dd className="text-right"><code>{s.chargeRef}</code></dd></> : null}
            {s.offlineSettlement ? <><dt>{t('hub.statements.offlineSettled')}</dt><dd className="text-right">{t(`hub.statements.offlineMethod.${s.offlineSettlement.method}`)} · <code>{s.offlineSettlement.reference}</code></dd></> : null}
            {s.offlineSettlement?.note ? <><dt>{t('hub.statements.offlineNote')}</dt><dd className="text-right">{s.offlineSettlement.note}</dd></> : null}
          </dl>
        </Card>
      </div>

      <OfflineDialog open={settlingOffline} netCents={s.netCents} busy={offline.isPending} error={offline.isError ? errorText(offline.error) : null} onClose={() => setSettlingOffline(false)} onSubmit={(body) => offline.mutate(body)} />
      <AdjustDialog open={adjusting} busy={adjust.isPending} error={adjust.isError ? errorText(adjust.error) : null} onClose={() => setAdjusting(false)} onSubmit={(body) => adjust.mutate(body)} />
    </div>
  );
}

function OfflineDialog({ open, netCents, busy, error, onClose, onSubmit }: { open: boolean; netCents: number; busy: boolean; error: string | null; onClose: () => void; onSubmit: (body: StatementSettleOffline) => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [method, setMethod] = useState<OfflineSettlementMethod>('interac');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  return (
    <Dialog open={open} title={t('hub.statements.settleOffline')} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); onSubmit({ method, reference: reference.trim(), ...(note.trim() ? { note: note.trim() } : {}) }); }}>
        <Notice tone="info">{t(netCents < 0 ? 'hub.statements.offlineHintOwed' : 'hub.statements.offlineHintPayout', { amount: formatMoney(Math.abs(netCents), lang) })}</Notice>
        <Field label={t('hub.statements.offlineMethodLabel')}>
          {(p) => (
            <Select {...p} value={method} onChange={(e) => setMethod(e.target.value as OfflineSettlementMethod)}>
              {OFFLINE_SETTLEMENT_METHODS.map((m) => <option key={m} value={m}>{t(`hub.statements.offlineMethod.${m}`)}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('hub.statements.offlineReference')}>{(p) => <Input {...p} required minLength={2} maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} />}</Field>
        <Field label={t('hub.statements.offlineNote')}>{(p) => <Input {...p} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Action tone="secondary" onClick={onClose}>{t('hub.common.cancel')}</Action>
          <Action type="submit" busy={busy} disabled={reference.trim().length < 2}>{t('hub.common.confirm')}</Action>
        </div>
      </form>
    </Dialog>
  );
}

function AdjustDialog({ open, busy, error, onClose, onSubmit }: { open: boolean; busy: boolean; error: string | null; onClose: () => void; onSubmit: (body: { direction: 'credit' | 'debit'; amountCents: number; reason: string }) => void }) {
  const { t } = useTranslation();
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const cents = Math.round(Number(amount.replace(',', '.')) * 100);
  return (
    <Dialog open={open} title={t('hub.statements.adjust')} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (cents > 0) onSubmit({ direction, amountCents: cents, reason: reason.trim() }); }}>
        <Field label={t('hub.statements.direction')}>
          {(p) => (
            <Select {...p} value={direction} onChange={(e) => setDirection(e.target.value as 'credit' | 'debit')}>
              <option value="credit">{t('hub.statements.credit')}</option>
              <option value="debit">{t('hub.statements.debit')}</option>
            </Select>
          )}
        </Field>
        <Field label={t('hub.statements.amountDollars')}>{(p) => <Input {...p} inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
        <Field label={t('hub.statements.reason')}>{(p) => <Input {...p} required minLength={3} maxLength={120} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Action tone="secondary" onClick={onClose}>{t('hub.common.cancel')}</Action>
          <Action type="submit" busy={busy} disabled={!(cents > 0)}>{t('hub.common.confirm')}</Action>
        </div>
      </form>
    </Dialog>
  );
}
