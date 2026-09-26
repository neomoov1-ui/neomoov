import { describe, expect, it } from 'vitest';
import { formatCents } from '../src/modules/invoicing/invoice-pdf.js';
import { invoiceVerificationKey, signInvoiceToken, verificationUrl, verifyInvoiceToken } from '../src/modules/invoicing/invoice-token.js';

const ID = '2f4c1a3e-8b6d-4f1a-9c2e-7d5b6a4c3e21';

describe('jeton de vérification d\'une facture', () => {
  const key = invoiceVerificationKey('cle-de-test-non-secrete');

  it('clé dérivée par HKDF, jamais la clé brute ; stable pour un même secret', () => {
    expect(key).toHaveLength(32);
    expect(key.equals(Buffer.from('cle-de-test-non-secrete'))).toBe(false);
    expect(invoiceVerificationKey('cle-de-test-non-secrete').equals(key)).toBe(true);
    expect(invoiceVerificationKey('autre-secret').equals(key)).toBe(false);
  });

  it('signé puis vérifié ; altéré, d\'une autre clé ou mal formé : refusé', () => {
    const token = signInvoiceToken(ID, key);
    expect(token).toMatch(/^[A-Za-z0-9_-]{44}$/);
    expect(verifyInvoiceToken(token, key)).toBe(ID);
    for (let i = 0; i < token.length; i += 7) {
      const altered = `${token.slice(0, i)}${token[i] === 'A' ? 'B' : 'A'}${token.slice(i + 1)}`;
      expect(verifyInvoiceToken(altered, key)).toBeNull();
    }
    expect(verifyInvoiceToken(token, invoiceVerificationKey('autre-secret'))).toBeNull();
    expect(verifyInvoiceToken(token.slice(0, 40), key)).toBeNull();
    expect(() => signInvoiceToken('pas-un-uuid', key)).toThrow();
  });

  it('adresse du code QR : paramètre `t` ajouté à l\'adresse de vérification', () => {
    expect(verificationUrl('https://neomoov.net/verifier-facture', 'abc')).toBe('https://neomoov.net/verifier-facture?t=abc');
    expect(verificationUrl('https://neomoov.net/verifier?lang=fr', 'abc')).toBe('https://neomoov.net/verifier?lang=fr&t=abc');
  });
});

describe('montants du PDF', () => {
  it('français du Canada, espace insécable, signe', () => {
    expect(formatCents(3156)).toBe('31,56 $');
    expect(formatCents(123456789)).toBe('1 234 567,89 $');
    expect(formatCents(-500)).toBe('-5,00 $');
    expect(formatCents(7)).toBe('0,07 $');
  });
});
