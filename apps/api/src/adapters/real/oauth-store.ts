/**
 * Magasin des jetons OAuth renouvelés (X et TikTok remplacent le jeton de rafraîchissement à chaque échange) : ligne
 * `oauth.<fournisseur>` de la table des réglages, portée `oauth` (jamais listée ni modifiable dans My Hub, qui ne lit
 * que la portée `global`), valeur chiffrée en AES-256-GCM avec une clé dérivée de `ENCRYPTION_KEY` par HKDF sous une
 * étiquette propre (mêmes primitives que les champs sensibles, jamais la clé brute). Partagé par l'API et le worker.
 */
import { hkdfSync } from 'node:crypto';
import { schema } from '@neomoov/db';
import { and, eq, sql } from 'drizzle-orm';
import { decryptField, encryptField } from '../../common/field-cipher.js';
import type { AppEnv } from '../../config/env.js';
import type { Database } from '../../infra/db.module.js';
import { MemoryTokenStore, type OAuthProvider, type OAuthTokenStore, type StoredOAuthTokens } from './oauth.js';

const LABEL = 'neomoov:oauth-tokens:v1';
export const OAUTH_SETTINGS_SCOPE = 'oauth';

export function deriveOAuthKey(encryptionKey: string): Buffer {
  return Buffer.from(hkdfSync('sha256', encryptionKey, Buffer.alloc(0), LABEL, 32));
}

export class SettingsTokenStore implements OAuthTokenStore {
  readonly #key: Buffer;

  constructor(private readonly database: Database, encryptionKey: string) {
    this.#key = deriveOAuthKey(encryptionKey);
  }

  toJSON() {
    return { name: 'settings', scope: OAUTH_SETTINGS_SCOPE };
  }

  async load(provider: OAuthProvider): Promise<StoredOAuthTokens | null> {
    const [row] = await this.database.db
      .select({ value: schema.settings.value })
      .from(schema.settings)
      .where(and(eq(schema.settings.key, `oauth.${provider}`), eq(schema.settings.scope, OAUTH_SETTINGS_SCOPE)))
      .limit(1);
    const sealed = (row?.value as { sealed?: unknown } | undefined)?.sealed;
    if (typeof sealed !== 'string') return null;
    try {
      const parsed = JSON.parse(decryptField(sealed, this.#key)) as StoredOAuthTokens;
      return typeof parsed.refreshToken === 'string' && typeof parsed.origin === 'string' ? parsed : null;
    } catch {
      // Clé changée ou valeur abîmée : l'autorisation repart du jeton de l'environnement.
      return null;
    }
  }

  async save(provider: OAuthProvider, tokens: StoredOAuthTokens): Promise<void> {
    const value = { sealed: encryptField(JSON.stringify(tokens), this.#key), savedAt: new Date().toISOString() };
    await this.database.db
      .insert(schema.settings)
      .values({ key: `oauth.${provider}`, scope: OAUTH_SETTINGS_SCOPE, value, description: 'Jetons OAuth renouvelés du connecteur (chiffrés, jamais affichés)' })
      .onConflictDoUpdate({ target: [schema.settings.key, schema.settings.scope], set: { value, updatedAt: sql`now()` } });
  }
}

/** Magasin de la base si `ENCRYPTION_KEY` est posée (toujours en production), sinon en mémoire. */
export function oauthTokenStore(env: Pick<AppEnv, 'ENCRYPTION_KEY'>, database: Database | null): OAuthTokenStore {
  return database && env.ENCRYPTION_KEY ? new SettingsTokenStore(database, env.ENCRYPTION_KEY) : new MemoryTokenStore();
}
