'use client';

import type { AuditEntryView } from '@neomoov/api-client';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading, useDebounced, useLang } from '@/components/hub/common';
import { Action, Card, DataTable, Field, Input, PageTitle } from '@/components/ui/kit';
import { formatDateTime } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

/** Journal d'audit : chaque action administrative avec son acteur, du plus récent au plus ancien (pagination par curseur). */
export default function AuditPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const e = useDebounced(entity.trim());
  const a = useDebounced(action.trim());
  const log = useInfiniteQuery({
    queryKey: ['hub', 'audit', e, a],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => hubApi.admin.audit({ limit: 50, ...(pageParam ? { cursor: pageParam } : {}), ...(e ? { entity: e } : {}), ...(a ? { action: a } : {}) }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = log.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div>
      <PageTitle title={t('hub.audit.title')} />
      <Card>
        <div className="mb-3 grid gap-3 sm:grid-cols-2 md:max-w-xl">
          <Field label={t('hub.audit.entity')}>{(p) => <Input {...p} value={entity} onChange={(ev) => setEntity(ev.target.value)} />}</Field>
          <Field label={t('hub.audit.action')}>{(p) => <Input {...p} value={action} onChange={(ev) => setAction(ev.target.value)} />}</Field>
        </div>
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
