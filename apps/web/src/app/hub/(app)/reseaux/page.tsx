'use client';

import type { SocialAccountView, SocialSpace } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading, useCanWrite, useErrorText, useLang } from '@/components/hub/common';
import { Action, Badge, Card, Checkbox, Field, Input, Notice, PageTitle, Select, type BadgeTone } from '@/components/ui/kit';
import { formatDateTime } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';
import { ENV_SET, PROCEDURES } from './procedures';

const STATUS_TONES: Record<SocialAccountView['status'], BadgeTone> = { connected: 'success', pending_approval: 'warning', invalid: 'danger', expired: 'danger', not_connected: 'neutral' };

/** Logo texte de chaque réseau : initiales sur la couleur du réseau (aucune image de marque embarquée). */
const LOGOS: Record<SocialSpace, { text: string; className: string }> = {
  site_blog: { text: 'N', className: 'bg-brand-blue-dark text-white' },
  facebook: { text: 'f', className: 'bg-[#1877F2] text-white' },
  instagram: { text: 'IG', className: 'bg-gradient-to-br from-[#F58529] via-[#DD2A7B] to-[#8134AF] text-white' },
  linkedin: { text: 'in', className: 'bg-[#0A66C2] text-white' },
  x: { text: 'X', className: 'bg-black text-white' },
  tiktok: { text: 'TT', className: 'bg-black text-[#25F4EE]' },
  snapchat: { text: 'S', className: 'bg-[#FFFC00] text-black' },
  telegram: { text: 'TG', className: 'bg-[#229ED9] text-white' },
  youtube: { text: '▶', className: 'bg-[#FF0000] text-white' },
  whatsapp_channel: { text: 'WA', className: 'bg-[#25D366] text-white' },
};

/**
 * Réseaux sociaux (3 octobre 2026) : les dix comptes de Neomoov sur des cartes (état coloré, compte relié, dernière
 * validation, connexion, revalidation, déconnexion, mode, lien public, « afficher sur le site »), et pour chaque carte la
 * procédure « Comment connecter ». Le retour d'un écran d'autorisation arrive ici (`?connecte=`, `?erreur=`, `?choisir=`).
 */
export default function SocialNetworksPage() {
  const { t } = useTranslation();
  const params = useSearchParams();
  const accounts = useQuery({ queryKey: ['hub', 'social'], queryFn: () => hubApi.social.accounts() });
  const label = (space: string | null) => accounts.data?.find((a) => a.space === space)?.label ?? space ?? '';
  const connected = params.get('connecte');
  const error = params.get('erreur');
  const choose = params.get('choisir') ? params.get('reseau') : null;
  const errorKey = error && ['refus', 'autorisation', 'application', 'echange', 'aucun-compte'].includes(error) ? error : 'generic';
  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={t('hub.social.title')} subtitle={t('hub.social.subtitle')} />
      {connected ? <Notice tone="success">{t('hub.social.returned.connected', { name: label(connected) })}</Notice> : null}
      {error ? <Notice tone="danger">{label(params.get('reseau'))} : {t(`hub.social.errors.${errorKey}`)}</Notice> : null}
      {choose ? <Notice tone="info">{t('hub.social.returned.choose', { name: label(choose) })}</Notice> : null}
      {accounts.isPending ? <Loading /> : accounts.isError ? <ErrorBlock error={accounts.error} onRetry={() => void accounts.refetch()} /> : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {accounts.data.map((account) => <SocialCard key={account.space} account={account} />)}
        </div>
      )}
    </div>
  );
}

