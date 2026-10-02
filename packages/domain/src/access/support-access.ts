/**
 * Étape 21 (amendement v1.2, section 3.2) : accès temporaire du support de la plateforme à une organisation cliente
 * (« se connecter en tant que »), et règle du dernier propriétaire. Le support demande (motif, durée), l'organisation
 * approuve ou refuse ; l'accès court de l'approbation à l'échéance et peut être révoqué à tout moment. Pendant l'accès,
 * le membre du personnel agit avec ses propres permissions de la plateforme, limitées à ce qu'une organisation cliente
 * peut détenir et aux modules de sa formule. Fonctions pures ; l'API applique et journalise.
 */
import { ORGANIZATION_PERMISSIONS, PERMISSIONS, type Permission } from './permissions.js';

export const SUPPORT_ACCESS_STATUSES = ['requested', 'approved', 'denied', 'expired', 'revoked'] as const;
export type SupportAccessStatus = (typeof SUPPORT_ACCESS_STATUSES)[number];

export const SUPPORT_ACCESS_ACTIONS = ['approve', 'deny', 'revoke'] as const;
export type SupportAccessAction = (typeof SUPPORT_ACCESS_ACTIONS)[number];

export interface SupportGrantState {
  status: SupportAccessStatus;
  createdAt: Date;
  startsAt: Date | null;
  endsAt: Date | null;
}

/**
 * Statut effectif à l'instant `now` : un accès approuvé arrivé à échéance est expiré ; une demande que l'organisation n'a
 * pas tranchée dans le délai (`requestTtlMs`) l'est aussi.
 */
export function supportGrantStatus(grant: SupportGrantState, now: Date, requestTtlMs: number): SupportAccessStatus {
  if (grant.status === 'approved' && grant.endsAt !== null && grant.endsAt <= now) return 'expired';
  if (grant.status === 'requested' && grant.createdAt.getTime() + requestTtlMs <= now.getTime()) return 'expired';
  return grant.status;
}

/** Accès en cours : approuvé, commencé et pas encore échu. */
export function supportGrantActive(grant: SupportGrantState, now: Date): boolean {
  return grant.status === 'approved' && grant.startsAt !== null && grant.endsAt !== null && grant.startsAt <= now && now < grant.endsAt;
}

/**
 * Décision de l'organisation sur un accès dont le statut effectif est `current` : approuver ou refuser une demande,
 * révoquer une demande ou un accès en cours. `null` : décision impossible (déjà tranché, expiré ou révoqué).
 */
export function supportGrantTransition(current: SupportAccessStatus, action: SupportAccessAction): SupportAccessStatus | null {
  if (action === 'revoke') return current === 'requested' || current === 'approved' ? 'revoked' : null;
  if (current !== 'requested') return null;
  return action === 'approve' ? 'approved' : 'denied';
}

/**
 * Permissions jamais exercées par le support pendant un accès (revue du 2 octobre 2026, sécurité 5) : il ne peut ni
 * s'inviter ni se rendre permanent, ni toucher aux membres, aux rôles, aux sous-organisations ou aux domaines de
 * l'organisation ; ces décisions restent aux membres de l'organisation.
 */
export const SUPPORT_ACCESS_EXCLUDED_PERMISSIONS: readonly Permission[] = ['members.invite', 'members.manage', 'roles.manage', 'organizations.manage', 'domains.manage'];

/**
 * Permissions du support pendant un accès en cours : ses permissions sur la plateforme, limitées à celles qu'une
 * organisation cliente peut détenir et aux modules de la formule de l'organisation (`null` : aucun module restreint),
 * sans celles de `SUPPORT_ACCESS_EXCLUDED_PERMISSIONS`.
 */
export function supportAccessPermissions(platform: ReadonlySet<Permission>, modules: readonly string[] | null): Set<Permission> {
  return new Set(ORGANIZATION_PERMISSIONS.filter((code) => platform.has(code) && !SUPPORT_ACCESS_EXCLUDED_PERMISSIONS.includes(code) && (!modules || modules.includes(PERMISSIONS[code].module))));
}

/** Rôle système du propriétaire du compte d'une organisation cliente (N1). */
export const OWNER_ROLE_CODE = 'org_owner';
/** Rôle donné à l'ancien propriétaire après un transfert de propriété. */
export const FORMER_OWNER_ROLE_CODE = 'org_admin';

/**
 * Règle du dernier propriétaire (amendement : « le propriétaire ne peut être retiré sans transfert ») : vrai si
 * l'adhésion visée est le seul propriétaire actif de l'organisation, donc si la suspendre, la retirer ou lui donner un
 * autre rôle laisserait l'organisation sans propriétaire.
 */
export function removesLastOwner(owners: ReadonlyArray<{ id: string; status: string }>, membershipId: string): boolean {
  const active = owners.filter((o) => o.status === 'active');
  return active.length === 1 && active[0]!.id === membershipId;
}
