'use client';

import type { InvitationCreated, InvitationView, MembershipView } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading, useHubUser, useLang } from '@/components/hub/common';
import { OrgPage, useOrg } from '@/components/hub/org-context';
import { useOrgErrorText } from '@/components/hub/org-errors';
import { Action, Badge, Card, DataTable, Dialog, Field, Input, Notice, PageTitle, Select, type Column } from '@/components/ui/kit';
import { formatDate } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

/**
 * Étape 21 : membres de l'organisation (rôle, portée, état), invitations par texto ou courriel avec choix du rôle et de
 * la portée, suspension, retrait, changement de rôle, transfert de propriété. L'API refuse ce que le rôle ne permet pas,
 * le retrait du dernier propriétaire (409) et toute escalade.
 */
export default function OrgMembersPage() {
  return <OrgPage permissions={['members.read', 'members.invite']}>{(orgId) => <Members orgId={orgId} />}</OrgPage>;
}

function Members({ orgId }: { orgId: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const errorText = useOrgErrorText();
  const me = useHubUser();
  const { can } = useOrg();
  const queryClient = useQueryClient();
  const manage = can('members.manage');
  const members = useQuery({ queryKey: ['org', orgId, 'members'], queryFn: () => hubApi.org.members(orgId), enabled: can('members.read') });
  const roles = useQuery({ queryKey: ['org', orgId, 'roles'], queryFn: () => hubApi.org.roles(orgId), enabled: can('roles.read', 'roles.manage'), retry: false });
  const invitations = useQuery({ queryKey: ['org', orgId, 'invitations'], queryFn: () => hubApi.org.invitations(orgId) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['org', orgId] });
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<MembershipView | null>(null);
  const [transferring, setTransferring] = useState(false);
  const update = useMutation({ mutationFn: (v: { id: string; status?: 'active' | 'suspended'; roleId?: string }) => hubApi.org.updateMembership(orgId, v.id, { ...(v.status ? { status: v.status } : {}), ...(v.roleId ? { roleId: v.roleId } : {}) }), onSuccess: () => { setEditing(null); refresh(); } });
  const remove = useMutation({ mutationFn: (id: string) => hubApi.org.removeMembership(orgId, id), onSuccess: refresh });
  const revoke = useMutation({ mutationFn: (id: string) => hubApi.org.revokeInvitation(orgId, id), onSuccess: refresh });
  const iAmOwner = (members.data ?? []).some((m) => m.userId === me.id && m.roleCode === 'org_owner' && m.status === 'active' && m.organizationId === orgId);

  const columns: Column<MembershipView>[] = [
    { key: 'name', header: t('hub.orgs.member'), cell: (m) => <>{m.name ?? m.userId.slice(0, 8)}{m.userId === me.id ? <span className="ml-1 text-xs text-slate-600">({t('org.members.you')})</span> : null}</> },
    { key: 'role', header: t('hub.orgs.role'), cell: (m) => (m.roleCode === 'org_owner' ? <Badge tone="info">{t('org.members.owner')}</Badge> : m.roleName) },
    { key: 'scope', header: t('hub.orgs.scope'), cell: (m) => t(`hub.orgs.scopes.${m.scope}`) },
    { key: 'status', header: t('hub.orgs.status'), cell: (m) => <Badge tone={m.status === 'active' ? 'success' : 'warning'}>{t(`hub.orgs.statuses.${m.status}`)}</Badge> },
    ...(manage ? [{
      key: 'actions', header: t('hub.common.actions'), cell: (m: MembershipView) => (
        <div className="flex flex-wrap gap-2">
          <Action tone="secondary" onClick={() => { update.reset(); setEditing(m); }}>{t('org.members.changeRole')}</Action>
          <Action tone="secondary" onClick={() => update.mutate({ id: m.id, status: m.status === 'active' ? 'suspended' : 'active' })}>{m.status === 'active' ? t('hub.orgs.suspend') : t('hub.orgs.reactivate')}</Action>
          <Action tone="danger" onClick={() => { if (window.confirm(t('org.members.confirmRemove'))) remove.mutate(m.id); }}>{t('hub.orgs.remove')}</Action>
        </div>
      ),
    }] : []),
  ];
  const invitationColumns: Column<InvitationView>[] = [
    { key: 'contact', header: t('org.members.contact'), cell: (i) => i.phone ?? i.email ?? '' },
    { key: 'role', header: t('hub.orgs.role'), cell: (i) => i.roleName },
    { key: 'scope', header: t('hub.orgs.scope'), cell: (i) => t(`hub.orgs.scopes.${i.scope}`) },
    { key: 'status', header: t('hub.orgs.status'), cell: (i) => <Badge tone={i.status === 'pending' ? 'info' : i.status === 'accepted' ? 'success' : 'neutral'}>{t(`org.members.statuses.${i.status}`)}</Badge> },
    { key: 'expires', header: t('org.members.expires'), cell: (i) => formatDate(i.expiresAt, lang) },
    ...(can('members.invite') ? [{ key: 'revoke', header: '', cell: (i: InvitationView) => (i.status === 'pending' ? <Action tone="secondary" onClick={() => revoke.mutate(i.id)}>{t('org.members.revoke')}</Action> : null) }] : []),
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageTitle
        title={t('org.members.title')}
        actions={(
          <div className="flex flex-wrap gap-2">
            {iAmOwner && manage ? <Action tone="secondary" onClick={() => setTransferring(true)}>{t('org.members.transfer')}</Action> : null}
            {can('members.invite') ? <Action onClick={() => setInviting(true)}>{t('org.members.invite')}</Action> : null}
          </div>
        )}
      />
      {update.isError || remove.isError || revoke.isError ? <Notice tone="danger">{errorText(update.error ?? remove.error ?? revoke.error)}</Notice> : null}
      {can('members.read') ? (
        <Card>
          {members.isPending ? <Loading /> : members.isError ? <ErrorBlock error={members.error} onRetry={() => void members.refetch()} /> : (
            <DataTable caption={t('org.members.title')} columns={columns} rows={members.data} rowKey={(m) => m.id} empty={t('hub.orgs.noMembers')} />
          )}
        </Card>
      ) : null}
      <Card title={t('org.members.invitations')}>
        {invitations.isPending ? <Loading /> : invitations.isError ? <ErrorBlock error={invitations.error} onRetry={() => void invitations.refetch()} /> : (
          <DataTable caption={t('org.members.invitations')} columns={invitationColumns} rows={invitations.data} rowKey={(i) => i.id} empty={t('org.members.noInvitations')} />
        )}
      </Card>
      <InviteDialog orgId={orgId} open={inviting} roles={roles.data ?? []} onClose={() => setInviting(false)} onSent={refresh} />
      <Dialog open={editing !== null} title={t('org.members.changeRole')} onClose={() => setEditing(null)}>
        {editing ? (
          <RoleForm current={editing.roleId} roles={roles.data ?? []} busy={update.isPending} error={update.isError ? errorText(update.error) : null} onCancel={() => setEditing(null)} onSave={(roleId) => update.mutate({ id: editing.id, roleId })} />
        ) : null}
      </Dialog>
      <TransferDialog orgId={orgId} open={transferring} members={(members.data ?? []).filter((m) => m.status === 'active' && m.userId !== me.id && m.organizationId === orgId)} onClose={() => setTransferring(false)} onDone={() => { setTransferring(false); refresh(); }} />
    </div>
  );
}

function RoleForm({ current, roles, busy, error, onCancel, onSave }: { current: string; roles: Array<{ id: string; name: string }>; busy: boolean; error: string | null; onCancel: () => void; onSave: (roleId: string) => void }) {
  const { t } = useTranslation();
  const [roleId, setRoleId] = useState(current);
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); onSave(roleId); }}>
      <Field label={t('org.members.newRole')}>
        {(p) => <Select {...p} value={roleId} onChange={(e) => setRoleId(e.target.value)}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>}
      </Field>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="flex justify-end gap-2">
        <Action tone="secondary" onClick={onCancel}>{t('hub.common.cancel')}</Action>
        <Action type="submit" busy={busy} disabled={roleId === current}>{t('hub.common.save')}</Action>
      </div>
    </form>
  );
}

