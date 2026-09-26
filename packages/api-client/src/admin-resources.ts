/**
 * Ressources de My Hub et de l'API publique (prompt 12), typées par les schémas de `@neomoov/domain`. Aucune règle
 * métier ici : chaque méthode est un appel HTTP.
 */
import type {
  AdminAgent, AdminApproval, AdminDispatchView, AdminCreateRide, AutocompleteSuggestion, PlaceDetails, PublicTrackingView, AdminClient, AdminDashboard, AdminDataRequest, AdminDocument, AdminDriverDetail, AdminDriverListItem, AdminIncident, AdminInvoice,
  AdminLead, AdminListQuery, AdminPromotion, AdminReport, AdminRideListItem, AdminRideListQuery, AdminSetting, AdminStaff, AdminStatement, AdminVehicle,
  ApprovalDecisionInput, CancellationResult, DocumentReview, IncidentDecision, LeadInput, LeadStatus, MfaEnrollment, Page, PackView, PricingRuleInput,
  PricingRuleView, QuoteRequest, QuotesResponse, RideEventView, RideView, SanctionInput, StaffLogin, StaffLoginResponse, StaffNote, TokensView, VehicleReview,
  ZoneGeometry, ZoneUpdate, SimulateQuote, SimulateResponse,
} from '@neomoov/domain';
import type { Transport } from './resources.js';

const id = (value: string) => encodeURIComponent(value);
type ListQuery = Partial<AdminListQuery>;

export function staffAuthResource(t: Transport) {
  return {
    /** Courriel et mot de passe ; renvoie un jeton de passage pour le second facteur (inscription à la première connexion). */
    login: (body: StaffLogin) => t.post<StaffLoginResponse>('/auth/staff/login', body, { auth: false }),
    enroll: (mfaToken: string) => t.post<MfaEnrollment>('/auth/staff/mfa/enroll', { mfaToken }, { auth: false }),
    confirm: (mfaToken: string, code: string) => t.post<TokensView & { backupCodes: string[] }>('/auth/staff/mfa/confirm', { mfaToken, code }, { auth: false }),
    verify: (mfaToken: string, code: string) => t.post<TokensView>('/auth/staff/mfa/verify', { mfaToken, code }, { auth: false }),
    backup: (mfaToken: string, backupCode: string) => t.post<TokensView>('/auth/staff/mfa/backup', { mfaToken, backupCode }, { auth: false }),
  };
}

