'use client';

import { VEHICLE_CATEGORIES, type PricingRuleView, type SimulateResponse, type VehicleCategory } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading, useCanWrite, useErrorText, useLang } from '@/components/hub/common';
import { Action, Badge, Card, DataTable, Field, Input, Notice, PageTitle, Select } from '@/components/ui/kit';
import { formatDate, formatMoney, montrealDate } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

const toCents = (dollars: string) => Math.round(Number(dollars.replace(',', '.')) * 100);
const validAmount = (dollars: string) => dollars.trim() !== '' && Number.isFinite(Number(dollars.replace(',', '.'))) && Number(dollars.replace(',', '.')) >= 0;

/** État d'une ligne : en vigueur (la plus récente déjà commencée de sa catégorie), à venir, ou remplacée. */
function ruleState(rule: PricingRuleView, rules: PricingRuleView[], today: string): 'current' | 'upcoming' | 'past' {
  if (rule.validFrom > today) return 'upcoming';
  const started = rules.filter((r) => r.category === rule.category && r.validFrom <= today && (!r.validTo || r.validTo > today));
  const latest = started.sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
  return latest?.id === rule.id ? 'current' : 'past';
}

// Trajet de référence de la simulation (centre-ville vers l'aéroport) quand la distance et la durée sont imposées.
const DOWNTOWN = { address: 'Centre-ville, Montréal, QC', coordinates: { lat: 45.5019, lng: -73.5674 } };
const AIRPORT = { address: 'Aéroport Montréal-Trudeau (YUL), Dorval, QC', coordinates: { lat: 45.4706, lng: -73.7408 } };

