import type { Metadata } from 'next';
import { Booking } from '@/components/booking';
import { brandTitle } from '@/lib/brand';
import { resources } from '@/lib/i18n-resources';
import { currentLanguage } from '@/lib/language.server';
import { currentBrand } from '@/lib/server/brand';

/** Titre au nom de la marque de l'hôte (étape 22) : « Réserver une course · Taxi Alpha ». */
export async function generateMetadata(): Promise<Metadata> {
  const texts = resources[await currentLanguage()].translation;
  return { title: brandTitle(texts.book.title, await currentBrand()), description: texts.book.subtitle };
}

export default function BookPage() {
  return <Booking />;
}
