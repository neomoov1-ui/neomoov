import { create } from 'zustand';

/** Code de rattachement reçu par un lien avant la connexion (étape 22) : gardé en mémoire jusqu'à l'ouverture de la session. */
export const usePendingJoin = create<{ code: string | null; set: (code: string | null) => void }>((set) => ({ code: null, set: (code) => set({ code }) }));
