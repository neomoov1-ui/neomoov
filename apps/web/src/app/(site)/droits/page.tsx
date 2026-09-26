import type { Metadata } from 'next';
import { Rights } from '@/components/rights';
import { resources } from '@/lib/i18n-resources';
import { currentLanguage } from '@/lib/language.server';

export async function generateMetadata(): Promise<Metadata> {
  const texts = resources[await currentLanguage()].translation;
  return { title: `${texts.rights.title} · Neomoov`, description: texts.rights.subtitle };
}

export default function RightsPage() {
  return <Rights />;
}
