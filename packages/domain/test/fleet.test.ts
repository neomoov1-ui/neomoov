import { describe, expect, it } from 'vitest';
import {
  datesBetween, firstNameOf, formatShare, maintenanceDue, NETWORK_SHARED_FIELDS, networkSharedRide, revenueShare, revenueShareRuleProblem, ruleApplies, ruleOn,
  shouldShareToNetwork, type RevenueShareRule,
} from '../src/fleet/fleet.js';
import {
  driverInvitationCreateSchema, fleetSettingsUpdateSchema, maintenanceCreateSchema, networkSharedRideSchema, orgDocumentReviewSchema, orgVehicleCreateSchema, orgVehicleUpdateSchema,
  revenueShareRuleCreateSchema,
} from '../src/schemas/fleet.js';
import { ORGANIZATION_PERMISSIONS, PERMISSIONS, systemRole } from '../src/access/permissions.js';

const rule = (over: Partial<RevenueShareRule> & Pick<RevenueShareRule, 'id' | 'mode'>): RevenueShareRule => ({
  driverId: null, weeklyRentCents: null, percentagePpm: null, effectiveFrom: '2026-01-01', effectiveTo: null, ...over,
});
const WEEK = { startDate: '2026-09-21', endDate: '2026-09-27' };

describe('flotte : règles de partage des revenus', () => {
  it('applique une règle entre ses dates, bornes comprises', () => {
    expect(ruleApplies({ effectiveFrom: '2026-09-21', effectiveTo: '2026-09-27' }, '2026-09-21')).toBe(true);
    expect(ruleApplies({ effectiveFrom: '2026-09-21', effectiveTo: '2026-09-27' }, '2026-09-27')).toBe(true);
    expect(ruleApplies({ effectiveFrom: '2026-09-21', effectiveTo: '2026-09-27' }, '2026-09-28')).toBe(false);
    expect(ruleApplies({ effectiveFrom: '2026-09-21', effectiveTo: null }, '2026-09-20')).toBe(false);
    expect(ruleApplies({ effectiveFrom: '2026-09-21', effectiveTo: null }, '2030-01-01')).toBe(true);
  });

  it('préfère la règle du chauffeur, puis la plus récente ; ignore celle d\'un autre chauffeur', () => {
    const org = rule({ id: 'org', mode: 'percentage', percentagePpm: 200_000 });
    const orgNewer = rule({ id: 'org2', mode: 'percentage', percentagePpm: 250_000, effectiveFrom: '2026-09-01' });
    const mine = rule({ id: 'mine', mode: 'rent', weeklyRentCents: 35_000, driverId: 'd1', effectiveFrom: '2026-09-25' });
    const other = rule({ id: 'other', mode: 'rent', weeklyRentCents: 1, driverId: 'd2' });
    expect(ruleOn([org, orgNewer, mine, other], 'd1', '2026-09-24')?.id).toBe('org2');
    expect(ruleOn([org, orgNewer, mine, other], 'd1', '2026-09-25')?.id).toBe('mine');
    expect(ruleOn([org, other], 'd2', '2026-09-25')?.id).toBe('other');
    expect(ruleOn([], 'd1', '2026-09-25')).toBeNull();
  });

  it('énumère les jours d\'une période', () => {
    expect(datesBetween('2026-09-28', '2026-10-02')).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    expect(datesBetween('2026-10-02', '2026-10-01')).toEqual([]);
  });

  it('formate un pourcentage', () => {
    expect(formatShare(200_000)).toBe('20 %');
    expect(formatShare(125_000)).toBe('12,5 %');
  });

  it('loyer de la semaine complète, ou au prorata des jours couverts', () => {
    const full = revenueShare([rule({ id: 'r', mode: 'rent', weeklyRentCents: 35_000 })], 'd1', WEEK, []);
    expect(full).toEqual({ totalCents: 35_000, lines: [{ ruleId: 'r', mode: 'rent', amountCents: 35_000, baseCents: 0, days: 7, label: 'Part de l\'organisation : loyer de la semaine' }] });
    const partial = revenueShare([rule({ id: 'r', mode: 'rent', weeklyRentCents: 35_000, effectiveFrom: '2026-09-25' })], 'd1', WEEK, [{ rideId: 'x', date: '2026-09-26', fareCents: 1_000 }]);
    expect(partial.totalCents).toBe(15_000);
    expect(partial.lines[0]!.label).toBe('Part de l\'organisation : loyer (3 jours sur 7)');
  });

  it('pourcentage du tarif chauffeur des courses de la période, par règle en vigueur le jour de la course', () => {
    const rules = [
      rule({ id: 'p20', mode: 'percentage', percentagePpm: 200_000, effectiveTo: '2026-09-23' }),
      rule({ id: 'p25', mode: 'percentage', percentagePpm: 250_000, effectiveFrom: '2026-09-24' }),
    ];
    const rides = [
      { rideId: 'a', date: '2026-09-22', fareCents: 4_000 },
      { rideId: 'b', date: '2026-09-24', fareCents: 2_000 },
      { rideId: 'c', date: '2026-09-28', fareCents: 9_999 },
      { rideId: 'd', date: '2026-09-20', fareCents: 9_999 },
    ];
    const share = revenueShare(rules, 'd1', WEEK, rides);
    expect(share.totalCents).toBe(800 + 500);
    expect(share.lines.map((l) => [l.ruleId, l.amountCents, l.baseCents, l.label])).toEqual([
      ['p20', 800, 4_000, 'Part de l\'organisation : 20 % du tarif'],
      ['p25', 500, 2_000, 'Part de l\'organisation : 25 % du tarif'],
    ]);
  });

  it('aucune ligne sans règle, sans course ou pour un montant nul', () => {
    expect(revenueShare([], 'd1', WEEK, [{ rideId: 'a', date: '2026-09-22', fareCents: 4_000 }])).toEqual({ totalCents: 0, lines: [] });
    expect(revenueShare([rule({ id: 'p', mode: 'percentage', percentagePpm: 200_000 })], 'd1', WEEK, []).lines).toEqual([]);
    // Valeurs absentes (règle mal formée en base) : traitées comme nulles.
    expect(revenueShare([rule({ id: 'r', mode: 'rent' })], 'd1', WEEK, []).lines).toEqual([]);
    expect(revenueShare([rule({ id: 'p', mode: 'percentage' })], 'd1', WEEK, [{ rideId: 'a', date: '2026-09-22', fareCents: 4_000 }]).lines).toEqual([]);
  });

  it('valide la cohérence d\'une règle', () => {
    const base = { weeklyRentCents: null, percentagePpm: null, effectiveFrom: '2026-09-21', effectiveTo: null };
    expect(revenueShareRuleProblem({ ...base, mode: 'rent' })).toBe('RENT_REQUIRED');
    expect(revenueShareRuleProblem({ ...base, mode: 'rent', weeklyRentCents: 0 })).toBe('RENT_REQUIRED');
    expect(revenueShareRuleProblem({ ...base, mode: 'percentage' })).toBe('PERCENTAGE_REQUIRED');
    expect(revenueShareRuleProblem({ ...base, mode: 'percentage', percentagePpm: 1_000_001 })).toBe('PERCENTAGE_REQUIRED');
    expect(revenueShareRuleProblem({ ...base, mode: 'percentage', percentagePpm: 0 })).toBe('PERCENTAGE_REQUIRED');
    expect(revenueShareRuleProblem({ ...base, mode: 'percentage', percentagePpm: -5 })).toBe('PERCENTAGE_REQUIRED');
    expect(revenueShareRuleProblem({ ...base, mode: 'rent', weeklyRentCents: -1 })).toBe('RENT_REQUIRED');
    expect(revenueShareRuleProblem({ ...base, mode: 'rent', weeklyRentCents: 100, effectiveTo: '2026-09-20' })).toBe('END_BEFORE_START');
    expect(revenueShareRuleProblem({ ...base, mode: 'percentage', percentagePpm: 200_000, effectiveTo: '2026-09-21' })).toBeNull();
  });
});

