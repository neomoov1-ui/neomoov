'use client';

import type { AuditFilters, OrgAuditEntryView } from '@neomoov/api-client';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading, useDebounced, useLang } from '@/components/hub/common';
import { OrgPage } from '@/components/hub/org-context';
import { Action, Card, DataTable, Field, Input, PageTitle } from '@/components/ui/kit';
import { formatDateTime } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

/** Étape 21 : journal de l'organisation et de ses sous-organisations (accès du support compris), du plus récent au plus ancien. */
export default function OrgAuditPage() {
  return <OrgPage permissions={['audit.read']}>{(orgId) => <Journal orgId={orgId} />}</OrgPage>;
}

function Journal({ orgId }: { orgId: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const e = useDebounced(entity.trim());
  const a = useDebounced(action.trim());
  const filters: AuditFilters = { ...(e ? { entity: e } : {}), ...(a ? { action: a } : {}) };
  const log = useInfiniteQuery({
    queryKey: ['org', orgId, 'audit', filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => hubApi.org.audit(orgId, { limit: 50, ...(pageParam ? { cursor: pageParam } : {}), ...filters }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = log.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div>
      <PageTitle title={t('org.audit.title')} subtitle={t('org.audit.intro')} />
      <Card>
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <Field label={t('hub.audit.entity')}>{(p) => <Input {...p} value={entity} onChange={(ev) => setEntity(ev.target.value)} />}</Field>
          <Field label={t('hub.audit.action')}>{(p) => <Input {...p} value={action} onChange={(ev) => setAction(ev.target.value)} />}</Field>
        </div>
        {log.isPending ? <Loading /> : log.isError ? <ErrorBlock error={log.error} onRetry={() => void log.refetch()} /> : (
          <>
            <DataTable<OrgAuditEntryView>
              caption={t('org.audit.title')}
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
