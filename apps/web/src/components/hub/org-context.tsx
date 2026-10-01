'use client';

/**
 * Étape 21 : espace d'une organisation cliente dans My Hub. Sélecteur d'organisation (adhésions de `GET /v1/me/organizations`,
 * accès du support en cours pour le personnel, organisation ouverte depuis l'arbre), mémorisé dans le navigateur ; fiche
 * de l'organisation (`GET /v1/org/:id` : permissions effectives, double authentification, accès du support) ; menu limité
 * aux entrées que ces permissions ouvrent. L'API reste juge : un menu masqué n'est qu'un confort.
 */
import type { OrganizationHome } from '@neomoov/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Action, Field, Notice, Select, cx, focus } from '@/components/ui/kit';
import { formatDateTime } from '@/lib/format';
import { hubApi, isStaffUser } from '@/lib/hub-api';
import { useHubUser, useLang } from './common';

export interface OrgChoice {
  organizationId: string;
  name: string;
  label: string;
  support: boolean;
}

interface OrgContextValue {
  choices: OrgChoice[];
  orgId: string;
  current: OrgChoice | null;
  home: OrganizationHome | null;
  loading: boolean;
  error: unknown;
  /** Au moins une des permissions (sémantique des routes). */
  can: (...permissions: string[]) => boolean;
  select: (organizationId: string, name?: string) => void;
  refresh: () => void;
}

const OrgContext = createContext<OrgContextValue | null>(null);
const STORAGE_KEY = 'nm_hub_org';

function stored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function remember(id: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Stockage indisponible (navigation privée) : le choix vaut pour la page.
  }
}

export function useOrg(): OrgContextValue {
  const value = useContext(OrgContext);
  if (!value) throw new Error('OrgContext absent');
  return value;
}

export function OrgProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const user = useHubUser();
  const staff = isStaffUser(user.roles);
  const queryClient = useQueryClient();
  const mine = useQuery({ queryKey: ['org', 'mine'], queryFn: () => hubApi.org.mine() });
  // Personnel : accès du support approuvés et en cours (403 sans `support.access` : aucun).
  const grants = useQuery({ queryKey: ['org', 'support-grants'], queryFn: () => hubApi.supportAccess.list({ status: 'approved' }), enabled: staff, retry: false });
  const [selected, setSelected] = useState<string | null>(null);
  const [opened, setOpened] = useState<OrgChoice[]>([]);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('org');
    setSelected(fromUrl ?? stored());
  }, []);

  const choices = useMemo<OrgChoice[]>(() => {
    const list: OrgChoice[] = (mine.data ?? []).map((m) => ({ organizationId: m.organizationId, name: m.name, label: `${m.name} · ${m.roleName}`, support: false }));
    for (const g of grants.data ?? []) {
      if (g.active && g.requestedByUserId === user.id && !list.some((c) => c.organizationId === g.organizationId)) {
        list.push({ organizationId: g.organizationId, name: g.organizationName, label: `${g.organizationName} · ${t('org.shell.support')}`, support: true });
      }
    }
    for (const o of opened) if (!list.some((c) => c.organizationId === o.organizationId)) list.push(o);
    return list;
  }, [mine.data, grants.data, opened, user.id, t]);

  const current = choices.find((c) => c.organizationId === selected) ?? choices[0] ?? null;
  const orgId = current?.organizationId ?? '';
  const home = useQuery({ queryKey: ['org', orgId, 'home'], queryFn: () => hubApi.org.home(orgId), enabled: Boolean(orgId), retry: false });

  const select = useCallback((organizationId: string, name?: string) => {
    if (name) setOpened((list) => (list.some((o) => o.organizationId === organizationId) ? list : [...list, { organizationId, name, label: name, support: false }]));
    setSelected(organizationId);
    remember(organizationId);
  }, []);

  const value: OrgContextValue = {
    choices,
    orgId,
    current,
    home: home.data ?? null,
    loading: mine.isPending || (Boolean(orgId) && home.isPending),
    error: mine.error ?? home.error,
    can: (...permissions) => permissions.some((p) => home.data?.permissions.includes(p) ?? false),
    select,
    refresh: () => void queryClient.invalidateQueries({ queryKey: ['org'] }),
  };
  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

/** Menu de l'espace organisation : chaque entrée n'apparaît que si une de ses permissions est détenue. */
const ORG_NAV: Array<{ group: string; items: Array<{ key: string; href: string; permissions: string[] }> }> = [
  {
    group: 'activity',
    items: [
      { key: 'dashboard', href: '/hub/organisation', permissions: ['dashboard.read', 'rides.read', 'drivers.read', 'statements.read'] },
      { key: 'rides', href: '/hub/organisation/courses', permissions: ['rides.read'] },
      { key: 'drivers', href: '/hub/organisation/chauffeurs', permissions: ['drivers.read'] },
      { key: 'vehicles', href: '/hub/organisation/vehicules', permissions: ['vehicles.read'] },
      { key: 'statements', href: '/hub/organisation/releves', permissions: ['statements.read'] },
    ],
  },
  {
    group: 'team',
    items: [
      { key: 'members', href: '/hub/organisation/membres', permissions: ['members.read', 'members.invite'] },
      { key: 'roles', href: '/hub/organisation/roles', permissions: ['roles.read', 'roles.manage'] },
      { key: 'organizations', href: '/hub/organisation/sous-organisations', permissions: ['organizations.read', 'organizations.manage'] },
    ],
  },
  {
    group: 'admin',
    items: [
      { key: 'audit', href: '/hub/organisation/journal', permissions: ['audit.read'] },
      { key: 'support', href: '/hub/organisation/support', permissions: ['audit.read', 'members.manage'] },
      { key: 'security', href: '/hub/organisation/securite', permissions: [] },
    ],
  },
];

