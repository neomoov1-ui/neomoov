import type { MeView, TokensView } from '@neomoov/domain';
import { create } from 'zustand';
import { secureStorage } from './storage';

const KEY = 'neomoov.session';

interface StoredSession {
  accessToken: string;
  refreshToken: string;
  user: MeView;
}

interface SessionState {
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

async function persist(session: StoredSession | null): Promise<void> {
  if (session) await secureStorage.setItem(KEY, JSON.stringify(session));
  else await secureStorage.removeItem(KEY);
}

/** Session de l'utilisateur : jetons (rotation par l'API) et profil, gardés dans le stockage sécurisé. */
export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  accessToken: null,
  refreshToken: null,
  user: null,
  async load() {
    try {
      const raw = await secureStorage.getItem(KEY);
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
