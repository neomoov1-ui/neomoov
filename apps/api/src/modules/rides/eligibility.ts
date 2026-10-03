/**
 * Éligibilité des chauffeurs en SQL (section 5.4), partagée par la répartition, la liste des véhicules libres et la
 * validation du véhicule choisi (D37) : une règle modifiée ici vaut partout. Les fragments supposent les alias `d`
 * (drivers), `v` (véhicule) et `vc` (sa catégorie) ; chacun est une expression booléenne complète.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { SettingsService } from '../../common/settings.service.js';

export interface EligibilityRules {
  requiredDocuments: string[];
  requireActivePack: boolean;
  scheduledConflictMinutes: number;
}

export async function loadEligibilityRules(settings: SettingsService): Promise<EligibilityRules> {
  const [requiredDocuments, requireActivePack, scheduledConflictMinutes] = await Promise.all([
    settings.get<unknown>('drivers.required_documents', ['licence', 'insurance', 'registration']),
    settings.get<boolean>('drivers.require_active_pack', false),
    settings.number('dispatch.scheduled_conflict_minutes', 90),
  ]);
  return { requiredDocuments: documentTypes(requiredDocuments), requireActivePack: requireActivePack === true, scheduledConflictMinutes };
}

/** Types de documents exigés, réduits aux codes sûrs (ils entrent dans un tableau SQL littéral). */
export function documentTypes(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((d): d is string => typeof d === 'string' && /^[a-z_]+$/.test(d)) : [];
}

/**
 * Même règle que `canReceiveOffers` (domaine) : un pack actif non échu avec des courses (ou Illimité), ou un
 * renouvellement automatique en attente. Sert au filtre (`drivers.require_active_pack`) et, depuis le 3 octobre 2026, à la
 * priorité de répartition : un chauffeur sans pack reçoit des courses, mais après ceux qui en ont un. Alias `d` (drivers).
 */
export const hasUsablePack = sql`EXISTS (SELECT 1 FROM pack_purchases pp WHERE pp.driver_id = d.id AND pp.status <> 'cancelled' AND (pp.auto_renew
    OR (pp.status = 'active' AND pp.expires_at > now() AND (pp.rides_included IS NULL OR coalesce(pp.rides_remaining, 0) + pp.carried_over_remaining > 0))))`;

/**
 * Chauffeur actif, documents exigés approuvés et valides, pack actif si exigé, solde non bloquant, aucune suspension ;
 * avec `pendingOffersExcept`, aucune offre en attente pour une autre course que celle-ci.
 */
export function driverEligible(rules: Pick<EligibilityRules, 'requiredDocuments' | 'requireActivePack'>, pendingOffersExcept?: string, options: { premiumContext?: boolean } = {}): SQL {
  const documents = rules.requiredDocuments.length
    ? sql`AND NOT EXISTS (SELECT 1 FROM unnest(${sql.raw(`ARRAY[${rules.requiredDocuments.map((t) => `'${t}'`).join(',')}]::text[]`)}) AS req(type)
           WHERE NOT EXISTS (SELECT 1 FROM driver_documents dd WHERE dd.driver_id = d.id AND dd.type::text = req.type AND dd.status = 'approved' AND (dd.expires_on IS NULL OR dd.expires_on >= current_date)))`
    : sql``;
  const pack = rules.requireActivePack ? sql`AND ${hasUsablePack}` : sql``;
  const pending = pendingOffersExcept
    ? sql`AND NOT EXISTS (SELECT 1 FROM ride_offers o WHERE o.driver_id = d.id AND o.state = 'sent' AND o.expires_at > now() AND o.ride_id <> ${pendingOffersExcept}::uuid)`
    : sql``;
  // Restriction (5.11) : plus de courses VIP, aéroport ni entreprise ; les autres restent ouvertes. Sans contexte connu
  // (liste des véhicules d'un devis, véhicule choisi), un chauffeur restreint n'est pas proposé.
  const status = options.premiumContext === false ? sql`d.status IN ('active', 'restricted')` : sql`d.status = 'active'`;
  return sql`(${status} ${documents} ${pack}
    AND NOT EXISTS (SELECT 1 FROM driver_balances b WHERE b.driver_id = d.id AND b.suspended_for_balance_at IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM sanctions s WHERE s.driver_id = d.id AND s.type = 'suspension' AND (s.ends_at IS NULL OR s.ends_at > now()))
    ${pending})`;
}

/** Mode de paiement accepté par le chauffeur quand le client le paie après la course (amendement v1.1) ; le prépaiement passe toujours. */
export function paymentAccepted(paymentChoice: string | null, paymentMethod: string | null): SQL {
  if (paymentChoice !== 'pay_driver_after') return sql`true`;
  if (paymentMethod === 'cash') return sql`d.accepts_cash`;
  if (paymentMethod === 'interac') return sql`d.accepts_interac`;
  if (paymentMethod === 'terminal') return sql`d.accepts_terminal`;
  return sql`true`;
}

/** Véhicule courant actif du chauffeur et sa catégorie (jointures à placer après `FROM drivers d`). */
export const currentVehicleJoin = sql`JOIN vehicles v ON v.id = d.current_vehicle_id AND v.status = 'active' JOIN vehicle_categories vc ON vc.code = v.category`;

/** Garantie modèle : catégorie `vc` égale ou supérieure à la catégorie réservée. */
export function categoryAtLeast(category: string): SQL {
  return sql`vc.rank >= (SELECT rank FROM vehicle_categories WHERE code = ${category})`;
}

/** Libre sur le créneau d'une planifiée : accepte les planifiées, aucune autre planifiée attribuée à ± `scheduledConflictMinutes`. */
export function scheduledSlotFree(rules: Pick<EligibilityRules, 'scheduledConflictMinutes'>, requestedAt: Date, exceptRideId?: string): SQL {
  const at = requestedAt.toISOString();
  const except = exceptRideId ? sql`AND r2.id <> ${exceptRideId}::uuid` : sql``;
  return sql`(d.accepts_scheduled AND NOT EXISTS (
    SELECT 1 FROM rides r2 WHERE r2.driver_id = d.id ${except} AND r2.type = 'scheduled' AND r2.state IN ('assigned', 'en_route', 'arrived', 'in_progress')
      AND r2.requested_at BETWEEN ${at}::timestamptz - make_interval(mins => ${rules.scheduledConflictMinutes}::int) AND ${at}::timestamptz + make_interval(mins => ${rules.scheduledConflictMinutes}::int)))`;
}

/**
 * Étape 23 (module Flotte) : une course d'une organisation cliente, tant qu'elle n'est pas repartie au réseau Neomoov
 * (`network_shared_at`), n'est proposée qu'aux chauffeurs de cette organisation et de ses descendantes ; les chauffeurs
 * d'autres organisations ne sont jamais proposés. Une course de la plateforme (racine, ou sans organisation) reste ouverte
 * à tous les chauffeurs éligibles, ceux des flottes compris. Alias `d` (drivers).
 */
export function organizationAllows(ride: { organizationId: string | null; networkSharedAt: Date | null }): SQL {
  if (!ride.organizationId || ride.networkSharedAt) return sql`true`;
  return sql`(NOT EXISTS (SELECT 1 FROM organizations ro WHERE ro.id = ${ride.organizationId}::uuid AND ro.parent_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM organizations ro JOIN organizations dor ON dor.path LIKE ro.path || '%' WHERE ro.id = ${ride.organizationId}::uuid AND dor.id = d.organization_id))`;
}
