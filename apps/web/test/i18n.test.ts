import { describe, expect, it } from 'vitest';
import { createI18n, isLanguage, resources } from '../src/lib/i18n';

describe('i18n web', () => {
  it('a les mêmes clés en français et en anglais', () => {
    const keys = (obj: object, prefix = ''): string[] => Object.entries(obj).flatMap(([k, v]) => (typeof v === 'object' && v ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
    expect(keys(resources.en.translation).sort()).toEqual(keys(resources['fr-CA'].translation).sort());
  });

  it('traduit en français par défaut et en anglais sur demande', () => {
    expect(createI18n().t('home.cta')).toBe('Réserver une course');
    expect(createI18n('en').t('home.cta')).toBe('Book a ride');
    expect(isLanguage('en')).toBe(true);
    expect(isLanguage('de')).toBe(false);
  });
});
