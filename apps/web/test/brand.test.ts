import { NEOMOOV_BRAND } from '@neomoov/domain';
import { describe, expect, it } from 'vitest';
import { brandCssVariables, brandTitle, isDefaultBrand, mixColors, requestHost } from '../src/lib/brand';

const alpha = { ...NEOMOOV_BRAND, displayName: 'Taxi Alpha', colors: { primary: '#123456', secondary: '#654321', background: '#FFFFFF', text: '#111111', accent: '#22AA55' } };

describe('marque sur le web (étape 22)', () => {
  it('la marque Neomoov ne produit aucune variable : la charte de globals.css reste', () => {
    expect(isDefaultBrand(NEOMOOV_BRAND)).toBe(true);
    expect(brandCssVariables(NEOMOOV_BRAND)).toBeNull();
    expect(isDefaultBrand({ ...NEOMOOV_BRAND, logoUrl: 'https://cdn.exemple.ca/logo.png' })).toBe(false);
  });

  it('une marque d\'organisation remplace les variables de la charte', () => {
    expect(brandCssVariables(alpha)).toEqual({
      '--color-brand-blue-dark': '#123456',
      '--color-brand-blue': '#654321',
      '--color-brand-green': '#22AA55',
      '--color-brand-ink': '#111111',
      '--color-brand-mist': '#FFFFFF',
      '--color-brand-tint': mixColors('#123456', '#FFFFFF', 0.88),
    });
    expect(mixColors('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(mixColors('#000000', '#FFFFFF', 3)).toBe('#FFFFFF');
    expect(brandTitle('Réserver une course', alpha)).toBe('Réserver une course · Taxi Alpha');
  });

  it('hôte de la requête : mandataire d\'abord, port retiré ; localhost et adresses IP gardent Neomoov', () => {
    expect(requestHost('Reservation.Taxi-Alpha.ca:443', 'interne:3000')).toBe('reservation.taxi-alpha.ca');
    expect(requestHost(null, 'hub.taxi-alpha.ca')).toBe('hub.taxi-alpha.ca');
    expect(requestHost('a.taxi-alpha.ca, b.proxy.local', null)).toBe('a.taxi-alpha.ca');
    expect(requestHost(null, 'localhost:3000')).toBeNull();
    expect(requestHost(null, '10.0.0.4')).toBeNull();
    expect(requestHost(undefined, undefined)).toBeNull();
  });
});