export function adminResource(t: Transport) {
  return {
    dashboard: () => t.get<AdminDashboard>('/admin/dashboard'),
    rides: (query: AdminRideListQuery = {}) => t.get<Page<AdminRideListItem>>('/admin/rides', { query }),
    ride: (rideId: string) => t.get<RideView>(`/admin/rides/${id(rideId)}`),
    rideSummary: (rideId: string) => t.get<AdminRideListItem>(`/admin/rides/${id(rideId)}/summary`),
    rideDispatch: (rideId: string) => t.get<AdminDispatchView>(`/admin/rides/${id(rideId)}/dispatch`),
    rideEvents: (rideId: string) => t.get<RideEventView[]>(`/admin/rides/${id(rideId)}/events`),
    createRide: (body: AdminCreateRide) => t.post<RideView>('/admin/rides', body),
    assignRide: (rideId: string, body: { driverId: string; vehicleId?: string; note?: string }) => t.post<RideView>(`/admin/rides/${id(rideId)}/assign`, body),
    reassignRide: (rideId: string, body: { reason: string; excludeDriver?: boolean }) => t.post<RideView>(`/admin/rides/${id(rideId)}/reassign`, body),
    holdRide: (rideId: string, reason: string) => t.post<RideView>(`/admin/rides/${id(rideId)}/hold`, { reason }),
    releaseRide: (rideId: string) => t.post<RideView>(`/admin/rides/${id(rideId)}/release`),
    cancelRide: (rideId: string, body: { reason: string; chargeFee?: boolean }) => t.post<CancellationResult>(`/admin/rides/${id(rideId)}/cancel`, body),
    simulate: (body: SimulateQuote) => t.post<SimulateResponse>('/admin/pricing/simulate', body),
    drivers: (query: ListQuery = {}) => t.get<Page<AdminDriverListItem>>('/admin/drivers', { query }),
    driver: (driverId: string) => t.get<AdminDriverDetail>(`/admin/drivers/${id(driverId)}`),
    activateDriver: (driverId: string) => t.post<AdminDriverDetail>(`/admin/drivers/${id(driverId)}/activate`),
    suspendDriver: (driverId: string, reason: string) => t.post<AdminDriverDetail>(`/admin/drivers/${id(driverId)}/suspend`, { reason }),
    reactivateDriver: (driverId: string) => t.post<AdminDriverDetail>(`/admin/drivers/${id(driverId)}/reactivate`),
    sanctionDriver: (driverId: string, body: SanctionInput) => t.post<AdminDriverDetail>(`/admin/drivers/${id(driverId)}/sanctions`, body),
    noteDriver: (driverId: string, body: string) => t.post<StaffNote>(`/admin/drivers/${id(driverId)}/notes`, { body }),
    documents: (query: ListQuery = {}) => t.get<Page<AdminDocument>>('/admin/documents', { query }),
    /** Chemin du fichier d'un document (visionneuse) : à charger avec le jeton, jamais par un lien public. */
    documentContentPath: (documentId: string) => `/admin/documents/${id(documentId)}/content`,
    reviewDocument: (documentId: string, body: DocumentReview) => t.post<AdminDocument>(`/admin/documents/${id(documentId)}/review`, body),
    vehicles: (query: ListQuery = {}) => t.get<Page<AdminVehicle>>('/admin/vehicles', { query }),
    reviewVehicle: (vehicleId: string, body: VehicleReview) => t.post<AdminVehicle>(`/admin/vehicles/${id(vehicleId)}/review`, body),
    clients: (query: ListQuery = {}) => t.get<Page<AdminClient>>('/admin/clients', { query }),
    incidents: (query: ListQuery = {}) => t.get<Page<AdminIncident>>('/admin/incidents', { query }),
    decideIncident: (incidentId: string, body: IncidentDecision) => t.post<AdminIncident>(`/admin/incidents/${id(incidentId)}/decide`, body),
    approvals: (query: ListQuery = {}) => t.get<Page<AdminApproval>>('/admin/approvals', { query }),
    decideApproval: (approvalId: string, body: ApprovalDecisionInput) => t.post<AdminApproval>(`/admin/approvals/${id(approvalId)}/decide`, body),
    settings: (q?: string) => t.get<AdminSetting[]>('/admin/settings', { query: { q } }),
    updateSetting: (key: string, value: unknown) => t.patch<AdminSetting>(`/admin/settings/${id(key)}`, { value }),
    staff: () => t.get<AdminStaff[]>('/admin/staff'),
    dataRequests: (query: ListQuery = {}) => t.get<Page<AdminDataRequest>>('/admin/data-requests', { query }),
    leads: (query: ListQuery = {}) => t.get<Page<AdminLead>>('/admin/leads', { query }),
    setLeadStatus: (leadId: string, status: LeadStatus) => t.patch<AdminLead>(`/admin/leads/${id(leadId)}`, { status }),
    packs: () => t.get<PackView[]>('/admin/packs'),
    promotions: () => t.get<AdminPromotion[]>('/admin/promotions'),
    invoices: (query: ListQuery = {}) => t.get<Page<AdminInvoice>>('/admin/invoices', { query }),
    statements: (query: ListQuery = {}) => t.get<Page<AdminStatement>>('/admin/statements', { query }),
    agents: () => t.get<AdminAgent[]>('/admin/agents'),
    tariffs: () => t.get<PricingRuleView[]>('/admin/tariffs'),
    addTariff: (body: PricingRuleInput) => t.post<PricingRuleView>('/admin/tariffs', body),
    zones: () => t.get<ZoneGeometry[]>('/admin/zones'),
    updateZone: (code: string, body: ZoneUpdate) => t.put<ZoneGeometry>(`/admin/zones/${id(code)}`, body),
    report: (from: string, to: string) => t.get<AdminReport>('/admin/reports', { query: { from, to } }),
    audit: (query: { limit?: number } = {}) => t.get<{ items: unknown[] }>('/admin/audit', { query }),
  };
}

export function publicResource(t: Transport) {
  return {
    /** Prospect (préinscription chauffeur, entreprise, partenaire) : clé publique et jeton anti-robots requis. */
    lead: (body: LeadInput) => t.post<{ id: string; status: 'received' }>('/public/leads', body),
    quotes: (body: QuoteRequest) => t.post<QuotesResponse>('/public/quotes', body, { timeoutMs: 30_000 }),
    autocomplete: (input: string, sessionToken?: string) => t.get<AutocompleteSuggestion[]>('/public/places/autocomplete', { query: { input, sessionToken } }),
    placeDetails: (placeId: string, sessionToken?: string) => t.get<PlaceDetails>('/public/places/details', { query: { placeId, sessionToken } }),
    track: (token: string) => t.get<PublicTrackingView>(`/public/track/${id(token)}`, { auth: false }),
  };
}
