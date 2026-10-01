import { describe, expect, it } from 'vitest';
import {
  applyBrandUpdate, attachOrganizationSchema, brandContrastIssues, brandSchema, brandSummary, brandTextsSchema, brandUpdateSchema, contrastRatio, dnsVerificationRecord, domainSchema,
  generateJoinCode, hexColorSchema, isHexColor, isJoinCode, JOIN_CODE_ALPHABET, joinCodeSchema, joinLink, NEOMOOV_BRAND, normalizeDomain, normalizeJoinCode, organizationDomainCreateSchema,
  PERMISSIONS, publicBrandQuerySchema, relativeLuminance, resolveBrand, SYSTEM_ROLES, systemRole,
} from '../src/index.js';

describe('code de rattachement (étape 22)', () => {
  it('8 caractères d\'un alphabet sans ambiguïté, quelle que soit la source aléatoire', () => {
    const code = generateJoinCode();
    expect(code).toHaveLength(8);
    expect(isJoinCode(code)).toBe(true);
    expect(JOIN_CODE_ALPHABET).not.toMatch(/[0O1IL]/);
    expect(generateJoinCode(() => 0)).toBe('AAAAAAAA');
    expect(generateJoinCode(() => 0.999999)).toBe('99999999');
    // Une source hors de [0, 1) est bornée plutôt que de produire un caractère vide.
    expect(generateJoinCode(() => 1.5)).toBe('99999999');
    expect(generateJoinCode(() => -1)).toBe('AAAAAAAA');
    for (let i = 0; i < 200; i += 1) expect(isJoinCode(generateJoinCode())).toBe(true);
  });

  it('saisie tolérante, schéma strict, lien de rattachement', () => {
    expect(normalizeJoinCode(' abcd-ef 23 ')).toBe('ABCDEF23');
    expect(joinCodeSchema.parse('abcd-ef23')).toBe('ABCDEF23');
    expect(joinCodeSchema.safeParse('ABCDEFO1').success).toBe(false);
    expect(joinCodeSchema.safeParse('ABC').success).toBe(false);
    expect(joinCodeSchema.safeParse('').success).toBe(false);
    expect(isJoinCode('abcdef23')).toBe(false);
    expect(joinLink('https://neomoov.net/', 'abcd-ef23')).toBe('https://neomoov.net/c/ABCDEF23');
    expect(attachOrganizationSchema.parse({ code: 'hjkm np23' })).toEqual({ code: 'HJKMNP23' });
  });
});

