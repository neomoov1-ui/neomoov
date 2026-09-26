'use client';

import { STAFF_ROLES, type AdminStaff, type StaffRole } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading, useErrorText, useHubUser, useLang } from '@/components/hub/common';
import { Action, Badge, Card, Checkbox, DataTable, Dialog, Field, Input, Notice, PageTitle, Select } from '@/components/ui/kit';
import { formatDate, fullName } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_!';

/** Mot de passe initial aléatoire (20 caractères, générateur cryptographique du navigateur), à transmettre par un canal sûr. */
function generatePassword(length = 20): string {
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(bytes, (b) => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length]).join('');
}

/**
 * Équipe de My Hub (administrateur) : rôles et état du second facteur, ajout d'un membre, remplacement du mot de passe
 * et réinitialisation du second facteur (téléphone perdu). Chaque action est journalisée par l'API.
 */
export default function StaffPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const user = useHubUser();
  const admin = user.roles.includes('admin');
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<AdminStaff | null>(null);
  const [passwordFor, setPasswordFor] = useState<AdminStaff | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const staff = useQuery({ queryKey: ['hub', 'staff'], queryFn: () => hubApi.admin.staff(), enabled: admin });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['hub', 'staff'] });
  const name = (s: AdminStaff) => fullName(s.firstName, s.lastName, s.email ?? '');

  if (!admin) {
    return (
      <div>
        <PageTitle title={t('hub.staff.title')} />
        <Notice tone="info">{t('hub.staff.adminOnly')}</Notice>
      </div>
    );
  }
  return (
    <div>
      <PageTitle title={t('hub.staff.title')} actions={<Action onClick={() => { setAdding(true); setNotice(null); }}>{t('hub.staff.add')}</Action>} />
      {notice ? <div className="mb-3"><Notice tone="success">{notice}</Notice></div> : null}
      <Card>
        {staff.isPending ? <Loading /> : staff.isError ? <ErrorBlock error={staff.error} onRetry={() => void staff.refetch()} /> : (
          <DataTable
            caption={t('hub.staff.title')}
            rows={staff.data}
            rowKey={(s) => s.id}
            empty={t('hub.common.empty')}
            columns={[
              { key: 'name', header: t('hub.clients.name'), cell: (s) => <span>{fullName(s.firstName, s.lastName)}{s.id === user.id ? <span className="ml-1 text-xs text-slate-600">({t('hub.staff.you')})</span> : null}</span> },
              { key: 'email', header: t('hub.staff.email'), cell: (s) => s.email ?? '' },
              { key: 'roles', header: t('hub.staff.roles'), cell: (s) => <span className="flex flex-wrap gap-1">{s.roles.map((r) => <Badge key={r} tone="info">{t(`enum.role.${r}`)}</Badge>)}</span> },
              { key: 'mfa', header: t('hub.staff.mfa'), cell: (s) => (s.mfaEnrolled ? <Badge tone="success">{t('hub.staff.enrolled')}</Badge> : <Badge tone="warning">{t('hub.staff.notEnrolled')}</Badge>) },
              { key: 'status', header: t('hub.common.status'), cell: (s) => s.status },
              { key: 'since', header: t('hub.drivers.since'), cell: (s) => formatDate(s.createdAt, lang) },
              {
                key: 'actions', header: t('hub.common.actions'), cell: (s) => (
                  <span className="flex flex-wrap gap-2">
                    <Action tone="secondary" onClick={() => { setPasswordFor(s); setNotice(null); }}>{t('hub.staff.setPassword')}</Action>
                    {s.mfaEnrolled ? <Action tone="secondary" onClick={() => { setResetting(s); setNotice(null); }}>{t('hub.staff.resetMfa')}</Action> : null}
                  </span>
                ),
              },
            ]}
          />
        )}
      </Card>
      <AddStaffDialog
        open={adding}
        onClose={() => setAdding(false)}
        onDone={(text) => {
          setAdding(false);
          setNotice(text);
          refresh();
        }}
      />
      <ResetMfaDialog
        key={resetting?.id ?? 'none'}
        member={resetting}
        self={resetting?.id === user.id}
        label={resetting ? name(resetting) : ''}
        onClose={() => setResetting(null)}
        onDone={() => {
          setResetting(null);
          setNotice(t('hub.staff.mfaReset'));
          refresh();
        }}
      />
      <PasswordDialog
        key={passwordFor?.id ?? 'none'}
        member={passwordFor}
        label={passwordFor ? name(passwordFor) : ''}
        onClose={() => setPasswordFor(null)}
        onDone={() => {
          setPasswordFor(null);
          setNotice(t('hub.staff.passwordSet'));
        }}
      />
    </div>
  );
}

