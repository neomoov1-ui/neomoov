/**
 * Module Flotte (étape 23) dans My Hub : appels des routes d'organisation `/v1/org/:organizationId/...` par la passerelle
 * (jeton côté serveur). L'organisation vient du sélecteur (`GET /v1/me/organizations`) ; l'API vérifie l'adhésion et les
 * permissions dans l'organisation, et ne montre que ses données (404 pour une ligne d'une autre organisation).
 */
import type {
  AdminVehicle, FleetDocument, FleetDriver, FleetLive, FleetSettings, FleetVehicle, MyOrganization, OrganizationHome, OrganizationStatementView, OwnerDashboard, Page,
  RevenueShareRuleView, RideView, WeeklyReport,
} from '@neomoov/domain';
import { hubApi } from './hub-api';

const org = (id: string) => `/org/${encodeURIComponent(id)}`;
const qs = (params: Record<string, string | number | undefined>) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '') as Array<[string, string | number]>;
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}` : '';
};

export interface MaintenanceView {
  vehicleId: string;
  records: Array<{ id: string; kind: string; performedOn: string; odometerKm: number | null; costCents: number | null; notes: string | null; nextDueOn: string | null; nextDueKm: number | null }>;
  due: Array<{ kind: string; dueOn: string | null; dueKm: number | null; status: 'ok' | 'due_soon' | 'overdue' }>;
  aiSuggestion: string | null;
}

export const fleetApi = {
  myOrganizations: () => hubApi.get<MyOrganization[]>('/me/organizations'),
  home: (id: string) => hubApi.get<OrganizationHome>(org(id)),

  drivers: (id: string, query: { page: number; pageSize: number; q?: string; status?: string }) => hubApi.get<Page<FleetDriver>>(`${org(id)}/drivers${qs(query)}`),
  inviteDriver: (id: string, body: { phone: string; firstName?: string; language: 'fr' | 'en' }) => hubApi.post<{ id: string; phone: string; expiresAt: string; sent: boolean }>(`${org(id)}/drivers/invitations`, body),
  driverDocuments: (id: string, driverId: string) => hubApi.get<FleetDocument[]>(`${org(id)}/drivers/${encodeURIComponent(driverId)}/documents`),
  reviewDocument: (id: string, documentId: string, body: { decision: 'approved' | 'rejected'; note?: string }) => hubApi.post<FleetDocument>(`${org(id)}/documents/${encodeURIComponent(documentId)}/review`, body),
  expiring: (id: string, days = 30) => hubApi.get<Array<{ documentId: string; driverId: string; type: string; expiresOn: string }>>(`${org(id)}/compliance/expiring${qs({ days })}`),

  vehicles: (id: string, query: { page: number; pageSize: number; q?: string; status?: string }) => hubApi.get<Page<AdminVehicle>>(`${org(id)}/vehicles${qs(query)}`),
  createVehicle: (id: string, body: Record<string, unknown>) => hubApi.post<FleetVehicle>(`${org(id)}/vehicles`, body),
  updateVehicle: (id: string, vehicleId: string, body: Record<string, unknown>) => hubApi.patch<FleetVehicle>(`${org(id)}/vehicles/${encodeURIComponent(vehicleId)}`, body),
  assignVehicle: (id: string, vehicleId: string, driverId: string) => hubApi.post<FleetVehicle>(`${org(id)}/vehicles/${encodeURIComponent(vehicleId)}/assign`, { driverId, makeCurrent: true }),
  maintenance: (id: string, vehicleId: string) => hubApi.get<MaintenanceView>(`${org(id)}/vehicles/${encodeURIComponent(vehicleId)}/maintenance`),
  addMaintenance: (id: string, vehicleId: string, body: Record<string, unknown>) => hubApi.post<MaintenanceView>(`${org(id)}/vehicles/${encodeURIComponent(vehicleId)}/maintenance`, body),

  live: (id: string) => hubApi.get<FleetLive>(`${org(id)}/live`),
  assignRide: (id: string, rideId: string, driverId: string) => hubApi.post<RideView>(`${org(id)}/rides/${encodeURIComponent(rideId)}/assign`, { driverId }),
  reassignRide: (id: string, rideId: string, reason: string) => hubApi.post<RideView>(`${org(id)}/rides/${encodeURIComponent(rideId)}/reassign`, { reason, excludeDriver: true }),
  settings: (id: string) => hubApi.get<FleetSettings>(`${org(id)}/fleet/settings`),
  updateSettings: (id: string, body: Partial<FleetSettings>) => hubApi.patch<FleetSettings>(`${org(id)}/fleet/settings`, body),

  rules: (id: string) => hubApi.get<RevenueShareRuleView[]>(`${org(id)}/revenue-share-rules`),
  createRule: (id: string, body: Record<string, unknown>) => hubApi.post<RevenueShareRuleView>(`${org(id)}/revenue-share-rules`, body),
  endRule: (id: string, ruleId: string, effectiveTo: string) => hubApi.post<RevenueShareRuleView>(`${org(id)}/revenue-share-rules/${encodeURIComponent(ruleId)}/end`, { effectiveTo }),
  organizationStatements: (id: string) => hubApi.get<OrganizationStatementView[]>(`${org(id)}/organization-statements`),
  settleOffline: (id: string, statementId: string, body: { method: string; reference: string; note?: string }) => hubApi.post<OrganizationStatementView>(`${org(id)}/organization-statements/${encodeURIComponent(statementId)}/settle-offline`, body),
  payoutAccount: (id: string) => hubApi.get<{ mode: 'connect' | 'offline'; linked: boolean; onboarded: boolean; payoutsEnabled: boolean; provider: string }>(`${org(id)}/payout-account`),
  payoutOnboarding: (id: string) => hubApi.post<{ url: string; expiresAt: string; simulated: boolean }>(`${org(id)}/payout-account/onboarding`),
  exportUrl: (id: string) => `/api/v1${org(id)}/payouts/export.csv`,

  weeklyReport: (id: string, periodStart?: string) => hubApi.get<WeeklyReport>(`${org(id)}/reports/weekly${qs({ periodStart })}`),
  ownerDashboard: (id: string, periodStart?: string) => hubApi.get<OwnerDashboard>(`${org(id)}/owner/vehicles${qs({ periodStart })}`),
};
