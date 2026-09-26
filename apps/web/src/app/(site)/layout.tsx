import { Suspense } from 'react';
import { SiteHeader } from '@/components/site-header';
import { currentLanguage } from '@/lib/language.server';

/** Pages publiques : en-tête du site (masqué quand la page est intégrée en iframe, `?embed=1`). */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const language = await currentLanguage();
  return (
    <>
      <Suspense>
        <SiteHeader language={language} />
      </Suspense>
      <main id="contenu" className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">{children}</main>
    </>
  );
}
