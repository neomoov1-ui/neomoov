'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitch } from '@/components/language-switch';
import { Action, cx, focus } from '@/components/ui/kit';
import { canWrite, logout } from '@/lib/hub-api';
import type { Language } from '@/lib/i18n-resources';
import type { HubUser } from '@/lib/server/gateway';
import { HubUserContext } from './common';

const NAV: Array<{ group: string; items: Array<{ key: string; href: string }> }> = [
  { group: 'operations', items: [{ key: 'dashboard', href: '/hub' }, { key: 'rides', href: '/hub/courses' }, { key: 'newRide', href: '/hub/courses/nouvelle' }] },
  { group: 'drivers', items: [{ key: 'drivers', href: '/hub/chauffeurs' }, { key: 'documents', href: '/hub/documents' }, { key: 'vehicles', href: '/hub/vehicules' }] },
  { group: 'clients', items: [{ key: 'clients', href: '/hub/clients' }, { key: 'leads', href: '/hub/prospects' }] },
  { group: 'offer', items: [{ key: 'tariffs', href: '/hub/tarifs' }, { key: 'zones', href: '/hub/zones' }, { key: 'offers', href: '/hub/offres' }] },
  { group: 'finance', items: [{ key: 'statements', href: '/hub/releves' }, { key: 'invoices', href: '/hub/factures' }, { key: 'ledgers', href: '/hub/registres' }] },
  { group: 'safety', items: [{ key: 'incidents', href: '/hub/incidents' }, { key: 'dataRequests', href: '/hub/demandes' }] },
  { group: 'intelligence', items: [{ key: 'agents', href: '/hub/agents' }, { key: 'reports', href: '/hub/rapports' }, { key: 'metrics', href: '/hub/metriques' }] },
  { group: 'admin', items: [{ key: 'settings', href: '/hub/parametres' }, { key: 'staff', href: '/hub/equipe' }, { key: 'audit', href: '/hub/journal' }] },
];

/** Cadre de My Hub : navigation par modules (barre latérale, repliable sur mobile), utilisateur, langue, déconnexion. */
export function HubShell({ user, language, children }: { user: HubUser; language: Language; children: React.ReactNode }) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || '';
  const active = (href: string) => (href === '/hub' ? pathname === '/hub' : pathname === href || (pathname.startsWith(`${href}/`) && href !== '/hub/courses') || (href === '/hub/courses' && /^\/hub\/courses\/(?!nouvelle)/.test(pathname)));

  return (
    <HubUserContext.Provider value={user}>
      <div className="min-h-screen lg:flex">
        <a href="#contenu" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">{t('hub.shell.skip')}</a>
        <div className="flex items-center justify-between bg-brand-night px-4 py-3 text-white lg:hidden">
          <span className="font-heading text-lg font-bold">neomoov · My Hub</span>
          <button type="button" aria-expanded={open} aria-controls="hub-nav" onClick={() => setOpen((v) => !v)} className={cx('rounded-md border border-white/40 px-3 py-1 text-sm', focus)}>{t('hub.shell.menu')}</button>
        </div>
        <aside id="hub-nav" className={cx('bg-brand-night text-white lg:sticky lg:top-0 lg:block lg:h-screen lg:w-60 lg:shrink-0 lg:overflow-y-auto', open ? 'block' : 'hidden')}>
          <div className="hidden px-4 py-5 lg:block">
            <Link href="/hub" className={cx('font-heading text-xl font-bold', focus)}>neomoov</Link>
            <p className="text-xs text-slate-300">My Hub</p>
          </div>
          <nav aria-label={t('hub.shell.menu')} className="px-2 pb-6">
            {NAV.map((section) => (
              <div key={section.group} className="mt-3">
                <p className="px-2 text-[11px] font-bold uppercase tracking-widest text-slate-300">{t(`hub.nav.groups.${section.group}`)}</p>
                <ul className="mt-1">
                  {section.items.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        aria-current={active(item.href) ? 'page' : undefined}
                        className={cx('block rounded-md px-2 py-1.5 text-sm', focus, active(item.href) ? 'bg-white font-semibold text-brand-night' : 'text-slate-100 hover:bg-white/10')}
                      >
                        {t(`hub.nav.${item.key}`)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </aside>
        <div className="min-w-0 flex-1">
          <header className="flex flex-wrap items-center justify-end gap-3 border-b border-slate-200 bg-white px-4 py-2 sm:px-6">
            {!canWrite(user.roles) ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">{t('hub.shell.readOnly')}</span> : null}
            <span className="text-sm text-slate-700">{t('hub.shell.signedInAs', { name })}</span>
            <LanguageSwitch current={language} />
            <Action tone="secondary" onClick={() => void logout()}>{t('hub.shell.logout')}</Action>
          </header>
          <main id="contenu" className="px-4 py-6 sm:px-6">{children}</main>
        </div>
      </div>
    </HubUserContext.Provider>
  );
}
