'use client';

import { LEDGER_TYPES, type AdminDriverListItem, type GeolocationExportView, type LedgerMonthView, type LedgerType } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading, useDebounced, useErrorText, useHubUser, useLang } from '@/components/hub/common';
import { Action, Badge, Card, DataTable, Dialog, Field, Input, Notice, PageTitle, Select, focus } from '@/components/ui/kit';
import { formatDate, formatDateTime, formatMoney, fullName, montrealDate } from '@/lib/format';
import { ApiError, hubApi } from '@/lib/hub-api';

const FINANCE_ROLES = ['admin', 'finance'];
const linkClass = `rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-brand-ink hover:bg-brand-tint ${focus}`;

/** Mois précédent (AAAA-MM) à Montréal : le dernier mois terminé. */
function previousMonth(): string {
  const [year, month] = montrealDate().split('-').map(Number) as [number, number];
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}

function currentQuarter(): { year: string; quarter: string } {
  const [year, month] = montrealDate().split('-').map(Number) as [number, number];
  return { year: String(year), quarter: `T${Math.floor((month - 1) / 3) + 1}` };
}

/**
 * Registres de la redevance et des taxes, exports comptables (CSV et rapport de synthèse PDF), remise de la redevance,
 * rapport trimestriel d'un chauffeur et exports mensuels de géolocalisation. Réservé aux finances et aux administrateurs.
 */
export default function LedgersPage() {
  const { t } = useTranslation();
  const user = useHubUser();
  const allowed = user.roles.some((r) => FINANCE_ROLES.includes(r));
  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={t('hub.ledgers.title')} subtitle={t('hub.ledgers.subtitle')} />
      {allowed ? (
        <>
          <ExportsCard />
          <MonthsCard />
          <DriverReportCard />
          <GeolocationCard />
        </>
      ) : <Notice tone="warning">{t('hub.ledgers.financeOnly')}</Notice>}
    </div>
  );
}

