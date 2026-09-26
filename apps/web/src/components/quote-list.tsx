'use client';

/** Choix de la catégorie parmi les devis (un par catégorie) : total tout compris, arrivée estimée, détail du prix. */
import type { QuoteView } from '@neomoov/domain';
import { useTranslation } from 'react-i18next';
import { cx, focus } from '@/components/ui/kit';
import { formatMoney } from '@/lib/format';
import type { Language } from '@/lib/i18n-resources';

export function QuoteList({ quotes, selected, onSelect, language, name }: { quotes: QuoteView[]; selected: string | null; onSelect: (quote: QuoteView) => void; language: Language; name: string }) {
  const { t } = useTranslation();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-semibold text-brand-ink">{t('book.chosen')}</legend>
      {quotes.map((q) => {
        const checked = selected === q.id;
        return (
          <label key={q.id} className={cx('flex cursor-pointer flex-col gap-2 rounded-lg border p-3', checked ? 'border-brand-blue-dark bg-brand-tint' : 'border-slate-300 bg-white hover:border-brand-blue-dark')}>
            <span className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-3">
                <input type="radio" name={name} value={q.category} checked={checked} onChange={() => onSelect(q)} className={cx('h-4 w-4 accent-brand-blue-dark', focus)} />
                <span>
                  <span className="block font-semibold text-brand-night">{t(`enum.category.${q.category}`)}</span>
                  <span className="block text-xs text-slate-700">
                    {q.eta.seconds !== null ? t('book.eta', { minutes: Math.max(1, Math.round(q.eta.seconds / 60)) }) : t('book.onAvailability')}
                  </span>
                </span>
              </span>
              <span className="text-lg font-bold text-brand-night">{formatMoney(q.totalCents, language)}</span>
            </span>
            {checked ? (
              <details className="text-sm">
                <summary className={cx('cursor-pointer text-brand-blue-dark underline', focus)}>{t('book.details')}</summary>
                <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
                  {q.lines.map((line) => (
                    <div key={`${line.code}-${line.label}`} className="contents">
                      <dt>{line.label}</dt>
                      <dd className="text-right tabular-nums">{formatMoney(line.amountCents, language)}</dd>
                    </div>
                  ))}
                  <dt className="font-bold">{t('book.total')}</dt>
                  <dd className="text-right font-bold tabular-nums">{formatMoney(q.totalCents, language)}</dd>
                </dl>
              </details>
            ) : null}
          </label>
        );
      })}
    </fieldset>
  );
}
