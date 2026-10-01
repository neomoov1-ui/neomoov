'use client';

import type { OrgPermissionView, RoleView } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading } from '@/components/hub/common';
import { OrgPage, useOrg } from '@/components/hub/org-context';
import { useOrgErrorText } from '@/components/hub/org-errors';
import { Action, Badge, Card, Checkbox, DataTable, Dialog, Field, Input, Notice, PageTitle, Select, type Column } from '@/components/ui/kit';
import { hubApi } from '@/lib/hub-api';

/**
 * Étape 21 : rôles de l'organisation. Un rôle personnalisé se compose à partir du catalogue d'une organisation cliente,
 * limité aux permissions que la personne détient ici (les autres sont grisées) ; les permissions sensibles choisies
 * sont signalées. L'API refuse toute escalade et garde les rôles système en lecture seule.
 */
export default function OrgRolesPage() {
  return <OrgPage permissions={['roles.read', 'roles.manage']}>{(orgId) => <Roles orgId={orgId} />}</OrgPage>;
}

function Roles({ orgId }: { orgId: string }) {
  const { t } = useTranslation();
  const { can } = useOrg();
  const queryClient = useQueryClient();
  const roles = useQuery({ queryKey: ['org', orgId, 'roles'], queryFn: () => hubApi.org.roles(orgId) });
  const catalog = useQuery({ queryKey: ['org', orgId, 'permissions'], queryFn: () => hubApi.org.permissions(orgId) });
  const [editing, setEditing] = useState<RoleView | 'new' | null>(null);
  const manage = can('roles.manage');
  const columns: Column<RoleView>[] = [
    { key: 'name', header: t('hub.orgs.role'), cell: (r) => <>{r.name} {r.system ? <Badge tone="neutral">{t('hub.orgs.system')}</Badge> : null}</> },
    { key: 'level', header: t('hub.orgs.level'), cell: (r) => `N${r.level}` },
    { key: 'permissions', header: t('hub.orgs.permissions'), cell: (r) => <span title={r.permissions.join(', ')}>{t('hub.orgs.permissionCount', { count: r.permissions.length })}</span> },
    ...(manage ? [{ key: 'edit', header: '', cell: (r: RoleView) => (r.system || r.organizationId !== orgId ? null : <Action tone="secondary" onClick={() => setEditing(r)}>{t('org.roles.edit')}</Action>) }] : []),
  ];
  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={t('org.roles.title')} subtitle={t('org.roles.intro')} actions={manage ? <Action onClick={() => setEditing('new')}>{t('org.roles.create')}</Action> : null} />
      <Card>
        {roles.isPending ? <Loading /> : roles.isError ? <ErrorBlock error={roles.error} onRetry={() => void roles.refetch()} /> : (
          <DataTable caption={t('org.roles.title')} columns={columns} rows={roles.data} rowKey={(r) => r.id} empty={t('hub.common.empty')} />
        )}
      </Card>
      {editing ? (
        <RoleEditor
          orgId={orgId}
          role={editing === 'new' ? null : editing}
          catalog={catalog.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void queryClient.invalidateQueries({ queryKey: ['org', orgId, 'roles'] }); }}
        />
      ) : null}
    </div>
  );
}

function RoleEditor({ orgId, role, catalog, onClose, onSaved }: { orgId: string; role: RoleView | null; catalog: OrgPermissionView[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const errorText = useOrgErrorText();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [level, setLevel] = useState(2);
  const [chosen, setChosen] = useState<string[]>(role?.permissions ?? []);
  const byModule = useMemo(() => {
    const groups = new Map<string, OrgPermissionView[]>();
    for (const p of catalog) groups.set(p.module, [...(groups.get(p.module) ?? []), p]);
    return [...groups.entries()];
  }, [catalog]);
  const sensitive = catalog.filter((p) => p.sensitive && chosen.includes(p.code)).map((p) => p.description);
  const save = useMutation({
    mutationFn: () => (role ? hubApi.org.updateRolePermissions(orgId, role.id, chosen) : hubApi.org.createRole(orgId, { code, name, level, permissions: chosen })),
    onSuccess: onSaved,
  });
  return (
    <Dialog open title={role ? t('org.roles.editTitle', { name: role.name }) : t('org.roles.create')} onClose={onClose} wide>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {!role ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('hub.orgs.name')}>{(p) => <Input {...p} required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
            <Field label={t('hub.orgs.code')}>{(p) => <Input {...p} required pattern="[a-z0-9_]{2,60}" value={code} onChange={(e) => setCode(e.target.value.toLowerCase())} />}</Field>
            <Field label={t('hub.orgs.level')}>
              {(p) => <Select {...p} value={level} onChange={(e) => setLevel(Number(e.target.value))}>{[1, 2, 3, 4].map((l) => <option key={l} value={l}>{`N${l}`}</option>)}</Select>}
            </Field>
          </div>
        ) : null}
        <Notice tone="info">{t('org.roles.intro')}</Notice>
        <div className="grid max-h-96 gap-3 overflow-y-auto sm:grid-cols-2">
          {byModule.map(([module, list]) => (
            <fieldset key={module} className="rounded border border-slate-200 p-2">
              <legend className="px-1 text-sm font-semibold">{t(`hub.orgs.modules.${module}`)}</legend>
              {list.map((p) => (
                <Checkbox
                  key={p.code}
                  disabled={!p.held}
                  label={`${p.description}${p.sensitive ? ` (${t('hub.orgs.sensitive')})` : ''}${p.held ? '' : ` · ${t('org.roles.notHeld')}`}`}
                  checked={chosen.includes(p.code)}
                  onChange={(e) => setChosen((c) => (e.target.checked ? [...c, p.code] : c.filter((x) => x !== p.code)))}
                />
              ))}
            </fieldset>
          ))}
        </div>
        {sensitive.length ? <Notice tone="warning">{t('org.roles.sensitiveWarning', { list: sensitive.join(', ') })}</Notice> : null}
        {save.isError ? <Notice tone="danger">{errorText(save.error)}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Action tone="secondary" onClick={onClose}>{t('hub.common.cancel')}</Action>
          <Action type="submit" busy={save.isPending} disabled={!chosen.length}>{t('hub.common.save')}</Action>
        </div>
      </form>
    </Dialog>
  );
}
