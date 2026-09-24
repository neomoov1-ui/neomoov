import { describe, expect, it } from 'vitest';
import { coreResources, createMobileI18n, isLanguage } from '../src/i18n';
import { colors } from '../src/theme';

describe('mobile-core', () => {
  it('fusionne les textes communs et ceux de l\'application, par langue', () => {
    const i18n = createMobileI18n({ 'fr-CA': { app: { hello: 'Bonjour' } }, en: { app: { hello: 'Hello' } } });
    expect(i18n.t('hello')).toBe('Bonjour');
    expect(i18n.t('core:tagline')).toBe('Une application conçue par le client pour les chauffeurs.');
    void i18n.changeLanguage('en');
    expect(i18n.t('hello')).toBe('Hello');
    expect(i18n.t('core:tagline')).toBe('An app designed by the customer, for drivers.');
  });

  it('a les mêmes clés communes dans les deux langues et la charte officielle', () => {
    expect(Object.keys(coreResources.en.core).sort()).toEqual(Object.keys(coreResources['fr-CA'].core).sort());
    expect(colors.blue).toBe('#1485E0');
    expect(colors.green).toBe('#6CC04A');
    expect(isLanguage('fr-CA')).toBe(true);
  });
});
