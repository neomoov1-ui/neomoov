import { describe, expect, it } from 'vitest';
import { appResources, i18n } from '../src/i18n';
import { isValidDate } from '../src/features/documents/validate';

type Tree = { [key: string]: string | Tree };

/** Toutes les clés d'un arbre de textes (`ride.end.title`…), pour comparer les deux langues en profondeur. */
function keysOf(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) => (typeof value === 'string' ? [`${prefix}${key}`] : keysOf(value, `${prefix}${key}.`)));
}

describe('application chauffeur : textes', () => {
  it('a les mêmes clés en français et en anglais, à toutes les profondeurs, sans texte vide', () => {
    const fr = keysOf(appResources['fr-CA'].app as Tree);
    expect(keysOf(appResources.en.app as Tree)).toEqual(fr);
    expect(fr.length).toBeGreaterThan(300);
    for (const key of fr) expect(i18n.t(key), key).not.toBe('');
  });

  it('démarre en français et bascule en anglais, avec les textes communs', async () => {
    expect(i18n.t('start')).toBe('Devenir chauffeur Neomoov');
    expect(i18n.t('home.packRemaining', { count: 3 })).toBe('3 courses restantes');
    await i18n.changeLanguage('en');
    expect(i18n.t('start')).toBe('Become a Neomoov driver');
    expect(i18n.t('ride.actions.arrive')).toBe('I have arrived');
    expect(i18n.t('core:tagline')).toBe('An app designed by the customer, for drivers.');
    await i18n.changeLanguage('fr-CA');
  });

  it('dates des documents au format AAAA-MM-JJ, calendrier vérifié', () => {
    expect(isValidDate('2027-02-28')).toBe(true);
    expect(isValidDate('2027-02-31')).toBe(false);
    expect(isValidDate('28/02/2027')).toBe(false);
  });
});
