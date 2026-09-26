/**
 * Chiffrement applicatif des champs sensibles (cahier des charges 10.3, prompt 14) : numéros de TPS et de TVQ des
 * chauffeurs, numéros de leurs documents (permis, police d'assurance, immatriculation…). AES-256-GCM avec une clé
 * dérivée de `ENCRYPTION_KEY` par HKDF (étiquette propre : jamais la clé brute, distincte des jetons de facture et des
 * pseudonymes de géolocalisation). Format : `v1.<iv>.<données>.<étiquette>` en base64url, comme les secrets TOTP.
 *
 * Lecture tolérante : une valeur en clair (lignes écrites avant l'étape 14) est rendue telle quelle, jusqu'au passage du
 * script de rattrapage `fields:encrypt`. Une valeur chiffrée avec une autre clé n'est jamais rendue : lecture en erreur.
 * La facture garde sa copie en clair du numéro de taxes du fournisseur : c'est une mention légale du document émis.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_ENV, type AppEnv } from '../config/env.js';

const LABEL = 'neomoov:fields:v1';
const PREFIX = 'v1.';

export function deriveFieldKey(encryptionKey: string): Buffer {
  return Buffer.from(hkdfSync('sha256', encryptionKey, Buffer.alloc(0), LABEL, 32));
}

export function isEncryptedField(value: string): boolean {
  return value.startsWith(PREFIX) && value.split('.').length === 4;
}

export function encryptField(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), data.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
}

export function decryptField(value: string, key: Buffer): string {
  if (!isEncryptedField(value)) return value;
  const [, iv, data, tag] = value.split('.') as [string, string, string, string];
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

@Injectable()
export class FieldCipher {
  private readonly key: Buffer;

  constructor(@Inject(APP_ENV) env: AppEnv) {
    if (!env.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY absente : chiffrement des champs sensibles impossible');
    this.key = deriveFieldKey(env.ENCRYPTION_KEY);
  }

  /** Chiffre une valeur ; vide ou absente : null. Une valeur déjà chiffrée n'est pas chiffrée deux fois. */
  encrypt(value: string | null | undefined): string | null {
    if (value === null || value === undefined || value === '') return null;
    return isEncryptedField(value) ? value : encryptField(value, this.key);
  }

  decrypt(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    return decryptField(value, this.key);
  }
}