export function OrgNav({ onNavigate }: { onNavigate: () => void }) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const { can, home } = useOrg();
  const staff = isStaffUser(useHubUser().roles);
  const active = (href: string) => (href === '/hub/organisation' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
  const visible = (item: { key: string; permissions: string[] }) => (item.key === 'security' ? !home?.supportAccess : can(...item.permissions));
  return (
    <nav aria-label={t('org.shell.space')} className="px-2 pb-6">
      {ORG_NAV.map((section) => {
        const items = section.items.filter(visible);
        if (!items.length) return null;
        return (
          <div key={section.group} className="mt-3">
            <p className="px-2 text-[11px] font-bold uppercase tracking-widest text-slate-300">{t(`org.nav.groups.${section.group}`)}</p>
            <ul className="mt-1">
              {items.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} onClick={onNavigate} aria-current={active(item.href) ? 'page' : undefined} className={cx('block rounded-md px-2 py-1.5 text-sm', focus, active(item.href) ? 'bg-white font-semibold text-brand-night' : 'text-slate-100 hover:bg-white/10')}>
                    {t(`org.nav.${item.key}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {staff ? (
        <div className="mt-6 px-2">
          <Link href="/hub" onClick={onNavigate} className={cx('text-sm text-slate-200 underline', focus)}>{t('org.shell.platform')}</Link>
        </div>
      ) : null}
    </nav>
  );
}

/** Barre de l'espace organisation : sélecteur, bandeau d'accès du support, invitation à la double authentification. */
export function OrgBar() {
  const { t } = useTranslation();
  const lang = useLang();
  const { choices, current, home, select, can, orgId } = useOrg();
  const pending = useQuery({
    queryKey: ['org', orgId, 'support-access', 'requested'],
    queryFn: () => hubApi.org.supportAccess(orgId, { status: 'requested' }),
    enabled: Boolean(orgId) && can('members.manage') && !home?.supportAccess,
    retry: false,
  });
  if (!choices.length) return null;
  return (
    <div className="mb-5 flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,22rem)_1fr] sm:items-end">
        <Field label={t('org.shell.choose')}>
          {(p) => (
            <Select {...p} value={current?.organizationId ?? ''} onChange={(e) => select(e.target.value)} data-testid="org-selector">
              {choices.map((c) => <option key={c.organizationId} value={c.organizationId}>{c.label}</option>)}
            </Select>
          )}
        </Field>
      </div>
      {home?.supportAccess ? (
        <div role="status" className="rounded-md border-2 border-amber-500 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950" data-testid="support-banner">
          {t('org.shell.supportBanner', { until: formatDateTime(home.supportAccess.endsAt, lang), reason: home.supportAccess.reason })}
        </div>
      ) : null}
      {home && !home.supportAccess && home.mfaPermissions.length ? (
        <Notice tone="warning">
          <span className="flex flex-wrap items-center gap-3">
            {t('org.shell.mfaNotice')}
            <Link href="/hub/organisation/securite" className={cx('font-semibold underline', focus)}>{t('org.shell.mfaAction')}</Link>
          </span>
        </Notice>
      ) : null}
      {pending.data?.length ? (
        <Notice tone="info">
          <span className="flex flex-wrap items-center gap-3">
            {t('org.support.pendingNotice', { count: pending.data.length })}
            <Link href="/hub/organisation/support" className={cx('font-semibold underline', focus)}>{t('org.nav.support')}</Link>
          </span>
        </Notice>
      ) : null}
    </div>
  );
}

/** Garde d'une page de l'organisation : chargement, aucune organisation, permission absente. */
export function OrgPage({ permissions, children }: { permissions?: string[]; children: (orgId: string) => ReactNode }) {
  const { t } = useTranslation();
  const { orgId, loading, choices, can, home } = useOrg();
  if (loading) return <p role="status" className="py-6 text-sm text-slate-600">{t('org.shell.loading')}</p>;
  if (!choices.length || !orgId) return <Notice tone="info">{t('org.shell.none')}</Notice>;
  if (!home) return <Notice tone="danger">{t('hub.common.error')}</Notice>;
  if (permissions && permissions.length && !can(...permissions)) return <Notice tone="warning">{t('hub.common.forbidden')}</Notice>;
  return <>{children(orgId)}</>;
}

/** Bouton qui ouvre une autre organisation de l'arbre dans l'espace (portée « sous-arbre »). */
export function OpenOrgButton({ organizationId, name }: { organizationId: string; name: string }) {
  const { t } = useTranslation();
  const { select, orgId } = useOrg();
  if (organizationId === orgId) return <span className="text-xs text-slate-600">{t('org.orgs.current')}</span>;
  return <Action tone="secondary" onClick={() => select(organizationId, name)}>{t('org.orgs.manage')}</Action>;
}
