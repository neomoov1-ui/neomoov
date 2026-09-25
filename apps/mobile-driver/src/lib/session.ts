import { createSessionStore } from '@neomoov/mobile-core/session';
import { driverStorage } from './storage';

/** Session du chauffeur, séparée de celle de l'application client (les deux peuvent être installées). */
export const useSession = createSessionStore('neomoov.driver.session', driverStorage);

/** Le compte porte le rôle chauffeur (candidature faite) : l'espace chauffeur et le socket `/driver` sont accessibles. */
export function useHasDriverRole(): boolean {
  return useSession((s) => s.user?.roles.includes('driver') ?? false);
}
