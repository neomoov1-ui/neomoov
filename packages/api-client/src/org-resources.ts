/**
 * Étapes 20 et 21 : ressources de My Hub côté organisation cliente (`/v1/org/:organizationId/...`, sélecteur
 * `GET /v1/me/organizations`), second facteur des membres connectés par code SMS, et accès temporaire du support vu de
 * la plateforme. Aucune règle métier ici : chaque méthode est un appel HTTP.
 */
import type {
  AdminDriverDetail, AdminDriverListItem, AdminListQuery, AdminRideListItem, AdminRideListQuery, AdminStatement, AdminVehicle, InvitationCreate, InvitationCreated,
  InvitationView, MembershipUpdate, MembershipView, MfaEnrollment, MyOrganization, OrganizationHome, OrganizationView, OrgOrganizationCreate, OrgOverview,
  OrgPermissionView, OrgRoleCreate, Page, RideView, RoleView, StaffLoginResponse, SupportAccessGrantView, SupportAccessRequest, SupportAccessStatus, TokensView,
} from '@neomoov/domain';
import type { AuditEntryView, AuditFilters } from './admin-resources.js';
import type { Transport } from './resources.js';

const id = (value: string) => encodeURIComponent(value);
type ListQuery = Partial<AdminListQuery>;
export type SupportAccessDecision = 'approve' | 'deny' | 'revoke';
/** Entrée du journal d'une organisation : celle de la plateforme, avec l'organisation. */
export type OrgAuditEntryView = AuditEntryView & { organizationId: string | null };

export function orgResource(t: Transport) {
  const base = (organizationId: string) => `/org/${id(organizationId)}`;
  return {
    /** Sélecteur d'organisation : adhésions actives de la personne connectée. */
    mine: () => t.get<MyOrganization[]>('/me/organizations'),
    /** Fiche : permissions effectives, modules, double authentification, accès du support en cours. */
    home: (organizationId: string) => t.get<OrganizationHome>(base(organizationId)),
    overview: (organizationId: string) => t.get<OrgOverview>(`${base(organizationId)}/overview`),
    drivers: (organizationId: string, query: ListQuery = {}) => t.get<Page<AdminDriverListItem>>(`${base(organizationId)}/drivers`, { query }),
    driver: (organizationId: string, driverId: string) => t.get<AdminDriverDetail>(`${base(organizationId)}/drivers/${id(driverId)}`),
    vehicles: (organizationId: string, query: ListQuery = {}) => t.get<Page<AdminVehicle>>(`${base(organizationId)}/vehicles`, { query }),
    rides: (organizationId: string, query: AdminRideListQuery = {}) => t.get<Page<AdminRideListItem>>(`${base(organizationId)}/rides`, { query }),
    ride: (organizationId: string, rideId: string) => t.get<RideView>(`${base(organizationId)}/rides/${id(rideId)}`),
    statements: (organizationId: string, query: ListQuery = {}) => t.get<Page<AdminStatement>>(`${base(organizationId)}/statements`, { query }),
    members: (organizationId: string) => t.get<MembershipView[]>(`${base(organizationId)}/members`),
    invite: (organizationId: string, body: Partial<InvitationCreate> & Pick<InvitationCreate, 'roleId'>) => t.post<InvitationCreated>(`${base(organizationId)}/invitations`, body),
    invitations: (organizationId: string) => t.get<InvitationView[]>(`${base(organizationId)}/invitations`),
    revokeInvitation: (organizationId: string, invitationId: string) => t.delete<void>(`${base(organizationId)}/invitations/${id(invitationId)}`),
    updateMembership: (organizationId: string, membershipId: string, body: MembershipUpdate) => t.patch<MembershipView>(`${base(organizationId)}/memberships/${id(membershipId)}`, body),
    removeMembership: (organizationId: string, membershipId: string) => t.delete<void>(`${base(organizationId)}/memberships/${id(membershipId)}`),
    transferOwnership: (organizationId: string, membershipId: string) => t.post<MembershipView>(`${base(organizationId)}/ownership/transfer`, { membershipId }),
    roles: (organizationId: string) => t.get<RoleView[]>(`${base(organizationId)}/roles`),
    createRole: (organizationId: string, body: OrgRoleCreate) => t.post<RoleView>(`${base(organizationId)}/roles`, body),
    updateRolePermissions: (organizationId: string, roleId: string, permissions: string[]) => t.put<RoleView>(`${base(organizationId)}/roles/${id(roleId)}/permissions`, { permissions }),
    permissions: (organizationId: string) => t.get<OrgPermissionView[]>(`${base(organizationId)}/permissions`),
    organizations: (organizationId: string) => t.get<OrganizationView[]>(`${base(organizationId)}/organizations`),
    createOrganization: (organizationId: string, body: Partial<OrgOrganizationCreate> & Pick<OrgOrganizationCreate, 'code' | 'name' | 'type'>) => t.post<OrganizationView>(`${base(organizationId)}/organizations`, body),
    audit: (organizationId: string, query: AuditFilters & { limit?: number; cursor?: string } = {}) => t.get<{ items: OrgAuditEntryView[]; nextCursor: string | null }>(`${base(organizationId)}/audit`, { query }),
    supportAccess: (organizationId: string, query: { status?: SupportAccessStatus } = {}) => t.get<SupportAccessGrantView[]>(`${base(organizationId)}/support-access`, { query }),
    decideSupportAccess: (organizationId: string, grantId: string, decision: SupportAccessDecision) => t.post<SupportAccessGrantView>(`${base(organizationId)}/support-access/${id(grantId)}/${decision}`, {}),
  };
}

/** Plateforme : accès temporaire du support à une organisation cliente (permission `support.access`). */
export function supportAccessResource(t: Transport) {
  return {
    request: (organizationId: string, body: Partial<SupportAccessRequest> & Pick<SupportAccessRequest, 'reason'>) => t.post<SupportAccessGrantView>(`/admin/organizations/${id(organizationId)}/support-access`, body),
    list: (query: { status?: SupportAccessStatus; organizationId?: string } = {}) => t.get<SupportAccessGrantView[]>('/admin/support-access', { query }),
    end: (grantId: string) => t.post<SupportAccessGrantView>(`/admin/support-access/${id(grantId)}/end`, {}),
  };
}

/** Second facteur TOTP d'un membre d'organisation connecté par code SMS (mêmes étapes que le personnel). */
export function memberMfaResource(t: Transport) {
  return {
    start: () => t.post<StaffLoginResponse>('/auth/mfa/start', {}),
    enroll: (mfaToken: string) => t.post<MfaEnrollment>('/auth/mfa/enroll', { mfaToken }, { auth: false }),
    confirm: (mfaToken: string, code: string) => t.post<TokensView & { backupCodes: string[] }>('/auth/mfa/confirm', { mfaToken, code }, { auth: false }),
    verify: (mfaToken: string, code: string) => t.post<TokensView>('/auth/mfa/verify', { mfaToken, code }, { auth: false }),
    backup: (mfaToken: string, backupCode: string) => t.post<TokensView>('/auth/mfa/backup', { mfaToken, backupCode }, { auth: false }),
  };
}
