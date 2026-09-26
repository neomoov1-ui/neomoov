import type { Metadata } from 'next';
import { Booking } from '@/components/booking';
import { resources } from '@/lib/i18n-resources';
import { currentLanguage } from '@/lib/language.server';

export async function generateMetadata(): Promise<Metadata> {
  const texts = resources[await currentLanguage()].translation;
  return { title: `${texts.book.title} · Neomoov`, description: texts.book.subtitle };
}

export default function BookPage() {
  return <Booking />;
}
