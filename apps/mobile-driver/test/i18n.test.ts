import { describe, expect, it } from 'vitest';
import { appResources, i18n } from '../src/i18n';

describe('application chauffeur : textes', () => {
  it('a les mêmes clés en français et en anglais', () => {
    expect(Object.keys(appResources.en.app).sort()).toEqual(Object.keys(appResources['fr-CA'].app).sort());
  });

  it('démarre en français et bascule en anglais', async () => {
    expect(i18n.t('start')).toBe('Devenir chauffeur Neomoov');
    await i18n.changeLanguage('en');
    expect(i18n.t('start')).toBe('Become a Neomoov driver');
    expect(i18n.t('core:tagline')).toBe('An app designed by the customer, for drivers.');
    await i18n.changeLanguage('fr-CA');
  });
});
