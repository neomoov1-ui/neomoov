import type { Metadata } from 'next';
import { Join } from '@/components/join';
import { resources } from '@/lib/i18n-resources';
import { currentLanguage } from '@/lib/language.server';

/** Rejoindre une organisation à partir d'une invitation (lien reçu, ou code saisi). Page non indexée. */
export async function generateMetadata(): Promise<Metadata> {
  const texts = resources[await currentLanguage()].translation;
  return { title: `${texts.join.title} · Neomoov`, description: texts.join.subtitle, robots: { index: false, follow: false } };
}

export default async function JoinPage({ searchParams }: { searchParams: Promise<{ code?: string | string[] }> }) {
  const { code } = await searchParams;
  return <Join initialCode={typeof code === 'string' ? code : ''} />;
}
