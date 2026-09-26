/**
 * Lien de vérification publique d'une facture (code QR, section 5.13). Le jeton est signé en HMAC-SHA256 avec une clé
 * dérivée par HKDF de `ENCRYPTION_KEY` sous une étiquette propre : la clé brute, qui chiffre aussi les secrets TOTP, ne
 * sert jamais directement. Jeton de 33 octets en base64url (44 caractères) : version (1 octet), identifiant de la facture
 * (16 octets), 16 premiers octets de la signature. Un jeton altéré, d'une autre version ou d'une autre clé est refusé.
 */
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

const VERSION = 1;
const LABEL = 'neomoov/invoice-verification/v1';
const MAC_BYTES = 16;

/** Clé de signature des liens de vérification, dérivée (HKDF-SHA256, 32 octets) du secret de chiffrement de l'API. */
export function invoiceVerificationKey(encryptionKey: string): Buffer {
  return Buffer.from(hkdfSync('sha256', encryptionKey, Buffer.alloc(0), LABEL, 32));
}

function uuidBytes(id: string): Buffer {
  const hex = id.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error('Identifiant de facture invalide');
  return Buffer.from(hex, 'hex');
}

function uuidOf(bytes: Buffer): string {
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function mac(key: Buffer, body: Buffer): Buffer {
  return createHmac('sha256', key).update(body).digest().subarray(0, MAC_BYTES);
}

export function signInvoiceToken(invoiceId: string, key: Buffer): string {
  const body = Buffer.concat([Buffer.from([VERSION]), uuidBytes(invoiceId)]);
  return Buffer.concat([body, mac(key, body)]).toString('base64url');
}

/** Identifiant de la facture si le jeton est authentique, sinon null (comparaison en temps constant). */
export function verifyInvoiceToken(token: string, key: Buffer): string | null {
  const raw = Buffer.from(token, 'base64url');
  if (raw.length !== 1 + 16 + MAC_BYTES || raw[0] !== VERSION) return null;
  const body = raw.subarray(0, 17);
  return timingSafeEqual(raw.subarray(17), mac(key, body)) ? uuidOf(body.subarray(1)) : null;
}

/** Adresse du code QR : la page de vérification (réglage `invoices.verification_base_url`) avec le jeton en paramètre `t`. */
export function verificationUrl(baseUrl: string, token: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set('t', token);
  return url.toString();
}
