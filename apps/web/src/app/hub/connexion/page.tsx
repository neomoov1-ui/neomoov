import type { Metadata } from 'next';
import { Suspense } from 'react';
import { HubLogin } from '@/components/hub-login';
import { currentLanguage } from '@/lib/language.server';

export const metadata: Metadata = { title: 'My Hub Neomoov', robots: { index: false, follow: false } };

export default async function HubLoginPage() {
  const language = await currentLanguage();
  return (
    <Suspense>
      <HubLogin language={language} />
    </Suspense>
  );
}