describe('flotte : réseau Neomoov', () => {
  const now = new Date('2026-09-30T12:00:00Z');
  const base = { networkMode: 'neomoov_network' as const, afterMinutes: 15, createdAt: new Date('2026-09-30T11:40:00Z'), requestedAt: new Date('2026-09-30T18:00:00Z'), now, state: 'offering', hasDriver: false, sharedAt: null };

  it('repart au réseau après le délai, ou quand l\'heure approche', () => {
    expect(shouldShareToNetwork(base)).toBe(true);
    expect(shouldShareToNetwork({ ...base, createdAt: new Date('2026-09-30T11:50:00Z') })).toBe(false);
    expect(shouldShareToNetwork({ ...base, createdAt: new Date('2026-09-30T11:55:00Z'), requestedAt: new Date('2026-09-30T12:10:00Z') })).toBe(true);
    expect(shouldShareToNetwork({ ...base, createdAt: new Date('2026-09-30T11:55:00Z'), requestedAt: null })).toBe(false);
    expect(shouldShareToNetwork({ ...base, state: 'requested' })).toBe(true);
  });

  it('jamais en mode isolé, deux fois, pourvue ou close', () => {
    expect(shouldShareToNetwork({ ...base, networkMode: 'isolated' })).toBe(false);
    expect(shouldShareToNetwork({ ...base, sharedAt: now })).toBe(false);
    expect(shouldShareToNetwork({ ...base, hasDriver: true })).toBe(false);
    expect(shouldShareToNetwork({ ...base, state: 'no_driver' })).toBe(false);
  });

  it('ne transmet que les champs permis et le prénom seul', () => {
    const shared = networkSharedRide({
      rideId: 'r', category: 'neo_premium', type: 'scheduled', requestedAt: '2026-09-30T18:00:00.000Z', driverFareCents: 3_000, passengerFirstName: 'Marie-Ève Tremblay',
      origin: { address: 'A', coordinates: { lat: 45.5, lng: -73.6 } }, destination: { address: 'B', coordinates: { lat: 45.4, lng: -73.7 } },
      clientPhone: '+15145550101', specialRequests: 'Appeler au 514', clientId: 'c',
    });
    expect(Object.keys(shared).sort()).toEqual([...NETWORK_SHARED_FIELDS].sort());
    expect(shared.passengerFirstName).toBe('Marie-Ève');
    expect(networkSharedRideSchema.safeParse({ ...shared, rideId: '00000000-0000-4000-8000-000000000001' }).success).toBe(true);
    expect(networkSharedRideSchema.safeParse({ ...shared, rideId: '00000000-0000-4000-8000-000000000001', clientPhone: '+1514' }).success).toBe(false);
    expect(firstNameOf('  ')).toBeNull();
    expect(firstNameOf(null)).toBeNull();
    expect(firstNameOf(undefined)).toBeNull();
  });
});