describe('marque : schémas et résolution', () => {
  it('couleurs hexadécimales en majuscules ; textes bornés', () => {
    expect(isHexColor('#0b5fb5')).toBe(true);
    expect(isHexColor('#0b5')).toBe(false);
    expect(isHexColor(12)).toBe(false);
    expect(hexColorSchema.parse(' #0b5fb5 ')).toBe('#0B5FB5');
    expect(hexColorSchema.safeParse('0B5FB5').success).toBe(false);
    expect(brandTextsSchema.parse({ welcomeTitle: 'Bienvenue' })).toEqual({ welcomeTitle: 'Bienvenue' });
    expect(brandTextsSchema.safeParse({ 'Welcome Title': 'x' }).success).toBe(false);
    const tooMany = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`t${i}`, 'x']));
    expect(brandTextsSchema.safeParse(tooMany).success).toBe(false);
  });

  it('mise à jour : adresses http(s) seulement, expéditeur de textos borné, null efface', () => {
    const ok = brandUpdateSchema.parse({ displayName: 'Taxi Exemple', logoUrl: 'https://cdn.exemple.ca/logo.png', colors: { primary: '#123456' }, smsSender: 'TAXIEX', supportEmail: 'Aide@Exemple.CA', supportPhone: '+15145550142', termsUrl: null });
    expect(ok).toMatchObject({ displayName: 'Taxi Exemple', colors: { primary: '#123456' }, supportEmail: 'aide@exemple.ca', termsUrl: null });
    expect(brandUpdateSchema.safeParse({ logoUrl: 'ftp://exemple.ca/logo.png' }).success).toBe(false);
    expect(brandUpdateSchema.safeParse({ smsSender: 'AB' }).success).toBe(false);
    expect(brandUpdateSchema.parse({ smsSender: '+15145550142' }).smsSender).toBe('+15145550142');
    expect(brandUpdateSchema.safeParse({ colors: { primary: 'bleu' } }).success).toBe(false);
  });

  it('résolution : rien donne Neomoov ; une marque partielle est complétée couleur par couleur et texte par texte', () => {
    expect(resolveBrand(null)).toEqual(NEOMOOV_BRAND);
    expect(brandSchema.parse(resolveBrand(undefined))).toEqual(NEOMOOV_BRAND);
    const resolved = resolveBrand({
      displayName: 'Taxi Exemple', colors: { primary: '#123456', accent: 'pas-une-couleur', text: null }, texts: { welcomeTitle: 'Bienvenue chez Taxi Exemple' }, supportPhone: '+15145550142', tagline: null,
    });
    expect(resolved.displayName).toBe('Taxi Exemple');
    expect(resolved.colors).toEqual({ ...NEOMOOV_BRAND.colors, primary: '#123456' });
    expect(resolved.texts).toEqual({ welcomeTitle: 'Bienvenue chez Taxi Exemple' });
    expect(resolved.support).toEqual({ phone: '+15145550142', email: null });
    expect(resolved.tagline).toBe(NEOMOOV_BRAND.tagline);
    // L'expéditeur des courriels suit le nom commercial ; l'adresse reste celle de la plateforme.
    expect(resolved.emailSender).toEqual({ name: 'Taxi Exemple', address: 'notifications@neomoov.net' });
    expect(resolveBrand({ emailSenderName: 'Service Taxi Exemple', emailSenderAddress: 'avis@exemple.ca', logoUrl: 'https://cdn.exemple.ca/logo.png', smsSender: 'TAXIEX', termsUrl: 'https://exemple.ca/cgu', privacyUrl: 'https://exemple.ca/vie-privee' })).toMatchObject({
      displayName: 'Neomoov', emailSender: { name: 'Service Taxi Exemple', address: 'avis@exemple.ca' }, logoUrl: 'https://cdn.exemple.ca/logo.png', smsSender: 'TAXIEX', termsUrl: 'https://exemple.ca/cgu', privacyUrl: 'https://exemple.ca/vie-privee',
    });
    // Valeurs par défaut de la plateforme (coordonnées du support lues des réglages par l'API).
    const withSupport = resolveBrand({}, { ...NEOMOOV_BRAND, support: { phone: '+15145550100', email: 'aide@neomoov.net' } });
    expect(withSupport.support).toEqual({ phone: '+15145550100', email: 'aide@neomoov.net' });
    expect(brandSummary(resolved)).toEqual({ displayName: 'Taxi Exemple', logoUrl: null, primary: '#123456' });
  });

  it('applique une mise à jour partielle : absent conserve, null efface, couleurs fusionnées', () => {
    const stored = applyBrandUpdate(null, brandUpdateSchema.parse({ displayName: 'Taxi Exemple', colors: { primary: '#123456', secondary: '#654321' }, texts: { a: 'b' }, tagline: 'Toujours à l\'heure' }));
    expect(stored).toEqual({ displayName: 'Taxi Exemple', colors: { primary: '#123456', secondary: '#654321' }, texts: { a: 'b' }, tagline: 'Toujours à l\'heure' });
    const next = applyBrandUpdate(stored, brandUpdateSchema.parse({ tagline: null, colors: { primary: '#000000' }, logoUrl: 'https://cdn.exemple.ca/logo.png', supportPhone: '+15145550142', supportEmail: 'a@b.ca', emailSenderName: 'X Y', emailSenderAddress: 'x@y.ca', smsSender: 'XYZ', termsUrl: 'https://x.ca/t', privacyUrl: 'https://x.ca/p' }));
    expect(next.colors).toEqual({ primary: '#000000', secondary: '#654321' });
    expect(next).toMatchObject({ displayName: 'Taxi Exemple', tagline: null, texts: { a: 'b' }, logoUrl: 'https://cdn.exemple.ca/logo.png', supportPhone: '+15145550142', supportEmail: 'a@b.ca', emailSenderName: 'X Y', emailSenderAddress: 'x@y.ca', smsSender: 'XYZ', termsUrl: 'https://x.ca/t', privacyUrl: 'https://x.ca/p' });
    expect(applyBrandUpdate(next, {})).toEqual(next);
    expect(stored.colors).toEqual({ primary: '#123456', secondary: '#654321' });
  });
});

