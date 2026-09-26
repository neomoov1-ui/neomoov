'use client';

import { AGENT_CODES, API_KEY_SCOPES, type AgentCode, type ApiKeyCreated, type ApiKeyScope, type ApiKeyView } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading, useErrorText, useHubUser, useLang } from '@/components/hub/common';
import { Action, Badge, Card, Checkbox, DataTable, Dialog, Field, Input, Notice, PageTitle, Select, type BadgeTone } from '@/components/ui/kit';
import { formatDate, formatDateTime, montrealToIso } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

type KeyState = 'active' | 'revoked' | 'expired';
const STATE_TONES: Record<KeyState, BadgeTone> = { active: 'success', revoked: 'neutral', expired: 'warning' };

const stateOf = (key: ApiKeyView, now = Date.now()): KeyState => (key.revokedAt ? 'revoked' : key.expiresAt && Date.parse(key.expiresAt) <= now ? 'expired' : 'active');
/** Clé de traduction d'une portée (`agents:run` devient `agents_run`, `tools:*` devient `tools_all`) : « : » sépare les espaces de noms d'i18next. */
const scopeKey = (scope: ApiKeyScope) => scope.replace(':', '_').replace('*', 'all');

/**
 * Clés de service (administrateur) : comptes de service des agents IA et des intégrations (site web, WordPress). Le
 * secret `nmk_…` n'est affiché qu'une fois, à la création, et n'est gardé que dans l'état du dialogue.
 */
export default function ApiKeysPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const admin = useHubUser().roles.includes('admin');
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const keys = useQuery({ queryKey: ['hub', 'api-keys'], queryFn: () => hubApi.admin.apiKeys(), enabled: admin });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['hub', 'api-keys'] });

  if (!admin) {
    return (
      <div>
        <PageTitle title={t('hub.apiKeys.title')} />
        <Notice tone="info">{t('hub.apiKeys.adminOnly')}</Notice>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <PageTitle title={t('hub.apiKeys.title')} subtitle={t('hub.apiKeys.intro')} actions={<Action onClick={() => { setCreating(true); setNotice(null); }}>{t('hub.apiKeys.create')}</Action>} />
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      <Card>
        {keys.isPending ? <Loading /> : keys.isError ? <ErrorBlock error={keys.error} onRetry={() => void keys.refetch()} /> : (
          <DataTable
            caption={t('hub.apiKeys.title')}
            rows={keys.data}
            rowKey={(k) => k.id}
            empty={t('hub.common.empty')}
            columns={[
              { key: 'name', header: t('hub.apiKeys.name'), cell: (k) => <span><strong>{k.name}</strong><code className="mt-0.5 block text-xs text-slate-600">{`nmk_${k.prefix}_…`}</code></span> },
              { key: 'scopes', header: t('hub.apiKeys.scopes'), cell: (k) => <span className="flex max-w-80 flex-wrap gap-1">{k.scopes.map((s) => <Badge key={s} tone="info">{s}</Badge>)}</span> },
              { key: 'agent', header: t('hub.apiKeys.agent'), cell: (k) => (k.agentCode ? t(`hub.apiKeys.agents.${k.agentCode}`) : '') },
              { key: 'created', header: t('hub.apiKeys.createdAt'), cell: (k) => formatDate(k.createdAt, lang) },
              { key: 'used', header: t('hub.apiKeys.lastUsed'), cell: (k) => formatDateTime(k.lastUsedAt, lang) },
              { key: 'expires', header: t('hub.apiKeys.expires'), cell: (k) => (k.expiresAt ? formatDate(k.expiresAt, lang) : t('hub.apiKeys.never')) },
              { key: 'state', header: t('hub.apiKeys.state'), cell: (k) => { const state = stateOf(k); return <Badge tone={STATE_TONES[state]}>{t(`hub.apiKeys.states.${state}`)}</Badge>; } },
              { key: 'actions', header: t('hub.common.actions'), cell: (k) => (k.revokedAt ? null : <Action tone="secondary" onClick={() => { setRevoking(k); setNotice(null); }}>{t('hub.apiKeys.revoke')}</Action>) },
            ]}
          />
        )}
      </Card>
      <CreateKeyDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(key) => {
          setCreating(false);
          setCreated(key);
          refresh();
        }}
      />
      <CreatedKeyDialog created={created} onClose={() => setCreated(null)} />
      <RevokeDialog
        key={revoking?.id ?? 'none'}
        apiKey={revoking}
        onClose={() => setRevoking(null)}
        onDone={() => {
          setRevoking(null);
          setNotice(t('hub.apiKeys.revoked'));
          refresh();
        }}
      />
    </div>
  );
}

function CreateKeyDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (key: ApiKeyCreated) => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiKeyScope[]>([]);
  const [agentCode, setAgentCode] = useState<AgentCode | ''>('');
  const [expiresOn, setExpiresOn] = useState('');
  const create = useMutation({
    // Expiration à la fin du jour choisi, heure de Montréal.
    mutationFn: () => hubApi.admin.createApiKey({ name: name.trim(), scopes, ...(agentCode ? { agentCode } : {}), ...(expiresOn ? { expiresAt: montrealToIso(expiresOn, '23:59') } : {}) }),
  });
  // Le secret passe au dialogue d'affichage, puis la mutation est remise à zéro : il ne reste pas dans son cache.
  const submit = () => create.mutate(undefined, {
    onSuccess: (key) => {
      setName('');
      setScopes([]);
      setAgentCode('');
      setExpiresOn('');
      create.reset();
      onCreated(key);
    },
  });
  const toggle = (scope: ApiKeyScope, checked: boolean) => setScopes((current) => (checked ? [...current, scope] : current.filter((s) => s !== scope)));
  return (
    <Dialog open={open} title={t('hub.apiKeys.create')} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label={t('hub.apiKeys.name')}>{(p) => <Input {...p} required minLength={2} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <div role="group" aria-label={t('hub.apiKeys.scopes')}>
          <p className="mb-1 text-sm font-semibold text-brand-ink">{t('hub.apiKeys.scopes')}</p>
          <div className="flex flex-col gap-1">
            {API_KEY_SCOPES.map((s) => <Checkbox key={s} label={<span><code className="text-xs">{s}</code> · {t(`hub.apiKeys.scopeHints.${scopeKey(s)}`)}</span>} checked={scopes.includes(s)} onChange={(e) => toggle(s, e.target.checked)} />)}
          </div>
          {scopes.length === 0 ? <p className="mt-1 text-xs text-slate-600">{t('hub.apiKeys.scopeRequired')}</p> : null}
        </div>
        <Field label={t('hub.apiKeys.agent')}>
          {(p) => (
            <Select {...p} value={agentCode} onChange={(e) => setAgentCode(e.target.value as AgentCode | '')}>
              <option value="">{t('hub.apiKeys.noAgent')}</option>
              {AGENT_CODES.map((code) => <option key={code} value={code}>{t(`hub.apiKeys.agents.${code}`)}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('hub.apiKeys.expiresOn')}>{(p) => <Input {...p} type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />}</Field>
        {create.isError ? <Notice tone="danger">{errorText(create.error)}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Action tone="secondary" onClick={onClose}>{t('hub.common.cancel')}</Action>
          <Action type="submit" busy={create.isPending} disabled={scopes.length === 0}>{t('hub.apiKeys.create')}</Action>
        </div>
      </form>
    </Dialog>
  );
}

/** Secret affiché une seule fois : il disparaît de l'écran (et de la mémoire de la page) à la fermeture du dialogue. */
function CreatedKeyDialog({ created, onClose }: { created: ApiKeyCreated | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const close = () => {
    setCopied(false);
    onClose();
  };
  const copy = () => {
    if (!created) return;
    void navigator.clipboard?.writeText(created.key).then(() => setCopied(true), () => setCopied(false));
  };
  return (
    <Dialog open={created !== null} title={t('hub.apiKeys.createdTitle')} onClose={close}>
      {created ? (
        <div className="flex flex-col gap-3">
          <Notice tone="warning">{t('hub.apiKeys.createdHint')}</Notice>
          <Field label={t('hub.apiKeys.secret')}>{(p) => <Input {...p} readOnly spellCheck={false} autoComplete="off" className="font-mono text-xs" value={created.key} onFocus={(e) => e.target.select()} />}</Field>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {copied ? <span role="status" className="text-sm text-green-900">{t('hub.apiKeys.copied')}</span> : null}
            <Action tone="secondary" onClick={copy}>{t('hub.apiKeys.copy')}</Action>
            <Action onClick={close}>{t('hub.apiKeys.done')}</Action>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

function RevokeDialog({ apiKey, onClose, onDone }: { apiKey: ApiKeyView | null; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const revoke = useMutation({ mutationFn: () => hubApi.admin.revokeApiKey(apiKey!.id), onSuccess: onDone });
  return (
    <Dialog open={apiKey !== null} title={t('hub.apiKeys.revokeTitle', { name: apiKey?.name ?? '' })} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm">{t('hub.apiKeys.revokeConfirm')}</p>
        {revoke.isError ? <Notice tone="danger">{errorText(revoke.error)}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Action tone="secondary" onClick={onClose}>{t('hub.common.cancel')}</Action>
          <Action tone="danger" busy={revoke.isPending} onClick={() => revoke.mutate()}>{t('hub.apiKeys.revoke')}</Action>
        </div>
      </div>
    </Dialog>
  );
}