describe('flotte : échéances d\'entretien', () => {
  it('garde le dernier entretien de chaque type, classe en retard, proche ou à jour', () => {
    const due = maintenanceDue([
      { kind: 'oil_change', performedOn: '2026-03-01', odometerKm: 40_000, nextDueOn: '2026-09-01', nextDueKm: 48_000 },
      { kind: 'oil_change', performedOn: '2026-06-01', odometerKm: 45_000, nextDueOn: '2026-12-01', nextDueKm: 50_500 },
      { kind: 'tires', performedOn: '2026-04-01', odometerKm: null, nextDueOn: '2026-10-05', nextDueKm: null },
      { kind: 'tires', performedOn: '2026-01-01', odometerKm: null, nextDueOn: '2026-02-01', nextDueKm: null },
      { kind: 'inspection', performedOn: '2026-07-01', odometerKm: null, nextDueOn: '2026-09-15', nextDueKm: null },
      { kind: 'brakes', performedOn: '2026-07-01', odometerKm: null, nextDueOn: null, nextDueKm: 60_000 },
      { kind: 'cleaning', performedOn: '2026-07-01', odometerKm: null, nextDueOn: null, nextDueKm: null },
      { kind: 'battery', performedOn: '2026-01-01', odometerKm: null, nextDueOn: '2027-06-01', nextDueKm: 52_000 },
      { kind: 'repair', performedOn: '2026-01-01', odometerKm: null, nextDueOn: '2027-06-01', nextDueKm: 49_000 },
      { kind: 'other', performedOn: '2026-01-01', odometerKm: null, nextDueOn: '2027-01-01', nextDueKm: null },
    ], '2026-09-30', 50_000);
    expect(due).toEqual([
      { kind: 'inspection', dueOn: '2026-09-15', dueKm: null, status: 'overdue' },
      { kind: 'repair', dueOn: '2027-06-01', dueKm: 49_000, status: 'overdue' },
      { kind: 'tires', dueOn: '2026-10-05', dueKm: null, status: 'due_soon' },
      { kind: 'oil_change', dueOn: '2026-12-01', dueKm: 50_500, status: 'due_soon' },
      { kind: 'other', dueOn: '2027-01-01', dueKm: null, status: 'ok' },
      { kind: 'battery', dueOn: '2027-06-01', dueKm: 52_000, status: 'ok' },
      { kind: 'brakes', dueOn: null, dueKm: 60_000, status: 'ok' },
    ]);
  });

  it('kilométrage inconnu et seuils réglables', () => {
    expect(maintenanceDue([{ kind: 'tires', performedOn: '2026-01-01', odometerKm: null, nextDueOn: null, nextDueKm: 10 }], '2026-09-30', null)).toEqual([{ kind: 'tires', dueOn: null, dueKm: 10, status: 'ok' }]);
    expect(maintenanceDue([{ kind: 'tires', performedOn: '2026-01-01', odometerKm: null, nextDueOn: '2026-10-20', nextDueKm: null }], '2026-09-30', null, { soonDays: 30, soonKm: 10 })[0]!.status).toBe('due_soon');
    expect(maintenanceDue([], '2026-09-30', null)).toEqual([]);
  });
});

