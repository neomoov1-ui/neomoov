import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Stockage persistant : trousseau iOS et Keystore Android (SecureStore) sur mobile ; `localStorage` sur le web, qui ne
 * sert qu'aux démonstrations et aux tests. Les jetons n'y sont jamais écrits en clair ailleurs.
 */
export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
    return SecureStore.getItemAsync(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  async removeItem(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.removeItem(key);
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};
