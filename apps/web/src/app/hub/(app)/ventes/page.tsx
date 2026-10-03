'use client';

import type { ProspectCreateInput, ProspectDetailView, ProspectStage, ProspectView, SalesAgentCode } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EnumBadge, ErrorBlock, Loading, pageLabels, useCanWrite, useErrorText, useLang, useDebounced } from '@/components/hub/common';
import { CrmStatus } from '@/components/hub/crm-status';
import { Action, Badge, Card, DataTable, Dialog, Field, Input, Notice, PageTitle, Pagination, Select, Textarea, type BadgeTone, type Column } from '@/components/ui/kit';
import { formatDateTime } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

const STAGES: ProspectStage[] = ['new', 'qualified', 'contacted', 'replied', 'meeting', 'quote', 'won', 'lost', 'do_not_contact'];
const SEGMENTS = ['hotel', 'business', 'agency', 'event', 'clinic', 'school', 'other'] as const;
const SOURCES = ['google_places', 'csv_import', 'web_lead', 'manual'] as const;
const STAGE_TONES: Record<string, BadgeTone> = { new: 'info', qualified: 'info', contacted: 'warning', replied: 'success', meeting: 'success', quote: 'success', won: 'success', lost: 'neutral', do_not_contact: 'danger' };
const PAGE_SIZE = 25;

/** Lecture d'un fichier CSV collé : en-tête obligatoire, virgule ou point-virgule, guillemets simples admis. */
function parseCsv(text: string): ProspectCreateInput[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const separator = (lines[0]!.match(/;/g)?.length ?? 0) > (lines[0]!.match(/,/g)?.length ?? 0) ? ';' : ',';
  const split = (line: string) => {
    const out: string[] = [];
    let current = '';
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === separator && !quoted) { out.push(current.trim()); current = ''; }
      else current += ch;
    }
    out.push(current.trim());
    return out;
  };
  const header = split(lines[0]!).map((h) => h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
  const index = (names: string[]) => header.findIndex((h) => names.includes(h));
  const cols = { organizationName: index(['organisation', 'organization', 'entreprise']), segment: index(['segment']), contactName: index(['contact', 'nom']), contactRole: index(['role', 'fonction']), email: index(['courriel', 'email']), phone: index(['telephone', 'phone', 'tel']), whatsappOk: index(['whatsapp']), website: index(['site', 'website']), city: index(['ville', 'city']), language: index(['langue', 'language']), consentBasis: index(['base', 'consent']) };
  return lines.slice(1).map((line) => {
    const cells = split(line);
    const at = (i: number) => (i >= 0 ? cells[i] ?? '' : '');
    const row: ProspectCreateInput = { organizationName: at(cols.organizationName) };
    const segment = at(cols.segment).toLowerCase();
    if ((SEGMENTS as readonly string[]).includes(segment)) row.segment = segment as (typeof SEGMENTS)[number];
    if (at(cols.contactName)) row.contactName = at(cols.contactName);
    if (at(cols.contactRole)) row.contactRole = at(cols.contactRole);
    if (at(cols.email)) row.email = at(cols.email);
    if (at(cols.phone)) row.phone = at(cols.phone).replace(/[\s().-]/g, '');
    if (/^(oui|yes|1|true|x)$/i.test(at(cols.whatsappOk))) row.whatsappOk = true;
    if (at(cols.website)) row.website = at(cols.website);
    if (at(cols.city)) row.city = at(cols.city);
    if (/^en/i.test(at(cols.language))) row.language = 'en';
    const basis = at(cols.consentBasis).toLowerCase();
    if (['published_address', 'form', 'existing_relationship', 'referral', 'none'].includes(basis)) row.consentBasis = basis as ProspectCreateInput['consentBasis'];
    return row;
  });
}

