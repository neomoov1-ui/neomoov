/**
 * Primitives cryptographiques de l'API (section 8) : hachage, jetons aléatoires, chiffrement applicatif AES-256-GCM
 * (clé dérivée de ENCRYPTION_KEY), TOTP (RFC 6238) pour le second facteur du personnel. Aucune dépendance externe.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/** HMAC-SHA256 en hexadécimal : sert à hacher les codes SMS avec un secret serveur (un vol de la table ne suffit pas à les rejouer). */
export function hmacHex(secret: string, input: string): string {
  return createHmac('sha256', secret).update(input).digest('hex');
}

/** Jeton aléatoire sûr en base64url (32 octets par défaut, 43 caractères). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Code numérique aléatoire à `digits` chiffres, uniforme (randomInt), avec zéros de tête. */
export function randomDigits(digits = 6): string {
  return randomInt(0, 10 ** digits).toString().padStart(digits, '0');
}

/** Code de secours lisible : xxxx-xxxx en minuscules et chiffres, sans caractères ambigus. */
export function randomBackupCode(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const part = () => Array.from({ length: 4 }, () => alphabet[randomInt(0, alphabet.length)]).join('');
  return `${part()}-${part()}`;
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

/** Chiffre une chaîne : `v1.<iv>.<données>.<étiquette>` en base64url. Une clé différente ne déchiffre pas. */
export function encryptString(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), data.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
}

export function decryptString(payload: string, secret: string): string {
  const [version, iv, data, tag] = payload.split('.');
  if (version !== 'v1' || !iv || !data || !tag) throw new Error('Format chiffré inconnu');
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

// --- TOTP (RFC 6238, HMAC-SHA1, 30 secondes, 6 chiffres : le profil des applications d'authentification courantes) ---

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Secret TOTP de 20 octets (160 bits, recommandation RFC 4226), en base32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpCode(secretBase32: string, atMs = Date.now(), stepSeconds = 30, digits = 6): string {
  const counter = Math.floor(atMs / 1000 / stepSeconds);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secretBase32)).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24) | (digest[offset + 1]! << 16) | (digest[offset + 2]! << 8) | digest[offset + 3]!;
  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

/**
 * Vérifie un code TOTP avec une tolérance de `window` pas de temps de chaque côté (dérive d'horloge du téléphone).
 * Renvoie le pas de temps accepté, pour interdire le rejeu du même code, ou null.
 */
export function verifyTotp(secretBase32: string, code: string, atMs = Date.now(), window = 1, stepSeconds = 30): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  for (let delta = -window; delta <= window; delta += 1) {
    const at = atMs + delta * stepSeconds * 1000;
    if (constantTimeEqual(totpCode(secretBase32, at, stepSeconds), code)) return Math.floor(at / 1000 / stepSeconds);
  }
  return null;
}

export function otpauthUri(issuer: string, account: string, secretBase32: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
