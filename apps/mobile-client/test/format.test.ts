import { describe, expect, it } from 'vitest';
import { formatDistance, formatDuration, formatMoney } from '../src/lib/format';
import { displayPhone, toE164 } from '../src/lib/phone';

/** Espaces insécables et fines produits par Intl : comparés comme des espaces ordinaires. */
const plain = (s: string) => s.replace(/[  ]/g, ' ');

describe('mise en forme', () => {
  it('montants en dollars canadiens, en français et en anglais', () => {
    expect(plain(formatMoney(3156, 'fr-CA'))).toBe('31,56 $');
    expect(plain(formatMoney(3156, 'en'))).toBe('$31.56');
    expect(plain(formatMoney(-500, 'fr-CA'))).toBe('-5,00 $');
  });

  it('durées et distances', () => {
    expect(formatDuration(1080)).toBe('18 min');
    expect(formatDuration(3900)).toBe('1 h 05');
    expect(formatDuration(10)).toBe('1 min');
    expect(formatDistance(650, 'fr-CA')).toBe('650 m');
    expect(plain(formatDistance(8230, 'fr-CA'))).toBe('8,2 km');
    expect(formatDistance(8230, 'en')).toBe('8.2 km');
  });
});

describe('téléphone', () => {
  it('saisie libre vers E.164, numéros invalides refusés', () => {
    expect(toE164('514 555-0123')).toBe('+15145550123');
    expect(toE164('(438) 499-1120')).toBe('+14384991120');
    expect(toE164('1-514-555-0123')).toBe('+15145550123');
    expect(toE164('555-0123')).toBeNull();
    expect(toE164('014 555 0123')).toBeNull();
    expect(displayPhone('+15145550123')).toBe('514 555-0123');
  });
});
