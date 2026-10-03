'use client';

import type { AdminLead, LeadStatus } from '@neomoov/domain';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CrmStatus } from '@/components/hub/crm-status';
import { ErrorBlock, ListToolbar, Loading, pageLabels, useCanWrite, useErrorText, useLang, usePagedList } from '@/components/hub/common';
import { Badge, Card, DataTable, Notice, PageTitle, Pagination, Select, type Column } from '@/components/ui/kit';
import { formatDateTime, fullName } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

const STATUSES: LeadStatus[] = ['new', 'contacted', 'converted', 'discarded'];

/** Code d'attestation Neomoov Chauffeur Pro consigné dans le message de la préinscription (NCP-XXXX-XXXX, ou CAP- pour les premières). */
const ACADEMY_CODE = /\b(NCP|CAP)-[A-Z0-9]{4}-[A-Z0-9]{4}\b/i;
const ACADEMY_VERIFY_URL = 'https://neomoov.net/wp-json/neomoov-academy/v1/attestation/';
function academyCodeOf(message: string | null | undefined): string | null {
  const m = message?.match(ACADEMY_CODE);
  return m ? m[0].toUpperCase() : null;
}
interface AcademyCheckResult { valid: boolean; name?: string; completed_on?: string; exam?: { passed: boolean; score?: string } }

/** Vérification de l'attestation auprès de l'API publique de l'Academy (lecture seule, à la demande). */
function AcademyCheck({ code }: { code: string | null }) {
  const { t } = useTranslation();
  const [state, setState] = useState<AcademyCheckResult | 'loading' | 'error' | null>(null);
  if (!code) return null;
  async function check() {
    setState('loading');
    try {
      const res = await fetch(ACADEMY_VERIFY_URL + encodeURIComponent(code!), { cache: 'no-store' });
      const json = (await res.json()) as AcademyCheckResult;
      setState({ valid: Boolean(json.valid), ...(json.name ? { name: json.name } : {}), ...(json.completed_on ? { completed_on: json.completed_on } : {}), ...(json.exam ? { exam: json.exam } : {}) });
    } catch {
      setState('error');
    }
  }
  return (
    <span className="block text-xs">
      <span className="font-mono">{code}</span>
      {state === null ? <button type="button" className="ml-2 underline underline-offset-2" onClick={() => void check()}>{t('hub.leads.verify')}</button>
        : state === 'loading' ? <span className="ml-2">…</span>
        : state === 'error' ? <span className="ml-2 text-red-700">{t('hub.leads.checkError')}</span>
        : state.valid ? <span className="ml-2 text-green-800">{t('hub.leads.valid')} · {state.name ?? ''} · {state.completed_on ?? ''}{state.exam?.passed ? ` · ${t('hub.leads.exam')} ${state.exam.score ?? ''}` : ''}</span>
        : <span className="ml-2 text-red-700">{t('hub.leads.invalid')}</span>}
    </span>
  );
}

/** Prospects reçus par l'API publique (préinscriptions de chauffeurs, entreprises, partenaires) et leur suivi. */
export default function LeadsPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const writable = useCanWrite();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const list = usePagedList<AdminLead>('leads', (q) => hubApi.admin.leads(q));
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: LeadStatus }) => hubApi.admin.setLeadStatus(id, status),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['hub', 'leads'] }),
  });
  const columns: Column<AdminLead>[] = [
    { key: 'received', header: t('hub.leads.received'), cell: (l) => formatDateTime(l.createdAt, lang) },
    { key: 'kind', header: t('hub.leads.kind'), cell: (l) => <Badge tone="info">{t(`enum.leadKind.${l.kind}`)}</Badge> },
    { key: 'name', header: t('hub.clients.name'), cell: (l) => fullName(l.firstName, l.lastName) },
    { key: 'contact', header: t('hub.leads.contact'), cell: (l) => <span>{l.phone ?? ''}<span className="block text-xs text-slate-600">{l.email ?? ''}</span></span> },
    { key: 'city', header: t('hub.leads.city'), cell: (l) => l.city ?? '' },
    { key: 'message', header: t('hub.leads.message'), cell: (l) => <span className="block max-w-72 whitespace-pre-wrap text-xs">{l.message ?? ''}</span> },
    { key: 'attestation', header: t('hub.leads.attestation'), cell: (l) => <AcademyCheck code={academyCodeOf(l.message)} /> },
    { key: 'source', header: t('hub.leads.source'), cell: (l) => l.source },
    // Étape 25 : état CRM chargé à la demande (une requête par fiche ouverte, pas par ligne).
    { key: 'crm', header: t('hub.crm.title'), cell: (l) => <CrmStatus kind="leads" entityId={l.id} lazy /> },
    {
      key: 'status',
      header: t('hub.common.status'),
      cell: (l) => writable ? (
        <Select aria-label={t('hub.common.status')} value={l.status} onChange={(e) => update.mutate({ id: l.id, status: e.target.value as LeadStatus })} className="min-w-32">
          {STATUSES.map((s) => <option key={s} value={s}>{t(`enum.leadStatus.${s}`)}</option>)}
        </Select>
      ) : t(`enum.leadStatus.${l.status}`),
    },
  ];
  return (
    <div>
      <PageTitle title={t('hub.leads.title')} />
      {update.isError ? <div className="mb-3"><Notice tone="danger">{errorText(update.error)}</Notice></div> : null}
      <Card>
        <ListToolbar filters={list.filters} setQ={list.setQ} setStatus={list.setStatus} statuses={STATUSES.map((s) => ({ value: s, label: t(`enum.leadStatus.${s}`) }))} />
        {list.query.isPending ? <Loading /> : list.query.isError ? <ErrorBlock error={list.query.error} onRetry={() => void list.query.refetch()} /> : (
          <>
            <DataTable caption={t('hub.leads.title')} columns={columns} rows={list.query.data.items} rowKey={(l) => l.id} empty={t('hub.common.empty')} />
            <Pagination page={list.filters.page} pageSize={list.pageSize} total={list.query.data.total} onPage={list.setPage} labels={pageLabels(t, list.filters.page, list.pageSize, list.query.data.total)} />
          </>
        )}
      </Card>
    </div>
  );
}
