'use client';

/** Briques communes des modules de My Hub : utilisateur courant, langue, erreurs, filtres et listes paginées. */
import type { Page } from '@neomoov/domain';
import { keepPreviousData, useQuery, type QueryKey } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Action, Badge, Field, Input, Notice, Select, type BadgeTone } from '@/components/ui/kit';
import { ApiError, canWrite } from '@/lib/hub-api';
import type { Language } from '@/lib/i18n-resources';
import type { HubUser } from '@/lib/server/gateway';

export const HubUserContext = createContext<HubUser | null>(null);

export function useHubUser(): HubUser {
  const user = useContext(HubUserContext);
  if (!user) throw new Error('HubUserContext absent');
  return user;
}

export const useCanWrite = () => canWrite(useHubUser().roles);

export function useLang(): Language {
  const { i18n } = useTranslation();
  return i18n.language === 'en' ? 'en' : 'fr-CA';
}

/** Message d'erreur d'une action : rôle insuffisant traduit, sinon le message de l'API (code stable en repli). */
export function useErrorText() {
  const { t } = useTranslation();
  return (error: unknown): string => {
    if (error instanceof ApiError) {
      if (error.status === 403) return t('hub.common.forbidden');
      return error.message || error.code;
    }
    return t('hub.common.error');
  };
}

export function ErrorBlock({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  const text = useErrorText();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Notice tone="danger">{`${t('hub.common.error')} ${text(error)}`}</Notice>
      {onRetry ? <Action tone="secondary" onClick={onRetry}>{t('hub.common.retry')}</Action> : null}
    </div>
  );
}

export function Loading() {
  const { t } = useTranslation();
  return <p role="status" className="py-6 text-sm text-slate-600">{t('hub.common.loading')}</p>;
}

/** Valeur différée (recherche au fil de la frappe sans requête à chaque touche). */
export function useDebounced<T>(value: T, delay = 300): T {
  const [current, setCurrent] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setCurrent(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return current;
}

export interface ListFilters {
  page: number;
  q: string;
  status: string;
}

/** Liste paginée avec recherche et filtre d'état ; la page revient à 1 quand un filtre change. */
export function usePagedList<T>(key: string, fetcher: (query: { page: number; pageSize: number; q?: string; status?: string }) => Promise<Page<T>>, pageSize = 25, initialStatus = '') {
  const [filters, setFilters] = useState<ListFilters>({ page: 1, q: '', status: initialStatus });
  const q = useDebounced(filters.q.trim());
  const queryKey: QueryKey = ['hub', key, filters.page, q, filters.status];
  const query = useQuery({
    queryKey,
    queryFn: () => fetcher({ page: filters.page, pageSize, ...(q ? { q } : {}), ...(filters.status ? { status: filters.status } : {}) }),
    placeholderData: keepPreviousData,
  });
  return {
    query,
    filters,
    pageSize,
    setPage: (page: number) => setFilters((f) => ({ ...f, page })),
    setQ: (value: string) => setFilters((f) => ({ ...f, q: value, page: 1 })),
    setStatus: (value: string) => setFilters((f) => ({ ...f, status: value, page: 1 })),
  };
}

/** Barre de recherche et de filtre ; `allowAll` faux quand l'API exige un état (documents, approbations). */
export function ListToolbar({ filters, setQ, setStatus, statuses, allowAll = true }: { filters: ListFilters; setQ: (v: string) => void; setStatus?: (v: string) => void; statuses?: Array<{ value: string; label: string }>; allowAll?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="mb-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
      <Field label={t('hub.common.search')}>{(p) => <Input {...p} type="search" value={filters.q} onChange={(e) => setQ(e.target.value)} />}</Field>
      {statuses && setStatus ? (
        <Field label={t('hub.common.status')}>
          {(p) => (
            <Select {...p} value={filters.status} onChange={(e) => setStatus(e.target.value)}>
              {allowAll ? <option value="">{t('hub.common.all')}</option> : null}
              {statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
          )}
        </Field>
      ) : null}
    </div>
  );
}

const RIDE_TONES: Record<string, BadgeTone> = {
  requested: 'info', offering: 'warning', assigned: 'info', en_route: 'info', arrived: 'info', in_progress: 'success', completed: 'success', rated: 'success',
  disputed: 'danger', no_driver: 'danger', cancelled_by_client: 'neutral', cancelled_by_driver: 'warning', no_show: 'warning', interrupted: 'danger', expired: 'neutral', quoted: 'neutral',
};

export function RideStateBadge({ state }: { state: string }) {
  const { t } = useTranslation();
  return <Badge tone={RIDE_TONES[state] ?? 'neutral'}>{t(`enum.rideState.${state}`)}</Badge>;
}

const STATUS_TONES: Record<string, BadgeTone> = {
  pending: 'warning', active: 'success', approved: 'success', rejected: 'danger', expired: 'danger', suspended: 'danger', restricted: 'warning', offboarded: 'neutral',
  non_compliant: 'danger', retired: 'neutral', open: 'danger', investigating: 'warning', decided: 'info', closed: 'neutral', overdue: 'danger', done: 'success',
  new: 'info', contacted: 'warning', converted: 'success', discarded: 'neutral', low: 'neutral', medium: 'warning', high: 'danger', critical: 'danger',
};

/** Badge d'une valeur d'énumération traduite (`enum.<groupe>.<valeur>`), teinte selon la valeur. */
export function EnumBadge({ group, value }: { group: string; value: string }) {
  const { t } = useTranslation();
  return <Badge tone={STATUS_TONES[value] ?? 'neutral'}>{t(`enum.${group}.${value}`)}</Badge>;
}

export function pageLabels(t: (key: string, options?: Record<string, unknown>) => string, page: number, pageSize: number, total: number) {
  return { previous: t('hub.common.previous'), next: t('hub.common.next'), pageOf: t('hub.common.pageOf', { page, pages: Math.max(1, Math.ceil(total / pageSize)) }) };
}
