'use client';

import { ORGANIZATION_TYPES, type OrganizationView } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading } from '@/components/hub/common';
import { OpenOrgButton, OrgPage, useOrg } from '@/components/hub/org-context';
import { useOrgErrorText } from '@/components/hub/org-errors';
import { Action, Card, Dialog, Field, Input, Notice, PageTitle, Select } from '@/components/ui/kit';
import { hubApi } from '@/lib/hub-api';

/**
 * Étape 21 : arbre de l'organisation et création de sous-organisations (sous elle ou sous une descendante). « Gérer »
 * ouvre une sous-organisation dans l'espace quand l'adhésion couvre le sous-arbre ; sinon l'API répond « non membre ».
 */
export default function OrgTreePage() {
  return <OrgPage permissions={['organizations.read', 'organizations.manage']}>{(orgId) => <Tree orgId={orgId} />}</OrgPage>;
}

function Tree({ orgId }: { orgId: string }) {
  const { t } = useTranslation();
  const { can } = useOrg();
  const queryClient = useQueryClient();
  const tree = useQuery({ queryKey: ['org', orgId, 'organizations'], queryFn: () => hubApi.org.organizations(orgId) });
  const [parent, setParent] = useState<OrganizationView | null>(null);
  const top = tree.data?.[0];
  const depth = (o: OrganizationView) => (top ? o.path.slice(top.path.length).split('/').filter(Boolean).length : 0);
  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={t('org.orgs.title')} subtitle={t('org.orgs.intro')} actions={can('organizations.manage') && top ? <Action onClick={() => setParent(top)}>{t('org.orgs.create')}</Action> : null} />
      <Card>
        {tree.isPending ? <Loading /> : tree.isError ? <ErrorBlock error={tree.error} onRetry={() => void tree.refetch()} /> : (
          <ul className="flex flex-col gap-1" data-testid="org-tree">
            {tree.data.map((o) => (
              <li key={o.id} style={{ paddingLeft: `${depth(o) * 1.25}rem` }} className="flex flex-wrap items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-slate-50">
                <span className="text-sm">{o.name} <span className="text-xs text-slate-600">({t(`hub.orgs.types.${o.type}`)} · {o.code})</span></span>
                <span className="flex gap-2">
                  {can('organizations.manage') ? <Action tone="ghost" onClick={() => setParent(o)}>{t('org.orgs.create')}</Action> : null}
                  <OpenOrgButton organizationId={o.id} name={o.name} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {parent ? <CreateDialog orgId={orgId} parent={parent} onClose={() => setParent(null)} onCreated={() => { setParent(null); void queryClient.invalidateQueries({ queryKey: ['org', orgId] }); }} /> : null}
    </div>
  );
}

function CreateDialog({ orgId, parent, onClose, onCreated }: { orgId: string; parent: OrganizationView; onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation();
  const errorText = useOrgErrorText();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [type, setType] = useState<Exclude<OrganizationView['type'], 'platform'>>('sub_org');
  const create = useMutation({ mutationFn: () => hubApi.org.createOrganization(orgId, { parentId: parent.id, code, name, type }), onSuccess: onCreated });
  return (
    <Dialog open title={t('hub.orgs.newSubOf', { name: parent.name })} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <Field label={t('hub.orgs.name')}>{(p) => <Input {...p} required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label={t('hub.orgs.code')} hint={t('hub.orgs.codeHint')}>{(p) => <Input {...p} required pattern="[a-z0-9-]{2,40}" value={code} onChange={(e) => setCode(e.target.value.toLowerCase())} />}</Field>
        <Field label={t('hub.orgs.type')}>
          {(p) => (
            <Select {...p} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              {ORGANIZATION_TYPES.filter((v) => v !== 'platform').map((v) => <option key={v} value={v}>{t(`hub.orgs.types.${v}`)}</option>)}
            </Select>
          )}
        </Field>
        {create.isError ? <Notice tone="danger">{errorText(create.error)}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Action tone="secondary" onClick={onClose}>{t('hub.common.cancel')}</Action>
          <Action type="submit" busy={create.isPending}>{t('hub.common.save')}</Action>
        </div>
      </form>
    </Dialog>
  );
}