/** Ajout d'un membre : un courriel ou un téléphone déjà connu met à jour ce compte (rôles ajoutés, mot de passe remplacé). */
function AddStaffDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (notice: string) => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [language, setLanguage] = useState<'fr' | 'en'>('fr');
  const [roles, setRoles] = useState<StaffRole[]>(['operator']);
  const [password, setPassword] = useState('');
  const create = useMutation({
    mutationFn: () => hubApi.admin.createStaff({ firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim(), phone: phone.trim(), language, roles, password }),
    onSuccess: (me) => {
      onDone(t('hub.staff.created', { name: fullName(me.firstName, me.lastName, me.email ?? ''), roles: me.roles.map((r) => t(`enum.role.${r}`)).join(', ') }));
      setFirstName('');
      setLastName('');
      setEmail('');
      setPhone('');
      setPassword('');
      setRoles(['operator']);
    },
  });
  const toggle = (role: StaffRole, checked: boolean) => setRoles((current) => (checked ? [...current, role] : current.filter((r) => r !== role)));
  return (
    <Dialog open={open} title={t('hub.staff.addTitle')} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <p className="text-xs text-slate-600">{t('hub.staff.addHint')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('hub.staff.firstName')}>{(p) => <Input {...p} required maxLength={100} autoComplete="off" value={firstName} onChange={(e) => setFirstName(e.target.value)} />}</Field>
          <Field label={t('hub.staff.lastName')}>{(p) => <Input {...p} required maxLength={100} autoComplete="off" value={lastName} onChange={(e) => setLastName(e.target.value)} />}</Field>
        </div>
        <Field label={t('hub.staff.email')}>{(p) => <Input {...p} type="email" required maxLength={254} autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label={t('hub.staff.phone')}>{(p) => <Input {...p} type="tel" required pattern="\+[1-9][0-9]{6,14}" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} />}</Field>
        <Field label={t('hub.staff.language')}>
          {(p) => (
            <Select {...p} value={language} onChange={(e) => setLanguage(e.target.value as 'fr' | 'en')}>
              <option value="fr">{t('hub.staff.languages.fr')}</option>
              <option value="en">{t('hub.staff.languages.en')}</option>
            </Select>
          )}
        </Field>
        <div role="group" aria-label={t('hub.staff.roles')}>
          <p className="mb-1 text-sm font-semibold text-brand-ink">{t('hub.staff.roles')}</p>
          <div className="grid gap-1 sm:grid-cols-2">
            {STAFF_ROLES.map((r) => <Checkbox key={r} label={t(`enum.role.${r}`)} checked={roles.includes(r)} onChange={(e) => toggle(r, e.target.checked)} />)}
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <Field label={t('hub.staff.password')}>{(p) => <Input {...p} type="text" required minLength={12} maxLength={200} autoComplete="new-password" spellCheck={false} className="font-mono" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
          <Action tone="secondary" onClick={() => setPassword(generatePassword())}>{t('hub.staff.generate')}</Action>
        </div>
        {create.isError ? <Notice tone="danger">{errorText(create.error)}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Action tone="secondary" onClick={onClose}>{t('hub.common.cancel')}</Action>
          <Action type="submit" busy={create.isPending} disabled={roles.length === 0}>{t('hub.staff.add')}</Action>
        </div>
      </form>
    </Dialog>
  );
}

/** Second facteur perdu : la prochaine connexion refait l'inscription ; les sessions du membre sont fermées. */
function ResetMfaDialog({ member, self, label, onClose, onDone }: { member: AdminStaff | null; self: boolean; label: string; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const reset = useMutation({ mutationFn: () => hubApi.admin.resetStaffMfa(member!.id), onSuccess: onDone });
  return (
    <Dialog open={member !== null} title={t('hub.staff.resetMfaTitle', { name: label })} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm">{t('hub.staff.resetMfaConfirm')}</p>
        {self ? <Notice tone="warning">{t('hub.staff.resetSelf')}</Notice> : null}
        {reset.isError ? <Notice tone="danger">{errorText(reset.error)}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Action tone="secondary" onClick={onClose}>{t('hub.common.cancel')}</Action>
          <Action tone="danger" busy={reset.isPending} onClick={() => reset.mutate()}>{t('hub.staff.resetMfa')}</Action>
        </div>
      </div>
    </Dialog>
  );
}

/** Nouveau mot de passe d'un membre : remet à zéro le verrouillage et ferme ses sessions. */
function PasswordDialog({ member, label, onClose, onDone }: { member: AdminStaff | null; label: string; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [password, setPassword] = useState('');
  const save = useMutation({ mutationFn: () => hubApi.admin.setStaffPassword(member!.id, password), onSuccess: onDone });
  return (
    <Dialog open={member !== null} title={t('hub.staff.setPasswordTitle', { name: label })} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <Field label={t('hub.staff.newPassword')}>{(p) => <Input {...p} type="text" required minLength={12} maxLength={200} autoComplete="new-password" spellCheck={false} className="font-mono" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
          <Action tone="secondary" onClick={() => setPassword(generatePassword())}>{t('hub.staff.generate')}</Action>
        </div>
        {save.isError ? <Notice tone="danger">{errorText(save.error)}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Action tone="secondary" onClick={onClose}>{t('hub.common.cancel')}</Action>
          <Action type="submit" busy={save.isPending}>{t('hub.common.save')}</Action>
        </div>
      </form>
    </Dialog>
  );
}
