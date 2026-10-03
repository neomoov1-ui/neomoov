'use client';

import type { InvitationCreated, MembershipView, OrganizationView, RoleView } from '@neomoov/domain';
import { ORGANIZATION_TYPES } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading, useErrorText } from '@/components/hub/common';
import { Action, Badge, Card, Checkbox, DataTable, Dialog, Field, Input, Notice, PageTitle, Select, cx, focus, type Column } from '@/components/ui/kit';
import { hubApi } from '@/lib/hub-api';
import { OrgBillingPanel } from '@/components/hub/org-billing';
import { OrgBrandPanel } from '@/components/hub/org-brand';

type Permission = { code: string; module: string; description: string; sensitive: boolean; platformOnly: boolean };
/** Onglets d'une organisation : la marque et l'abonnement ne concernent que les organisations clientes (pas la racine). */
type Tab = 'members' | 'roles' | 'brand' | 'billing';

/**
 * Organisations et accès (étape 19) : arbre des organisations, membres et invitations à usage unique, rôles système et
 * personnalisés ; marque et domaines (étape 22) et abonnement à la plateforme (étape 25) d'une organisation cliente.
 * L'API refuse toute permission que la personne connectée ne détient pas (pas d'escalade).
 */
export default function OrganizationsPage() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const orgs = useQuery({ queryKey: ['hub', 'orgs'], queryFn: () => hubApi.admin.organizations() });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('members');
  const [creating, setCreating] = useState(false);
  const root = orgs.data?.find((o) => o.parentId === null) ?? null;
  const selected = orgs.data?.find((o) => o.id === (selectedId ?? root?.id)) ?? null;
  const depth = (o: OrganizationView) => o.path.split('/').filter(Boolean).length - 1;
  const client = selected !== null && selected.parentId !== null;

  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={t('hub.orgs.title')} actions={selected ? <Action onClick={() => setCreating(true)}>{t('hub.orgs.newSub')}</Action> : null} />
      <Notice tone="info">{t('hub.orgs.intro')}</Notice>
      {orgs.isPending ? <Loading /> : orgs.isError ? <ErrorBlock error={orgs.error} onRetry={() => void orgs.refetch()} /> : (
        <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
          <Card title={t('hub.orgs.tree')}>
            <ul className="flex flex-col gap-1">
              {orgs.data.map((o) => (
                <li key={o.id} style={{ paddingLeft: `${depth(o) * 1}rem` }}>
                  <button type="button" onClick={() => setSelectedId(o.id)} className={cx('w-full rounded px-2 py-1 text-left text-sm', focus, o.id === selected?.id ? 'bg-brand-night text-white' : 'hover:bg-slate-100')}>
                    {o.name} <span className="text-xs opacity-70">({t(`hub.orgs.types.${o.type}`)})</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          {selected ? (
            <Card title={selected.name} actions={(
              <div className="flex flex-wrap gap-2">
                <Action tone={tab === 'members' ? 'primary' : 'secondary'} aria-pressed={tab === 'members'} onClick={() => setTab('members')}>{t('hub.orgs.members')}</Action>
                <Action tone={tab === 'roles' ? 'primary' : 'secondary'} aria-pressed={tab === 'roles'} onClick={() => setTab('roles')}>{t('hub.orgs.roles')}</Action>
                {client ? <Action tone={tab === 'brand' ? 'primary' : 'secondary'} aria-pressed={tab === 'brand'} onClick={() => setTab('brand')}>{t('hub.brand.tab')}</Action> : null}
                {client ? <Action tone={tab === 'billing' ? 'primary' : 'secondary'} aria-pressed={tab === 'billing'} onClick={() => setTab('billing')}>{t('hub.billing.tab')}</Action> : null}
              </div>
            )}>
              {tab === 'roles' ? <Roles org={selected} /> : tab === 'brand' && client ? <OrgBrandPanel key={selected.id} org={selected} /> : tab === 'billing' && client ? <OrgBillingPanel key={selected.id} org={selected} /> : <Members org={selected} />}
            </Card>
          ) : null}
        </div>
      )}
      {selected ? (
        <CreateOrganization parent={selected} open={creating} onClose={() => setCreating(false)} onCreated={(o) => { setCreating(false); setSelectedId(o.id); void queryClient.invalidateQueries({ queryKey: ['hub', 'orgs'] }); }} errorText={errorText} />
      ) : null}
    </div>
  );
}

function CreateOrganization({ parent, open, onClose, onCreated, errorText }: { parent: OrganizationView; open: boolean; onClose: () => void; onCreated: (o: OrganizationView) => void; errorText: (e: unknown) => string }) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<Exclude<OrganizationView['type'], 'platform'>>('fleet');
  const create = useMutation({ mutationFn: () => hubApi.admin.createOrganization({ parentId: parent.id, code, name, type }), onSuccess: onCreated });
  return (
    <Dialog open={open} title={t('hub.orgs.newSubOf', { name: parent.name })} onClose={onClose}>
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

function Members({ org }: { org: OrganizationView }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const members = useQuery({ queryKey: ['hub', 'orgs', org.id, 'members'], queryFn: () => hubApi.admin.members(org.id) });
  const roles = useQuery({ queryKey: ['hub', 'orgs', org.id, 'roles'], queryFn: () => hubApi.admin.roles(org.id) });
  const [inviting, setInviting] = useState(false);
  const [roleId, setRoleId] = useState('');
  const [contact, setContact] = useState('');
  const [scope, setScope] = useState<'organization' | 'subtree'>('organization');
  // Étape 21 : le lien part par texto ou courriel ; le jeton n'est rendu qu'en développement (réglage de l'API).
  const [created, setCreated] = useState<InvitationCreated | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['hub', 'orgs', org.id, 'members'] });
  const invite = useMutation({
    mutationFn: () => hubApi.admin.invite(org.id, { roleId, scope, ...(contact.includes('@') ? { email: contact.trim() } : { phone: contact.trim() }) }),
    onSuccess: (r) => { setCreated(r); setContact(''); },
  });
  const update = useMutation({ mutationFn: (v: { id: string; status: 'active' | 'suspended' }) => hubApi.admin.updateMembership(v.id, { status: v.status }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => hubApi.admin.removeMembership(id), onSuccess: refresh });
  const columns: Column<MembershipView>[] = [
    { key: 'name', header: t('hub.orgs.member'), cell: (m) => m.name ?? m.userId.slice(0, 8) },
    { key: 'role', header: t('hub.orgs.role'), cell: (m) => m.roleName },
    { key: 'scope', header: t('hub.orgs.scope'), cell: (m) => t(`hub.orgs.scopes.${m.scope}`) },
    { key: 'status', header: t('hub.orgs.status'), cell: (m) => <Badge tone={m.status === 'active' ? 'success' : 'warning'}>{t(`hub.orgs.statuses.${m.status}`)}</Badge> },
    {
      key: 'actions', header: '', cell: (m) => (
        <div className="flex gap-2">
          <Action tone="secondary" onClick={() => update.mutate({ id: m.id, status: m.status === 'active' ? 'suspended' : 'active' })}>{m.status === 'active' ? t('hub.orgs.suspend') : t('hub.orgs.reactivate')}</Action>
          <Action tone="danger" onClick={() => remove.mutate(m.id)}>{t('hub.orgs.remove')}</Action>
        </div>
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div><Action onClick={() => { setInviting(true); setCreated(null); invite.reset(); }}>{t('hub.orgs.invite')}</Action></div>
      {update.isError || remove.isError ? <Notice tone="danger">{errorText(update.error ?? remove.error)}</Notice> : null}
      {members.isPending ? <Loading /> : members.isError ? <ErrorBlock error={members.error} onRetry={() => void members.refetch()} /> : (
        <DataTable caption={t('hub.orgs.members')} columns={columns} rows={members.data} rowKey={(m) => m.id} empty={t('hub.orgs.noMembers')} />
      )}
      <Dialog open={inviting} title={t('hub.orgs.invite')} onClose={() => setInviting(false)}>
        {created ? (
          <div className="flex flex-col gap-3">
            <Notice tone="success">{t('org.members.sent', { channel: t(`org.members.channels.${created.channel}`) })}</Notice>
            {created.token ? <p className="text-xs text-slate-600">{t('org.members.devToken')} <code className="break-all">{`${window.location.origin}/rejoindre?token=${created.token}`}</code></p> : null}
            <div className="flex justify-end"><Action onClick={() => setInviting(false)}>{t('hub.common.close')}</Action></div>
          </div>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); invite.mutate(); }}>
            <Field label={t('hub.orgs.role')}>
              {(p) => (
                <Select {...p} required value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                  <option value="">{t('hub.orgs.chooseRole')}</option>
                  {(roles.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
              )}
            </Field>
            <Field label={t('hub.orgs.contact')} hint={t('hub.orgs.contactHint')}>{(p) => <Input {...p} required value={contact} onChange={(e) => setContact(e.target.value)} />}</Field>
            <Field label={t('hub.orgs.scope')}>
              {(p) => (
                <Select {...p} value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
                  {(['organization', 'subtree'] as const).map((s) => <option key={s} value={s}>{t(`hub.orgs.scopes.${s}`)}</option>)}
                </Select>
              )}
            </Field>
            {invite.isError ? <Notice tone="danger">{errorText(invite.error)}</Notice> : null}
            <div className="flex justify-end gap-2">
              <Action tone="secondary" onClick={() => setInviting(false)}>{t('hub.common.cancel')}</Action>
              <Action type="submit" busy={invite.isPending}>{t('hub.orgs.send')}</Action>
            </div>
          </form>
        )}
      </Dialog>
    </div>
  );
}

function Roles({ org }: { org: OrganizationView }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const roles = useQuery({ queryKey: ['hub', 'orgs', org.id, 'roles'], queryFn: () => hubApi.admin.roles(org.id) });
  const catalog = useQuery({ queryKey: ['hub', 'permissions'], queryFn: () => hubApi.admin.permissions() });
  const [creating, setCreating] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [level, setLevel] = useState(2);
  const [chosen, setChosen] = useState<string[]>([]);
  const clientOrg = org.parentId !== null;
  const byModule = useMemo(() => {
    const groups = new Map<string, Permission[]>();
    for (const p of catalog.data ?? []) if (!(clientOrg && p.platformOnly) && p.module !== 'self') groups.set(p.module, [...(groups.get(p.module) ?? []), p]);
    return [...groups.entries()];
  }, [catalog.data, clientOrg]);
  const create = useMutation({
    mutationFn: () => hubApi.admin.createRole({ organizationId: org.id, code, name, level, permissions: chosen }),
    onSuccess: () => { setCreating(false); setChosen([]); setCode(''); setName(''); void queryClient.invalidateQueries({ queryKey: ['hub', 'orgs', org.id, 'roles'] }); },
  });
  const columns: Column<RoleView>[] = [
    { key: 'name', header: t('hub.orgs.role'), cell: (r) => <>{r.name} {r.system ? <Badge tone="neutral">{t('hub.orgs.system')}</Badge> : null}</> },
    { key: 'level', header: t('hub.orgs.level'), cell: (r) => `N${r.level}` },
    { key: 'permissions', header: t('hub.orgs.permissions'), cell: (r) => <span title={r.permissions.join(', ')}>{t('hub.orgs.permissionCount', { count: r.permissions.length })}</span> },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div><Action onClick={() => { setCreating(true); create.reset(); }}>{t('hub.orgs.newRole')}</Action></div>
      {roles.isPending ? <Loading /> : roles.isError ? <ErrorBlock error={roles.error} onRetry={() => void roles.refetch()} /> : (
        <DataTable caption={t('hub.orgs.roles')} columns={columns} rows={roles.data} rowKey={(r) => r.id} empty={t('hub.common.empty')} />
      )}
      <Dialog open={creating} title={t('hub.orgs.newRole')} onClose={() => setCreating(false)} wide>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('hub.orgs.name')}>{(p) => <Input {...p} required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
            <Field label={t('hub.orgs.code')}>{(p) => <Input {...p} required pattern="[a-z0-9_]{2,60}" value={code} onChange={(e) => setCode(e.target.value.toLowerCase())} />}</Field>
            <Field label={t('hub.orgs.level')}>
              {(p) => <Select {...p} value={level} onChange={(e) => setLevel(Number(e.target.value))}>{[1, 2, 3, 4].map((l) => <option key={l} value={l}>{`N${l}`}</option>)}</Select>}
            </Field>
          </div>
          <Notice tone="info">{t('hub.orgs.noEscalation')}</Notice>
          <div className="grid max-h-96 gap-3 overflow-y-auto sm:grid-cols-2">
            {byModule.map(([module, list]) => (
              <fieldset key={module} className="rounded border border-slate-200 p-2">
                <legend className="px-1 text-sm font-semibold">{t(`hub.orgs.modules.${module}`)}</legend>
                {list.map((p) => (
                  <Checkbox key={p.code} label={`${p.description}${p.sensitive ? ` (${t('hub.orgs.sensitive')})` : ''}`} checked={chosen.includes(p.code)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, p.code] : c.filter((x) => x !== p.code)))} />
                ))}
              </fieldset>
            ))}
          </div>
          {create.isError ? <Notice tone="danger">{errorText(create.error)}</Notice> : null}
          <div className="flex justify-end gap-2">
            <Action tone="secondary" onClick={() => setCreating(false)}>{t('hub.common.cancel')}</Action>
            <Action type="submit" busy={create.isPending} disabled={!chosen.length}>{t('hub.common.save')}</Action>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
