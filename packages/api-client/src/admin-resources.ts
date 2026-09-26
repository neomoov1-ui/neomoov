/**
 * Ressources de My Hub et de l'API publique (prompt 12), typées par les schémas de `@neomoov/domain`. Aucune règle
 * métier ici : chaque méthode est un appel HTTP.
 */
import type {
  AdminAgent, AdminApproval, AdminDispatchView, AdminCreateRide, AutocompleteSuggestion, PlaceDetails, PublicTrackingView, AdminClient, AdminDashboard, AdminDataRequest, AdminDocument, AdminDriverDetail, AdminDriverListItem, DriverPrograms, AdminIncident, AdminInvoice,
  AdminLead, AdminListQuery, AdminPromotion, AdminReport, AdminRideListItem, AdminRideListQuery, AdminSetting, AdminStaff, AdminStatement, AdminVehicle,
  ApprovalDecisionInput, CancellationResult, DocumentReview, IncidentDecision, LeadInput, LeadStatus, MfaEnrollment, Page, PackView, PricingRuleInput,
  PricingRuleView, QuoteRequest, QuotesResponse, RideEventView, RideMessageView, RideView, SanctionInput, StaffLogin, StaffLoginResponse, StaffNote, TokensView, VehicleReview,
  ZoneGeometry, ZoneUpdate, SimulateQuote, SimulateResponse, PaymentView, RefundInput, RefundView,
} from '@neomoov/domain';
import type { GuaranteeDecision, GuaranteeResult } from '@neomoov/domain';
import type { AdminBalance, AdminStatementDetail, StatementAdjust, StatementGenerate, StatementGeneration, StatementSettleOffline } from '@neomoov/domain';
import type { AgentReportView, AgentRunListQuery, AgentRunView, AgentUpdate, ConversationReplyInput, ConversationView, QualityReviewView, QualityRunResult } from '@neomoov/domain';
import type { AdminMetrics } from '@neomoov/domain';
import type { AdminIncidentCreate, ApiKeyCreate, ApiKeyCreated, ApiKeyView, MeView, PrivacyBreachInput, PrivacyBreachView, StaffCreate } from '@neomoov/domain';
import type { Transport } from './resources.js';

const id = (value: string) => encodeURIComponent(value);

