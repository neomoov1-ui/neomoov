'use client';

/**
 * Marque de la requête dans les composants du navigateur (étape 22) : résolue par le serveur à partir de l'hôte, passée
 * par la mise en page racine. Nom ou logo de l'en-tête, liens des conditions, coordonnées de l'assistance.
 */
import { NEOMOOV_BRAND, type Brand } from '@neomoov/domain';
import { createContext, useContext, type ReactNode } from 'react';

const WebBrandContext = createContext<Brand>(NEOMOOV_BRAND);

export function WebBrandProvider({ brand, children }: { brand: Brand; children: ReactNode }) {
  return <WebBrandContext.Provider value={brand}>{children}</WebBrandContext.Provider>;
}

export function useWebBrand(): Brand {
  return useContext(WebBrandContext);
}

/** Logo de la marque s'il existe, sinon son nom (le mot-symbole « neomoov » en minuscules pour Neomoov). */
export function BrandMark({ className }: { className?: string }) {
  const brand = useWebBrand();
  if (brand.logoUrl) {
    // Logo hébergé par l'organisation : image simple, sans optimisation Next.js (domaine externe quelconque).
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={brand.logoUrl} alt={brand.displayName} className="h-8 w-auto" />;
  }
  return <span className={className}>{brand.displayName === NEOMOOV_BRAND.displayName ? 'neomoov' : brand.displayName}</span>;
}