function SocialCard({ account }: { account: SocialAccountView }) {
  const { t } = useTranslation();
  const lang = useLang();
  const writable = useCanWrite();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [botToken, setBotToken] = useState('');
  const [channel, setChannel] = useState('');
  const [link, setLink] = useState(account.profileUrl ?? '');
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const space = account.space;
  const procedure = PROCEDURES[lang][space];
  const manual = account.mode === 'manual';
  const logo = LOGOS[space];

  const done = (view: SocialAccountView) => {
    queryClient.setQueryData<SocialAccountView[]>(['hub', 'social'], (list) => list?.map((a) => (a.space === view.space ? view : a)));
    // Facebook et Instagram partagent un parcours : la liste entière est relue.
    void queryClient.invalidateQueries({ queryKey: ['hub', 'social'] });
    setMessage(t('hub.social.saved'));
  };
  const connect = useMutation({ mutationFn: () => hubApi.social.connect(space), onSuccess: (r) => window.location.assign(r.url) });
  const validate = useMutation({ mutationFn: () => hubApi.social.validate(space), onSuccess: done });
  const disconnect = useMutation({ mutationFn: () => hubApi.social.disconnect(space), onSuccess: (view) => { setLink(''); done(view); } });
  const update = useMutation({ mutationFn: (body: Parameters<typeof hubApi.social.update>[1]) => hubApi.social.update(space, body), onSuccess: done });
  const telegram = useMutation({ mutationFn: () => hubApi.social.connectTelegram({ botToken: botToken.trim(), channel: channel.trim() }), onSuccess: (view) => { setBotToken(''); done(view); } });
  const saveLink = useMutation({ mutationFn: () => hubApi.social.setLink(space, link.trim()), onSuccess: done });
  const select = useMutation({ mutationFn: (accountId: string) => hubApi.social.select(space, accountId), onSuccess: done });
  const failed = [connect, validate, disconnect, update, telegram, saveLink, select].find((m) => m.isError);
  // Compte relié (ou identifiants posés sur le serveur) : revalidation et lien public proposés.
  const linked = account.credentialSource !== 'none' || ['connected', 'invalid', 'expired'].includes(account.status);
  const replace = (text: string) => text.replaceAll('{{callback}}', account.callbackUrl ?? '');

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Presse-papiers refusé par le navigateur : l'adresse reste affichée et sélectionnable.
    }
  };

  return (
    <Card
      title={(
        <span className="flex items-center gap-3">
          <span aria-hidden className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${logo.className}`}>{logo.text}</span>
          <span>{account.label}</span>
        </span>
      )}
      actions={<Badge tone={STATUS_TONES[account.status]}>{t(`hub.social.status.${account.status}`)}</Badge>}
    >
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-slate-600">{procedure.summary}</p>
        <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
          <dt className="text-slate-600">{t('hub.social.account')}</dt>
          <dd>
            {account.accountName ?? <span className="text-slate-500">{t('hub.social.none')}</span>}
            {account.profileUrl ? <a href={account.profileUrl} target="_blank" rel="noreferrer" className="block break-all text-xs text-brand-blue-dark underline">{account.profileUrl}</a> : null}
          </dd>
          <dt className="text-slate-600">{t('hub.social.lastValidated')}</dt>
          <dd>{account.lastValidatedAt ? formatDateTime(account.lastValidatedAt, lang) : t('hub.social.never')}</dd>
          {account.expiresAt ? (<><dt className="text-slate-600">{t('hub.social.expires')}</dt><dd>{formatDateTime(account.expiresAt, lang)}</dd></>) : null}
        </dl>
        {account.lastError ? <Notice tone="danger">{account.lastError}</Notice> : null}
        {account.status === 'pending_approval' ? <Notice tone="warning">{t('hub.social.pendingHint', { name: account.label })}</Notice> : null}
        {account.credentialSource === 'environment' && account.connection !== 'wordpress' ? <p className="text-xs text-slate-600">{t('hub.social.envSource')}</p> : null}
        {account.connection === 'wordpress' ? <p className="text-xs text-slate-600">{t('hub.social.blogHint')}</p> : null}
        {manual ? <p className="text-xs text-slate-600">{t('hub.social.manualHint')}</p> : null}
        {!account.appConfigured && account.connection === 'oauth' && !manual ? <Notice tone="warning">{t('hub.social.appMissing', { variables: account.appVariables.join(', ') })}</Notice> : null}

        {writable && account.candidates.length ? (
          <div className="flex flex-col gap-2 rounded-md border border-brand-blue-dark/30 p-3">
            <p className="font-medium">{t('hub.social.choose')}</p>
            {account.candidates.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{c.name}{c.detail ? <span className="block text-xs text-slate-600">{c.detail}</span> : null}</span>
                <Action tone="secondary" busy={select.isPending && select.variables === c.id} onClick={() => select.mutate(c.id)}>{t('hub.social.chooseAction')}</Action>
              </div>
            ))}
          </div>
        ) : null}

        {writable ? (
          <div className="flex flex-col gap-3">
            {account.modes.length > 1 ? (
              <Field label={t('hub.social.mode')}>
                {(p) => (
                  <Select {...p} value={account.mode} disabled={update.isPending} onChange={(e) => update.mutate({ mode: e.target.value as 'direct' | 'manual' })}>
                    {account.modes.filter((m) => m !== 'aggregator').map((m) => <option key={m} value={m}>{t(`hub.social.modes.${m}`)}</option>)}
                  </Select>
                )}
              </Field>
            ) : null}

            {account.connection === 'telegram' && !manual ? (
              <div className="flex flex-col gap-2">
                <Field label={t('hub.social.telegramToken')} hint={t('hub.social.telegramHint')}>{(p) => <Input {...p} type="password" autoComplete="off" value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder="123456789:AA…" />}</Field>
                <Field label={t('hub.social.telegramChannel')}>{(p) => <Input {...p} value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="@neomoov" />}</Field>
                <Action busy={telegram.isPending} disabled={!botToken.trim() || !channel.trim()} onClick={() => telegram.mutate()}>{t('hub.social.telegramConnect')}</Action>
              </div>
            ) : null}

            {account.connection === 'manual' || manual || linked ? (
              <div className="flex flex-col gap-2">
                <Field label={t('hub.social.link')}>{(p) => <Input {...p} type="url" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder={`https://${account.space === 'site_blog' ? 'neomoov.net' : PROCEDURE_HOSTS[space]}/…`} />}</Field>
                <Action tone="secondary" busy={saveLink.isPending} disabled={!link.trim() || link.trim() === account.profileUrl} onClick={() => saveLink.mutate()}>{t('hub.social.saveLink')}</Action>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {account.connection === 'oauth' && !manual ? (
                <Action busy={connect.isPending} disabled={!account.appConfigured} onClick={() => connect.mutate()}>{linked && account.status !== 'pending_approval' ? t('hub.social.reconnect') : t('hub.social.connect')}</Action>
              ) : null}
              {linked && !manual ? <Action tone="secondary" busy={validate.isPending} onClick={() => validate.mutate()}>{t('hub.social.revalidate')}</Action> : null}
              {account.connection !== 'wordpress' && (account.accountId || account.profileUrl) ? (
                <Action tone="danger" busy={disconnect.isPending} onClick={() => { if (window.confirm(t('hub.social.confirmDisconnect', { name: account.label }))) disconnect.mutate(); }}>{t('hub.social.disconnect')}</Action>
              ) : null}
            </div>

            <Checkbox label={t('hub.social.showOnSite')} checked={account.showOnSite} disabled={update.isPending} onChange={(e) => update.mutate({ showOnSite: e.target.checked })} />
            {account.requiresApproval ? <Checkbox label={t('hub.social.appApproved')} checked={account.appApproved} disabled={update.isPending} onChange={(e) => update.mutate({ appApproved: e.target.checked })} /> : null}
          </div>
        ) : null}

        {message && !failed ? <Notice tone="success">{message}</Notice> : null}
        {failed ? <Notice tone="danger">{errorText(failed.error)}</Notice> : null}

        <details className="rounded-md bg-slate-50 p-3">
          <summary className="cursor-pointer font-medium text-brand-blue-dark">{t('hub.social.howTo')}</summary>
          <div className="mt-3 flex flex-col gap-3">
            {account.callbackUrl ? (
              <div>
                <p className="text-xs font-medium text-slate-700">{t('hub.social.callback')}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <code className="break-all rounded bg-white px-2 py-1 text-xs">{account.callbackUrl}</code>
                  <Action tone="ghost" onClick={() => void copy(account.callbackUrl!)}>{copied ? t('hub.social.copied') : t('hub.social.copy')}</Action>
                </div>
              </div>
            ) : null}
            <ol className="list-decimal space-y-1 pl-5">
              {procedure.steps.map((step) => <li key={step}>{replace(step)}</li>)}
            </ol>
            {account.appVariables.length ? (
              <div>
                <p className="text-xs text-slate-700">{t('hub.social.serverCommand')} <code>{account.appVariables.join(', ')}</code></p>
                <code className="mt-1 block break-all rounded bg-white px-2 py-1 text-xs">{ENV_SET}</code>
              </div>
            ) : null}
            {procedure.approval ? <p><strong>{t('hub.social.approval')} : </strong>{procedure.approval}</p> : null}
            <p><strong>{t('hub.social.automatic')} : </strong>{procedure.automatic}</p>
          </div>
        </details>
      </div>
    </Card>
  );
}

/** Exemple de domaine pour le lien public (indication dans le champ). */
const PROCEDURE_HOSTS: Record<SocialSpace, string> = {
  site_blog: 'neomoov.net', facebook: 'www.facebook.com', instagram: 'www.instagram.com', linkedin: 'www.linkedin.com', x: 'x.com', tiktok: 'www.tiktok.com',
  snapchat: 'www.snapchat.com', telegram: 't.me', youtube: 'www.youtube.com', whatsapp_channel: 'whatsapp.com',
};
