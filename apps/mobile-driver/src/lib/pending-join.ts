import { create } from 'zustand';

/** Code de rattachement reçu par un lien avant la connexion (étape 22) : gardé en mémoire jusqu'à l'ouverture de la session. */
export const usePendingJoin = create<{ code: string | null; set: (code: string | null) => void }>((set) => ({ code: null, set: (code) => set({ code }) }));

/** Jeton d'invitation de flotte reçu par un lien avant la connexion (étape 23) : l'écran d'acceptation reprend après la connexion. */
export const usePendingFleetInvitation = create<{ token: string | null; set: (token: string | null) => void }>((set) => ({ token: null, set: (token) => set({ token }) }));
