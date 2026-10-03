/**
 * Finalisation du 3 octobre 2026 (agent U2) : conditions des rôles, permissions sensibles utilisées, critères Pilote de la
 * flotte, suggestion d'entretien, règle des 60 000 km, renouvellement des antécédents, garde des statuts de facturation.
 */
import { describe, expect, it } from 'vitest';
import {
  admittedPermissions, backgroundCheckDueOn, billingPortalRequestSchema, conditionFactsNeeded, conditionRefusal, conditionsForStorage, conditionsWithin,
  DEFAULT_PILOT_CRITERIA, evaluateOffer, evaluateOfferWithFleet, fleetPilotSettingsSchema, isDefaultPilotCriteria, maintenanceDue, maintenanceSuggestion,
  mechanicalCertificateDueOn, nextSubscriptionStatus, organizationWriteRefusal, parseFleetPilotSettings, parseRoleConditions, pilotCriteriaSchema,
  refusedConditionGrants, restrictiveOrganizationStatus, roleCreateSchema, roleConditionsSchema, rolePermissionsUpdateSchema, SENSITIVE_PERMISSIONS,
  sensitivePermissionsUsed, suspensionForced, type MaintenanceRecord, type Permission, type PermissionGrants, type PilotContext, type PilotOffer, type RoleConditions,
} from '../src/index.js';

const grants = (entries: Array<[Permission, Array<RoleConditions | null>]>): PermissionGrants => new Map(entries);

describe('conditions des rôles', () => {
  it('lecture de la colonne : vide sans condition, illisible refusée, normalisée', () => {
    expect(parseRoleConditions({})).toEqual({ ok: true, conditions: null });
    expect(parseRoleConditions(null)).toEqual({ ok: true, conditions: null });
    expect(parseRoleConditions({ readOnly: false })).toEqual({ ok: true, conditions: null });
    expect(parseRoleConditions({ zones: ['plateau', 'centre', 'plateau'] })).toEqual({ ok: true, conditions: { zones: ['centre', 'plateau'] } });
    expect(parseRoleConditions({ maxAmountCents: -1 })).toEqual({ ok: false });
    expect(parseRoleConditions({ inconnu: true })).toEqual({ ok: false });
    expect(parseRoleConditions('texte')).toEqual({ ok: false });
    expect(conditionsForStorage(null)).toEqual({});
    expect(conditionsForStorage({ readOnly: true, zones: ['b', 'a'] })).toEqual({ readOnly: true, zones: ['a', 'b'] });
    expect(roleConditionsSchema.safeParse({ zones: [] }).success).toBe(false);
  });

  it('refus par condition : lecture seule, montant, zone ; faits absents non jugés', () => {
    expect(conditionRefusal(null, { write: true, amountCents: 999_999 })).toBeNull();
    expect(conditionRefusal({ readOnly: true }, { write: true })).toBe('read_only');
    expect(conditionRefusal({ readOnly: true }, { write: false })).toBeNull();
    expect(conditionRefusal({ maxAmountCents: 5000 }, { write: true, amountCents: 5000 })).toBeNull();
    expect(conditionRefusal({ maxAmountCents: 5000 }, { write: true, amountCents: 5001 })).toBe('amount');
    expect(conditionRefusal({ maxAmountCents: 5000 }, { write: true, amountCents: null })).toBe('amount');
    expect(conditionRefusal({ maxAmountCents: 5000 }, { write: true })).toBeNull();
    expect(conditionRefusal({ zones: ['plateau'] }, { write: true, zones: ['grand-montreal', 'plateau'] })).toBeNull();
    expect(conditionRefusal({ zones: ['plateau'] }, { write: true, zones: ['grand-montreal'] })).toBe('zone');
    expect(conditionRefusal({ zones: ['plateau'] }, { write: true, zones: [] })).toBe('zone');
    expect(conditionRefusal({ zones: ['plateau'] }, { write: true })).toBeNull();
  });

  it('une tenue sans condition suffit ; sinon la première raison est rendue', () => {
    const held = grants([['rides.create', [{ maxAmountCents: 3000 }, null]], ['rides.cancel', [{ readOnly: true }, { zones: ['plateau'] }]]]);
    expect(admittedPermissions(['rides.create'], held, { write: true, amountCents: 90_000 }).admitted).toEqual(['rides.create']);
    const result = admittedPermissions(['rides.cancel', 'rides.read'], held, { write: true, zones: ['centre'] });
    expect(result).toEqual({ admitted: [], refusals: { 'rides.cancel': 'read_only' } });
    expect(admittedPermissions(['rides.cancel'], held, { write: true, zones: ['plateau'] }).admitted).toEqual(['rides.cancel']);
    expect(conditionFactsNeeded(['rides.create'], held)).toEqual({ amount: true, zone: false });
    expect(conditionFactsNeeded(['rides.cancel'], held)).toEqual({ amount: false, zone: true });
    expect(conditionFactsNeeded(['rides.read'], held)).toEqual({ amount: false, zone: false });
  });

  it('pas d\'escalade : conditions accordées au moins aussi strictes que l\'une de celles de l\'auteur', () => {
    expect(conditionsWithin(null, null)).toBe(true);
    expect(conditionsWithin({ readOnly: true }, null)).toBe(true);
    expect(conditionsWithin(null, { maxAmountCents: 100 })).toBe(false);
    expect(conditionsWithin({ maxAmountCents: 50 }, { maxAmountCents: 100 })).toBe(true);
    expect(conditionsWithin({ maxAmountCents: 150 }, { maxAmountCents: 100 })).toBe(false);
    expect(conditionsWithin({ maxAmountCents: 50 }, { readOnly: true })).toBe(false);
    expect(conditionsWithin({ zones: ['a'] }, { zones: ['a', 'b'] })).toBe(true);
    expect(conditionsWithin({ zones: ['c'] }, { zones: ['a', 'b'] })).toBe(false);
    expect(conditionsWithin({ readOnly: true }, { zones: ['a'] })).toBe(false);
    const held = grants([['rides.create', [{ maxAmountCents: 3000 }, { zones: ['plateau'] }]], ['rides.read', [null]]]);
    expect(refusedConditionGrants(held, ['rides.create', 'rides.read'], { 'rides.create': { maxAmountCents: 2000 } })).toEqual([]);
    expect(refusedConditionGrants(held, ['rides.create', 'rides.read'], undefined)).toEqual(['rides.create']);
    expect(refusedConditionGrants(held, ['rides.create'], { 'rides.create': { zones: ['plateau', 'centre'] } })).toEqual(['rides.create']);
    // Une permission que l'auteur ne tient pas du tout est jugée par `refusedGrants`, pas ici.
    expect(refusedConditionGrants(held, ['rides.cancel'], undefined)).toEqual([]);
  });

  it('schémas des rôles : conditions facultatives, absentes du rôle sans condition', () => {
    const base = { organizationId: '018f3c1e-0000-7000-8000-000000000001', code: 'agent_limite', name: 'Agent limité', level: 2, permissions: ['rides.create'] };
    expect(roleCreateSchema.parse(base).conditions).toBeUndefined();
    expect(roleCreateSchema.parse({ ...base, conditions: { 'rides.create': { maxAmountCents: 5000 } } }).conditions).toEqual({ 'rides.create': { maxAmountCents: 5000 } });
    expect(rolePermissionsUpdateSchema.safeParse({ permissions: ['rides.create'], conditions: { 'rides.create': { montant: 1 } } }).success).toBe(false);
  });
});

