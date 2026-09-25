import { createSessionStore } from '@neomoov/mobile-core/session';

/** Session de l'utilisateur : jetons (rotation par l'API) et profil, gardés dans le stockage sécurisé. */
export const useSession = createSessionStore('neomoov.session');