/** Ventes (phase 1 « entreprise autonome ») : prospects B2B, fiche, actions, import CSV, passes à la demande. */
export default function SalesPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const writable = useCanWrite();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({ page: 1, q: '', stage: '', source: '', segment: '', minScore: '' });
  const q = useDebounced(filters.q.trim());
  const [selected, setSelected] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['hub', 'sales', filters.page, q, filters.stage, filters.source, filters.segment, filters.minScore],
    queryFn: () => hubApi.admin.salesProspects({
      page: filters.page, pageSize: PAGE_SIZE, ...(q ? { q } : {}), ...(filters.stage ? { stage: filters.stage as ProspectStage } : {}), ...(filters.source ? { source: filters.source as (typeof SOURCES)[number] } : {}),
      ...(filters.segment ? { segment: filters.segment as (typeof SEGMENTS)[number] } : {}), ...(filters.minScore ? { minScore: Number(filters.minScore) } : {}),
    }),
  });
  const run = useMutation({
    mutationFn: (code: SalesAgentCode) => hubApi.admin.runSalesAgent(code),
    onSuccess: (r) => {
      setRunMessage(t('hub.sales.runDone', { summary: JSON.stringify(r.summary) }));
      void queryClient.invalidateQueries({ queryKey: ['hub', 'sales'] });
    },
  });
  const set = (patch: Partial<typeof filters>) => setFilters((f) => ({ ...f, ...patch, page: 1 }));
  const columns: Column<ProspectView>[] = [
    { key: 'org', header: t('hub.sales.organization'), cell: (p) => <button type="button" className="text-left font-semibold text-brand-blue-dark underline-offset-2 hover:underline" onClick={() => setSelected(p.id)}>{p.organizationName}<span className="block text-xs font-normal text-slate-600">{p.city ?? ''}</span></button> },
    { key: 'segment', header: t('hub.sales.segment'), cell: (p) => t(`enum.prospectSegment.${p.segment}`) },
    { key: 'stage', header: t('hub.sales.stage'), cell: (p) => <Badge tone={STAGE_TONES[p.stage] ?? 'neutral'}>{t(`enum.prospectStage.${p.stage}`)}</Badge> },
    { key: 'score', header: t('hub.sales.score'), className: 'text-right', cell: (p) => p.score },
    { key: 'contact', header: t('hub.sales.contact'), cell: (p) => <span>{p.contactName ?? ''}<span className="block text-xs text-slate-600">{p.email ?? p.phone ?? ''}</span></span> },
    { key: 'source', header: t('hub.sales.source'), cell: (p) => t(`enum.prospectSource.${p.source}`) },
    { key: 'next', header: t('hub.sales.nextAction'), cell: (p) => <span className="text-xs">{p.nextAction ?? ''}{p.nextActionAt ? ` · ${formatDateTime(p.nextActionAt, lang)}` : ''}</span> },
    { key: 'updated', header: t('hub.sales.updated'), cell: (p) => formatDateTime(p.updatedAt, lang) },
  ];
  return (
    <div className="flex flex-col gap-5">
      <PageTitle
        title={t('hub.sales.title')}
        subtitle={t('hub.sales.subtitle')}
        actions={writable ? (
          <div className="flex flex-wrap gap-2">
            <Action tone="secondary" onClick={() => setImportOpen(true)}>{t('hub.sales.import')}</Action>
            <Action tone="secondary" busy={run.isPending && run.variables === 'b2b_prospecting'} onClick={() => run.mutate('b2b_prospecting')}>{t('hub.sales.runProspecting')}</Action>
            <Action tone="secondary" busy={run.isPending && run.variables === 'followups'} onClick={() => run.mutate('followups')}>{t('hub.sales.runFollowups')}</Action>
            <Action tone="secondary" busy={run.isPending && run.variables === 'outbound_calls'} onClick={() => run.mutate('outbound_calls')}>{t('hub.sales.runCalls')}</Action>
          </div>
        ) : undefined}
      />
      {run.isError ? <Notice tone="danger">{errorText(run.error)}</Notice> : null}
      {runMessage ? <Notice tone="success">{runMessage}</Notice> : null}
      <Card>
        <div className="mb-3 grid gap-3 md:grid-cols-5">
          <Field label={t('hub.common.search')}>{(p) => <Input {...p} type="search" value={filters.q} onChange={(e) => set({ q: e.target.value })} />}</Field>
          <Field label={t('hub.sales.stage')}>{(p) => <Select {...p} value={filters.stage} onChange={(e) => set({ stage: e.target.value })}><option value="">{t('hub.common.all')}</option>{STAGES.map((s) => <option key={s} value={s}>{t(`enum.prospectStage.${s}`)}</option>)}</Select>}</Field>
          <Field label={t('hub.sales.source')}>{(p) => <Select {...p} value={filters.source} onChange={(e) => set({ source: e.target.value })}><option value="">{t('hub.common.all')}</option>{SOURCES.map((s) => <option key={s} value={s}>{t(`enum.prospectSource.${s}`)}</option>)}</Select>}</Field>
          <Field label={t('hub.sales.segment')}>{(p) => <Select {...p} value={filters.segment} onChange={(e) => set({ segment: e.target.value })}><option value="">{t('hub.common.all')}</option>{SEGMENTS.map((s) => <option key={s} value={s}>{t(`enum.prospectSegment.${s}`)}</option>)}</Select>}</Field>
          <Field label={t('hub.sales.minScore')}>{(p) => <Input {...p} type="number" min={0} max={100} value={filters.minScore} onChange={(e) => set({ minScore: e.target.value })} />}</Field>
        </div>
        {list.isPending ? <Loading /> : list.isError ? <ErrorBlock error={list.error} onRetry={() => void list.refetch()} /> : (
          <>
            <DataTable caption={t('hub.sales.title')} columns={columns} rows={list.data.items} rowKey={(p) => p.id} empty={t('hub.common.empty')} />
            <Pagination page={filters.page} pageSize={PAGE_SIZE} total={list.data.total} onPage={(page) => setFilters((f) => ({ ...f, page }))} labels={pageLabels(t, filters.page, PAGE_SIZE, list.data.total)} />
          </>
        )}
      </Card>
      {importOpen ? <ImportDialog onClose={() => setImportOpen(false)} onDone={() => void queryClient.invalidateQueries({ queryKey: ['hub', 'sales'] })} /> : null}
      {selected ? <ProspectDialog id={selected} writable={writable} onClose={() => setSelected(null)} onChanged={() => void queryClient.invalidateQueries({ queryKey: ['hub', 'sales'] })} /> : null}
    </div>
  );
}