describe('permissions sensibles utilisées', () => {
  it('catalogue : la liste suit le drapeau de chaque permission', () => {
    expect(SENSITIVE_PERMISSIONS).toContain('members.manage');
    expect(SENSITIVE_PERMISSIONS).toContain('documents.content.read');
    expect(SENSITIVE_PERMISSIONS).not.toContain('rides.read');
  });

  it('une permission non sensible de la route qui suffit : aucune utilisation sensible', () => {
    expect(sensitivePermissionsUsed(['members.manage'], new Set<Permission>(['members.manage']))).toEqual(['members.manage']);
    expect(sensitivePermissionsUsed(['audit.read', 'members.manage'], new Set<Permission>(['audit.read', 'members.manage']))).toEqual([]);
    expect(sensitivePermissionsUsed(['audit.read', 'members.manage'], ['members.manage'])).toEqual(['members.manage']);
    expect(sensitivePermissionsUsed(['rides.read'], ['rides.read'])).toEqual([]);
  });
});

describe('critères Pilote de la flotte', () => {
  const BASE: PilotOffer = {
    rideType: 'scheduled', negotiation: false, category: 'neo_premium', driverFareCents: 3000,
    pickupMeters: null, pickupSeconds: null, tripMeters: 10_000, tripSeconds: 1200, pickupAt: new Date('2026-10-05T14:00:00Z'),
    originZones: ['grand-montreal', 'plateau'], destinationZones: ['grand-montreal', 'centre-ville'], clientRating: 4.8, assistanceAnimal: false, accessibility: false,
  };
  const CTX: PilotContext = { timeZone: 'America/Toronto', multiAppFactor: 1.25, nearMissPercent: 0, planned: [] };
  const driver = (input = {}) => pilotCriteriaSchema.parse(input);

  it('réglage enregistré : illisible ou absent vaut « off »', () => {
    expect(parseFleetPilotSettings(undefined).mode).toBe('off');
    expect(parseFleetPilotSettings({ mode: 'imposé' }).mode).toBe('off');
    expect(parseFleetPilotSettings({ mode: 'minimum', criteria: { minFareCents: 2500 } })).toMatchObject({ mode: 'minimum', criteria: { minFareCents: 2500 } });
    expect(fleetPilotSettingsSchema.parse({ mode: 'default' }).criteria.originZones).toEqual([]);
    expect(isDefaultPilotCriteria({ ...DEFAULT_PILOT_CRITERIA, multiAppMode: true })).toBe(true);
    expect(isDefaultPilotCriteria(driver({ minFareCents: 1 }))).toBe(false);
  });

  it('off ou sans critères du chauffeur : évaluation du chauffeur seule', () => {
    const fleet = fleetPilotSettingsSchema.parse({ mode: 'off', criteria: { minFareCents: 5000 } });
    expect(evaluateOfferWithFleet(BASE, driver(), fleet, CTX)).toEqual(evaluateOffer(BASE, driver(), CTX));
    expect(evaluateOfferWithFleet(BASE, null, fleetPilotSettingsSchema.parse({ mode: 'minimum' }), CTX).reasons[0]?.code).toBe('criteria_invalid');
    expect(evaluateOfferWithFleet(BASE, driver(), null, CTX).decision).toBe('accept');
  });

  it('default : critères de la flotte tant que le chauffeur n\'a rien réglé', () => {
    const fleet = fleetPilotSettingsSchema.parse({ mode: 'default', criteria: { minFareCents: 5000 } });
    expect(evaluateOfferWithFleet(BASE, driver(), fleet, CTX).decision).toBe('reject');
    expect(evaluateOfferWithFleet(BASE, driver({ maxDurationMinutes: 60 }), fleet, CTX).decision).toBe('accept');
  });

  it('minimum : Pilote n\'accepte que ce que les deux admettent, raisons réunies sans doublon', () => {
    const fleet = fleetPilotSettingsSchema.parse({ mode: 'minimum', criteria: { categories: ['neo_xl'], minFareCents: 5000 } });
    const result = evaluateOfferWithFleet(BASE, driver({ minFareCents: 4000 }), fleet, CTX);
    expect(result.decision).toBe('reject');
    expect(result.score).toBe('red');
    expect(result.reasons.map((r) => r.code).sort()).toEqual(['category_not_admitted', 'fare_below_min', 'fare_below_min']);
    expect(result.metrics).toEqual(evaluateOffer(BASE, driver({ minFareCents: 4000 }), CTX).metrics);
    expect(evaluateOfferWithFleet(BASE, driver({ minFareCents: 2000 }), fleetPilotSettingsSchema.parse({ mode: 'minimum', criteria: { minFareCents: 2500 } }), CTX).decision).toBe('accept');
    const manual = evaluateOfferWithFleet({ ...BASE, rideType: 'immediate' }, driver({ multiAppMode: true }), fleetPilotSettingsSchema.parse({ mode: 'minimum' }), CTX);
    expect(manual.decision).toBe('manual');
    expect(manual.reasons.filter((r) => r.code === 'multi_app_immediate')).toHaveLength(1);
  });
});

