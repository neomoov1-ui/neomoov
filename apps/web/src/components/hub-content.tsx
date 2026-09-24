'use client';

import { useTranslation } from 'react-i18next';

export function HubContent() {
  const { t } = useTranslation();
  return (
    <section className="py-12">
      <h1 className="text-3xl text-brand-night">{t('hub.title')}</h1>
      <p className="mt-4 max-w-2xl">{t('hub.placeholder')}</p>
    </section>
  );
}
