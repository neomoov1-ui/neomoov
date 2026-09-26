'use client';

/** Paiements d'une course dans My Hub (étape 7) : états, montants, carte masquée ; remboursement sur la carte ou crédit. */
import type { PaymentView } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Action, Card, DataTable, Dialog, Field, Input, Notice, Select, Textarea } from '@/components/ui/kit';
import { formatDateTime, formatMoney } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';
import { EnumBadge, ErrorBlock, Loading, useErrorText, useHubUser, useLang } from './common';

const REFUND_ROLES = ['admin', 'operator', 'finance'];

export function RidePayments({ rideId }: { rideId: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const user = useHubUser();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'refund' | 'credit'>('refund');
  // Une clé par ouverture du dialogue : un double clic ne rembourse pas deux fois.
  const idempotency = useRef('');
  const payments = useQuery({ queryKey: ['hub', 'ride', rideId, 'payments'], queryFn: () => hubApi.admin.ridePayments(rideId) });
  const refund = useMutation({
    mutationFn: () => hubApi.admin.refundRide(rideId, { amountCents: Math.round(Number(amount.replace(',', '.')) * 100), reason: reason.trim(), mode }, idempotency.current),
    onSuccess: () => {
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['hub', 'ride', rideId] });
    },
  });
  const canRefund = user.roles.some((r) => REFUND_ROLES.includes(r));
  const amountOk = Number(amount.replace(',', '.')) > 0;

  return (
    <Card
      title={t('hub.rides.payments')}
      actions={canRefund && payments.data?.length ? <Action tone="secondary" onClick={() => { idempotency.current = `hub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; refund.reset(); setOpen(true); }}>{t('hub.rides.refund')}</Action> : null}
    >
      {refund.isSuccess ? <div className="mb-3"><Notice tone="success">{t('hub.rides.refundDone')}</Notice></div> : null}
      {payments.isPending ? <Loading /> : payments.isError ? <ErrorBlock error={payments.error} /> : payments.data.length === 0 ? <p className="text-sm text-slate-600">{t('hub.rides.noPayments')}</p> : (
        <DataTable<PaymentView>
          rows={payments.data}
          rowKey={(p) => p.id}
          empty={t('hub.rides.noPayments')}
          columns={[
            { key: 'kind', header: t('hub.rides.kind'), cell: (p) => t(`enum.paymentKind.${p.kind}`) },
            { key: 'status', header: t('hub.common.status'), cell: (p) => <EnumBadge group="paymentStatus" value={p.status} /> },
            { key: 'method', header: t('hub.rides.payment'), cell: (p) => `${t(`enum.paymentMethod.${p.method}`)}${p.card ? ` · ${p.card.brand} •••• ${p.card.last4}` : ''}` },
            { key: 'authorized', header: t('hub.rides.authorized'), className: 'text-right', cell: (p) => formatMoney(p.authorizedCents, lang) },
            { key: 'captured', header: t('hub.rides.captured'), className: 'text-right', cell: (p) => formatMoney(p.driverConfirmedCents ?? p.capturedCents, lang) },
            { key: 'refunded', header: t('hub.rides.refunded'), className: 'text-right', cell: (p) => (p.refundedCents ? formatMoney(p.refundedCents, lang) : '') },
            { key: 'when', header: t('hub.rides.when'), cell: (p) => <span className="text-xs">{formatDateTime(p.createdAt, lang)}{p.failureCode ? <span className="block text-red-800">{p.failureCode}</span> : null}</span> },
          ]}
        />
      )}
      <Dialog open={open} title={t('hub.rides.refund')} onClose={() => setOpen(false)}>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (amountOk && reason.trim().length >= 3) refund.mutate(); }}>
          <Field label={t('hub.rides.refundAmount')}>{(p) => <Input {...p} inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
          <Field label={t('hub.rides.refundMode')}>
            {(p) => (
              <Select {...p} value={mode} onChange={(e) => setMode(e.target.value as 'refund' | 'credit')}>
                <option value="refund">{t('hub.rides.refundCard')}</option>
                <option value="credit">{t('hub.rides.refundCredit')}</option>
              </Select>
            )}
          </Field>
          <Field label={t('hub.common.reason')}>{(p) => <Textarea {...p} required minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          {refund.isError ? <Notice tone="danger">{errorText(refund.error)}</Notice> : null}
          <div className="flex justify-end gap-2">
            <Action tone="secondary" onClick={() => setOpen(false)}>{t('hub.common.cancel')}</Action>
            <Action type="submit" busy={refund.isPending} disabled={!amountOk || reason.trim().length < 3 || refund.isPending}>{t('hub.rides.refund')}</Action>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}
