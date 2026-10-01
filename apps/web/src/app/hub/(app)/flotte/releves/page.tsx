'use client';

import type { OrganizationStatementView, RevenueShareRuleView } from '@neomoov/domain';
import { OFFLINE_SETTLEMENT_METHODS } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading, useErrorText, useLang } from '@/components/hub/common';
import { useFleetOrg } from '@/components/hub/fleet-org';
import { Action, Badge, Card, DataTable, Dialog, Field, Input, Notice, PageTitle, Select, type Column } from '@/components/ui/kit';
import { fleetApi } from '@/lib/fleet-api';
import { formatDate, formatMoney, fullName, montrealDate } from '@/lib/format';

/**
 * Partage des revenus et versements (étape 23) : règles de partage (loyer ou pourcentage), compte de versement de
 * l'organisation (Stripe Connect, sinon règlement hors plateforme) et relevés hebdomadaires de l'organisation.
 */
export default function FleetStatementsPage() {
  const { t } = useTranslation();
  const fleet = useFleetOrg();
  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={t('fleet.statements.title')} subtitle={fleet.name} />
      <PayoutAccount />
      <Rules />
      <OrganizationStatements />
    </div>
  );
}

function PayoutAccount() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const fleet = useFleetOrg();
  const account = useQuery({ queryKey: ['fleet', fleet.organizationId, 'payout-account'], queryFn: () => fleetApi.payoutAccount(fleet.organizationId), enabled: fleet.can('statements.read', 'payouts.manage') });
  const onboarding = useMutation({ mutationFn: () => fleetApi.payoutOnboarding(fleet.organizationId), onSuccess: (link) => { if (!link.simulated) window.location.assign(link.url); else void account.refetch(); } });
  if (!account.data && !account.isPending) return account.isError ? <ErrorBlock error={account.error} /> : null;
  return (
    <Card title={t('fleet.statements.account')} actions={fleet.can('payouts.manage') && account.data?.mode !== 'connect' ? <Action busy={onboarding.isPending} onClick={() => onboarding.mutate()}>{t('fleet.statements.openAccount')}</Action> : null}>
      {account.isPending ? <Loading /> : account.data ? (
        <Notice tone={account.data.mode === 'connect' ? 'success' : 'warning'}>{account.data.mode === 'connect' ? t('fleet.statements.connect') : t('fleet.statements.offline')}</Notice>
      ) : null}
      {onboarding.data?.simulated ? <p className="mt-2 text-xs text-slate-600">{t('fleet.statements.simulated')}</p> : null}
      {onboarding.isError ? <Notice tone="danger">{errorText(onboarding.error)}</Notice> : null}
    </Card>
  );
}

function Rules() {
  const { t } = useTranslation();
  const lang = useLang();
  const errorText = useErrorText();
  const fleet = useFleetOrg();
  const queryClient = useQueryClient();
  const key = ['fleet', fleet.organizationId, 'rules'];
  const rules = useQuery({ queryKey: key, queryFn: () => fleetApi.rules(fleet.organizationId), enabled: fleet.can('statements.read', 'revenue_share.manage') });
  const drivers = useQuery({ queryKey: ['fleet', fleet.organizationId, 'driver-options'], queryFn: () => fleetApi.drivers(fleet.organizationId, { page: 1, pageSize: 100 }), enabled: fleet.can('revenue_share.manage') });
  const [creating, setCreating] = useState(false);
  const end = useMutation({ mutationFn: (rule: RevenueShareRuleView) => fleetApi.endRule(fleet.organizationId, rule.id, montrealDate()), onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }) });
  const columns: Column<RevenueShareRuleView>[] = [
    { key: 'driver', header: t('fleet.statements.driver'), cell: (r) => r.driverName ?? t('fleet.statements.allDrivers') },
    { key: 'mode', header: t('fleet.statements.mode'), cell: (r) => (r.mode === 'rent' ? `${t('fleet.statements.rent')} · ${formatMoney(r.weeklyRentCents, lang)}` : `${t('fleet.statements.percentage')} · ${(r.percentagePpm ?? 0) / 10_000} %`) },
    { key: 'from', header: t('fleet.statements.from'), cell: (r) => formatDate(r.effectiveFrom, lang) },
    { key: 'to', header: t('fleet.statements.to'), cell: (r) => formatDate(r.effectiveTo, lang) },
    { key: 'actions', header: '', cell: (r) => (fleet.can('revenue_share.manage') && !r.effectiveTo ? <Action tone="secondary" busy={end.isPending} onClick={() => end.mutate(r)}>{t('fleet.statements.end')}</Action> : null) },
  ];
  if (!fleet.can('statements.read', 'revenue_share.manage')) return null;
  return (
    <Card title={t('fleet.statements.rules')} actions={fleet.can('revenue_share.manage') ? <Action onClick={() => setCreating(true)}>{t('fleet.statements.newRule')}</Action> : null}>
      {rules.isPending ? <Loading /> : rules.isError ? <ErrorBlock error={rules.error} /> : <DataTable columns={columns} rows={rules.data} rowKey={(r) => r.id} empty="—" caption={t('fleet.statements.rules')} />}
      {end.isError ? <Notice tone="danger">{errorText(end.error)}</Notice> : null}
      {creating ? <NewRuleDialog drivers={(drivers.data?.items ?? []).map((d) => ({ id: d.id, name: fullName(d.firstName, d.lastName, d.publicNumber) }))} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); void queryClient.invalidateQueries({ queryKey: key }); }} /> : null}
    </Card>
  );
}

