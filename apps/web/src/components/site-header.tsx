'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { LanguageSwitch } from '@/components/language-switch';
import { focus } from '@/components/ui/kit';
import type { Language } from '@/lib/i18n-resources';

/** En-tête du site public ; absent en mode intégré (`?embed=1`, iframe sur un site partenaire ou WordPress). */
export function SiteHeader({ language }: { language: Language }) {
  const { t } = useTranslation();
  const embedded = useSearchParams().get('embed') === '1';
  if (embedded) return null;
  const link = `rounded-md px-2 py-1 text-sm font-semibold text-brand-ink hover:bg-brand-tint ${focus}`;
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
      <a href="#contenu" className="sr-only focus:not-sr-only">{t('hub.shell.skip')}</a>
      <Link href="/" className={`font-heading text-2xl font-bold text-brand-blue-dark ${focus}`}>neomoov</Link>
      <nav aria-label="Neomoov" className="flex flex-wrap items-center gap-1">
        <Link href="/reserver" className={link}>{t('nav.book')}</Link>
        <Link href="/chauffeurs" className={link}>{t('nav.drivers')}</Link>
        <Link href="/droits" className={link}>{t('nav.rights')}</Link>
        <LanguageSwitch current={language} />
      </nav>
    </header>
  );
}