function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [text, setText] = useState('');
  const rows = parseCsv(text);
  const importRows = useMutation({ mutationFn: () => hubApi.admin.importSalesProspects({ rows }), onSuccess: onDone });
  return (
    <Dialog open title={t('hub.sales.import')} onClose={onClose} wide>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-700">{t('hub.sales.importHint')}</p>
        <Field label={t('hub.sales.importPaste')}>{(p) => <Textarea {...p} rows={10} value={text} onChange={(e) => setText(e.target.value)} />}</Field>
        {importRows.isError ? <Notice tone="danger">{errorText(importRows.error)}</Notice> : null}
        {importRows.isSuccess ? (
          <div className="flex flex-col gap-1">
            <Notice tone="success">{t('hub.sales.importResult', { imported: importRows.data.imported, updated: importRows.data.updated, skipped: importRows.data.skipped.length })}</Notice>
            {importRows.data.skipped.map((s) => <span key={s.row} className="text-xs text-red-800">{t('hub.sales.importSkipped', { row: s.row, reason: s.reason })}</span>)}
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <Action tone="secondary" onClick={onClose}>{t('hub.common.close')}</Action>
          <Action busy={importRows.isPending} disabled={!rows.length} onClick={() => importRows.mutate()}>{t('hub.sales.importRun')} ({rows.length})</Action>
        </div>
      </div>
    </Dialog>
  );
}

type Panel = 'quote' | 'account' | 'dnc' | null;

function ProspectDialog({ id, writable, onClose, onChanged }: { id: string; writable: boolean; onClose: () => void; onChanged: () => void }) {
  const { t } = useTranslation();
  const lang = useLang();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [panel, setPanel] = useState<Panel>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({ rides: '20', discount: '', terms: '', notes: '', ownerEmail: '', organizationName: '', reason: '' });
  const detail = useQuery({ queryKey: ['hub', 'sales', 'prospect', id], queryFn: () => hubApi.admin.salesProspect(id) });
  const refresh = (text: string) => {
    setMessage(text);
    setPanel(null);
    void queryClient.invalidateQueries({ queryKey: ['hub', 'sales', 'prospect', id] });
    onChanged();
  };
  const call = useMutation({ mutationFn: () => hubApi.admin.salesCallNow(id), onSuccess: (r) => refresh(r.message || t('hub.sales.callStarted')) });
  const followup = useMutation({ mutationFn: () => hubApi.admin.salesFollowupNow(id), onSuccess: () => refresh(t('hub.sales.followupSent')) });
  const quote = useMutation({
    mutationFn: () => hubApi.admin.salesQuote(id, { expectedMonthlyRides: Number(form.rides), requestedDiscountBps: form.discount.trim() ? Math.round(Number(form.discount.replace(',', '.')) * 100) : null, paymentTermsDays: form.terms.trim() ? Number(form.terms) : null, ...(form.notes.trim() ? { notes: form.notes.trim() } : {}) }),
    onSuccess: (r) => refresh(r.message || t('hub.sales.quoteSent')),
  });
  const account = useMutation({
    mutationFn: () => hubApi.admin.salesOpenAccount(id, { ...(form.ownerEmail.trim() ? { ownerEmail: form.ownerEmail.trim() } : {}), ...(form.organizationName.trim() ? { organizationName: form.organizationName.trim() } : {}) }),
    onSuccess: () => refresh(t('hub.sales.accountOpened')),
  });
  const dnc = useMutation({ mutationFn: () => hubApi.admin.salesDoNotContact(id, { reason: form.reason.trim() }), onSuccess: () => refresh(t('hub.sales.dncDone')) });
  const stage = useMutation({ mutationFn: (value: ProspectStage) => hubApi.admin.updateSalesProspect(id, { stage: value as Exclude<ProspectStage, 'do_not_contact'> }), onSuccess: () => refresh(t('hub.sales.actionDone')) });
  const pending = call.isPending || followup.isPending || quote.isPending || account.isPending || dnc.isPending || stage.isPending;
  const error = [call, followup, quote, account, dnc, stage].find((m) => m.isError)?.error;
  const d: ProspectDetailView | undefined = detail.data;
  const p = d?.prospect;
  const closed = p ? ['won', 'do_not_contact'].includes(p.stage) : true;
  return (
    <Dialog open title={p ? p.organizationName : t('hub.sales.detail')} onClose={onClose} wide>
      {detail.isPending ? <Loading /> : detail.isError || !d || !p ? <ErrorBlock error={detail.error} /> : (
        <div className="flex flex-col gap-4 text-sm">
          {message ? <Notice tone="success">{message}</Notice> : null}
          {error ? <Notice tone="danger">{errorText(error)}</Notice> : null}
          <div className="grid gap-2 sm:grid-cols-2">
            <p><strong>{t('hub.sales.stage')}</strong> : <Badge tone={STAGE_TONES[p.stage] ?? 'neutral'}>{t(`enum.prospectStage.${p.stage}`)}</Badge>{p.stageReason ? <span className="block text-xs text-slate-600">{p.stageReason}</span> : null}</p>
            <p><strong>{t('hub.sales.segment')}</strong> : {t(`enum.prospectSegment.${p.segment}`)} · {t('hub.sales.score')} {p.score}</p>
            <p><strong>{t('hub.sales.contact')}</strong> : {p.contactName ?? ''}{p.contactRole ? ` (${p.contactRole})` : ''}<span className="block text-xs text-slate-600">{p.email ?? ''} {p.phone ?? ''}{p.whatsappOk ? ` · ${t('hub.sales.whatsapp')}` : ''}</span></p>
            <p><strong>{t('hub.sales.source')}</strong> : {t(`enum.prospectSource.${p.source}`)} · {t('hub.sales.consent')} : {t(`enum.consentBasis.${p.consentBasis}`)}{p.consentAt ? ` (${formatDateTime(p.consentAt, lang)})` : ''}</p>
            <p><strong>{t('hub.sales.city')}</strong> : {p.city ?? ''} · {t('hub.sales.language')} : {p.language}{p.website ? <span className="block text-xs text-slate-600">{p.website}</span> : null}</p>
            <p><strong>{t('hub.sales.sequence')}</strong> : {p.sequenceKey ?? t('hub.common.none')}{p.firstContactAt ? ` · ${t('hub.sales.firstContact')} ${formatDateTime(p.firstContactAt, lang)}` : ''}{p.hubspotId ? ` · ${t('hub.sales.hubspot')} ${p.hubspotId}` : ''}</p>
            {p.unsubscribedAt ? <p className="text-red-800"><strong>{t('hub.sales.unsubscribed')}</strong> {formatDateTime(p.unsubscribedAt, lang)}</p> : null}
            {p.lastQuote ? <p><strong>{t('hub.sales.quote')}</strong> : {t('hub.sales.discount')} {p.lastQuote.discountBps / 100} %, {p.lastQuote.expectedMonthlyRides} / mois, {p.lastQuote.paymentTermsDays} j · {t('hub.sales.validUntil')} {formatDateTime(p.lastQuote.validUntil, lang)} · {p.lastQuote.inGrid ? t('hub.sales.inGrid') : t('hub.sales.outOfGrid')}</p> : null}
          </div>
          {/* Étape 25 : état CRM de la fiche (HubSpot, simulé en développement). */}
          <Card title={t('hub.crm.title')}><CrmStatus kind="prospects" entityId={p.id} /></Card>
          {writable && !closed ? (
            <div className="flex flex-wrap items-end gap-2">
              <Action busy={call.isPending} disabled={pending || !p.phone} onClick={() => call.mutate()}>{t('hub.sales.callNow')}</Action>
              <Action tone="secondary" busy={followup.isPending} disabled={pending} onClick={() => followup.mutate()}>{t('hub.sales.followupNow')}</Action>
              <Action tone="secondary" disabled={pending} onClick={() => setPanel(panel === 'quote' ? null : 'quote')}>{t('hub.sales.sendQuote')}</Action>
              <Action tone="secondary" disabled={pending} onClick={() => setPanel(panel === 'account' ? null : 'account')}>{t('hub.sales.openAccount')}</Action>
              <Action tone="danger" disabled={pending} onClick={() => setPanel(panel === 'dnc' ? null : 'dnc')}>{t('hub.sales.doNotContact')}</Action>
              <Field label={t('hub.sales.changeStage')}>{(fp) => <Select {...fp} value={p.stage} disabled={pending} onChange={(e) => stage.mutate(e.target.value as ProspectStage)}>{STAGES.filter((s) => s !== 'do_not_contact').map((s) => <option key={s} value={s}>{t(`enum.prospectStage.${s}`)}</option>)}</Select>}</Field>
            </div>
          ) : null}
          {panel === 'quote' ? (
            <Card title={t('hub.sales.quoteTitle')}>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={t('hub.sales.expectedMonthlyRides')}>{(fp) => <Input {...fp} type="number" min={0} value={form.rides} onChange={(e) => setForm({ ...form, rides: e.target.value })} />}</Field>
                <Field label={t('hub.sales.requestedDiscount')}>{(fp) => <Input {...fp} inputMode="decimal" value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} />}</Field>
                <Field label={t('hub.sales.paymentTerms')}>{(fp) => <Input {...fp} type="number" min={0} value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} />}</Field>
              </div>
              <Field label={t('hub.sales.notes')}>{(fp) => <Textarea {...fp} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />}</Field>
              <div className="mt-2 flex justify-end"><Action busy={quote.isPending} disabled={!(Number(form.rides) >= 0)} onClick={() => quote.mutate()}>{t('hub.sales.sendQuote')}</Action></div>
            </Card>
          ) : null}
          {panel === 'account' ? (
            <Card title={t('hub.sales.accountTitle')}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('hub.sales.ownerEmail')}>{(fp) => <Input {...fp} type="email" value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} />}</Field>
                <Field label={t('hub.sales.organizationName')}>{(fp) => <Input {...fp} value={form.organizationName} onChange={(e) => setForm({ ...form, organizationName: e.target.value })} />}</Field>
              </div>
              <div className="mt-2 flex justify-end"><Action busy={account.isPending} onClick={() => account.mutate()}>{t('hub.sales.openAccount')}</Action></div>
            </Card>
          ) : null}
          {panel === 'dnc' ? (
            <Card title={t('hub.sales.dncTitle')}>
              <Field label={t('hub.sales.dncReason')}>{(fp) => <Input {...fp} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />}</Field>
              <div className="mt-2 flex justify-end"><Action tone="danger" busy={dnc.isPending} disabled={form.reason.trim().length < 3} onClick={() => dnc.mutate()}>{t('hub.sales.doNotContact')}</Action></div>
            </Card>
          ) : null}
          <Card title={t('hub.sales.timeline')}>
            {d.touches.length === 0 ? <p className="text-slate-600">{t('hub.sales.noTimeline')}</p> : (
              <ol className="flex flex-col gap-1">
                {d.touches.map((x) => <li key={x.id}><span className="text-xs text-slate-600">{formatDateTime(x.occurredAt, lang)}</span> · <EnumBadge group="touchChannel" value={x.channel} /> {x.direction === 'inbound' ? '←' : '→'} {x.summary}{x.result ? <span className="text-xs text-slate-600"> ({x.result})</span> : null}</li>)}
              </ol>
            )}
          </Card>
          {d.calls.length ? (
            <Card title={t('hub.sales.calls')}>
              <DataTable
                rows={d.calls}
                rowKey={(c) => c.id}
                empty={t('hub.common.empty')}
                columns={[
                  { key: 'at', header: t('hub.sales.scheduledAt'), cell: (c) => formatDateTime(c.scheduledAt, lang) },
                  { key: 'status', header: t('hub.common.status'), cell: (c) => t(`enum.callStatus.${c.status}`) },
                  { key: 'result', header: t('hub.sales.result'), cell: (c) => (c.result ? t(`enum.callResult.${c.result}`) : '') },
                  { key: 'summary', header: t('hub.leads.message'), cell: (c) => <span className="block max-w-72 text-xs">{c.summary ?? ''}</span> },
                  { key: 'duration', header: t('hub.sales.duration'), className: 'text-right', cell: (c) => (c.durationSeconds === null ? '' : `${c.durationSeconds} s`) },
                ]}
              />
            </Card>
          ) : null}
          {d.followups.length ? (
            <Card title={t('hub.sales.followups')}>
              <DataTable
                rows={d.followups}
                rowKey={(f) => f.id}
                empty={t('hub.common.empty')}
                columns={[
                  { key: 'target', header: t('hub.sales.target'), cell: (f) => t(`enum.followupTarget.${f.targetType}`) },
                  { key: 'due', header: t('hub.sales.dueAt'), cell: (f) => formatDateTime(f.dueAt, lang) },
                  { key: 'attempt', header: t('hub.sales.attempt'), className: 'text-right', cell: (f) => `${f.attempt} / ${f.maxAttempts}` },
                  { key: 'status', header: t('hub.common.status'), cell: (f) => <span>{t(`enum.followupStatus.${f.status}`)}{f.closeReason ? <span className="block text-xs text-slate-600">{f.closeReason}</span> : null}</span> },
                ]}
              />
            </Card>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
