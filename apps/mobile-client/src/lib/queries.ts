import type { RideView } from '@neomoov/domain';
import { MutationCache, QueryCache, QueryClient, useQuery } from '@tanstack/react-query';
import { ApiError } from '@neomoov/api-client';
import { api } from './api';
import { POLL_FALLBACK_MS } from './config';
import { reportMobileError } from './observability';
import { useSession } from './session';

export const queryClient = new QueryClient({
  // Une panne de l'API (5xx) est signalée au suivi des erreurs avec son identifiant de corrélation.
  queryCache: new QueryCache({ onError: (error) => reportMobileError(error, { source: 'query' }) }),
  mutationCache: new MutationCache({ onError: (error) => reportMobileError(error, { source: 'mutation' }) }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Pas de nouvelle tentative sur un refus de l'API (4xx) : seulement sur panne réseau ou erreur serveur.
      retry: (count, error) => count < 2 && (!(error instanceof ApiError) || error.isNetwork || error.status >= 500),
    },
  },
});

export const keys = {
  config: ['config'] as const,
  me: ['me'] as const,
  preferences: ['preferences'] as const,
  places: ['places'] as const,
  consents: ['consents'] as const,
  rides: ['rides'] as const,
  ride: (id: string) => ['ride', id] as const,
  offers: (id: string) => ['offers', id] as const,
  messages: (id: string) => ['messages', id] as const,
  vehicles: (quoteId: string) => ['vehicles', quoteId] as const,
};

/** Configuration publique (drapeaux distants, préavis, catégories), relue au plus toutes les 5 minutes. */
export function useAppConfig() {
  return useQuery({ queryKey: keys.config, queryFn: () => api.config.get(), staleTime: 5 * 60_000 });
}

function useSignedIn(): boolean {
  return useSession((s) => s.status === 'signedIn');
}

export function usePreferences() {
  return useQuery({ queryKey: keys.preferences, queryFn: () => api.me.preferences(), enabled: useSignedIn() });
}

export function usePlaces() {
  return useQuery({ queryKey: keys.places, queryFn: () => api.me.places(), enabled: useSignedIn() });
}

export function useConsents() {
  return useQuery({ queryKey: keys.consents, queryFn: () => api.me.consents(), enabled: useSignedIn() });
}

/** Dernières courses du client (la liste est triée par l'API, la plus récente d'abord). */
export function useRides() {
  return useQuery({ queryKey: keys.rides, queryFn: async () => (await api.rides.list({ limit: 50 })).items, enabled: useSignedIn() });
}

const TERMINAL: ReadonlyArray<RideView['state']> = ['completed', 'rated', 'disputed', 'no_driver', 'cancelled_by_client', 'no_show', 'interrupted', 'expired'];

export function isClosed(ride: Pick<RideView, 'state'>): boolean {
  return TERMINAL.includes(ride.state);
}

/**
 * Une course ; `pollWhenOffline` : rafraîchissement HTTP toutes les 5 secondes quand le socket est indisponible
 * (7.3), arrêté une fois la course close.
 */
export function useRide(rideId: string, pollWhenOffline: boolean) {
  return useQuery({
    queryKey: keys.ride(rideId),
    queryFn: () => api.rides.get(rideId),
    enabled: useSignedIn() && rideId.length > 0,
    refetchInterval: (query) => (pollWhenOffline && query.state.data && !isClosed(query.state.data) ? POLL_FALLBACK_MS : false),
  });
}