describe('suggestion d\'entretien (règles déterministes)', () => {
  const record = (kind: MaintenanceRecord['kind'], performedOn: string, extra: Partial<MaintenanceRecord> = {}): MaintenanceRecord => ({ kind, performedOn, odometerKm: null, nextDueOn: null, nextDueKm: null, ...extra });

  it('véhicule suivi et à jour hors saison : rien à conseiller', () => {
    const records = [record('inspection', '2026-05-01'), record('brakes', '2026-01-10'), record('tires', '2026-04-20', { odometerKm: 30_000 })];
    expect(maintenanceSuggestion(records, maintenanceDue(records, '2026-06-15', 35_000), '2026-06-15', 35_000)).toBeNull();
  });

  it('retards, échéances proches, inspection, pneus, freins et pneus d\'hiver, en français et en anglais', () => {
    const records = [record('oil_change', '2025-01-01', { nextDueOn: '2026-01-01' }), record('battery', '2026-10-01', { nextDueOn: '2026-10-20' }), record('tires', '2025-04-01', { odometerKm: 10_000 })];
    const due = maintenanceDue(records, '2026-10-16', 60_000);
    const fr = maintenanceSuggestion(records, due, '2026-10-16', 60_000)!;
    expect(fr).toContain('En retard : vidange');
    expect(fr).toContain('À prévoir bientôt : batterie');
    expect(fr).toContain('Aucune inspection enregistrée depuis 12 mois');
    expect(fr).toContain('Pneus : vérifiez l\'usure');
    expect(fr).toContain('Freins : contrôle conseillé');
    expect(fr).toContain('Pneus d\'hiver obligatoires au Québec');
    const en = maintenanceSuggestion(records, due, '2026-10-16', 60_000, 'en')!;
    expect(en).toContain('Overdue: oil change');
    expect(en).toContain('Winter tires are mandatory');
    // Sans kilométrage déclaré, aucune règle de kilométrage.
    expect(maintenanceSuggestion([record('inspection', '2026-05-01'), record('brakes', '2026-05-01')], [], '2026-06-01', null)).toBeNull();
  });
});

