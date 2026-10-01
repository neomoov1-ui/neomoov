import type { Metadata } from 'next';
import { Suspense } from 'react';
import { HubLogin } from '@/components/hub-login';
import { currentLanguage } from '@/lib/language.server';
import { currentBrand } from '@/lib/server/brand';

/** Connexion à My Hub au nom de la marque de l'hôte (étape 22) : « My Hub Taxi Alpha ». */
export async function generateMetadata(): Promise<Metadata> {
  const brand = await currentBrand();
  return { title: `My Hub ${brand.displayName}`, robots: { index: false, follow: false } };
}

export default async function HubLoginPage() {
  const language = await currentLanguage();
  return (
    <Suspense>
      <HubLogin language={language} />
    </Suspense>
  );
}
