/**
 * Conditions des rôles (étapes 19 à 21, amendement v1.2 section 3) : une permission d'un rôle peut être restreinte par
 * `role_permissions.conditions` : lecture seule, montant maximal (en cents), zones admises (codes de zone). Une permission
 * tenue par plusieurs rôles vaut dès qu'une de ses tenues l'admet ; une tenue sans condition l'admet toujours. Une
 * condition illisible n'accorde rien (refus par défaut). Pas d'escalade : on n'accorde une permission qu'avec des
 * conditions au moins aussi strictes que l'une des siennes. Fonctions pures ; la garde des routes d'organisation applique.
 */
import { z } from 'zod';
import { PERMISSION_CODES, PERMISSIONS, type Permission } from './permissions.js';

const ZONE_CODE = /^[a-z0-9_-]{1,40}$/;

/** Conditions d'une permission dans un rôle ; un objet vide ou absent : aucune condition. */
export const roleConditionsSchema = z
  .object({
    /** La permission ne vaut que pour lire (GET) : toute écriture qu'elle ouvrirait est refusée. */
    readOnly: z.boolean().optional(),
    /** Montant maximal d'une action (course créée, attribuée ou annulée…), en cents, taxes comprises. */
    maxAmountCents: z.number().int().min(0).max(10_000_000).optional(),
    /** Zones admises : l'action doit porter sur un lieu situé dans l'une d'elles (départ de la course). */
    zones: z.array(z.string().regex(ZONE_CODE)).min(1).max(50).optional(),
  })
  .strict();
export type RoleConditions = z.infer<typeof roleConditionsSchema>;

/** Conditions par permission, telles que My Hub les écrit et les lit (clé : code de permission). */
export const roleConditionsMapSchema = z.record(z.string(), roleConditionsSchema);
export type RoleConditionsMap = z.infer<typeof roleConditionsMapSchema>;

export type ParsedRoleConditions = { ok: true; conditions: RoleConditions | null } | { ok: false };

/** Lecture de la colonne JSON : `null` sans condition ; `ok: false` pour un contenu illisible (la tenue n'accorde rien). */
export function parseRoleConditions(raw: unknown): ParsedRoleConditions {
  if (raw === null || raw === undefined) return { ok: true, conditions: null };
  const parsed = roleConditionsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false };
  return { ok: true, conditions: hasConditions(parsed.data) ? normalized(parsed.data) : null };
}

/** Vrai si l'objet restreint vraiment la permission (lecture seule vraie, montant ou zones présents). */
export function hasConditions(c: RoleConditions | null | undefined): c is RoleConditions {
  return Boolean(c && (c.readOnly === true || c.maxAmountCents !== undefined || (c.zones !== undefined && c.zones.length > 0)));
}

function normalized(c: RoleConditions): RoleConditions {
  return {
    ...(c.readOnly === true ? { readOnly: true } : {}),
    ...(c.maxAmountCents !== undefined ? { maxAmountCents: c.maxAmountCents } : {}),
    ...(c.zones?.length ? { zones: [...new Set(c.zones)].sort() } : {}),
  };
}

/** Conditions à écrire pour une permission : objet vide sans condition (valeur par défaut de la colonne). */
export function conditionsForStorage(c: RoleConditions | null | undefined): RoleConditions | Record<string, never> {
  return hasConditions(c) ? normalized(c) : {};
}

/**
 * Faits d'une requête, comparés aux conditions. `amountCents` absent : la route ne porte aucun montant (le plafond ne
 * s'applique pas) ; `null` : montant attendu mais inconnu (un plafond refuse). `zones` absent : la route ne porte aucun
 * lieu ; une liste (même vide) : zones qui contiennent le lieu de l'action.
 */
export interface ConditionFacts {
  write: boolean;
  amountCents?: number | null;
  zones?: readonly string[];
}

export const CONDITION_REFUSALS = ['read_only', 'amount', 'zone'] as const;
export type ConditionRefusal = (typeof CONDITION_REFUSALS)[number];

