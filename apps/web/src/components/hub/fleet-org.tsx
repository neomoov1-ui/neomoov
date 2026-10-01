'use client';

/**
 * Organisation courante des pages Flotte (étape 23) : choisie parmi les adhésions de la personne connectée
 * (`GET /v1/me/organizations`), mémorisée dans le navigateur. Les permissions effectives viennent de la fiche de
 * l'organisation (`GET /v1/org/:id`) ; l'API reste seule juge de chaque accès.
 */
import type { MyOrganization } from '@neomoov/domain';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorBlock, Loading } from '@/components/hub/common';
import { Field, Notice, Select } from '@/components/ui/kit';
import { fleetApi } from '@/lib/fleet-api';

const STORAGE_KEY = 'neomoov.hub.fleet.organization';

interface FleetOrg {
  organizationId: string;
  name: string;
  permissions: ReadonlySet<string>;
  can: (...permissions: string[]) => boolean;
}

const FleetOrgContext = createContext<FleetOrg | null>(null);

export function useFleetOrg(): FleetOrg {
  const value = useContext(FleetOrgContext);
  if (!value) throw new Error('useFleetOrg hors de FleetOrgProvider');
  return value;
}

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function FleetOrgProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const memberships = useQuery({ queryKey: ['fleet', 'me', 'organizations'], queryFn: () => fleetApi.myOrganizations() });
  const organizations = useMemo(() => {
    const seen = new Map<string, MyOrganization>();
    for (const m of memberships.data ?? []) if (!seen.has(m.organizationId) && m.type !== 'platform') seen.set(m.organizationId, m);
    return [...seen.values()];
  }, [memberships.data]);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (!organizations.length) return;
    const stored = readStored();
    setSelected((current) => current ?? (organizations.some((o) => o.organizationId === stored) ? stored : organizations[0]!.organizationId));
  }, [organizations]);
  const home = useQuery({ queryKey: ['fleet', 'home', selected], queryFn: () => fleetApi.home(selected!), enabled: Boolean(selected) });

  if (memberships.isPending) return <Loading />;
  if (memberships.isError) return <ErrorBlock error={memberships.error} onRetry={() => void memberships.refetch()} />;
  if (!organizations.length) return <Notice tone="warning">{t('fleet.selector.none')}</Notice>;
  const current = organizations.find((o) => o.organizationId === selected);
  const permissions = new Set(home.data?.permissions ?? []);
  const value: FleetOrg | null = current ? { organizationId: current.organizationId, name: current.name, permissions, can: (...codes) => codes.some((c) => permissions.has(c)) } : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-full max-w-sm">
          <Field label={t('fleet.selector.label')}>
            {(p) => (
              <Select
                {...p}
                value={selected ?? ''}
                onChange={(e) => {
                  setSelected(e.target.value);
                  try {
                    window.localStorage.setItem(STORAGE_KEY, e.target.value);
                  } catch {
                    // Stockage indisponible (navigation privée) : le choix vaut pour la page.
                  }
                }}
              >
                {organizations.map((o) => <option key={o.organizationId} value={o.organizationId}>{o.name}</option>)}
              </Select>
            )}
          </Field>
        </div>
        <p className="text-xs text-slate-600">{t('fleet.scope')}</p>
      </div>
      {value && home.data ? <FleetOrgContext.Provider value={value}>{children}</FleetOrgContext.Provider> : home.isError ? <ErrorBlock error={home.error} onRetry={() => void home.refetch()} /> : <Loading />}
    </div>
  );
}