/** Entrée du journal d'audit (GET /v1/admin/audit). */
export interface AuditEntryView {
  id: string;
  actorUserId: string | null;
  actorAgentCode: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ipAddress: string | null;
  correlationId: string | null;
  occurredAt: string;
}
/** Échéance de conformité (GET /v1/admin/compliance). */
export interface ComplianceCheckView {
  id: string;
  entityType: 'driver' | 'vehicle';
  entityId: string;
  type: string;
  label: string;
  dueOn: string;
  status: 'pending' | 'overdue';
  remindersSent: number;
  suspendedAt: string | null;
}
export interface ComplianceRunReport { synced: number; reminders: number; suspended: number; lifted: number }
export interface InspectionInput { inspectedOn: string; passed: boolean; odometerKm?: number; notes?: string }
/** Tâche de conservation (Loi 25) journalisée, ou blocage faute de sauvegarde vérifiée. */
export interface RetentionJobView { id: string; type: string; executedAt: string; rowsProcessed: number; details: Record<string, unknown> }
export interface QueueStatsView { mode: 'redis' | 'memory'; queues: Array<{ name: string; waiting: number; active: number; failed: number; dropped?: number }> }
export interface FailedJobView { id: string; name: string; failedReason: string | null; attempts: number; failedAt: string | null }
/** Course figée (GET /v1/admin/rides/stuck) : état intermédiaire tenu trop longtemps, depuis `since`. */
export interface StuckRideView { rideId: string; publicNumber: string; state: string; since: string; minutes: number }
/** Filtres du journal d'audit (liste et export CSV) ; `from` et `to` sont des instants ISO. */
export type AuditFilters = { entity?: string; action?: string; actorUserId?: string; actorAgentCode?: string; from?: string; to?: string };
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
    /** Métriques d'exploitation (étape 15) : courses par état, attribution, latences, files, paiements, fournisseurs. */
    metrics: () => t.get<AdminMetrics>('/admin/metrics'),
    rides: (query: AdminRideListQuery = {}) => t.get<Page<AdminRideListItem>>('/admin/rides', { query }),
    ride: (rideId: string) => t.get<RideView>(`/admin/rides/${id(rideId)}`),
    rideSummary: (rideId: string) => t.get<AdminRideListItem>(`/admin/rides/${id(rideId)}/summary`),
    rideDispatch: (rideId: string) => t.get<AdminDispatchView>(`/admin/rides/${id(rideId)}/dispatch`),
    ridePayments: (rideId: string) => t.get<PaymentView[]>(`/admin/rides/${id(rideId)}/payments`),
    refundRide: (rideId: string, body: RefundInput, idempotencyKey?: string) => t.post<RefundView>(`/admin/rides/${id(rideId)}/refund`, body, idempotencyKey ? { idempotencyKey } : {}),
    rideEvents: (rideId: string) => t.get<RideEventView[]>(`/admin/rides/${id(rideId)}/events`),
    rideMessages: (rideId: string) => t.get<RideMessageView[]>(`/admin/rides/${id(rideId)}/messages`),
    sendRideMessage: (rideId: string, body: string) => t.post<RideMessageView>(`/admin/rides/${id(rideId)}/messages`, { body }),
    createRide: (body: AdminCreateRide) => t.post<RideView>('/admin/rides', body),
    assignRide: (rideId: string, body: { driverId: string; vehicleId?: string; note?: string }) => t.post<RideView>(`/admin/rides/${id(rideId)}/assign`, body),
    reassignRide: (rideId: string, body: { reason: string; excludeDriver?: boolean }) => t.post<RideView>(`/admin/rides/${id(rideId)}/reassign`, body),
    holdRide: (rideId: string, reason: string) => t.post<RideView>(`/admin/rides/${id(rideId)}/hold`, { reason }),
    releaseRide: (rideId: string) => t.post<RideView>(`/admin/rides/${id(rideId)}/release`),
    cancelRide: (rideId: string, body: { reason: string; chargeFee?: boolean }) => t.post<CancellationResult>(`/admin/rides/${id(rideId)}/cancel`, body),
    interruptRide: (rideId: string, body: { reason: string; incidentType?: 'accident' | 'other' }) => t.post<{ state: string; incidentId: string }>(`/admin/rides/${id(rideId)}/interrupt`, body),
    /** Courses figées (étape 15) : l'exploitation décide, rien n'est corrigé automatiquement. */
    stuckRides: () => t.get<StuckRideView[]>('/admin/rides/stuck'),
    simulate: (body: SimulateQuote) => t.post<SimulateResponse>('/admin/pricing/simulate', body),
    drivers: (query: ListQuery = {}) => t.get<Page<AdminDriverListItem>>('/admin/drivers', { query }),
    driver: (driverId: string) => t.get<AdminDriverDetail>(`/admin/drivers/${id(driverId)}`),
    activateDriver: (driverId: string) => t.post<AdminDriverDetail>(`/admin/drivers/${id(driverId)}/activate`),
    suspendDriver: (driverId: string, reason: string) => t.post<AdminDriverDetail>(`/admin/drivers/${id(driverId)}/suspend`, { reason }),
    reactivateDriver: (driverId: string) => t.post<AdminDriverDetail>(`/admin/drivers/${id(driverId)}/reactivate`),
    setDriverPrograms: (driverId: string, body: DriverPrograms) => t.post<AdminDriverDetail>(`/admin/drivers/${id(driverId)}/programs`, body),
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
    /** Incident ouvert à la main ; un incident de confidentialité est inscrit au registre (Loi 25) dès sa création. */
    createIncident: (body: AdminIncidentCreate) => t.post<AdminIncident>('/admin/incidents', body),
    privacyBreach: (incidentId: string) => t.get<PrivacyBreachView>(`/admin/incidents/${id(incidentId)}/privacy-breach`),
    savePrivacyBreach: (incidentId: string, body: PrivacyBreachInput) => t.put<PrivacyBreachView>(`/admin/incidents/${id(incidentId)}/privacy-breach`, body),
    /** Chemin du registre complet en CSV (administrateur) : à charger avec le jeton, jamais par un lien public. */
    privacyRegisterCsvPath: () => '/admin/incidents/privacy-register.csv',
    /** Garantie modèle : validée (remboursement intégral, tarif du chauffeur maintenu ou sanction proposée) ou refusée. */
    decideGuarantee: (incidentId: string, body: GuaranteeDecision) => t.post<GuaranteeResult>(`/admin/incidents/${id(incidentId)}/guarantee`, body),
    approvals: (query: ListQuery = {}) => t.get<Page<AdminApproval>>('/admin/approvals', { query }),
    decideApproval: (approvalId: string, body: ApprovalDecisionInput) => t.post<AdminApproval>(`/admin/approvals/${id(approvalId)}/decide`, body),
    settings: (q?: string) => t.get<AdminSetting[]>('/admin/settings', { query: { q } }),
    updateSetting: (key: string, value: unknown) => t.patch<AdminSetting>(`/admin/settings/${id(key)}`, { value }),
    staff: () => t.get<AdminStaff[]>('/admin/staff'),
    /** Personnel (administrateur) : création ou ajout de rôles, mot de passe remplacé, second facteur réinitialisé. */
    createStaff: (body: StaffCreate) => t.post<MeView>('/admin/staff', body),
    setStaffPassword: (userId: string, password: string) => t.post<void>(`/admin/staff/${id(userId)}/password`, { password }),
    resetStaffMfa: (userId: string) => t.post<void>(`/admin/staff/${id(userId)}/mfa/reset`),
    /** Clés de service (administrateur) : le secret n'est renvoyé qu'à la création. */
    apiKeys: () => t.get<ApiKeyView[]>('/admin/api-keys'),
    createApiKey: (body: ApiKeyCreate) => t.post<ApiKeyCreated>('/admin/api-keys', body),
    revokeApiKey: (keyId: string) => t.delete<void>(`/admin/api-keys/${id(keyId)}`),
    dataRequests: (query: ListQuery = {}) => t.get<Page<AdminDataRequest>>('/admin/data-requests', { query }),
    leads: (query: ListQuery = {}) => t.get<Page<AdminLead>>('/admin/leads', { query }),
    setLeadStatus: (leadId: string, status: LeadStatus) => t.patch<AdminLead>(`/admin/leads/${id(leadId)}`, { status }),
    packs: () => t.get<PackView[]>('/admin/packs'),
    promotions: () => t.get<AdminPromotion[]>('/admin/promotions'),
    invoices: (query: ListQuery = {}) => t.get<Page<AdminInvoice>>('/admin/invoices', { query }),
    statements: (query: ListQuery = {}) => t.get<Page<AdminStatement>>('/admin/statements', { query }),
    /** Règlement hebdomadaire (étape 9) : génération ou aperçu, détail, émission, règlement, ajustement, PDF, soldes. */
    generateStatements: (body: Partial<StatementGenerate>) => t.post<StatementGeneration>('/admin/statements/generate', body),
    statement: (statementId: string) => t.get<AdminStatementDetail>(`/admin/statements/${id(statementId)}`),
    issueStatement: (statementId: string) => t.post<AdminStatementDetail>(`/admin/statements/${id(statementId)}/issue`),
    payStatement: (statementId: string) => t.post<AdminStatementDetail>(`/admin/statements/${id(statementId)}/pay`),
    settleStatementOffline: (statementId: string, body: StatementSettleOffline) => t.post<AdminStatementDetail>(`/admin/statements/${id(statementId)}/settle-offline`, body),
    adjustStatement: (statementId: string, body: StatementAdjust) => t.post<AdminStatementDetail>(`/admin/statements/${id(statementId)}/adjust`, body),
    statementPdfPath: (statementId: string) => `/admin/statements/${id(statementId)}/pdf`,
    balances: () => t.get<AdminBalance[]>('/admin/balances'),
    agents: () => t.get<AdminAgent[]>('/admin/agents'),
    /** Agents IA (étape 13) : réglage (administrateur), journal des exécutions, rapports, conversations de l'assistance. */
    updateAgent: (code: string, body: AgentUpdate) => t.patch<AdminAgent>(`/admin/agents/${id(code)}`, body),
    agentRuns: (query: Partial<AgentRunListQuery> = {}) => t.get<Page<AgentRunView>>('/admin/agents/runs', { query }),
    agentRun: (runId: string) => t.get<AgentRunView>(`/admin/agents/runs/${id(runId)}`),
    agentReports: (query: ListQuery = {}) => t.get<Page<AgentReportView>>('/admin/agents/reports', { query }),
    conversations: (query: ListQuery = {}) => t.get<Page<ConversationView>>('/admin/conversations', { query }),
    conversation: (conversationId: string) => t.get<ConversationView>(`/admin/conversations/${id(conversationId)}`),
    replyConversation: (conversationId: string, body: ConversationReplyInput) => t.post<ConversationView>(`/admin/conversations/${id(conversationId)}/messages`, body),
    tariffs: () => t.get<PricingRuleView[]>('/admin/tariffs'),
    addTariff: (body: PricingRuleInput) => t.post<PricingRuleView>('/admin/tariffs', body),
    zones: () => t.get<ZoneGeometry[]>('/admin/zones'),
    updateZone: (code: string, body: ZoneUpdate) => t.put<ZoneGeometry>(`/admin/zones/${id(code)}`, body),
    report: (from: string, to: string) => t.get<AdminReport>('/admin/reports', { query: { from, to } }),
    /** Conformité (étape 14) : échéances, passe quotidienne, inspection d'un véhicule. */
    complianceChecks: (query: { status?: 'pending' | 'overdue'; driverId?: string } = {}) => t.get<ComplianceCheckView[]>('/admin/compliance', { query }),
    runCompliance: () => t.post<ComplianceRunReport>('/admin/compliance/run', {}),
    recordInspection: (vehicleId: string, body: InspectionInput) => t.post<{ vehicleId: string; status: string; nextInspectionDueOn: string | null }>(`/admin/compliance/vehicles/${id(vehicleId)}/inspections`, body),
    /** Conservation (Loi 25) : tâches journalisées, sauvegarde vérifiée, passe à la demande. */
    retentionJobs: () => t.get<RetentionJobView[]>('/admin/retention/jobs'),
    confirmBackup: (body: { note: string; verifiedAt?: string }) => t.post<{ verifiedAt: string }>('/admin/retention/backup-verified', body),
    runRetention: () => t.post<Array<{ type: string; rowsProcessed: number; details: Record<string, unknown> }>>('/admin/retention/run', {}),
    /** Files de tâches (étape 15) : état, tâches en échec, relance. */
    queues: () => t.get<QueueStatsView>('/admin/queues'),
    failedJobs: (name: string) => t.get<FailedJobView[]>(`/admin/queues/${id(name)}/failed`),
    retryJobs: (name: string, jobId?: string) => t.post<{ retried: number }>(`/admin/queues/${id(name)}/retry`, jobId ? { jobId } : {}),
    /** Qualité des chauffeurs (5.11) : mesures, propositions de l'agent qualité, passe à la demande. */
    quality: () => t.get<QualityReviewView[]>('/admin/quality'),
    runQuality: () => t.post<QualityRunResult>('/admin/quality/run', {}),
    audit: (query: AuditFilters & { limit?: number; cursor?: string } = {}) => t.get<{ items: AuditEntryView[]; nextCursor: string | null }>('/admin/audit', { query }),
    /** Chemin de l'export CSV filtré du journal d'audit (administrateur), avec sa chaîne de requête. */
    auditExportPath: (filters: AuditFilters = {}) => {
      const params = new URLSearchParams(Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])));
      const search = params.toString();
      return `/admin/audit/export${search ? `?${search}` : ''}`;
    },
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
