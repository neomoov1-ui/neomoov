'use client';

import type { SupportAccessGrantView } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading, useErrorText, useHubUser, useLang } from '@/components/hub/common';
import { Action, Badge, Card, DataTable, Field, Input, Notice, PageTitle, Select, Textarea, type Column } from '@/components/ui/kit';
import { formatDateTime } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

/**
 * Étape 21 (plateforme, permission `support.access`) : demande d'un accès temporaire à une organisation cliente, suivi
 * des accès (demandés, en cours, passés), ouverture de l'espace de l'organisation pendant un accès en cours (bandeau
 * « Accès support en cours »), fin anticipée.
 */
export default function PlatformSupportPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const errorText = useErrorText();
  const me = useHubUser();
  const queryClient = useQueryClient();
  const orgs = useQuery({ queryKey: ['hub', 'orgs'], queryFn: () => hubApi.admin.organizations() });
  const grants = useQuery({ queryKey: ['hub', 'support-access'], queryFn: () => hubApi.supportAccess.list() });
  const [organizationId, setOrganizationId] = useState('');
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState(60);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['hub', 'support-access'] });
  const request = useMutation({ mutationFn: () => hubApi.supportAccess.request(organizationId, { reason: reason.trim(), durationMinutes: duration }), onSuccess: () => { setReason(''); refresh(); } });
  const end = useMutation({ mutationFn: (id: string) => hubApi.supportAccess.end(id), onSuccess: refresh });
  const columns: Column<SupportAccessGrantView>[] = [
    { key: 'created', header: t('hub.audit.when'), cell: (g) => formatDateTime(g.createdAt, lang) },
    { key: 'org', header: t('org.platform.organization'), cell: (g) => g.organizationName },
    { key: 'by', header: t('org.support.requestedBy'), cell: (g) => g.requestedByName ?? g.requestedByUserId.slice(0, 8) },
    { key: 'reason', header: t('org.support.reason'), cell: (g) => <span className="block max-w-80">{g.reason}</span> },
    { key: 'status', header: t('org.support.status'), cell: (g) => <Badge tone={g.active ? 'info' : g.status === 'requested' ? 'warning' : 'neutral'}>{g.active ? t('org.support.active') : t(`org.support.statuses.${g.status}`)}</Badge> },
    { key: 'period', header: t('org.support.period'), cell: (g) => (g.startsAt ? `${formatDateTime(g.startsAt, lang)} → ${formatDateTime(g.endsAt, lang)}` : t('org.support.minutes', { count: g.durationMinutes })) },
    {
      key: 'actions', header: t('hub.common.actions'), cell: (g) => (g.requestedByUserId !== me.id ? null : (
        <div className="flex flex-wrap gap-2">
          {g.active ? <Action onClick={() => window.location.assign(`/hub/organisation?org=${g.organizationId}`)}>{t('org.platform.open')}</Action> : null}
          {g.active || g.status === 'requested' ? <Action tone="secondary" onClick={() => end.mutate(g.id)}>{t('org.platform.end')}</Action> : null}
        </div>
      )),
    },
  ];
  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={t('org.platform.title')} subtitle={t('org.platform.intro')} />
      <Card title={t('org.platform.request')}>
        <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]" onSubmit={(e) => { e.preventDefault(); request.mutate(); }}>
          <Field label={t('org.platform.organization')}>
            {(p) => (
              <Select {...p} required value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}>
                <option value="">{t('org.platform.organization')}</option>
                {(orgs.data ?? []).filter((o) => o.parentId !== null).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label={t('org.platform.duration')}>{(p) => <Input {...p} type="number" min={15} max={1440} step={15} required value={duration} onChange={(e) => setDuration(Number(e.target.value))} />}</Field>
          <div className="sm:col-span-2">
            <Field label={t('org.platform.reason')}>{(p) => <Textarea {...p} required minLength={10} maxLength={500} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          </div>
          {request.isSuccess ? <div className="sm:col-span-2"><Notice tone="success">{t('org.platform.requested')}</Notice></div> : null}
          {request.isError ? <div className="sm:col-span-2"><Notice tone="danger">{errorText(request.error)}</Notice></div> : null}
          <div><Action type="submit" busy={request.isPending} disabled={!organizationId || reason.trim().length < 10}>{t('org.platform.request')}</Action></div>
        </form>
      </Card>
      <Card>
        {end.isError ? <Notice tone="danger">{errorText(end.error)}</Notice> : null}
        {grants.isPending ? <Loading /> : grants.isError ? <ErrorBlock error={grants.error} onRetry={() => void grants.refetch()} /> : (
          <DataTable caption={t('org.platform.title')} columns={columns} rows={grants.data} rowKey={(g) => g.id} empty={t('org.support.none')} />
        )}
      </Card>
    </div>
  );
}
