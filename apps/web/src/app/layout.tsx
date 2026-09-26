import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';
import { resources } from '@/lib/i18n-resources';
import { currentLanguage } from '@/lib/language.server';

export async function generateMetadata(): Promise<Metadata> {
  const language = await currentLanguage();
  const texts = resources[language].translation;
  return { title: texts.app.name, description: texts.meta.description };
}

/** Racine commune : langue et fournisseurs. Le site public (`(site)`) et My Hub (`hub`) ont chacun leur mise en page. */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const language = await currentLanguage();
  return (
    <html lang={language}>
      <body className="min-h-screen">
        <Providers language={language}>{children}</Providers>
      </body>
    </html>
  );
}
