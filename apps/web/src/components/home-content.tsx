'use client';

import { createApiClient, type HealthReport } from '@neomoov/api-client';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { Language } from '@/lib/i18n-resources';

/** Adresse de l'API vue du navigateur (variable exposée au client par Next.js). */
const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:4000';

export function HomeContent() {
  const { t, i18n } = useTranslation();
  const api = useMemo(() => createApiClient({ baseUrl: API_BASE, language: () => i18n.language as Language }), [i18n.language]);
  const health = useQuery<HealthReport>({ queryKey: ['health', API_BASE], queryFn: ({ signal }) => api.health.get({ signal, auth: false }) });

  const summary = (report: HealthReport) =>
    [
      `${t('status.api')} ${t(`status.${report.status}`)}`,
      `${t('status.database')} ${t(`status.${report.checks.database.status}`)}`,
      `${t('status.redis')} ${t(`status.${report.checks.redis.status}`)}`,
      `${t('status.queues')} ${report.checks.queues.mode === 'memory' ? t('status.memory') : t(`status.${report.checks.queues.status}`)}`,
    ].join(' · ');

  return (
    <section className="flex flex-col gap-8 py-12">
      <p className="text-sm font-bold uppercase tracking-widest text-brand-blue-dark">{t('app.tagline')}</p>
      <h1 className="text-4xl leading-tight text-brand-night md:text-5xl">{t('home.title')}</h1>
      <p className="max-w-2xl text-lg">{t('home.subtitle')}</p>
      <div className="flex flex-wrap gap-3">
        <Button href="/reserver">{t('home.cta')}</Button>
        <Button href="/hub" variant="ghost">{t('home.hub')}</Button>
      </div>
      <dl className="rounded-2xl bg-white p-6 text-sm shadow-sm">
        <dt className="font-bold">{t('home.status')}</dt>
        <dd className="mt-2">
          {health.isPending && t('common.loading')}
          {health.isError && t('common.error')}
          {health.data && summary(health.data)}
        </dd>
      </dl>
    </section>
  );
}