describe('marque : contraste WCAG AA', () => {
  it('luminance et rapport de contraste conformes à la formule', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
    expect(contrastRatio('#000000', '#FFFFFF')).toBe(21);
    expect(contrastRatio('#FFFFFF', '#000000')).toBe(21);
    expect(contrastRatio('#FFFFFF', '#0B5FB5')).toBeGreaterThan(6);
    expect(() => relativeLuminance('bleu')).toThrow('Couleur hexadécimale attendue');
  });

  it('la marque Neomoov passe ; un texte trop pâle ou une couleur principale trop claire sont refusés avec un message', () => {
    expect(brandContrastIssues(NEOMOOV_BRAND.colors)).toEqual([]);
    const pale = brandContrastIssues({ ...NEOMOOV_BRAND.colors, text: '#AAB6C4' });
    expect(pale).toHaveLength(1);
    expect(pale[0]).toMatchObject({ pair: 'text_on_background', minimum: 4.5 });
    expect(pale[0]!.ratio).toBeLessThan(4.5);
    expect(pale[0]!.message).toContain('4,5 pour 1');
    const light = brandContrastIssues({ ...NEOMOOV_BRAND.colors, primary: '#FFD400' });
    expect(light).toHaveLength(1);
    expect(light[0]).toMatchObject({ pair: 'button_text_on_primary' });
    expect(light[0]!.message).toContain('plus foncée');
    expect(brandContrastIssues({ ...NEOMOOV_BRAND.colors, text: '#F0F0F0', primary: '#FFFFFF' })).toHaveLength(2);
  });
});

describe('domaines d\'organisation', () => {
  it('normalise un nom d\'hôte et refuse ce qui n\'en est pas un', () => {
    expect(normalizeDomain(' HTTPS://Reservation.Taxi-Exemple.CA:443/reserver ')).toBe('reservation.taxi-exemple.ca');
    expect(normalizeDomain('exemple.ca.')).toBe('exemple.ca');
    expect(normalizeDomain('')).toBe(null);
    expect(normalizeDomain('localhost')).toBe(null);
    expect(normalizeDomain('1.2.3.4')).toBe(null);
    expect(normalizeDomain('-mauvais.ca')).toBe(null);
    expect(normalizeDomain('exemple.c')).toBe(null);
    expect(normalizeDomain(`${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.ca`)).toBe(null);
    expect(domainSchema.parse('Reservation.Exemple.ca')).toBe('reservation.exemple.ca');
    const bad = domainSchema.safeParse('pas un domaine');
    expect(bad.success).toBe(false);
    expect(organizationDomainCreateSchema.parse({ domain: 'hub.exemple.ca' })).toEqual({ domain: 'hub.exemple.ca', kind: 'booking' });
    expect(organizationDomainCreateSchema.parse({ domain: 'hub.exemple.ca', kind: 'hub' }).kind).toBe('hub');
    expect(dnsVerificationRecord('hub.exemple.ca', 'abc')).toEqual({ type: 'TXT', name: '_neomoov-verification.hub.exemple.ca', value: 'neomoov-verification=abc' });
  });

  it('la marque publique se demande par code ou par domaine, jamais les deux ni aucun', () => {
    expect(publicBrandQuerySchema.parse({ code: 'abcd-ef23' })).toEqual({ code: 'ABCDEF23' });
    expect(publicBrandQuerySchema.parse({ domain: 'Hub.Exemple.ca' })).toEqual({ domain: 'hub.exemple.ca' });
    expect(publicBrandQuerySchema.safeParse({ code: 'ABCDEF23', domain: 'hub.exemple.ca' }).success).toBe(false);
    expect(publicBrandQuerySchema.safeParse({}).success).toBe(false);
  });
});

describe('permissions de la marque (catalogue)', () => {
  it('brand.edit et domains.manage vont aux organisations ; domains.verify reste à la plateforme', () => {
    expect(PERMISSIONS['brand.edit']).toMatchObject({ module: 'organization', sensitive: false, platformOnly: false });
    expect(PERMISSIONS['domains.verify'].platformOnly).toBe(true);
    expect(systemRole('org_owner')!.permissions).toContain('brand.edit');
    expect(systemRole('org_admin')!.permissions).toContain('domains.manage');
    expect(systemRole('org_admin')!.permissions).not.toContain('domains.verify');
    expect(systemRole('platform_admin')!.permissions).toContain('domains.verify');
    for (const role of SYSTEM_ROLES.filter((r) => r.level >= 2)) expect(role.permissions).not.toContain('brand.edit');
  });
});
