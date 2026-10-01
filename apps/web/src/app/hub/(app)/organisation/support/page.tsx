'use client';

import type { SupportAccessDecision } from '@neomoov/api-client';
import type { SupportAccessGrantView } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading, useLang } from '@/components/hub/common';
import { OrgPage, useOrg } from '@/components/hub/org-context';
import { useOrgErrorText } from '@/components/hub/org-errors';
import { Action, Badge, Card, DataTable, Notice, PageTitle, type BadgeTone, type Column } from '@/components/ui/kit';
import { formatDateTime } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

const TONES: Record<SupportAccessGrantView['status'], BadgeTone> = { requested: 'warning', approved: 'success', denied: 'neutral', expired: 'neutral', revoked: 'danger' };

/**
 * Étape 21 : accès temporaires du support de la plateforme à l'organisation. Une demande s'approuve (l'accès court dès
 * lors pour la durée demandée), se refuse ou se révoque à tout moment ; chaque usage figure dans le journal.
 */
export default function OrgSupportPage() {
  return <OrgPage permissions={['audit.read', 'members.manage']}>{(orgId) => <Support orgId={orgId} />}</OrgPage>;
}

function Support({ orgId }: { orgId: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const errorText = useOrgErrorText();
  const { can, home } = useOrg();
  const queryClient = useQueryClient();
  const grants = useQuery({ queryKey: ['org', orgId, 'support-access'], queryFn: () => hubApi.org.supportAccess(orgId) });
  const decide = useMutation({
    mutationFn: (v: { id: string; decision: SupportAccessDecision }) => hubApi.org.decideSupportAccess(orgId, v.id, v.decision),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['org', orgId] }),
  });
  const manage = can('members.manage') && !home?.supportAccess;
  const columns: Column<SupportAccessGrantView>[] = [
    { key: 'created', header: t('hub.audit.when'), cell: (g) => formatDateTime(g.createdAt, lang) },
    { key: 'org', header: t('org.platform.organization'), cell: (g) => g.organizationName },
    { key: 'by', header: t('org.support.requestedBy'), cell: (g) => g.requestedByName ?? g.requestedByUserId.slice(0, 8) },
    { key: 'reason', header: t('org.support.reason'), cell: (g) => <span className="block max-w-80">{g.reason}</span> },
    { key: 'duration', header: t('org.support.duration'), cell: (g) => t('org.support.minutes', { count: g.durationMinutes }) },
    { key: 'status', header: t('org.support.status'), cell: (g) => <Badge tone={g.active ? 'info' : TONES[g.status]}>{g.active ? t('org.support.active') : t(`org.support.statuses.${g.status}`)}</Badge> },
    { key: 'period', header: t('org.support.period'), cell: (g) => (g.startsAt ? `${formatDateTime(g.startsAt, lang)} → ${formatDateTime(g.endsAt, lang)}` : '') },
    ...(manage ? [{
      key: 'actions', header: t('hub.common.actions'), cell: (g: SupportAccessGrantView) => (
        <div className="flex flex-wrap gap-2">
          {g.status === 'requested' ? <Action onClick={() => decide.mutate({ id: g.id, decision: 'approve' })}>{t('org.support.approve')}</Action> : null}
          {g.status === 'requested' ? <Action tone="secondary" onClick={() => decide.mutate({ id: g.id, decision: 'deny' })}>{t('org.support.deny')}</Action> : null}
          {g.status === 'requested' || g.status === 'approved' ? <Action tone="danger" onClick={() => decide.mutate({ id: g.id, decision: 'revoke' })}>{t('org.support.revoke')}</Action> : null}
        </div>
      ),
    }] : []),
  ];
  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={t('org.support.title')} subtitle={t('org.support.intro')} />
      {decide.isError ? <Notice tone="danger">{errorText(decide.error)}</Notice> : null}
      <Card>
        {grants.isPending ? <Loading /> : grants.isError ? <ErrorBlock error={grants.error} onRetry={() => void grants.refetch()} /> : (
          <DataTable caption={t('org.support.title')} columns={columns} rows={grants.data} rowKey={(g) => g.id} empty={t('org.support.none')} />
        )}
      </Card>
    </div>
  );
}