describe('flotte : schémas', () => {
  const id = '00000000-0000-4000-8000-000000000001';

  it('invitation d\'un chauffeur : téléphone E.164, langue et durée par défaut', () => {
    expect(driverInvitationCreateSchema.parse({ phone: '+15145550101' })).toEqual({ phone: '+15145550101', language: 'fr', expiresInDays: 7 });
    expect(driverInvitationCreateSchema.safeParse({ phone: '5145550101' }).success).toBe(false);
  });

  it('revue d\'un document par l\'organisation : motif exigé pour un refus', () => {
    expect(orgDocumentReviewSchema.safeParse({ decision: 'approved' }).success).toBe(true);
    expect(orgDocumentReviewSchema.safeParse({ decision: 'rejected' }).success).toBe(false);
    expect(orgDocumentReviewSchema.safeParse({ decision: 'rejected', note: 'Photo illisible' }).success).toBe(true);
  });

  it('véhicules : création avec titulaire, modification non vide', () => {
    expect(orgVehicleCreateSchema.safeParse({ driverId: id, make: 'Tesla', model: 'Model 3', year: 2024, colour: 'blanche', plate: 'abc 123', seats: 4 }).success).toBe(true);
    expect(orgVehicleUpdateSchema.safeParse({}).success).toBe(false);
    expect(orgVehicleUpdateSchema.parse({ plate: 'xyz 9' })).toEqual({ plate: 'XYZ 9' });
  });

  it('entretien : l\'échéance suit la date de l\'entretien', () => {
    expect(maintenanceCreateSchema.safeParse({ kind: 'oil_change', performedOn: '2026-09-30' }).success).toBe(true);
    expect(maintenanceCreateSchema.safeParse({ kind: 'oil_change', performedOn: '2026-09-30', nextDueOn: '2026-09-29' }).success).toBe(false);
    expect(maintenanceCreateSchema.safeParse({ kind: 'oil_change', performedOn: '2026-09-30', nextDueOn: '2027-03-30' }).success).toBe(true);
  });

  it('réglages de la flotte : au moins un champ', () => {
    expect(fleetSettingsUpdateSchema.safeParse({}).success).toBe(false);
    expect(fleetSettingsUpdateSchema.safeParse({ networkMode: 'neomoov_network' }).success).toBe(true);
  });

  it('règles de partage : loyer ou pourcentage, fin facultative', () => {
    expect(revenueShareRuleCreateSchema.safeParse({ mode: 'rent', weeklyRentCents: 35_000, effectiveFrom: '2026-09-21' }).success).toBe(true);
    expect(revenueShareRuleCreateSchema.safeParse({ mode: 'rent', effectiveFrom: '2026-09-21' }).success).toBe(false);
    expect(revenueShareRuleCreateSchema.safeParse({ mode: 'percentage', percentagePpm: 200_000, driverId: id, effectiveFrom: '2026-09-21', effectiveTo: '2026-12-31' }).success).toBe(true);
  });
});

describe('flotte : permissions et rôles', () => {
  it('les permissions de la flotte sont ouvertes aux organisations ; partage et versements sensibles', () => {
    for (const code of ['drivers.invite', 'vehicles.manage', 'vehicles.assign', 'vehicles.maintenance.manage', 'vehicles.owner.read', 'dispatch.network.share', 'revenue_share.manage', 'payouts.manage'] as const) {
      expect(ORGANIZATION_PERMISSIONS).toContain(code);
    }
    expect(PERMISSIONS['revenue_share.manage'].sensitive).toBe(true);
    expect(PERMISSIONS['payouts.manage'].sensitive).toBe(true);
  });

  it('gestionnaire de flotte et propriétaire de véhicule', () => {
    expect(systemRole('fleet_manager')!.permissions).toEqual(expect.arrayContaining(['drivers.invite', 'vehicles.manage', 'vehicles.assign', 'vehicles.maintenance.manage', 'reports.read']));
    expect(systemRole('vehicle_owner')).toMatchObject({ level: 3, permissions: ['vehicles.owner.read'] });
  });
});
