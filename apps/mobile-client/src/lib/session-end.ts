/**
 * Sortie de session de l'application client (revue du 2 octobre 2026, constat mobile 13) : déconnexion, suppression du
 * compte et session perdue (jeton de rafraîchissement refusé) passent par la même routine. Dans l'ordre : notifications
 * désinscrites, session révoquée auprès de l'API (déconnexion demandée seulement), file hors ligne vidée (rien ne sera
 * rejoué pour un autre compte), socket fermé, cache des requêtes et brouillon de réservation vidés, session effacée.
 * Chargé par la racine de l'application, ce module branche la routine sur les refus de l'API (`handleSessionLost`).
 */
import { createSessionEnd } from '@neomoov/mobile-core/session-end';
import { useBooking } from '@/features/booking/store';
import { api, handleSessionLost, offlineQueue } from './api';
import { reportMobileError } from './observability';
import { forgetPush, unregisterPush } from './push';
import { queryClient } from './queries';
import { disconnectRealtime } from './realtime';
import { useSession } from './session';

export const endSession = createSessionEnd(
  [
    { name: 'push', run: (reason) => (reason === 'logout' ? unregisterPush() : forgetPush()) },
    {
      name: 'revoke',
      run: async (reason) => {
        if (reason !== 'logout') return;
        const refreshToken = useSession.getState().refreshToken;
        await api.auth.logout(refreshToken ? { refreshToken } : {});
      },
    },
    { name: 'offline-queue', run: () => offlineQueue.clear() },
    { name: 'realtime', run: () => disconnectRealtime() },
    { name: 'queries', run: () => queryClient.clear() },
    { name: 'booking', run: () => useBooking.getState().reset() },
    { name: 'session', run: () => useSession.getState().signOut() },
  ],
  (step, error) => reportMobileError(error, { source: 'session-end', step }),
);

handleSessionLost(() => void endSession('expired'));
