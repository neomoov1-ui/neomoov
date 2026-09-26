'use client';

import type { AdminSetting } from '@neomoov/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading, useDebounced, useErrorText, useHubUser, useLang } from '@/components/hub/common';
import { Action, Card, DataTable, Dialog, Field, Input, Notice, PageTitle, Textarea } from '@/components/ui/kit';
import { formatDateTime } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';

/**
 * Paramètres de la plateforme (drapeaux, préavis, limites, gabarits, version de la politique de confidentialité) :
 * valeurs JSON typées par l'API. Les secrets ne sont jamais ici (fichier d'environnement du serveur).
 */
export default function SettingsPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const user = useHubUser();
  const writable = user.roles.includes('admin');
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('');
  const q = useDebounced(filter.trim());
  const settings = useQuery({ queryKey: ['hub', 'settings', q], queryFn: () => hubApi.admin.settings(q || undefined) });
  const [editing, setEditing] = useState<AdminSetting | null>(null);
  const [raw, setRaw] = useState('');
  const [invalid, setInvalid] = useState(false);
  const save = useMutation({
    mutationFn: (value: unknown) => hubApi.admin.updateSetting(editing!.key, value),
    onSuccess: () => {
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ['hub', 'settings'] });
    },
  });
  const submit = () => {
    try {
      const value: unknown = JSON.parse(raw);
      setInvalid(false);
      save.mutate(value);
    } catch {
      setInvalid(true);
    }
  };
  return (
    <div>
      <PageTitle title={t('hub.settings.title')} />
      <Card>
        <div className="mb-3 max-w-md"><Field label={t('hub.settings.filter')}>{(p) => <Input {...p} type="search" value={filter} onChange={(e) => setFilter(e.target.value)} />}</Field></div>
        {settings.isPending ? <Loading /> : settings.isError ? <ErrorBlock error={settings.error} onRetry={() => void settings.refetch()} /> : (
          <DataTable
            caption={t('hub.settings.title')}
            rows={settings.data}
            rowKey={(s) => s.key}
            empty={t('hub.common.empty')}
            columns={[
              { key: 'key', header: t('hub.settings.key'), cell: (s) => <code className="text-xs">{s.key}</code> },
              { key: 'value', header: t('hub.settings.value'), cell: (s) => <code className="block max-w-80 truncate text-xs">{JSON.stringify(s.value)}</code> },
              { key: 'description', header: t('hub.settings.description'), cell: (s) => <span className="text-xs">{s.description ?? ''}</span> },
              { key: 'updated', header: t('hub.settings.updated'), cell: (s) => formatDateTime(s.updatedAt, lang) },
              ...(writable ? [{ key: 'edit', header: t('hub.common.actions'), cell: (s: AdminSetting) => <Action tone="secondary" onClick={() => { setEditing(s); setRaw(JSON.stringify(s.value, null, 2)); setInvalid(false); save.reset(); }}>{t('hub.settings.edit')}</Action> }] : []),
            ]}
          />
        )}
      </Card>
      <Dialog open={editing !== null} title={editing?.key ?? ''} onClose={() => setEditing(null)}>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          {editing?.description ? <p className="text-sm text-slate-700">{editing.description}</p> : null}
          <Field label={t('hub.settings.value')} error={invalid ? t('hub.settings.invalidJson') : null}>{(p) => <Textarea {...p} className="font-mono" rows={6} value={raw} onChange={(e) => setRaw(e.target.value)} />}</Field>
          {save.isError ? <Notice tone="danger">{errorText(save.error)}</Notice> : null}
          <div className="flex justify-end gap-2">
            <Action tone="secondary" onClick={() => setEditing(null)}>{t('hub.common.cancel')}</Action>
            <Action type="submit" busy={save.isPending}>{t('hub.common.save')}</Action>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