describe('conformité : 60 000 km et antécédents judiciaires', () => {
  it('certificat mécanique : sa date, ou aujourd\'hui une fois 60 000 km parcourus depuis la vérification', () => {
    expect(mechanicalCertificateDueOn('2027-03-01', 120_000, 70_000, '2026-10-03')).toBe('2027-03-01');
    expect(mechanicalCertificateDueOn('2027-03-01', 130_000, 70_000, '2026-10-03')).toBe('2026-10-03');
    expect(mechanicalCertificateDueOn('2027-03-01', 130_000, null, '2026-10-03')).toBe('2027-03-01');
    expect(mechanicalCertificateDueOn('2026-09-01', 130_000, 70_000, '2026-10-03')).toBe('2026-09-01');
  });

  it('antécédents : date du document, sinon dépôt plus la durée réglée, sinon aucune échéance', () => {
    expect(backgroundCheckDueOn({ expiresOn: '2027-01-31', depositedOn: '2026-01-31' }, 12)).toBe('2027-01-31');
    expect(backgroundCheckDueOn({ expiresOn: null, depositedOn: '2026-01-31' }, 12)).toBe('2027-01-31');
    expect(backgroundCheckDueOn({ expiresOn: null, depositedOn: '2026-01-31' }, 0)).toBeNull();
  });
});

describe('facturation de la plateforme : écritures des organisations', () => {
  it('statut le plus restrictif de l\'organisation et de ses ancêtres', () => {
    expect(restrictiveOrganizationStatus([])).toBe('active');
    expect(restrictiveOrganizationStatus(['active', 'trial'])).toBe('active');
    expect(restrictiveOrganizationStatus(['active', 'read_only', 'trial'])).toBe('read_only');
    expect(restrictiveOrganizationStatus(['suspended', 'read_only'])).toBe('suspended');
    expect(restrictiveOrganizationStatus(['active', 'inconnu'])).toBe('inconnu');
  });

  it('écriture refusée sous lecture seule ou suspension, jamais sur une course en cours ni pour régulariser', () => {
    expect(organizationWriteRefusal('active', { write: true, activeRide: false, exempt: false })).toBeNull();
    expect(organizationWriteRefusal('read_only', { write: false, activeRide: false, exempt: false })).toBeNull();
    expect(organizationWriteRefusal('read_only', { write: true, activeRide: false, exempt: false })).toBe('read_only');
    expect(organizationWriteRefusal('suspended', { write: true, activeRide: true, exempt: false })).toBeNull();
    expect(organizationWriteRefusal('suspended', { write: true, activeRide: false, exempt: true })).toBeNull();
    expect(organizationWriteRefusal('closed', { write: true, activeRide: false, exempt: false })).toBe('closed');
  });

  it('suspension reportée : forcée après le délai réglé seulement', () => {
    const since = new Date('2026-10-01T05:00:00Z');
    expect(suspensionForced(null, new Date('2026-12-01T00:00:00Z'), 7)).toBe(false);
    expect(suspensionForced(since, new Date('2026-10-20T00:00:00Z'), 0)).toBe(false);
    expect(suspensionForced(since, new Date('2026-10-08T04:59:59Z'), 7)).toBe(false);
    expect(suspensionForced(since, new Date('2026-10-08T05:00:00Z'), 7)).toBe(true);
    expect(nextSubscriptionStatus('read_only', 'suspended', { activeRide: true })).toMatchObject({ status: 'read_only', postponed: true });
    expect(nextSubscriptionStatus('read_only', 'suspended', { activeRide: true, forceSuspension: true })).toMatchObject({ status: 'suspended', postponed: false, escalated: true });
  });

  it('portail client : retour vers My Hub seulement', () => {
    expect(billingPortalRequestSchema.safeParse({}).success).toBe(true);
    expect(billingPortalRequestSchema.safeParse({ returnPath: '/hub/organisation?onglet=facturation' }).success).toBe(true);
    expect(billingPortalRequestSchema.safeParse({ returnPath: 'https://exemple.test/hub' }).success).toBe(false);
    expect(billingPortalRequestSchema.safeParse({ returnPath: '//exemple.test/hub' }).success).toBe(false);
    expect(billingPortalRequestSchema.safeParse({ returnPath: '/hub/../connexion' }).success).toBe(false);
  });
});
