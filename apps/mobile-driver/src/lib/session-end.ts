/**
 * Sortie de session de l'application chauffeur (revue du 2 octobre 2026, constats mobile 2 et 22) : déconnexion,
 * suppression du compte et session perdue (jeton de rafraîchissement refusé, même depuis la tâche de localisation en
 * arrière-plan) passent par la même routine. Dans l'ordre : hors ligne (plus aucune position ne part, service de premier
 * plan arrêté, file des positions effacée), sonnerie d'offre arrêtée, notifications désinscrites, session révoquée
 * auprès de l'API (déconnexion demandée seulement), socket fermé, cache des requêtes vidé, session effacée.
 * Chargé par la racine de l'application, ce module branche la routine sur les refus de l'API (`handleSessionLost`).
 */
import { createSessionEnd } from '@neomoov/mobile-core/session-end';
import { api, handleSessionLost } from './api';
import { stopLocationUpdates } from './location';
import { reportMobileError } from './observability';
import { stopOfferAlert } from './offer-alert';
import { changeStatus } from './presence';
import { forgetPush, unregisterPush } from './push';
import { queryClient } from './queries';
import { disconnectRealtime } from './realtime';
import { useSession } from './session';

export const endSession = createSessionEnd(
  [
    // Déconnexion demandée : l'API est prévenue (hors ligne) ; sinon elle ne répond plus pour ce compte, la présence expire d'elle-même.
    { name: 'location', run: (reason) => (reason === 'logout' ? changeStatus('offline') : stopLocationUpdates()) },
    { name: 'offer-alert', run: () => stopOfferAlert() },
    { name: 'push', run: (reason) => (reason === 'logout' ? unregisterPush() : forgetPush()) },
    {
      name: 'revoke',
      run: async (reason) => {
        if (reason !== 'logout') return;
        const refreshToken = useSession.getState().refreshToken;
        await api.auth.logout(refreshToken ? { refreshToken } : {});
      },
    },
    { name: 'realtime', run: () => disconnectRealtime() },
    { name: 'queries', run: () => queryClient.clear() },
    { name: 'session', run: () => useSession.getState().signOut() },
  ],
  (step, error) => reportMobileError(error, { source: 'session-end', step }),
);

handleSessionLost(() => void endSession('expired'));
