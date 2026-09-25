import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, decryptString, encryptString, generateTotpSecret, otpauthUri, randomBackupCode, randomDigits, totpCode, verifyTotp } from '../src/common/crypto.js';
import { hashPassword, verifyPassword } from '../src/common/passwords.js';
import { RateLimitService } from '../src/common/rate-limit.service.js';
import { maskSensitive } from '../src/modules/audit/audit.service.js';
import { ApiKeysService } from '../src/modules/auth/api-keys.service.js';
import { anonymizedPhone } from '../src/modules/privacy/privacy-jobs.service.js';

describe('primitives de sécurité', () => {
  it('TOTP : vecteurs de la RFC 6238 (SHA-1, 30 s, 6 chiffres) et fenêtre de tolérance', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(totpCode(secret, 59 * 1000)).toBe('287082');
    expect(totpCode(secret, 1_111_111_109 * 1000)).toBe('081804');
    expect(totpCode(secret, 1_234_567_890 * 1000)).toBe('005924');
    expect(verifyTotp(secret, '287082', 59 * 1000)).toBe(1);
    expect(verifyTotp(secret, '287082', 75 * 1000)).toBe(1); // pas précédent (30 à 59 s), dans la fenêtre de tolérance
    expect(verifyTotp(secret, '287082', 150 * 1000)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', 59 * 1000)).toBeNull();
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
    expect(otpauthUri('Neomoov My Hub', 'admin@neomoov.net', secret)).toBe(`otpauth://totp/Neomoov%20My%20Hub%3Aadmin%40neomoov.net?secret=${secret}&issuer=Neomoov%20My%20Hub&algorithm=SHA1&digits=6&period=30`);
  });

  it('chiffrement applicatif : aller-retour, clé différente refusée, format inconnu refusé', () => {
    const payload = encryptString('secret-totp', 'cle-a');
    expect(payload).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(decryptString(payload, 'cle-a')).toBe('secret-totp');
    expect(() => decryptString(payload, 'cle-b')).toThrow();
    expect(() => decryptString('v0.x.y.z', 'cle-a')).toThrow(/Format/);
    expect(encryptString('x', 'k')).not.toBe(encryptString('x', 'k'));
  });

  it('codes aléatoires : six chiffres avec zéros de tête, codes de secours lisibles', () => {
    for (let i = 0; i < 50; i += 1) expect(randomDigits(6)).toMatch(/^\d{6}$/);
    expect(randomBackupCode()).toMatch(/^[a-hj-kmnp-z2-9]{4}-[a-hj-kmnp-z2-9]{4}$/);
    expect(anonymizedPhone('6f1c2a9e-0000-4000-8000-000000000042')).toMatch(/^\+999\d{11}$/);
    expect(anonymizedPhone('a')).not.toBe(anonymizedPhone('b'));
  });

  it('argon2id : vérifie le bon mot de passe, refuse les autres et un haché invalide', async () => {
    const hash = await hashPassword('Correct-Horse-Battery-1');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword('Correct-Horse-Battery-1', hash)).toBe(true);
    expect(await verifyPassword('correct-horse-battery-1', hash)).toBe(false);
    expect(await verifyPassword('x', 'pas-un-haché')).toBe(false);
  });

  it('limitation de débit en mémoire : fenêtre fixe, drapeaux, remise à zéro', async () => {
    const limiter = new RateLimitService(null);
    for (let i = 1; i <= 3; i += 1) expect((await limiter.hit('k', 3, 60)).allowed).toBe(true);
    const fourth = await limiter.hit('k', 3, 60);
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
    expect(fourth.resetIn).toBeGreaterThan(0);
    await limiter.reset('k');
    expect((await limiter.hit('k', 3, 60)).remaining).toBe(2);
    expect(await limiter.claimOnce('once', 60)).toBe(true);
    expect(await limiter.claimOnce('once', 60)).toBe(false);
    expect(await limiter.hasFlag('f')).toBe(false);
    await limiter.flag('f', 60);
    expect(await limiter.hasFlag('f')).toBe(true);
  });

  it('masque les données sensibles du journal d\'audit', () => {
    const masked = maskSensitive({ email: 'a@b.c', password: 'x', accessToken: 'y', nested: { totpSecret: 'z', code: '123456', ok: 1 }, list: [{ key: 'k' }], long: 'a'.repeat(600), when: new Date('2026-09-25T00:00:00Z') }) as Record<string, unknown>;
    expect(masked['email']).toBe('a@b.c');
    expect(masked['password']).toBe('[masqué]');
    expect(masked['accessToken']).toBe('[masqué]');
    expect((masked['nested'] as Record<string, unknown>)['totpSecret']).toBe('[masqué]');
    expect((masked['nested'] as Record<string, unknown>)['code']).toBe('[masqué]');
    expect((masked['nested'] as Record<string, unknown>)['ok']).toBe(1);
    expect((masked['list'] as Array<Record<string, unknown>>)[0]!['key']).toBe('[masqué]');
    expect((masked['long'] as string).length).toBe(501);
    expect(masked['when']).toBe('2026-09-25T00:00:00.000Z');
  });

  it('portées des clés de service : exacte, joker, toute clé', () => {
    const actor = { kind: 'service' as const, apiKeyId: 'k', name: 'n', scopes: ['tools:*', 'rides:read'], agentCode: null };
    expect(ApiKeysService.hasScope(actor, ['rides:read'])).toBe(true);
    expect(ApiKeysService.hasScope(actor, ['tools:dispatch'])).toBe(true);
    expect(ApiKeysService.hasScope(actor, ['rides:write'])).toBe(false);
    expect(ApiKeysService.hasScope(actor, ['*'])).toBe(true);
    expect(ApiKeysService.hasScope({ ...actor, scopes: [] }, ['*'])).toBe(false);
  });
});