function NewRuleDialog({ drivers, onClose, onCreated }: { drivers: Array<{ id: string; name: string }>; onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const fleet = useFleetOrg();
  const [form, setForm] = useState({ driverId: '', mode: 'percentage', amount: '', share: '20', from: montrealDate(), to: '' });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const create = useMutation({
    mutationFn: () => fleetApi.createRule(fleet.organizationId, {
      mode: form.mode, effectiveFrom: form.from, ...(form.to ? { effectiveTo: form.to } : {}), ...(form.driverId ? { driverId: form.driverId } : {}),
      ...(form.mode === 'rent' ? { weeklyRentCents: Math.round(Number(form.amount) * 100) } : { percentagePpm: Math.round(Number(form.share) * 10_000) }),
    }),
    onSuccess: onCreated,
  });
  return (
    <Dialog open title={t('fleet.statements.newRule')} onClose={onClose}>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <Field label={t('fleet.statements.driver')}>
          {(p) => <Select {...p} value={form.driverId} onChange={set('driverId')}><option value="">{t('fleet.statements.allDrivers')}</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>}
        </Field>
        <Field label={t('fleet.statements.mode')}>
          {(p) => <Select {...p} value={form.mode} onChange={set('mode')}><option value="percentage">{t('fleet.statements.percentage')}</option><option value="rent">{t('fleet.statements.rent')}</option></Select>}
        </Field>
        {form.mode === 'rent'
          ? <Field label={t('fleet.statements.amount')}>{(p) => <Input {...p} required type="number" min={1} step="0.01" value={form.amount} onChange={set('amount')} />}</Field>
          : <Field label={t('fleet.statements.share')}>{(p) => <Input {...p} required type="number" min={0.01} max={100} step="0.01" value={form.share} onChange={set('share')} />}</Field>}
        <Field label={t('fleet.statements.from')}>{(p) => <Input {...p} required type="date" value={form.from} onChange={set('from')} />}</Field>
        <Field label={t('fleet.statements.to')}>{(p) => <Input {...p} type="date" value={form.to} onChange={set('to')} />}</Field>
        <div className="sm:col-span-2 flex flex-col gap-2">
          {create.isError ? <Notice tone="danger">{errorText(create.error)}</Notice> : null}
          <Action type="submit" busy={create.isPending}>{t('fleet.statements.newRule')}</Action>
        </div>
      </form>
    </Dialog>
  );
}

function OrganizationStatements() {
  const { t } = useTranslation();
  const lang = useLang();
  const fleet = useFleetOrg();
  const statements = useQuery({ queryKey: ['fleet', fleet.organizationId, 'organization-statements'], queryFn: () => fleetApi.organizationStatements(fleet.organizationId), enabled: fleet.can('statements.read') });
  const [settling, setSettling] = useState<OrganizationStatementView | null>(null);
  const tone = { issued: 'warning', paid: 'success', failed: 'danger', settled_offline: 'info' } as const;
  const columns: Column<OrganizationStatementView>[] = [
    { key: 'period', header: t('fleet.statements.period'), cell: (s) => `${formatDate(s.periodStart, lang)} → ${formatDate(s.periodEnd, lang)}` },
    { key: 'status', header: t('fleet.statements.status'), cell: (s) => <Badge tone={tone[s.status]}>{t(`fleet.statements.statuses.${s.status}`)}</Badge> },
    { key: 'share', header: t('fleet.statements.total'), cell: (s) => formatMoney(s.shareCents, lang) },
    { key: 'drivers', header: t('fleet.statements.drivers'), cell: (s) => s.lines.map((l) => `${l.driverName ?? l.driverPublicNumber} (${formatMoney(l.shareCents, lang)})`).join(', ') },
    { key: 'actions', header: '', cell: (s) => (fleet.can('payouts.manage') && (s.status === 'issued' || s.status === 'failed') ? <Action tone="secondary" onClick={() => setSettling(s)}>{t('fleet.statements.settle')}</Action> : null) },
  ];
  if (!fleet.can('statements.read')) return null;
  return (
    <Card title={t('fleet.statements.organizationStatements')} actions={<a className="text-sm font-semibold text-brand-blue-dark underline" href={fleetApi.exportUrl(fleet.organizationId)}>{t('fleet.statements.export')}</a>}>
      {statements.isPending ? <Loading /> : statements.isError ? <ErrorBlock error={statements.error} /> : <DataTable columns={columns} rows={statements.data} rowKey={(s) => s.id} empty={t('fleet.statements.none')} caption={t('fleet.statements.organizationStatements')} />}
      {settling ? <SettleDialog statement={settling} onClose={() => setSettling(null)} onSettled={() => { setSettling(null); void statements.refetch(); }} /> : null}
    </Card>
  );
}

function SettleDialog({ statement, onClose, onSettled }: { statement: OrganizationStatementView; onClose: () => void; onSettled: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const fleet = useFleetOrg();
  const [method, setMethod] = useState<string>('bank_transfer');
  const [reference, setReference] = useState('');
  const settle = useMutation({ mutationFn: () => fleetApi.settleOffline(fleet.organizationId, statement.id, { method, reference }), onSuccess: onSettled });
  return (
    <Dialog open title={t('fleet.statements.settle')} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); settle.mutate(); }}>
        <Field label={t('fleet.statements.method')}>
          {(p) => <Select {...p} value={method} onChange={(e) => setMethod(e.target.value)}>{OFFLINE_SETTLEMENT_METHODS.map((m) => <option key={m} value={m}>{t(`fleet.statements.methods.${m}`)}</option>)}</Select>}
        </Field>
        <Field label={t('fleet.statements.reference')}>{(p) => <Input {...p} required minLength={2} maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} />}</Field>
        {settle.isError ? <Notice tone="danger">{errorText(settle.error)}</Notice> : null}
        <Action type="submit" busy={settle.isPending}>{t('fleet.statements.settle')}</Action>
      </form>
    </Dialog>
  );
}