export default function TariffsPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const writable = useCanWrite();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const today = montrealDate();
  const rules = useQuery({ queryKey: ['hub', 'tariffs'], queryFn: () => hubApi.admin.tariffs() });

  const [form, setForm] = useState({ category: 'neo_premium' as VehicleCategory, base: '', perKm: '', perMinute: '', minimum: '', validFrom: montrealDate(1) });
  const amountsOk = [form.base, form.perKm, form.perMinute, form.minimum].every(validAmount);
  const add = useMutation({
    mutationFn: () => hubApi.admin.addTariff({ category: form.category, baseCents: toCents(form.base), perKmCents: toCents(form.perKm), perMinuteCents: toCents(form.perMinute), minimumCents: toCents(form.minimum), validFrom: form.validFrom }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['hub', 'tariffs'] }),
  });

  const [sim, setSim] = useState({ km: '20', minutes: '25' });
  const simulate = useMutation({
    mutationFn: () => hubApi.admin.simulate({
      origin: DOWNTOWN, destination: AIRPORT, stops: [], options: { flex: false, priority: false, childSeat: false, luggage: false },
      distanceMeters: Math.round(Number(sim.km) * 1000), durationSeconds: Math.round(Number(sim.minutes) * 60), ignoreLeadTime: true,
    }),
  });

  const stateBadge = (rule: PricingRuleView) => {
    const state = ruleState(rule, rules.data ?? [], today);
    return <Badge tone={state === 'current' ? 'success' : state === 'upcoming' ? 'info' : 'neutral'}>{t(`hub.tariffs.${state}`)}</Badge>;
  };

  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={t('hub.tariffs.title')} subtitle={t('hub.tariffs.subtitle')} />
      <Card>
        {rules.isPending ? <Loading /> : rules.isError ? <ErrorBlock error={rules.error} onRetry={() => void rules.refetch()} /> : (
          <DataTable
            caption={t('hub.tariffs.title')}
            rows={[...rules.data].sort((a, b) => a.category.localeCompare(b.category) || b.validFrom.localeCompare(a.validFrom))}
            rowKey={(r) => r.id}
            empty={t('hub.common.empty')}
            columns={[
              { key: 'category', header: t('hub.tariffs.category'), cell: (r) => t(`enum.category.${r.category}`) },
              { key: 'base', header: t('hub.tariffs.base'), className: 'text-right', cell: (r) => formatMoney(r.baseCents, lang) },
              { key: 'km', header: t('hub.tariffs.perKm'), className: 'text-right', cell: (r) => formatMoney(r.perKmCents, lang) },
              { key: 'min', header: t('hub.tariffs.perMinute'), className: 'text-right', cell: (r) => formatMoney(r.perMinuteCents, lang) },
              { key: 'minimum', header: t('hub.tariffs.minimum'), className: 'text-right', cell: (r) => formatMoney(r.minimumCents, lang) },
              { key: 'from', header: t('hub.tariffs.validFrom'), cell: (r) => formatDate(r.validFrom, lang) },
              { key: 'to', header: t('hub.tariffs.validTo'), cell: (r) => formatDate(r.validTo, lang) },
              { key: 'state', header: t('hub.common.status'), cell: stateBadge },
            ]}
          />
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {writable ? (
          <Card title={t('hub.tariffs.add')}>
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (amountsOk) add.mutate(); }}>
              <Field label={t('hub.tariffs.category')}>
                {(p) => <Select {...p} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as VehicleCategory })}>{VEHICLE_CATEGORIES.map((c) => <option key={c} value={c}>{t(`enum.category.${c}`)}</option>)}</Select>}
              </Field>
              <Field label={t('hub.tariffs.validFrom')}>{(p) => <Input {...p} type="date" required min={today} value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} />}</Field>
              {(['base', 'perKm', 'perMinute', 'minimum'] as const).map((k) => (
                <Field key={k} label={`${t(`hub.tariffs.${k}`)} ($)`}>{(p) => <Input {...p} inputMode="decimal" required value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />}</Field>
              ))}
              {add.isError ? <div className="sm:col-span-2"><Notice tone="danger">{errorText(add.error)}</Notice></div> : null}
              {add.isSuccess ? <div className="sm:col-span-2"><Notice tone="success">{t('hub.tariffs.added')}</Notice></div> : null}
              <div className="sm:col-span-2"><Action type="submit" busy={add.isPending} disabled={!amountsOk || add.isPending}>{t('hub.common.save')}</Action></div>
            </form>
          </Card>
        ) : null}

        <Card title={t('hub.tariffs.simulate')}>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); simulate.mutate(); }}>
            <Field label={t('hub.tariffs.distanceKm')}>{(p) => <Input {...p} inputMode="decimal" required value={sim.km} onChange={(e) => setSim({ ...sim, km: e.target.value })} />}</Field>
            <Field label={t('hub.tariffs.durationMin')}>{(p) => <Input {...p} inputMode="numeric" required value={sim.minutes} onChange={(e) => setSim({ ...sim, minutes: e.target.value })} />}</Field>
            <div className="sm:col-span-2"><Action type="submit" tone="secondary" busy={simulate.isPending}>{t('hub.tariffs.simulate')}</Action></div>
          </form>
          {simulate.isError ? <div className="mt-3"><Notice tone="danger">{errorText(simulate.error)}</Notice></div> : null}
          {simulate.data ? <SimulationResult result={simulate.data} /> : null}
        </Card>
      </div>
    </div>
  );
}

function SimulationResult({ result }: { result: SimulateResponse }) {
  const { t } = useTranslation();
  const lang = useLang();
  return (
    <div className="mt-4">
      <h3 className="mb-2 text-sm font-semibold">{t('hub.tariffs.result')} ({result.pricingRulesVersion})</h3>
      <DataTable
        rows={result.quotes}
        rowKey={(q) => q.id}
        empty={t('hub.common.empty')}
        columns={[
          { key: 'category', header: t('hub.tariffs.category'), cell: (q) => t(`enum.category.${q.category}`) },
          { key: 'fare', header: t('hub.rides.price'), className: 'text-right', cell: (q) => formatMoney(q.fareCents, lang) },
          { key: 'total', header: t('book.total'), className: 'text-right font-semibold', cell: (q) => formatMoney(q.totalCents, lang) },
          { key: 'bench', header: '', cell: (q) => (result.benchmark.find((b) => b.category === q.category)?.exceeded ? <Badge tone="warning">benchmark</Badge> : null) },
        ]}
      />
    </div>
  );
}
