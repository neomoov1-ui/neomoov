/**
 * Session de saisie de carte (étape 26) : jeton court signé qui ouvre la page `/carte` du web pour un utilisateur donné,
 * sans jamais exposer son jeton d'accès dans une adresse. Signé en HMAC-SHA256 avec une clé dérivée par HKDF de
 * `ENCRYPTION_KEY` sous une étiquette propre (même approche que les liens de vérification des factures).
 * Jeton de 46 octets en base64url : version (1), objet (1 : carte du client ou méthode de prélèvement du chauffeur),
 * identifiant de l'utilisateur (16), expiration en secondes (4), aléa (8), 16 premiers octets de la signature.
 * Revue du 2 octobre 2026 (sécurité 16) : 10 minutes au lieu de 15, usage unique (consommée par la première
 * confirmation réussie, voir `PaymentsService.confirmCardSession`), transportée dans le fragment de l'adresse (jamais
 * envoyé à un serveur) puis dans le corps des requêtes, et désignée dans le magasin d'usage par son empreinte seulement.
 */
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

const VERSION = 1;
const LABEL = 'neomoov/card-session/v1';
const MAC_BYTES = 16;
const BODY_BYTES = 1 + 1 + 16 + 4 + 8;
/** Durée de validité d'une session (10 minutes : saisie et vérification 3-D Secure comprises). */
export const CARD_SESSION_TTL_MS = 10 * 60_000;

/** Empreinte d'une session (SHA-256) : clé de son usage unique, jamais le jeton lui-même. */
export function cardSessionFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 32);
}

export const CARD_SESSION_PURPOSES = ['client_card', 'driver_debit'] as const;
export type CardSessionPurpose = (typeof CARD_SESSION_PURPOSES)[number];

export interface CardSession {
  userId: string;
  purpose: CardSessionPurpose;
  expiresAt: Date;
}

export type CardSessionCheck = { ok: true; session: CardSession } | { ok: false; reason: 'invalid' | 'expired' };

/** Clé de signature des sessions, dérivée (HKDF-SHA256, 32 octets) du secret de chiffrement de l'API. */
export function cardSessionKey(encryptionKey: string): Buffer {
  return Buffer.from(hkdfSync('sha256', encryptionKey, Buffer.alloc(0), LABEL, 32));
}

function uuidBytes(id: string): Buffer {
  const hex = id.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error('Identifiant d\'utilisateur invalide');
  return Buffer.from(hex, 'hex');
}

function uuidOf(bytes: Buffer): string {
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function mac(key: Buffer, body: Buffer): Buffer {
  return createHmac('sha256', key).update(body).digest().subarray(0, MAC_BYTES);
}

export function signCardSession(session: CardSession, key: Buffer): string {
  const purpose = CARD_SESSION_PURPOSES.indexOf(session.purpose);
  if (purpose < 0) throw new Error('Objet de session inconnu');
  const expires = Buffer.alloc(4);
  expires.writeUInt32BE(Math.floor(session.expiresAt.getTime() / 1000));
  const body = Buffer.concat([Buffer.from([VERSION, purpose]), uuidBytes(session.userId), expires, randomBytes(8)]);
  return Buffer.concat([body, mac(key, body)]).toString('base64url');
}

/** Session si le jeton est authentique et non expiré (comparaison en temps constant), sinon le motif du refus. */
export function verifyCardSession(token: string, key: Buffer, now = new Date()): CardSessionCheck {
  let raw: Buffer;
  try {
    raw = Buffer.from(token, 'base64url');
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (raw.length !== BODY_BYTES + MAC_BYTES || raw[0] !== VERSION) return { ok: false, reason: 'invalid' };
  const body = raw.subarray(0, BODY_BYTES);
  if (!timingSafeEqual(raw.subarray(BODY_BYTES), mac(key, body))) return { ok: false, reason: 'invalid' };
  const purpose = CARD_SESSION_PURPOSES[body[1]!];
  if (!purpose) return { ok: false, reason: 'invalid' };
  const expiresAt = new Date(body.readUInt32BE(18) * 1000);
  if (expiresAt.getTime() <= now.getTime()) return { ok: false, reason: 'expired' };
  return { ok: true, session: { userId: uuidOf(body.subarray(2, 18)), purpose, expiresAt } };
}
