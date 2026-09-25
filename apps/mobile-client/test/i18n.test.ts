import { describe, expect, it } from 'vitest';
import { appResources, i18n } from '../src/i18n';

/** Toutes les clés, imbriquées comprises (`book.title`, `category.lines.gst`…). */
function keysOf(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([k, v]) => keysOf(v, prefix ? `${prefix}.${k}` : k));
}

describe('application client : textes', () => {
  it('a exactement les mêmes clés en français et en anglais, toutes non vides', () => {
    const fr = keysOf(appResources['fr-CA'].app).sort();
    const en = keysOf(appResources.en.app).sort();
    expect(en).toEqual(fr);
    for (const key of fr) {
      expect(i18n.t(key, { lng: 'fr-CA' })).not.toBe('');
      expect(i18n.t(key, { lng: 'en' })).not.toBe(key);
    }
  });

  it('démarre en français et bascule en anglais', async () => {
    expect(i18n.t('start')).toBe('Réserver ma course');
    await i18n.changeLanguage('en');
    expect(i18n.t('start')).toBe('Book my ride');
    expect(i18n.t('core:leadTime')).toBe('Book at least 2 hours ahead.');
    await i18n.changeLanguage('fr-CA');
  });

  it('message des commodités (D45) et slogan (D44) mot pour mot', () => {
    expect(i18n.t('confirm.amenitiesMessage')).toBe('Choisissez toutes les commodités de votre voyage, et indiquez-nous vos demandes spéciales');
    expect(i18n.t('core:tagline')).toBe('Une application conçue par le client pour les chauffeurs.');
  });
});
