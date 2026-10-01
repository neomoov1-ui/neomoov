import type { Metadata } from 'next';
import { DriverJoin } from '@/components/driver-join';
import { resources } from '@/lib/i18n-resources';
import { currentLanguage } from '@/lib/language.server';

/** Rejoindre une flotte comme chauffeur (étape 23), à partir du lien reçu par texto. Page non indexée. */
export async function generateMetadata(): Promise<Metadata> {
  const texts = resources[await currentLanguage()].translation.fleet.join;
  return { title: `${texts.title} · Neomoov`, description: texts.subtitle, robots: { index: false, follow: false } };
}

export default async function DriverJoinPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return <DriverJoin initialToken={typeof token === 'string' ? token : ''} />;
}
