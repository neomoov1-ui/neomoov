'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { createI18n, type Language } from '@/lib/i18n';

export function Providers({ children, language }: { children: React.ReactNode; language: Language }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }));
  const i18n = useMemo(() => createI18n(language), [language]);
  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </QueryClientProvider>
  );
}
