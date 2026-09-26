import { ApiError } from '@neomoov/api-client';
import type { EarningsQuery } from '@neomoov/domain';
import { MutationCache, QueryCache, QueryClient, useQuery } from '@tanstack/react-query';
import { api } from './api';
import { POLL_DATA_SAVER_MS, POLL_FALLBACK_MS } from './config';
import { reportMobileError } from './observability';
import { usePreferences } from './preferences';
import { useRealtimeStatus } from './realtime';
import { useHasDriverRole, useSession } from './session';

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
  home: ['home'] as const,
  profile: ['profile'] as const,
  onboarding: ['onboarding'] as const,
  vehicles: ['vehicles'] as const,
  vehicleModels: ['vehicle-models'] as const,
  documents: ['documents'] as const,
  training: ['training'] as const,
  payout: ['payout'] as const,
  packs: ['packs'] as const,
  earnings: (query: EarningsQuery) => ['earnings', query.period ?? 'week', query.date ?? 'today'] as const,
  statements: ['statements'] as const,
  statement: (id: string) => ['statement', id] as const,
  loyalClients: ['loyal-clients'] as const,
  score: ['score'] as const,
  offers: ['offers'] as const,
  rides: ['rides'] as const,
  ride: (id: string) => ['ride', id] as const,
  messages: (id: string) => ['messages', id] as const,
  scheduled: ['scheduled'] as const,
  consents: ['consents'] as const,
};

function useSignedIn(): boolean {
  return useSession((s) => s.status === 'signedIn');
}

/** Requêtes de l'espace chauffeur : seulement une fois la candidature faite (le jeton porte le rôle). */
function useDriverReady(): boolean {
  return useSignedIn() && useHasDriverRole();
}

export function useAppConfig() {
  return useQuery({ queryKey: keys.config, queryFn: () => api.config.get(), staleTime: 5 * 60_000 });
}

/** Accueil : rafraîchi toutes les 30 secondes (revenus, alertes, prérequis). */
export function useHome() {
  return useQuery({ queryKey: keys.home, queryFn: () => api.driver.home(), enabled: useDriverReady(), refetchInterval: 30_000 });
}

export function useProfile() {
  return useQuery({ queryKey: keys.profile, queryFn: () => api.driver.profile(), enabled: useDriverReady() });
}

export function useOnboarding() {
  return useQuery({ queryKey: keys.onboarding, queryFn: () => api.driver.onboarding(), enabled: useDriverReady() });
}

export function useVehicles() {
  return useQuery({ queryKey: keys.vehicles, queryFn: () => api.driver.vehicles(), enabled: useDriverReady() });
}

export function useVehicleModels() {
  return useQuery({ queryKey: keys.vehicleModels, queryFn: () => api.driver.vehicleModels(), enabled: useDriverReady(), staleTime: 60 * 60_000 });
}

export function useDocuments() {
  return useQuery({ queryKey: keys.documents, queryFn: () => api.driver.documents(), enabled: useDriverReady() });
}

export function useTraining() {
  return useQuery({ queryKey: keys.training, queryFn: () => api.driver.training(), enabled: useDriverReady() });
}

export function usePayout() {
  return useQuery({ queryKey: keys.payout, queryFn: () => api.driver.payout(), enabled: useDriverReady() });
}

export function usePacks() {
  return useQuery({ queryKey: keys.packs, queryFn: () => api.driver.packs(), enabled: useDriverReady() });
}

export function useEarnings(query: EarningsQuery) {
  return useQuery({ queryKey: keys.earnings(query), queryFn: () => api.driver.earnings(query), enabled: useDriverReady() });
}

export function useStatements() {
  return useQuery({ queryKey: keys.statements, queryFn: () => api.driver.statements(), enabled: useDriverReady() });
}

export function useStatement(id: string) {
  return useQuery({ queryKey: keys.statement(id), queryFn: () => api.driver.statement(id), enabled: useDriverReady() && id.length > 0 });
}

export function useLoyalClients() {
  return useQuery({ queryKey: keys.loyalClients, queryFn: () => api.driver.loyalClients(), enabled: useDriverReady() });
}

export function useScore() {
  return useQuery({ queryKey: keys.score, queryFn: () => api.driver.score(), enabled: useDriverReady() });
}

export function useScheduled() {
  return useQuery({ queryKey: keys.scheduled, queryFn: () => api.driver.scheduled(), enabled: useDriverReady() });
}

export function useDriverRides() {
  return useQuery({ queryKey: keys.rides, queryFn: () => api.driver.rides(), enabled: useDriverReady() });
}

export function useConsents() {
  return useQuery({ queryKey: keys.consents, queryFn: () => api.me.consents(), enabled: useSignedIn() });
}

/** Intervalle du rafraîchissement HTTP de repli : seulement socket coupé, espacé en économie de données. */
function useFallbackInterval(wanted: boolean): number | false {
  const saver = usePreferences((s) => s.dataSaver);
  const connected = useRealtimeStatus((s) => s.connected);
  if (!wanted || connected) return false;
  return saver ? POLL_DATA_SAVER_MS : POLL_FALLBACK_MS;
}

/** Offres en attente : poussées par le socket, relues ici au retour au premier plan et en repli. */
export function useOffers(poll: boolean) {
  const interval = useFallbackInterval(poll);
  return useQuery({ queryKey: keys.offers, queryFn: () => api.driver.offers(), enabled: useDriverReady(), refetchInterval: interval });
}

/** Fiche de course ; rafraîchie par HTTP quand le socket est indisponible (7.3), plus lentement en économie de données. */
export function useDriverRide(rideId: string, poll: boolean) {
  const interval = useFallbackInterval(poll);
  return useQuery({ queryKey: keys.ride(rideId), queryFn: () => api.driver.ride(rideId), enabled: useDriverReady() && rideId.length > 0, refetchInterval: interval });
}

export function useMessages(rideId: string, enabled: boolean) {
  return useQuery({ queryKey: keys.messages(rideId), queryFn: () => api.rides.messages(rideId), enabled: useSignedIn() && enabled && rideId.length > 0 });
}

/** Après une action qui change l'état du chauffeur : l'accueil, les courses et le dossier sont relus. */
export async function refreshDriver(): Promise<void> {
  await Promise.all([keys.home, keys.rides, keys.onboarding, keys.documents, keys.profile].map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}
