/**
 * Fournisseur de thème de la marque (étape 22) : la marque reçue par `GET /v1/config` (organisation du profil client
 * rattaché, sinon Neomoov) est mise à disposition des écrans et des composants. Ce qui reste « Neomoov » quoi qu'il
 * arrive : l'icône, le nom sous l'icône, l'écran de démarrage et le nom des notifications (règles 4.2.6 et 4.3 d'Apple).
 */
import type { Brand } from '@neomoov/domain';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { brandTheme, type BrandTheme } from './brand-theme';
import { colors, radius, spacing, typography, type ThemeColors } from './theme';

const BrandContext = createContext<BrandTheme>(brandTheme(null));

export function BrandProvider({ brand, children }: { brand: Brand | null | undefined; children: ReactNode }) {
  const value = useMemo(() => brandTheme(brand), [brand]);
  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

/** Marque courante et ses jetons de couleur. */
export function useBrand(): BrandTheme {
  return useContext(BrandContext);
}

/** Jetons de couleur de la marque courante (ceux de la charte quand aucune organisation n'est rattachée). */
export function useBrandColors(): ThemeColors {
  return useContext(BrandContext).colors;
}

/** Aperçu d'une marque (écran « Rejoindre une organisation ») : pastille de la couleur principale, nom, signature. */
export function BrandPreview({ brand }: { brand: Pick<Brand, 'displayName' | 'colors' | 'tagline'> }) {
  return (
    <View style={[styles.preview, { backgroundColor: brand.colors.background, borderColor: brand.colors.primary }]} accessibilityRole="summary" accessibilityLabel={brand.displayName}>
      <View style={[styles.swatch, { backgroundColor: brand.colors.primary }]}>
        <Text style={styles.initial}>{brand.displayName.slice(0, 1).toUpperCase()}</Text>
      </View>
      <View style={styles.previewText}>
        <Text style={[styles.previewName, { color: brand.colors.text }]}>{brand.displayName}</Text>
        {brand.tagline ? <Text style={[styles.previewTagline, { color: brand.colors.text }]}>{brand.tagline}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  preview: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1 },
  swatch: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  initial: { color: colors.white, fontSize: typography.sizes.lg, fontWeight: '700' },
  previewText: { flex: 1, gap: 2 },
  previewName: { fontSize: typography.sizes.md, fontWeight: '700' },
  previewTagline: { fontSize: typography.sizes.sm },
});
