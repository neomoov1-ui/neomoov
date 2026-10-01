import type { Metadata } from 'next';
import { Join } from '@/components/join';
import { resources } from '@/lib/i18n-resources';
import { currentLanguage } from '@/lib/language.server';

/**
 * Rejoindre une organisation à partir d'une invitation (lien reçu, ou code saisi). Page non indexée. Étape 21 : le lien
 * envoyé par texto ou courriel porte `?token=` ; l'ancien `?code=` reste accepté.
 */
export async function generateMetadata(): Promise<Metadata> {
  const texts = resources[await currentLanguage()].translation;
  return { title: `${texts.join.title} · Neomoov`, description: texts.join.subtitle, robots: { index: false, follow: false } };
}

export default async function JoinPage({ searchParams }: { searchParams: Promise<{ token?: string | string[]; code?: string | string[] }> }) {
  const { token, code } = await searchParams;
  const value = typeof token === 'string' ? token : typeof code === 'string' ? code : '';
  return <Join initialCode={value} />;
}
