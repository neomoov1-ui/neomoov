import { create } from 'zustand';
import type { NavigationApp } from './navigation';
import { driverStorage } from './storage';

const KEY = 'neomoov.driver.preferences';

interface Preferences {
  /** Mode économie de données : carte masquée pendant la course, rafraîchissements espacés (positions toujours envoyées). */
  dataSaver: boolean;
  navigationApp: NavigationApp;
}

interface PreferencesState extends Preferences {
  load: () => Promise<void>;
  set: (patch: Partial<Preferences>) => Promise<void>;
}

/** Réglages de l'appareil (pas du compte) : gardés sur le téléphone. */
export const usePreferences = create<PreferencesState>((set, get) => ({
  dataSaver: false,
  navigationApp: 'google',
  async load() {
    try {
      const raw = await driverStorage.getItem(KEY);
      if (raw) set(JSON.parse(raw) as Partial<Preferences>);
    } catch {
      // Réglages illisibles : valeurs par défaut.
    }
  },
  async set(patch) {
    set(patch);
    const { dataSaver, navigationApp } = get();
    await driverStorage.setItem(KEY, JSON.stringify({ dataSaver, navigationApp }));
  },
}));
