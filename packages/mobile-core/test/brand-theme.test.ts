import { NEOMOOV_BRAND } from '@neomoov/domain';
import { describe, expect, it } from 'vitest';
import { brandColors, brandTheme, darken, isDefaultBrand, lighten, mixColors } from '../src/brand-theme';
import { colors } from '../src/theme';

describe('thème de la marque (étape 22)', () => {
  it('la marque Neomoov garde exactement les jetons de la charte', () => {
    expect(isDefaultBrand(null)).toBe(true);
    expect(isDefaultBrand(NEOMOOV_BRAND)).toBe(true);
    expect(brandColors(NEOMOOV_BRAND)).toBe(colors);
    const theme = brandTheme(undefined);
    expect(theme).toEqual({ brand: NEOMOOV_BRAND, colors, isDefault: true });
  });

  it('une marque d\'organisation remplace le bleu, le vert, le fond et le texte, et dérive le bleu foncé et la teinte', () => {
    const brand = { ...NEOMOOV_BRAND, displayName: 'Taxi Alpha', colors: { primary: '#123456', secondary: '#654321', background: '#FFFFFF', text: '#111111', accent: '#22AA55' } };
    const theme = brandTheme(brand);
    expect(theme.isDefault).toBe(false);
    expect(theme.colors).toMatchObject({ blue: '#123456', green: '#22AA55', mist: '#FFFFFF', ink: '#111111', white: '#FFFFFF', night: colors.night, danger: colors.danger });
    expect(theme.colors.blueDark).toBe(darken('#123456', 0.25));
    expect(theme.colors.tint).toBe(lighten('#123456', 0.88));
    expect(theme.colors.blueDark).not.toBe('#123456');
  });

  it('mélange des couleurs borné et arrondi', () => {
    expect(mixColors('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(mixColors('#000000', '#FFFFFF', 2)).toBe('#FFFFFF');
    expect(mixColors('#000000', '#FFFFFF', -1)).toBe('#000000');
    expect(darken('#FFFFFF', 1)).toBe('#000000');
    expect(lighten('#000000', 0)).toBe('#000000');
  });
});
