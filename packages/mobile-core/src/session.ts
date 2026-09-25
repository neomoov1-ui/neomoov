import type { MeView, TokensView } from '@neomoov/domain';
import { create } from 'zustand';
import { secureStorage } from './storage';

interface StoredSession {
  accessToken: string;
  refreshToken: string;
  user: MeView;
}

export interface SessionState {
  status: 'loading' | 'signedOut' | 'signedIn';
  accessToken: string | null;
  refreshToken: string | null;
  user: MeView | null;
  /** Relit la session enregistrée au démarrage. */
  load: () => Promise<void>;
  signIn: (tokens: TokensView) => Promise<void>;
  setUser: (user: MeView) => Promise<void>;
  signOut: () => Promise<void>;
}

/**
 * Session d'une application : jetons (rotation par l'API) et profil, gardés dans le stockage sécurisé sous une clé
 * propre à l'application (le client et le chauffeur peuvent être installés sur le même téléphone).
 */
export function createSessionStore(storageKey: string) {
  const persist = async (session: StoredSession | null): Promise<void> => {
    if (session) await secureStorage.setItem(storageKey, JSON.stringify(session));
    else await secureStorage.removeItem(storageKey);
  };
  return create<SessionState>((set, get) => ({
    status: 'loading',
    accessToken: null,
    refreshToken: null,
    user: null,
    async load() {
      try {
        const raw = await secureStorage.getItem(storageKey);
        const stored = raw ? (JSON.parse(raw) as StoredSession) : null;
        if (stored?.accessToken && stored.refreshToken && stored.user) {
          set({ status: 'signedIn', accessToken: stored.accessToken, refreshToken: stored.refreshToken, user: stored.user });
          return;
        }
      } catch {
        // Session illisible : on repart d'une connexion.
      }
      set({ status: 'signedOut', accessToken: null, refreshToken: null, user: null });
    },
    async signIn(tokens) {
      set({ status: 'signedIn', accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, user: tokens.user });
      await persist({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, user: tokens.user });
    },
    async setUser(user) {
      const { accessToken, refreshToken } = get();
      set({ user });
      if (accessToken && refreshToken) await persist({ accessToken, refreshToken, user });
    },
    async signOut() {
      set({ status: 'signedOut', accessToken: null, refreshToken: null, user: null });
      await persist(null);
    },
  }));
}
