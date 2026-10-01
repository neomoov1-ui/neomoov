/**
 * Marque par organisation (étape 22) : marque publique par code ou par domaine, rattachement du profil client par code,
 * administration de la marque et des domaines d'une organisation (My Hub). Typé par les schémas de `@neomoov/domain`.
 */
import type { AttachOrganizationResult, BrandUpdate, BrandView, OrganizationDomainCreate, OrganizationDomainCreated, OrganizationDomainView, PublicBrand } from '@neomoov/domain';
import type { Transport } from './resources.js';

const id = (value: string) => encodeURIComponent(value);

export function brandingResource(t: Transport) {
  return {
    /** Marque d'une organisation par son code de rattachement (lien `neomoov.net/c/<code>`, code QR, saisie) ; sans compte. */
    publicByCode: (code: string) => t.get<PublicBrand>('/public/brand', { query: { code }, auth: false }),
    /** Marque d'une organisation par son domaine vérifié (réservation web, My Hub sous le domaine du client). */
    publicByDomain: (domain: string) => t.get<PublicBrand>('/public/brand', { query: { domain }, auth: false }),
    /** Rattache mon profil client à l'organisation du code ; la configuration (`config.get`) porte ensuite sa marque. */
    attach: (code: string) => t.post<AttachOrganizationResult>('/me/organizations/attach', { code }),
    // My Hub.
    get: (organizationId: string) => t.get<BrandView>(`/admin/organizations/${id(organizationId)}/brand`),
    update: (organizationId: string, body: BrandUpdate) => t.put<BrandView>(`/admin/organizations/${id(organizationId)}/brand`, body),
    domains: (organizationId: string) => t.get<OrganizationDomainView[]>(`/admin/organizations/${id(organizationId)}/domains`),
    /** Le jeton de vérification et l'enregistrement TXT ne sont rendus qu'à la création. */
    addDomain: (organizationId: string, body: OrganizationDomainCreate) => t.post<OrganizationDomainCreated>(`/admin/organizations/${id(organizationId)}/domains`, body),
    removeDomain: (organizationId: string, domainId: string) => t.delete(`/admin/organizations/${id(organizationId)}/domains/${id(domainId)}`),
    /** Plateforme seulement (V1) : après contrôle manuel du DNS. */
    verifyDomain: (organizationId: string, domainId: string) => t.post<OrganizationDomainView>(`/admin/organizations/${id(organizationId)}/domains/${id(domainId)}/verify`),
  };
}