function InviteDialog({ orgId, open, roles, onClose, onSent }: { orgId: string; open: boolean; roles: Array<{ id: string; name: string }>; onClose: () => void; onSent: () => void }) {
  const { t } = useTranslation();
  const errorText = useOrgErrorText();
  const [roleId, setRoleId] = useState('');
  const [contact, setContact] = useState('');
  const [scope, setScope] = useState<'organization' | 'subtree'>('organization');
  const [created, setCreated] = useState<InvitationCreated | null>(null);
  const invite = useMutation({
    mutationFn: () => hubApi.org.invite(orgId, { roleId, scope, ...(contact.includes('@') ? { email: contact.trim() } : { phone: contact.trim() }) }),
    onSuccess: (r) => { setCreated(r); setContact(''); onSent(); },
  });
  const close = () => { setCreated(null); invite.reset(); onClose(); };
  return (
    <Dialog open={open} title={t('org.members.invite')} onClose={close}>
      {created ? (
        <div className="flex flex-col gap-3">
          <Notice tone="success">{t('org.members.sent', { channel: t(`org.members.channels.${created.channel}`) })}</Notice>
          {created.token ? <p className="text-xs text-slate-600">{t('org.members.devToken')} <code className="break-all">{`${window.location.origin}/rejoindre?token=${created.token}`}</code></p> : null}
          <div className="flex justify-end"><Action onClick={close}>{t('hub.common.close')}</Action></div>
        </div>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); invite.mutate(); }}>
          <p className="text-sm text-slate-700">{t('org.members.inviteHint')}</p>
          <Field label={t('hub.orgs.contact')} hint={t('hub.orgs.contactHint')}>{(p) => <Input {...p} required value={contact} onChange={(e) => setContact(e.target.value)} />}</Field>
          <Field label={t('hub.orgs.role')}>
            {(p) => (
              <Select {...p} required value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                <option value="">{t('hub.orgs.chooseRole')}</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label={t('hub.orgs.scope')}>
            {(p) => <Select {...p} value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>{(['organization', 'subtree'] as const).map((s) => <option key={s} value={s}>{t(`hub.orgs.scopes.${s}`)}</option>)}</Select>}
          </Field>
          {invite.isError ? <Notice tone="danger">{errorText(invite.error)}</Notice> : null}
          <div className="flex justify-end gap-2">
            <Action tone="secondary" onClick={close}>{t('hub.common.cancel')}</Action>
            <Action type="submit" busy={invite.isPending} disabled={!roleId || !contact.trim()}>{t('hub.orgs.send')}</Action>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function TransferDialog({ orgId, open, members, onClose, onDone }: { orgId: string; open: boolean; members: MembershipView[]; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const errorText = useOrgErrorText();
  const [membershipId, setMembershipId] = useState('');
  const transfer = useMutation({ mutationFn: () => hubApi.org.transferOwnership(orgId, membershipId), onSuccess: onDone });
  return (
    <Dialog open={open} title={t('org.members.transferTitle')} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); transfer.mutate(); }}>
        <Notice tone="warning">{t('org.members.transferHint')}</Notice>
        <Field label={t('hub.orgs.member')}>
          {(p) => (
            <Select {...p} required value={membershipId} onChange={(e) => setMembershipId(e.target.value)}>
              <option value="">{t('hub.orgs.member')}</option>
              {members.map((m) => <option key={m.id} value={m.id}>{`${m.name ?? m.userId.slice(0, 8)} · ${m.roleName}`}</option>)}
            </Select>
          )}
        </Field>
        {transfer.isError ? <Notice tone="danger">{errorText(transfer.error)}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Action tone="secondary" onClick={onClose}>{t('hub.common.cancel')}</Action>
          <Action type="submit" tone="danger" busy={transfer.isPending} disabled={!membershipId}>{t('org.members.transfer')}</Action>
        </div>
      </form>
    </Dialog>
  );
}
