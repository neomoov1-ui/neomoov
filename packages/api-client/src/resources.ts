/**
 * Méthodes typées par ressource (section 7.2), côté client : les types viennent des schémas Zod de `@neomoov/domain`,
 * les mêmes que ceux qui valident l'API. Aucune règle métier ici : chaque méthode est un appel HTTP.
 */
import type {
  AppConfig, AutocompleteSuggestion, AvailableVehicle, CancellationResult, CancelRide, ClientOfferView, ConsentInput, ConsentView, CreateRide, DataRequestInput, DataRequestView,
  DeviceInput, DeviceView, MeView, OtpRequestResponse, OtpVerify, PatchMe, PlaceDetails, QuoteDetail, QuoteRequest, QuotesResponse, RateRide, RideEventView, RideMessageInput,
  RideMessageView, RidePreferences, RideView, SavedPlace, SavedPlaceInput, ShareResponse, SocialLogin, SocialLoginResponse, SosInput, SosResponse, TokensView,
} from '@neomoov/domain';
import type { RequestOptions } from './client.js';

/** Ce dont les ressources ont besoin : les verbes HTTP du client. */
export interface Transport {
  get<T>(path: string, options?: RequestOptions): Promise<T>;
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  delete<T = void>(path: string, options?: RequestOptions): Promise<T>;
}

const id = (value: string) => encodeURIComponent(value);

export function authResource(t: Transport) {
  return {
    /** Envoie un code SMS ; la réponse indique quand un nouveau code pourra être demandé. */
    requestOtp: (phone: string) => t.post<OtpRequestResponse>('/auth/otp/request', { phone }, { auth: false }),
    verifyOtp: (body: OtpVerify) => t.post<TokensView>('/auth/otp/verify', body, { auth: false }),
    apple: (body: SocialLogin) => t.post<SocialLoginResponse>('/auth/apple', body, { auth: false }),
    google: (body: SocialLogin) => t.post<SocialLoginResponse>('/auth/google', body, { auth: false }),
    refresh: (refreshToken: string) => t.post<TokensView>('/auth/refresh', { refreshToken }, { auth: false }),
    logout: (body: { refreshToken?: string; allDevices?: boolean } = {}) => t.post<void>('/auth/logout', body),
  };
}

export function meResource(t: Transport) {
  return {
    get: () => t.get<MeView>('/me'),
    update: (body: PatchMe) => t.patch<MeView>('/me', body),
    /** Suppression du compte (exigence des magasins) : accès coupé immédiatement. */
    remove: (reason?: string) => t.delete<{ requestId: string; status: 'scheduled' }>('/me', { body: reason ? { reason } : {} }),
    consents: () => t.get<ConsentView[]>('/me/consents'),
    setConsent: (body: ConsentInput) => t.post<ConsentView>('/me/consents', body),
    devices: () => t.get<DeviceView[]>('/me/devices'),
    registerDevice: (body: DeviceInput) => t.post<DeviceView>('/me/devices', body),
    removeDevice: (deviceId: string) => t.delete(`/me/devices/${id(deviceId)}`),
    dataRequests: () => t.get<DataRequestView[]>('/me/data-requests'),
    createDataRequest: (body: DataRequestInput) => t.post<DataRequestView>('/me/data-requests', body),
    dataRequest: (requestId: string) => t.get<DataRequestView>(`/me/data-requests/${id(requestId)}`),
    preferences: () => t.get<RidePreferences>('/me/preferences'),
    setPreferences: (body: RidePreferences) => t.put<RidePreferences>('/me/preferences', body),
    places: () => t.get<SavedPlace[]>('/me/places'),
    addPlace: (body: SavedPlaceInput) => t.post<SavedPlace>('/me/places', body),
    removePlace: (placeId: string) => t.delete(`/me/places/${id(placeId)}`),
  };
}

export function placesResource(t: Transport) {
  return {
    /** Suggestions Places ; `sessionToken` regroupe les frappes d'une même recherche (facturation Google). */
    autocomplete: (input: string, options: { sessionToken?: string; near?: { lat: number; lng: number } } = {}) =>
      t.get<AutocompleteSuggestion[]>('/places/autocomplete', { query: { input, sessionToken: options.sessionToken, lat: options.near?.lat, lng: options.near?.lng } }),
    details: (placeId: string, sessionToken?: string) => t.get<PlaceDetails>('/places/details', { query: { placeId, sessionToken } }),
  };
}

export function quotesResource(t: Transport) {
  return {
    /** Devis de toutes les catégories (ou d'une seule) ; le prix affiché est celui-ci, au centime. */
    create: (body: QuoteRequest) => t.post<QuotesResponse>('/quotes', body, { timeoutMs: 30_000 }),
    get: (quoteId: string) => t.get<QuoteDetail>(`/quotes/${id(quoteId)}`),
    /** Véhicules libres sur le créneau d'un devis planifié (D37). */
    vehicles: (quoteId: string) => t.get<AvailableVehicle[]>(`/quotes/${id(quoteId)}/vehicles`),
  };
}

export function ridesResource(t: Transport) {
  return {
    /** Demande de course ; la même clé d'idempotence renvoie la même course (reprise après coupure réseau). */
    create: (body: CreateRide, idempotencyKey: string) => t.post<RideView>('/rides', body, { idempotencyKey, timeoutMs: 30_000 }),
    list: (query: { cursor?: string; limit?: number; state?: string } = {}) => t.get<{ items: RideView[]; nextCursor: string | null }>('/rides', { query }),
    get: (rideId: string) => t.get<RideView>(`/rides/${id(rideId)}`),
    events: (rideId: string) => t.get<RideEventView[]>(`/rides/${id(rideId)}/events`),
    cancel: (rideId: string, body: CancelRide) => t.post<CancellationResult>(`/rides/${id(rideId)}/cancel`, body),
    rate: (rideId: string, body: RateRide) => t.post<RideView>(`/rides/${id(rideId)}/rate`, body),
    share: (rideId: string) => t.post<ShareResponse>(`/rides/${id(rideId)}/share`),
    messages: (rideId: string) => t.get<RideMessageView[]>(`/rides/${id(rideId)}/messages`),
    sendMessage: (rideId: string, body: RideMessageInput) => t.post<RideMessageView>(`/rides/${id(rideId)}/messages`, body),
    sos: (rideId: string, body: SosInput) => t.post<SosResponse>(`/rides/${id(rideId)}/sos`, body),
    reportVehicleMismatch: (rideId: string, body: { description: string; plateSeen?: string; modelSeen?: string }) =>
      t.post<{ incidentId: string; status: 'open' }>(`/rides/${id(rideId)}/report-vehicle-mismatch`, body),
    /** Négociation (drapeau distant `features.negotiation`) : 404 `FEATURE_DISABLED` sinon. */
    propose: (rideId: string, proposedTotalCents: number) => t.post<RideView>(`/rides/${id(rideId)}/proposals`, { proposedTotalCents }),
    offers: (rideId: string) => t.get<ClientOfferView[]>(`/rides/${id(rideId)}/offers`),
    acceptOffer: (rideId: string, offerId: string, consentText?: string) => t.post<RideView>(`/rides/${id(rideId)}/offers/${id(offerId)}/accept`, consentText ? { consentText } : {}),
  };
}

export function configResource(t: Transport) {
  return {
    /** Configuration publique : drapeaux distants, préavis, catégories. Lue à chaque démarrage de l'application. */
    get: () => t.get<AppConfig>('/config', { auth: false }),
  };
}
