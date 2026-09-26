/**
 * Méthodes typées par ressource (section 7.2), côté client : les types viennent des schémas Zod de `@neomoov/domain`,
 * les mêmes que ceux qui valident l'API. Aucune règle métier ici : chaque méthode est un appel HTTP.
 */
import type {
  AppConfig, AutocompleteSuggestion, AvailableVehicle, CancellationResult, CancelRide, ClientOfferView, ConsentInput, ConsentView, CreateRide, DataRequestInput, DataRequestView,
  DeviceInput, DeviceView, MeView, OtpRequestResponse, OtpVerify, PatchMe, PlaceDetails, QuoteDetail, QuoteRequest, QuotesResponse, RateRide, RideEventView, RideMessageInput,
  RideMessageView, RidePreferences, RideView, SavedPlace, SavedPlaceInput, ShareResponse, SocialLogin, SocialLoginResponse, SosInput, SosResponse, TokensView,
  AdmittedModel, DriverApply, DriverDocumentView, DriverDocumentsView, DriverHomeView, DriverIncidentInput, DriverOfferView, DriverPacksView, DriverProfileUpdate,
  DriverProfileView, DriverRideView, DriverScoreView, DriverStatementView, DriverStatusInput, DriverStatusView, EarningsQuery, EarningsView, LocationUpdate,
  LoyalClientView, OfferCounterInput, OnboardingView, PackActivate, PackUpdate, PayoutLink, PayoutStatus, RateClient, ScheduledRideView, ShiftStartResult,
  StatementSummary, TrainingResult, TrainingView, VehicleInputBody, VehicleView,
  BalanceView, ConnectStatus, PaymentMethodView, PaymentView, SetupIntentResponse,
  CreditsView, ReferralView,
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
    /** Crédits du compte (parrainage, gestes, remboursements en crédit), déduits automatiquement du devis. */
    credits: () => t.get<CreditsView>('/me/credits'),
    /** Code personnel et lien de partage (créés au premier appel), montants et statistiques ; chauffeur par défaut pour un chauffeur. */
    referral: (kind?: 'client' | 'driver') => t.get<ReferralView>('/me/referral', kind ? { query: { kind } } : undefined),
    /** Saisie du code d'un parrain, à l'inscription et avant la première course. */
    applyReferral: (code: string) => t.post<ReferralView>('/me/referral/apply', { code }),
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

/** Paiements (prompt 07) : cartes par SetupIntent Stripe, pourboire, reçu, solde dû ; côté chauffeur, Connect et prélèvement. */
export function paymentsResource(t: Transport) {
  return {
    setupIntent: () => t.post<SetupIntentResponse>('/payment-methods/setup-intent'),
    /** Après confirmation par la feuille de paiement Stripe : l'API relit la carte chez Stripe. */
    confirm: (setupIntentId: string, makeDefault = true) => t.post<PaymentMethodView>('/payment-methods/confirm', { setupIntentId, makeDefault }),
    methods: () => t.get<PaymentMethodView[]>('/payment-methods'),
    remove: (methodId: string) => t.delete(`/payment-methods/${id(methodId)}`),
    tip: (rideId: string, amountCents: number) => t.post<PaymentView>(`/rides/${id(rideId)}/tip`, { amountCents }),
    ridePayments: (rideId: string) => t.get<PaymentView[]>(`/rides/${id(rideId)}/payments`),
    balance: () => t.get<BalanceView>('/me/balance'),
    settle: (paymentMethodId?: string) => t.post<{ paidCents: number; balanceDueCents: number }>('/me/settle', paymentMethodId ? { paymentMethodId } : {}),
    connectLink: () => t.post<PayoutLink>('/driver/connect/onboarding-link'),
    connectStatus: () => t.get<ConnectStatus>('/driver/connect/status'),
    debitSetupIntent: () => t.post<SetupIntentResponse>('/driver/payment-method'),
    confirmDebit: (setupIntentId: string) => t.post<ConnectStatus>('/driver/payment-method/confirm', { setupIntentId }),
  };
}

export function driverResource(t: Transport) {
  const ride = (rideId: string, action: string) => `/driver/rides/${id(rideId)}/${action}`;
  return {
    /** Candidature d'un compte connecté ; renouveler ensuite le jeton (`auth.refresh`) pour obtenir le rôle chauffeur. */
    apply: (body: DriverApply) => t.post<DriverProfileView>('/driver/apply', body),
    home: () => t.get<DriverHomeView>('/driver/home'),
    profile: () => t.get<DriverProfileView>('/driver/profile'),
    updateProfile: (body: DriverProfileUpdate) => t.patch<DriverProfileView>('/driver/profile', body),
    onboarding: () => t.get<OnboardingView>('/driver/onboarding'),
    vehicleModels: () => t.get<AdmittedModel[]>('/driver/vehicle-models'),
    vehicles: () => t.get<VehicleView[]>('/driver/vehicles'),
    addVehicle: (body: VehicleInputBody) => t.post<VehicleView>('/driver/vehicles', body),
    documents: () => t.get<DriverDocumentsView>('/driver/documents'),
    /** Formulaire multipart : champs `type`, `number`, `issuedOn`, `expiresOn`, `vehicleId` et le fichier `file`. */
    uploadDocument: (form: FormData) => t.post<DriverDocumentView>('/driver/documents', form, { timeoutMs: 60_000 }),
    training: () => t.get<TrainingView>('/driver/training'),
    submitTraining: (moduleCode: string, answers: Record<string, number>) => t.post<TrainingResult>(`/driver/training/${id(moduleCode)}/submit`, { answers }),
    payout: () => t.get<PayoutStatus>('/driver/payout'),
    payoutLink: () => t.post<PayoutLink>('/driver/connect/onboarding-link'),
    earnings: (query: EarningsQuery = {}) => t.get<EarningsView>('/driver/earnings', { query }),
    statements: () => t.get<StatementSummary[]>('/driver/statements'),
    statement: (statementId: string) => t.get<DriverStatementView>(`/driver/statements/${id(statementId)}`),
    packs: () => t.get<DriverPacksView>('/driver/packs'),
    activatePack: (body: PackActivate) => t.post<DriverPacksView>('/driver/packs/activate', body),
    updatePack: (purchaseId: string, body: PackUpdate) => t.patch<DriverPacksView>(`/driver/packs/${id(purchaseId)}`, body),
    loyalClients: () => t.get<LoyalClientView[]>('/driver/loyal-clients'),
    score: () => t.get<DriverScoreView>('/driver/score'),
    startShift: (photoBase64: string) => t.post<ShiftStartResult>('/driver/shifts/start', { photoBase64 }),
    // Présence et positions (secours au socket `/driver`).
    status: () => t.get<DriverStatusView>('/driver/status'),
    setStatus: (body: DriverStatusInput) => t.post<DriverStatusView>('/driver/status', body),
    location: (body: LocationUpdate) => t.post<{ rideId: string | null; accepted: boolean }>('/driver/location', body),
    locations: (positions: LocationUpdate[]) => t.post<{ rideId: string | null; accepted: number; ignored: number }>('/driver/locations', { positions }),
    // Offres de la répartition.
    offers: () => t.get<DriverOfferView[]>('/driver/offers'),
    acceptOffer: (offerId: string) => t.post<RideView>(`/driver/offers/${id(offerId)}/accept`),
    declineOffer: (offerId: string) => t.post<{ state: 'declined' }>(`/driver/offers/${id(offerId)}/decline`),
    counterOffer: (offerId: string, body: OfferCounterInput) => t.post<DriverOfferView>(`/driver/offers/${id(offerId)}/counter`, body),
    // Déroulé des courses.
    rides: () => t.get<{ active: RideView | null; items: RideView[] }>('/driver/rides'),
    ride: (rideId: string) => t.get<DriverRideView>(`/driver/rides/${id(rideId)}`),
    depart: (rideId: string) => t.post<RideView>(ride(rideId, 'depart')),
    arrive: (rideId: string) => t.post<RideView>(ride(rideId, 'arrive')),
    contact: (rideId: string) => t.post<{ contactAttempts: number }>(ride(rideId, 'contact')),
    start: (rideId: string) => t.post<RideView>(ride(rideId, 'start')),
    complete: (rideId: string, body: { measuredDistanceMeters?: number; measuredDurationSeconds?: number } = {}) => t.post<RideView>(ride(rideId, 'complete'), body),
    noShow: (rideId: string) => t.post<CancellationResult>(ride(rideId, 'no-show')),
    cancel: (rideId: string, reason: string) => t.post<RideView>(ride(rideId, 'cancel'), { reason }),
    paymentReceived: (rideId: string, amountCents: number) => t.post<DriverRideView>(ride(rideId, 'payment-received'), { amountCents }),
    rateClient: (rideId: string, body: RateClient) => t.post<DriverRideView>(ride(rideId, 'rate'), body),
    reportIncident: (rideId: string, body: DriverIncidentInput) => t.post<{ incidentId: string; status: 'open' }>(ride(rideId, 'incident'), body),
    // Réservations planifiées.
    scheduled: () => t.get<ScheduledRideView[]>('/driver/scheduled'),
    claimScheduled: (rideId: string) => t.post<{ assignmentId: string; status: 'proposed' }>(`/driver/scheduled/${id(rideId)}/claim`),
    confirmScheduled: (rideId: string) => t.post<RideView>(`/driver/scheduled/${id(rideId)}/confirm`),
    declineScheduled: (rideId: string) => t.post<void>(`/driver/scheduled/${id(rideId)}/decline`),
  };
}
