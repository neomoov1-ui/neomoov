'use client';

import type { AuditEntryView, AuditFilters } from '@neomoov/api-client';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading, useDebounced, useHubUser, useLang } from '@/components/hub/common';
import { Action, Card, DataTable, Field, Input, PageTitle, focus } from '@/components/ui/kit';
import { formatDateTime, montrealToIso } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

/** Lendemain d'une date `AAAA-MM-JJ` (borne exclusive de la période : le jour choisi est inclus). */
function nextDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Journal d'audit : chaque action administrative avec son acteur, du plus récent au plus ancien (pagination par curseur),
 * filtré par objet, action et période (jours de Montréal) ; export CSV des mêmes filtres pour l'administration.
 */
export default function AuditPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const admin = useHubUser().roles.includes('admin');
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const e = useDebounced(entity.trim());
  const a = useDebounced(action.trim());
  const filters: AuditFilters = {
    ...(e ? { entity: e } : {}),
    ...(a ? { action: a } : {}),
    ...(from ? { from: montrealToIso(from, '00:00') } : {}),
    ...(to ? { to: montrealToIso(nextDay(to), '00:00') } : {}),
  };
  const log = useInfiniteQuery({
    queryKey: ['hub', 'audit', filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => hubApi.admin.audit({ limit: 50, ...(pageParam ? { cursor: pageParam } : {}), ...filters }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = log.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div>
      <PageTitle
        title={t('hub.audit.title')}
        actions={admin ? <a href={`/api/v1${hubApi.admin.auditExportPath(filters)}`} download title={t('hub.audit.exportHint')} className={`rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-brand-ink hover:bg-brand-tint ${focus}`}>{t('hub.audit.export')}</a> : null}
      />
      <Card>
        <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('hub.audit.entity')}>{(p) => <Input {...p} value={entity} onChange={(ev) => setEntity(ev.target.value)} />}</Field>
          <Field label={t('hub.audit.action')}>{(p) => <Input {...p} value={action} onChange={(ev) => setAction(ev.target.value)} />}</Field>
          <Field label={t('hub.audit.from')}>{(p) => <Input {...p} type="date" max={to || undefined} value={from} onChange={(ev) => setFrom(ev.target.value)} />}</Field>
          <Field label={t('hub.audit.to')}>{(p) => <Input {...p} type="date" min={from || undefined} value={to} onChange={(ev) => setTo(ev.target.value)} />}</Field>
        </div>
        {admin ? <p className="mb-3 text-xs text-slate-600">{t('hub.audit.exportHint')}</p> : null}
        {log.isPending ? <Loading /> : log.isError ? <ErrorBlock error={log.error} onRetry={() => void log.refetch()} /> : (
          <>
            <DataTable<AuditEntryView>
              caption={t('hub.audit.title')}
              rows={rows}
              rowKey={(r) => r.id}
              empty={t('hub.common.empty')}
              columns={[
                { key: 'when', header: t('hub.audit.when'), cell: (r) => formatDateTime(r.occurredAt, lang) },
                { key: 'action', header: t('hub.audit.action'), cell: (r) => <code className="text-xs">{r.action}</code> },
                { key: 'entity', header: t('hub.audit.entity'), cell: (r) => <span className="text-xs">{r.entity}{r.entityId ? ` · ${r.entityId.slice(0, 8)}` : ''}</span> },
                { key: 'actor', header: t('hub.audit.actor'), cell: (r) => <span className="text-xs">{r.actorUserId?.slice(0, 8) ?? r.actorAgentCode ?? t('hub.audit.system')}</span> },
                { key: 'after', header: '', cell: (r) => (r.after ? <code className="block max-w-96 truncate text-[11px]">{JSON.stringify(r.after)}</code> : null) },
              ]}
            />
            {log.hasNextPage ? <div className="mt-3"><Action tone="secondary" busy={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>{t('hub.common.next')}</Action></div> : null}
          </>
        )}
      </Card>
    </div>
  );
}