function ExportsCard() {
  const { t } = useTranslation();
  const lang = useLang();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [type, setType] = useState<LedgerType>('redevance');
  const [kind, setKind] = useState<'month' | 'quarter'>('month');
  const [month, setMonth] = useState(previousMonth());
  const [quarter, setQuarter] = useState(currentQuarter());
  const period = kind === 'month' ? month : `${quarter.year}-${quarter.quarter}`;
  const valid = kind === 'month' ? /^\d{4}-(0[1-9]|1[0-2])$/.test(month) : /^\d{4}$/.test(quarter.year);

  const summaryKey = ['hub', 'ledgers', 'summary', type, period];
  const summary = useQuery({
    queryKey: summaryKey,
    enabled: valid,
    retry: false,
    // 404 : aucun rapport demandé pour cette période (pas une erreur).
    queryFn: async () => {
      try {
        return await hubApi.ledgers.summary(type, period);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 3_000 : false),
  });
  const request = useMutation({
    mutationFn: () => hubApi.ledgers.requestSummary(type, period),
    onSuccess: (view) => queryClient.setQueryData(summaryKey, view),
  });
  const state = summary.data;

  return (
    <Card title={t('hub.ledgers.exportsTitle')}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t('hub.ledgers.type')}>{(p) => (
          <Select {...p} value={type} onChange={(e) => setType(e.target.value as LedgerType)}>
            {LEDGER_TYPES.map((value) => <option key={value} value={value}>{t(`hub.ledgers.types.${value}`)}</option>)}
          </Select>
        )}</Field>
        <Field label={t('hub.ledgers.periodKind')}>{(p) => (
          <Select {...p} value={kind} onChange={(e) => setKind(e.target.value as 'month' | 'quarter')}>
            <option value="month">{t('hub.ledgers.month')}</option>
            <option value="quarter">{t('hub.ledgers.quarter')}</option>
          </Select>
        )}</Field>
        {kind === 'month' ? (
          <Field label={t('hub.ledgers.month')}>{(p) => <Input {...p} type="month" value={month} onChange={(e) => setMonth(e.target.value)} />}</Field>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('hub.ledgers.year')}>{(p) => <Input {...p} inputMode="numeric" maxLength={4} value={quarter.year} onChange={(e) => setQuarter({ ...quarter, year: e.target.value.trim() })} />}</Field>
            <Field label={t('hub.ledgers.quarter')}>{(p) => (
              <Select {...p} value={quarter.quarter} onChange={(e) => setQuarter({ ...quarter, quarter: e.target.value })}>
                {['T1', 'T2', 'T3', 'T4'].map((q) => <option key={q} value={q}>{q}</option>)}
              </Select>
            )}</Field>
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-slate-600">{t('hub.ledgers.periodHint')}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {valid ? <a href={`/api/v1${hubApi.ledgers.exportCsvPath(type, period)}`} download className={linkClass}>{t('hub.ledgers.downloadCsv')}</a> : null}
        <Action disabled={!valid} busy={request.isPending} onClick={() => request.mutate()}>{t('hub.ledgers.requestPdf')}</Action>
        {state?.status === 'ready' && state.downloadPath ? <a href={`/api/v1${state.downloadPath}`} download className={linkClass}>{t('hub.ledgers.downloadPdf')}</a> : null}
      </div>
      <div className="mt-3" aria-live="polite">
        {request.isError ? <Notice tone="danger">{errorText(request.error)}</Notice> : null}
        {summary.isError ? <ErrorBlock error={summary.error} onRetry={() => void summary.refetch()} /> : null}
        {state ? (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={state.status === 'ready' ? 'success' : state.status === 'failed' ? 'danger' : 'warning'}>{t(`hub.ledgers.summaryStatus.${state.status}`)}</Badge>
            <span>{state.status === 'ready' ? t('hub.ledgers.generatedAt', { date: formatDateTime(state.generatedAt, lang) }) : t('hub.ledgers.requestedAt', { date: formatDateTime(state.requestedAt, lang) })}</span>
            {state.error ? <span className="text-red-800">{state.error}</span> : null}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function MonthsCard() {
  const { t } = useTranslation();
  const lang = useLang();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const months = useQuery({ queryKey: ['hub', 'ledgers', 'months'], queryFn: () => hubApi.ledgers.months() });
  const [target, setTarget] = useState<LedgerMonthView | null>(null);
  const [form, setForm] = useState({ remittedOn: montrealDate(), reference: '' });
  const remit = useMutation({
    mutationFn: () => hubApi.ledgers.remitRedevance({ period: target!.period, remittedOn: form.remittedOn, ...(form.reference.trim() ? { reference: form.reference.trim() } : {}) }),
    onSuccess: () => {
      setTarget(null);
      void queryClient.invalidateQueries({ queryKey: ['hub', 'ledgers', 'months'] });
    },
  });
  const closed = (period: string) => period < montrealDate().slice(0, 7);

  return (
    <Card title={t('hub.ledgers.monthsTitle')}>
      {months.isPending ? <Loading /> : months.isError ? <ErrorBlock error={months.error} onRetry={() => void months.refetch()} /> : (
        <DataTable
          caption={t('hub.ledgers.monthsTitle')}
          rows={months.data}
          rowKey={(m) => m.period}
          empty={t('hub.ledgers.noMonths')}
          columns={[
            { key: 'period', header: t('hub.ledgers.month'), cell: (m) => <code>{m.period}</code> },
            { key: 'rides', header: t('hub.ledgers.rides'), className: 'text-right', cell: (m) => m.rideCount },
            { key: 'due', header: t('hub.ledgers.redevanceDue'), className: 'text-right', cell: (m) => formatMoney(m.redevanceCents, lang) },
            { key: 'billed', header: t('hub.ledgers.redevanceBilled'), className: 'text-right', cell: (m) => formatMoney(m.redevanceBilledCents, lang) },
            {
              key: 'remitted', header: t('hub.ledgers.remitted'), cell: (m) => (
                m.unremittedCount === 0
                  ? <span><Badge tone="success">{t('hub.ledgers.remittedAll')}</Badge><span className="block text-xs text-slate-600">{formatDate(m.remittedAt, lang)}</span></span>
                  : <Badge tone="warning">{t('hub.ledgers.toRemit', { amount: formatMoney(m.redevanceCents - m.remittedCents, lang), count: m.unremittedCount })}</Badge>
              ),
            },
            { key: 'fareTaxes', header: t('hub.ledgers.fareTaxes'), className: 'text-right', cell: (m) => <span>{formatMoney(m.fareGstCents, lang)}<span className="block text-xs text-slate-600">{formatMoney(m.fareQstCents, lang)}</span></span> },
            { key: 'feeTaxes', header: t('hub.ledgers.feeTaxes'), className: 'text-right', cell: (m) => <span>{formatMoney(m.feeGstCents, lang)}<span className="block text-xs text-slate-600">{formatMoney(m.feeQstCents, lang)}</span></span> },
            {
              key: 'actions', header: t('hub.common.actions'), cell: (m) => (m.unremittedCount > 0 && closed(m.period)
                ? <Action tone="secondary" onClick={() => { remit.reset(); setForm({ remittedOn: montrealDate(), reference: '' }); setTarget(m); }}>{t('hub.ledgers.markRemitted')}</Action>
                : null),
            },
          ]}
        />
      )}
      <p className="mt-2 text-xs text-slate-600">{t('hub.ledgers.taxesHint')}</p>
      <Dialog open={target !== null} title={t('hub.ledgers.remitTitle', { period: target?.period ?? '' })} onClose={() => setTarget(null)}>
        {target ? (
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); remit.mutate(); }}>
            <p className="text-sm">{t('hub.ledgers.remitSummary', { amount: formatMoney(target.redevanceCents - target.remittedCents, lang), count: target.unremittedCount })}</p>
            <Field label={t('hub.ledgers.remittedOn')}>{(p) => <Input {...p} type="date" required max={montrealDate()} value={form.remittedOn} onChange={(e) => setForm({ ...form, remittedOn: e.target.value })} />}</Field>
            <Field label={t('hub.ledgers.reference')} hint={t('hub.ledgers.referenceHint')}>{(p) => <Input {...p} maxLength={100} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />}</Field>
            {remit.isError ? <Notice tone="danger">{errorText(remit.error)}</Notice> : null}
            <div className="flex justify-end gap-2">
              <Action tone="secondary" onClick={() => setTarget(null)}>{t('hub.common.cancel')}</Action>
              <Action type="submit" busy={remit.isPending}>{t('hub.common.confirm')}</Action>
            </div>
          </form>
        ) : null}
      </Dialog>
    </Card>
  );
}

function DriverReportCard() {
  const { t } = useTranslation();
  const lang = useLang();
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim());
  const [driver, setDriver] = useState<AdminDriverListItem | null>(null);
  const [quarter, setQuarter] = useState(currentQuarter());
  const code = `${quarter.year}-${quarter.quarter}`;
  const drivers = useQuery({ queryKey: ['hub', 'ledgers', 'drivers', search], queryFn: () => hubApi.admin.drivers({ q: search, pageSize: 8 }), enabled: search.length >= 2 });
  const report = useQuery({ queryKey: ['hub', 'ledgers', 'taxReport', driver?.id, code], queryFn: () => hubApi.ledgers.driverTaxReport(driver!.id, code), enabled: driver !== null && /^\d{4}$/.test(quarter.year) });

  return (
    <Card title={t('hub.ledgers.driverTitle')}>
      <p className="mb-3 text-sm text-slate-700">{t('hub.ledgers.driverHint')}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('hub.ledgers.driverSearch')}>{(p) => <Input {...p} type="search" value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
        <Field label={t('hub.ledgers.year')}>{(p) => <Input {...p} inputMode="numeric" maxLength={4} value={quarter.year} onChange={(e) => setQuarter({ ...quarter, year: e.target.value.trim() })} />}</Field>
        <Field label={t('hub.ledgers.quarter')}>{(p) => (
          <Select {...p} value={quarter.quarter} onChange={(e) => setQuarter({ ...quarter, quarter: e.target.value })}>
            {['T1', 'T2', 'T3', 'T4'].map((value) => <option key={value} value={value}>{value}</option>)}
          </Select>
        )}</Field>
      </div>
      {search.length >= 2 ? (
        <div className="mt-3">
          {drivers.isPending ? <Loading /> : drivers.isError ? <ErrorBlock error={drivers.error} /> : drivers.data.items.length === 0 ? <p className="text-sm text-slate-600">{t('hub.common.empty')}</p> : (
            <ul className="flex flex-wrap gap-2">
              {drivers.data.items.map((d) => (
                <li key={d.id}>
                  <Action tone={driver?.id === d.id ? 'primary' : 'secondary'} aria-pressed={driver?.id === d.id} onClick={() => setDriver(d)}>{`${d.publicNumber} ${fullName(d.firstName, d.lastName)}`}</Action>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      {driver ? (
        <div className="mt-4">
          {report.isPending ? <Loading /> : report.isError ? <ErrorBlock error={report.error} onRetry={() => void report.refetch()} /> : (
            <>
              <p className="mb-2 text-sm">
                <strong>{`${report.data.driver.publicNumber} ${report.data.driver.name ?? ''}`}</strong>
                {` · ${t('hub.ledgers.gstNumber')} ${report.data.driver.gstNumber ?? t('hub.ledgers.notProvided')} · ${t('hub.ledgers.qstNumber')} ${report.data.driver.qstNumber ?? t('hub.ledgers.notProvided')}`}
              </p>
              <DataTable
                caption={t('hub.ledgers.driverTitle')}
                rows={[...report.data.months.map((m) => ({ key: m.month, label: m.month, ...m })), { key: 'total', label: t('hub.ledgers.total'), ...report.data.totals }]}
                rowKey={(r) => r.key}
                empty={t('hub.common.empty')}
                columns={[
                  { key: 'month', header: t('hub.ledgers.month'), cell: (r) => (r.key === 'total' ? <strong>{r.label}</strong> : <code>{r.label}</code>) },
                  { key: 'rides', header: t('hub.ledgers.rides'), className: 'text-right', cell: (r) => r.rideCount },
                  { key: 'fare', header: t('hub.ledgers.fares'), className: 'text-right', cell: (r) => formatMoney(r.fareCents, lang) },
                  { key: 'gst', header: t('hub.ledgers.gst'), className: 'text-right', cell: (r) => formatMoney(r.gstCents, lang) },
                  { key: 'qst', header: t('hub.ledgers.qst'), className: 'text-right', cell: (r) => formatMoney(r.qstCents, lang) },
                ]}
              />
            </>
          )}
        </div>
      ) : null}
    </Card>
  );
}

function GeolocationCard() {
  const { t } = useTranslation();
  const lang = useLang();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const exports = useQuery({ queryKey: ['hub', 'ledgers', 'geolocation'], queryFn: () => hubApi.ledgers.geolocationExports() });
  const [month, setMonth] = useState(previousMonth());
  const run = useMutation({
    mutationFn: () => hubApi.ledgers.runGeolocationExport(month),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['hub', 'ledgers', 'geolocation'] }),
  });

  return (
    <Card title={t('hub.ledgers.geolocationTitle')}>
      <p className="mb-3 text-sm text-slate-700">{t('hub.ledgers.geolocationHint')}</p>
      <form className="mb-4 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); run.mutate(); }}>
        <Field label={t('hub.ledgers.month')}>{(p) => <Input {...p} type="month" required max={previousMonth()} value={month} onChange={(e) => setMonth(e.target.value)} />}</Field>
        <Action type="submit" busy={run.isPending} disabled={!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)}>{t('hub.ledgers.runGeolocation')}</Action>
      </form>
      <div aria-live="polite" className="mb-3">
        {run.isError ? <Notice tone="danger">{errorText(run.error)}</Notice> : null}
        {run.isSuccess ? <Notice tone="success">{t(run.data.status === 'done' ? 'hub.ledgers.geolocationDone' : 'hub.ledgers.geolocationQueued', { month: run.data.month })}</Notice> : null}
      </div>
      {exports.isPending ? <Loading /> : exports.isError ? <ErrorBlock error={exports.error} onRetry={() => void exports.refetch()} /> : (
        <DataTable<GeolocationExportView>
          caption={t('hub.ledgers.geolocationTitle')}
          rows={exports.data}
          rowKey={(e) => e.id}
          empty={t('hub.ledgers.noGeolocation')}
          columns={[
            { key: 'period', header: t('hub.ledgers.month'), cell: (e) => <code>{e.period}</code> },
            { key: 'format', header: t('hub.ledgers.format'), cell: (e) => e.format },
            { key: 'rides', header: t('hub.ledgers.rides'), className: 'text-right', cell: (e) => e.rideCount },
            { key: 'produced', header: t('hub.ledgers.producedAt'), cell: (e) => formatDateTime(e.producedAt, lang) },
            { key: 'transmitted', header: t('hub.ledgers.transmittedAt'), cell: (e) => (e.transmittedAt ? formatDateTime(e.transmittedAt, lang) : t('hub.ledgers.notTransmitted')) },
            { key: 'file', header: t('hub.ledgers.file'), cell: (e) => (e.downloadPath ? <a className={`text-brand-blue-dark underline ${focus}`} href={`/api/v1${e.downloadPath}`} download>{e.fileName}</a> : t('hub.ledgers.noFile')) },
          ]}
        />
      )}
    </Card>
  );
}
