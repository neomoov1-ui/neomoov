'use client';

/**
 * État CRM d'une fiche (étape 25) : objets créés chez le fournisseur (contact, entreprise, transaction, note), état de la
 * synchronisation, tentatives et dernière erreur. Chargé à la demande (`lazy`) dans les listes, pour ne pas lancer une
 * requête par ligne ; tout de suite dans une fiche ouverte.
 */
import type { CrmRecordsView } from '@neomoov/domain';
import type { CrmRecordKind } from '@neomoov/api-client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Action, Badge, type BadgeTone } from '@/components/ui/kit';
import { formatDateTime } from '@/lib/format';
import { hubApi } from '@/lib/hub-api';
import type { Language } from '@/lib/i18n-resources';
import { ErrorBlock, Loading, useLang } from './common';

const TONES: Record<string, BadgeTone> = { synced: 'success', pending: 'info', error: 'danger', skipped: 'neutral' };

export function CrmStatus({ kind, entityId, lazy = false }: { kind: CrmRecordKind; entityId: string; lazy?: boolean }) {
  const { t } = useTranslation();
  const lang = useLang();
  const [open, setOpen] = useState(!lazy);
  const records = useQuery({ queryKey: ['hub', 'crm', kind, entityId], queryFn: () => hubApi.admin.crmRecords(kind, entityId), enabled: open, retry: false });
  if (!open) return <Action tone="ghost" onClick={() => setOpen(true)}>{t('hub.crm.show')}</Action>;
  if (records.isPending) return <Loading />;
  if (records.isError) return <ErrorBlock error={records.error} />;
  return <CrmRecordsList view={records.data} lang={lang} />;
}

/** Liste des objets CRM d'une fiche ; exportée pour les tests de rendu. */
export function CrmRecordsList({ view, lang }: { view: CrmRecordsView; lang: Language }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1 text-xs" data-testid="crm-status">
      <span className="text-slate-700">{t('hub.crm.provider', { provider: view.provider })}</span>
      {view.records.length === 0 ? <span className="text-slate-700">{t('hub.crm.none')}</span> : (
        <ul className="flex flex-col gap-1">
          {view.records.map((r) => (
            <li key={r.objectType}>
              <span className="font-semibold">{t(`hub.crm.objects.${r.objectType}`)}</span>{' '}
              <Badge tone={TONES[r.status] ?? 'neutral'}>{t(`hub.crm.statuses.${r.status}`)}</Badge>
              {r.externalId ? <code className="ml-1">{r.externalId}</code> : null}
              {r.attempts ? <span className="ml-1">{t('hub.crm.attempts', { count: r.attempts })}</span> : null}
              {r.lastSyncedAt ? <span className="block text-slate-700">{t('hub.crm.lastSynced', { date: formatDateTime(r.lastSyncedAt, lang) })}</span> : null}
              {r.error ? <span className="block text-red-800">{r.error}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
