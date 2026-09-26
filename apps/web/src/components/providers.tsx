'use client';

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { createI18n, type Language } from '@/lib/i18n';
import { reportBrowserError } from '@/lib/observability';

export function Providers({ children, language }: { children: React.ReactNode; language: Language }) {
  // Une panne de l'API (5xx) vue par My Hub ou la réservation est signalée au suivi des erreurs, avec son identifiant de corrélation.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
        queryCache: new QueryCache({ onError: (error) => reportBrowserError(error, { source: 'query' }) }),
        mutationCache: new MutationCache({ onError: (error) => reportBrowserError(error, { source: 'mutation' }) }),
      }),
  );
  const i18n = useMemo(() => createI18n(language), [language]);
  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </QueryClientProvider>
  );
}
