'use client';

import { NEOMOOV_BRAND, type Brand } from '@neomoov/domain';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { WebBrandProvider } from '@/components/brand-context';
import { createI18n, type Language } from '@/lib/i18n';
import { reportBrowserError } from '@/lib/observability';

/** Fournisseurs du navigateur : requêtes, traductions et marque de la requête (résolue par le serveur à partir de l'hôte, étape 22). */
export function Providers({ children, language, brand = NEOMOOV_BRAND }: { children: React.ReactNode; language: Language; brand?: Brand }) {
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
      <I18nextProvider i18n={i18n}>
        <WebBrandProvider brand={brand}>{children}</WebBrandProvider>
      </I18nextProvider>
    </QueryClientProvider>
  );
}
