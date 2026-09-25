/**
 * Mots de passe du personnel de My Hub : argon2id (recommandation OWASP : 64 Mio, 3 itérations, parallélisme 1), en
 * WebAssembly (hash-wasm) pour éviter un module natif à compiler sur le serveur. Clients et chauffeurs n'ont pas de mot de passe.
 */
import { argon2Verify, argon2id } from 'hash-wasm';
import { randomBytes } from 'node:crypto';

export async function hashPassword(password: string): Promise<string> {
  return argon2id({ password, salt: randomBytes(16), parallelism: 1, iterations: 3, memorySize: 65_536, hashLength: 32, outputType: 'encoded' });
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash: encodedHash });
  } catch {
    return false;
  }
}

/** Hachage de référence, vérifié quand le courriel est inconnu : le temps de réponse ne révèle pas l'existence du compte. */
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}
