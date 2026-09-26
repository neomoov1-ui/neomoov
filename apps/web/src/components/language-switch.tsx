'use client';

import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, type Language } from '@/lib/i18n';

const LABELS: Record<Language, string> = { 'fr-CA': 'FR', en: 'EN' };

/** Change la langue : témoin `lang` lu par la mise en page serveur, puis rafraîchissement. */
export function LanguageSwitch({ current }: { current: Language }) {
  const router = useRouter();
  const { t } = useTranslation();
  const change = (lang: Language) => {
    document.cookie = `lang=${lang}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };
  return (
    <div className="flex items-center gap-1" aria-label={t('nav.language')}>
      {SUPPORTED_LANGUAGES.map((lang) => (
        <button key={lang} type="button" onClick={() => change(lang)} aria-pressed={lang === current} className={`rounded-full px-3 py-1 text-xs font-bold ${lang === current ? 'bg-brand-blue-dark text-white' : 'text-brand-ink hover:bg-brand-tint'}`}>
          {LABELS[lang]}
        </button>
      ))}
    </div>
  );
}
