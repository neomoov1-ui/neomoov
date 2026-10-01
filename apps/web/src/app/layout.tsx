import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import './globals.css';
import { Providers } from '@/components/providers';
import { brandCssVariables, isDefaultBrand } from '@/lib/brand';
import { resources } from '@/lib/i18n-resources';
import { currentLanguage } from '@/lib/language.server';
import { currentBrand } from '@/lib/server/brand';

export async function generateMetadata(): Promise<Metadata> {
  const language = await currentLanguage();
  const brand = await currentBrand();
  const texts = resources[language].translation;
  return { title: isDefaultBrand(brand) ? texts.app.name : brand.displayName, description: texts.meta.description };
}

/**
 * Racine commune : langue, marque et fournisseurs. Le site public (`(site)`) et My Hub (`hub`) ont chacun leur mise en
 * page. Marque (étape 22) : résolue par l'hôte de la requête (domaine vérifié d'une organisation) ; ses couleurs
 * remplacent les variables CSS de la charte sur `<html>`, son nom et son logo passent par le contexte. Hôte inconnu :
 * Neomoov, sans aucune variable ajoutée.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const language = await currentLanguage();
  const brand = await currentBrand();
  const variables = brandCssVariables(brand);
  return (
    <html lang={language} style={variables ? (variables as CSSProperties) : undefined}>
      <body className="min-h-screen">
        <Providers language={language} brand={brand}>{children}</Providers>
      </body>
    </html>
  );
}