/** Raison pour laquelle une tenue conditionnée n'admet pas la requête, ou `null` si elle l'admet. */
export function conditionRefusal(conditions: RoleConditions | null, facts: ConditionFacts): ConditionRefusal | null {
  if (!hasConditions(conditions)) return null;
  if (conditions.readOnly && facts.write) return 'read_only';
  if (conditions.maxAmountCents !== undefined && facts.amountCents !== undefined && (facts.amountCents === null || facts.amountCents > conditions.maxAmountCents)) return 'amount';
  if (conditions.zones?.length && facts.zones !== undefined && !facts.zones.some((z) => conditions.zones!.includes(z))) return 'zone';
  return null;
}

/** Tenues d'une permission : une entrée par rôle qui la donne (`null` : sans condition). */
export type PermissionGrants = ReadonlyMap<Permission, ReadonlyArray<RoleConditions | null>>;

/** Faits nécessaires pour juger les tenues des permissions requises : lieu, montant (seulement si une tenue les restreint). */
export function conditionFactsNeeded(required: readonly Permission[], grants: PermissionGrants): { amount: boolean; zone: boolean } {
  let amount = false;
  let zone = false;
  for (const code of required) {
    for (const c of grants.get(code) ?? []) {
      if (c?.maxAmountCents !== undefined) amount = true;
      if (c?.zones?.length) zone = true;
    }
  }
  return { amount, zone };
}

/**
 * Permissions requises admises par leurs tenues pour cette requête (au moins une tenue sans refus), et, pour celles qui
 * ne le sont pas, la première raison du refus (pour la réponse 403).
 */
export function admittedPermissions(required: readonly Permission[], grants: PermissionGrants, facts: ConditionFacts): { admitted: Permission[]; refusals: Partial<Record<Permission, ConditionRefusal>> } {
  const admitted: Permission[] = [];
  const refusals: Partial<Record<Permission, ConditionRefusal>> = {};
  for (const code of required) {
    const held = grants.get(code);
    if (!held?.length) continue;
    const reasons = held.map((c) => conditionRefusal(c, facts));
    if (reasons.some((r) => r === null)) admitted.push(code);
    else refusals[code] = reasons[0]!;
  }
  return { admitted, refusals };
}

/** `granted` est au moins aussi strict que `held` (pas d'escalade par les conditions). */
export function conditionsWithin(granted: RoleConditions | null, held: RoleConditions | null): boolean {
  if (!hasConditions(held)) return true;
  if (!hasConditions(granted)) return false;
  if (held.readOnly && !granted.readOnly) return false;
  if (held.maxAmountCents !== undefined && (granted.maxAmountCents === undefined || granted.maxAmountCents > held.maxAmountCents)) return false;
  if (held.zones?.length && (!granted.zones?.length || !granted.zones.every((z) => held.zones!.includes(z)))) return false;
  return true;
}

/**
 * Permissions accordées (rôle personnalisé) avec des conditions plus larges que toutes celles de l'auteur : refusées
 * comme une escalade. Une permission que l'auteur ne tient pas du tout est jugée ailleurs (`refusedGrants`).
 */
export function refusedConditionGrants(grants: PermissionGrants, requested: readonly string[], conditions: RoleConditionsMap | undefined): string[] {
  return requested.filter((code) => {
    const held = grants.get(code as Permission);
    if (!held?.length) return false;
    const granted = conditions?.[code] ?? null;
    return !held.some((h) => conditionsWithin(hasConditions(granted) ? granted : null, h));
  });
}

/** Permissions sensibles du catalogue (double authentification, journal, alerte au propriétaire de l'organisation). */
export const SENSITIVE_PERMISSIONS: readonly Permission[] = PERMISSION_CODES.filter((code) => PERMISSIONS[code].sensitive);

/**
 * Permissions sensibles réellement utilisées par une requête admise : celles de la route que l'appelant détient, à moins
 * qu'une permission non sensible de la même route ne suffise (elle aurait admis la requête seule).
 */
export function sensitivePermissionsUsed(required: readonly Permission[], admitted: ReadonlySet<Permission> | readonly Permission[]): Permission[] {
  const held = admitted instanceof Set ? admitted : new Set(admitted as readonly Permission[]);
  const usable = required.filter((code) => held.has(code));
  if (usable.some((code) => !PERMISSIONS[code].sensitive)) return [];
  return usable.filter((code) => PERMISSIONS[code].sensitive);
}
