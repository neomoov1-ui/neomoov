import { randomBytes } from 'node:crypto';
import { createDatabase, schema } from '@neomoov/db';
import { and, eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import type { OAuthProvider, StoredOAuthTokens } from '../src/adapters/real/oauth.js';
import { OAUTH_SETTINGS_SCOPE, SettingsTokenStore } from '../src/adapters/real/oauth-store.js';
import { testEnv } from './helpers.js';

/**
 * Magasin des jetons OAuth renouvelés (X, TikTok ; 3 octobre 2026) dans la base de développement : valeur chiffrée
 * (jamais le jeton en clair), relue par un autre processus, illisible avec une autre clé, hors de la portée `global`
 * des réglages de My Hub. Les lignes d'essai portent un fournisseur inventé et sont retirées à la fin.
 */
const env = testEnv();
const database = env ? createDatabase({ url: env.DATABASE_URL, max: 1 }) : null;
const provider = `essai-${randomBytes(4).toString('hex')}` as OAuthProvider;

afterAll(async () => {
  if (!database) return;
  await database.db.delete(schema.settings).where(and(eq(schema.settings.scope, OAUTH_SETTINGS_SCOPE), like(schema.settings.key, 'oauth.essai-%')));
  await database.close();
});

describe('magasin des jetons OAuth (base)', () => {
  it('garde le jeton chiffré, le rend à un autre processus, refuse une autre clé', async ({ skip }) => {
    if (!database) return skip('DATABASE_URL absente');
    const tokens: StoredOAuthTokens = { origin: 'empreinte', refreshToken: 'rt-tres-secret-123', refreshExpiresAt: null, accessToken: 'acces-tres-secret-456', accessExpiresAt: Date.parse('2026-10-03T14:00:00Z') };
    const store = new SettingsTokenStore(database, 'cle-de-chiffrement-de-essai-32-caracteres');
    expect(await store.load(provider)).toBeNull();
    await store.save(provider, tokens);
    const [row] = await database.db.select().from(schema.settings).where(and(eq(schema.settings.key, `oauth.${provider}`), eq(schema.settings.scope, OAUTH_SETTINGS_SCOPE)));
    expect(row).toBeTruthy();
    expect(JSON.stringify(row!.value)).not.toMatch(/secret|rt-tres|acces-tres/);
    expect((row!.value as { sealed: string }).sealed).toMatch(/^v1\./);
    // Un autre processus (même clé) relit l'état ; une mise à jour remplace la ligne.
    const other = new SettingsTokenStore(database, 'cle-de-chiffrement-de-essai-32-caracteres');
    expect(await other.load(provider)).toEqual(tokens);
    await other.save(provider, { ...tokens, refreshToken: 'rt-suivant' });
    expect((await store.load(provider))?.refreshToken).toBe('rt-suivant');
    expect(await database.db.select().from(schema.settings).where(eq(schema.settings.key, `oauth.${provider}`))).toHaveLength(1);
    // Autre clé : rien n'est rendu (l'autorisation repart du jeton de l'environnement).
    expect(await new SettingsTokenStore(database, 'une-autre-cle-de-chiffrement-32-car').load(provider)).toBeNull();
  });
});
