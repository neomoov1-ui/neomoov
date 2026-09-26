import type { Metadata } from 'next';
import { DriverSignup } from '@/components/driver-signup';
import { resources } from '@/lib/i18n-resources';
import { currentLanguage } from '@/lib/language.server';

export async function generateMetadata(): Promise<Metadata> {
  const texts = resources[await currentLanguage()].translation;
  return { title: `${texts.driversPage.title} · Neomoov`, description: texts.driversPage.subtitle };
}

export default function DriversSignupPage() {
  return <DriverSignup />;
}
