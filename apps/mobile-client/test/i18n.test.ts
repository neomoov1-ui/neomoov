import { describe, expect, it } from 'vitest';
import { appResources, i18n } from '../src/i18n';

describe('application client : textes', () => {
  it('a les mêmes clés en français et en anglais', () => {
    expect(Object.keys(appResources.en.app).sort()).toEqual(Object.keys(appResources['fr-CA'].app).sort());
  });

  it('démarre en français et bascule en anglais', async () => {
    expect(i18n.t('start')).toBe('Réserver ma course');
    await i18n.changeLanguage('en');
    expect(i18n.t('start')).toBe('Book my ride');
    expect(i18n.t('core:leadTime')).toBe('Book at least 2 hours ahead.');
    await i18n.changeLanguage('fr-CA');
  });
});
