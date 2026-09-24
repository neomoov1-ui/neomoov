import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';
import { LanguageSwitch } from '@/components/language-switch';
import { resources } from '@/lib/i18n-resources';
import { currentLanguage } from '@/lib/language.server';

export async function generateMetadata(): Promise<Metadata> {
  const language = await currentLanguage();
  const texts = resources[language].translation;
  return { title: texts.app.name, description: texts.meta.description };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const language = await currentLanguage();
  return (
    <html lang={language}>
      <body className="min-h-screen">
        <Providers language={language}>
          <header className="flex items-center justify-between px-6 py-4">
            <a href="/" className="font-heading text-2xl font-bold text-brand-blue">neomoov</a>
            <LanguageSwitch current={language} />
          </header>
          <main className="mx-auto max-w-5xl px-6 pb-16">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
