/**
 * Code de rattachement d'une organisation (étape 22, amendement v1.2 section 5) : 8 caractères pris dans un alphabet
 * sans ambiguïté (ni 0 et O, ni 1, I et L), généré à la création de l'organisation, imprimé sur un code QR ou porté par
 * le lien `https://neomoov.net/c/<code>`. Un client le saisit dans l'application unique pour rattacher son profil à
 * l'organisation et recevoir sa marque. Fonctions pures : la base garantit l'unicité (index).
 */
import { z } from 'zod';

export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const JOIN_CODE_LENGTH = 8;
const JOIN_CODE = new RegExp(`^[${JOIN_CODE_ALPHABET}]{${JOIN_CODE_LENGTH}}$`);

/** Code aléatoire ; `random` renvoie un nombre dans [0, 1) (Math.random par défaut, source cryptographique côté API). */
export function generateJoinCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < JOIN_CODE_LENGTH; i += 1) {
    const index = Math.min(JOIN_CODE_ALPHABET.length - 1, Math.max(0, Math.floor(random() * JOIN_CODE_ALPHABET.length)));
    code += JOIN_CODE_ALPHABET[index];
  }
  return code;
}

/** Saisie tolérante : majuscules, espaces et tirets retirés (« abcd-ef23 » devient « ABCDEF23 »). */
export function normalizeJoinCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]+/g, '');
}

export function isJoinCode(value: string): boolean {
  return JOIN_CODE.test(value);
}

/** Code tel que saisi par une personne (normalisé) ou lu dans un lien. */
export const joinCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .transform(normalizeJoinCode)
  .pipe(z.string().regex(JOIN_CODE, 'Code de rattachement de 8 lettres et chiffres attendu'));

/** Lien de rattachement porté par le code QR et les invitations : `<site>/c/<code>`. */
export function joinLink(webBaseUrl: string, code: string): string {
  return `${webBaseUrl.replace(/\/+$/, '')}/c/${normalizeJoinCode(code)}`;
}
