import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** `localStorage` du navigateur (web seulement), typé sans dépendre des types du DOM. */
const web = globalThis as { localStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void } };

export interface SecureStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * Stockage persistant : trousseau iOS et Keystore Android (SecureStore) sur mobile ; `localStorage` sur le web, qui ne
 * sert qu'aux démonstrations et aux tests. Les jetons n'y sont jamais écrits en clair ailleurs.
 * `readableWhenLocked` : lisible écran verrouillé après le premier déverrouillage (tâche de localisation du chauffeur
 * relancée en arrière-plan) ; sinon, lisible seulement téléphone déverrouillé (réglage par défaut du trousseau).
 */
export function createSecureStorage(options: { readableWhenLocked?: boolean } = {}): SecureStorage {
  const native: SecureStore.SecureStoreOptions = options.readableWhenLocked ? { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK } : {};
  return {
    async getItem(key) {
      if (Platform.OS === 'web') return web.localStorage?.getItem(key) ?? null;
      return SecureStore.getItemAsync(key, native);
    },
    async setItem(key, value) {
      if (Platform.OS === 'web') {
        web.localStorage?.setItem(key, value);
        return;
      }
      await SecureStore.setItemAsync(key, value, native);
    },
    async removeItem(key) {
      if (Platform.OS === 'web') {
        web.localStorage?.removeItem(key);
        return;
      }
      await SecureStore.deleteItemAsync(key, native);
    },
  };
}

export const secureStorage = createSecureStorage();
