import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { TokensView } from '@neomoov/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { AnyPgColumn, AnyPgTable } from 'drizzle-orm/pg-core';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OrgScopeService } from '../src/modules/organizations/org-scope.service.js';
import { cleanupTestData, createDriver, db, loginByOtp, startTestApp, testEmail, testPhone, trackUser, type TestDriver } from './helpers.js';

/**
 * Étape 20, critère 1 : zéro accès croisé, table par table. Deux organisations sœurs A et B sous la racine (et A1, fille
 * de A), chacune avec un jeu de données complet (chauffeur, véhicule, client, devis, course terminée, paiement, facture,
 * relevé, incident, sanction, conversation, avis, crédit...). Pour chaque table qui porte une politique de 0021 ou 0022,
 * dans une transaction restreinte à A : seules les lignes de A sont lues, aucune ligne de B n'est modifiable, aucune ligne
 * rattachée à B ne peut être créée ; hors contexte, la plateforme voit tout. Les tables réservées à la plateforme ne livrent
 * aucune ligne ; les tables partagées se lisent sans s'écrire.
 */
const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lng: -73.582, lat: 45.523 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lng: -73.567, lat: 45.5 } };
const LINE = { type: 'LineString' as const, coordinates: [[-73.582, 45.523], [-73.567, 45.5]] };
const RUN = Math.random().toString(36).slice(2, 8).toUpperCase();
const hex = (bytes: number) => randomBytes(bytes).toString('hex');

interface Org {
  id: string;
  path: string;
}

/** Jeu de données d'une organisation : identifiants des lignes créées, table par table. */
interface Dataset {
  org: Org;
  driver: TestDriver;
  client: TokensView;
  clientId: string;
  /** Compte sans profil (ni chauffeur ni client) : sert aux tentatives de création de profils. */
  spareUserId: string;
  documentId: string;
  paymentMethodId: string;
  quoteId: string;
  rideId: string;
  rideEventId: string;
  offerId: string;
  ratingId: string;
  messageId: string;
  assignmentId: string;
  paymentId: string;
  refundId: string;
  invoiceId: string;
  sevId: string;
  redevanceId: string;
  taxId: string;
  packPurchaseId: string;
  packConsumptionId: string;
  creditId: string;
  creditUseId: string;
  promotionUseId: string;
  statementId: string;
  statementLineId: string;
  scoreId: string;
  shiftId: string;
  trainingId: string;
  sanctionId: string;
  appealId: string;
  incidentId: string;
  conversationId: string;
  conversationMessageId: string;
  notificationId: string;
  leadId: string;
  auditId: string;
  membershipId: string;
  invitationId: string;
  roleId: string;
  placeId: string;
  investorId: string;
  financingId: string;
  checkId: string;
  deviceId: string;
  consentId: string;
}

interface TableCase {
  name: string;
  table: AnyPgTable;
  /** Colonne dont les valeurs distinguent la ligne de A de celle de B (identifiant de la ligne ou de son parent). */
  key: AnyPgColumn;
  a: string;
  b: string;
  /** Ligne rattachée à B, à créer dans le contexte de A : refusée par la politique. */
  insertForB: () => Record<string, unknown>;
}

function messageOf(error: unknown): string {
  const e = error as { message?: string; cause?: { message?: string } };
  return `${e?.cause?.message ?? ''} ${e?.message ?? ''}`;
}

const isRlsRefusal = (error: unknown) => /row-level security|permission denied/i.test(messageOf(error));

describe('isolation par organisation, table par table (intégration)', () => {
  let app: NestExpressApplication | null = null;
  let scope: OrgScopeService;
  let root: Org;
  let A: Dataset;
  let B: Dataset;
  let orgA1: Org;
  let driverA1: TestDriver;
  let systemRoleId: string;
  let permissionCode: string;
  let promotionId: string;

  const keys = (rows: Array<{ k: unknown }>) => [...new Set(rows.map((r) => String(r.k)))].sort();

  async function createOrganization(name: string, parent: Org, type = 'fleet'): Promise<Org> {
    const id = randomUUID();
    const path = `${parent.path}${id}/`;
    await db(app!).insert(schema.organizations).values({ id, code: `iso-${name.toLowerCase()}-${id.slice(0, 8)}`, name: `Isolation ${name}`, type, parentId: parent.id, path });
    return { id, path };
  }

  async function attach(driver: TestDriver, org: Org): Promise<void> {
    await db(app!).update(schema.drivers).set({ organizationId: org.id }).where(eq(schema.drivers.id, driver.driverId));
    await db(app!).update(schema.vehicles).set({ organizationId: org.id }).where(eq(schema.vehicles.id, driver.vehicleId));
  }

  /** Jeu de données réaliste d'une organisation : parcours existants pour les comptes, insertions directes pour le reste. */
  async function dataset(org: Org, label: string): Promise<Dataset> {
    const database = db(app!);
    const driver = await createDriver(app!, 'neo_premium', { acceptsScheduled: false });
    await attach(driver, org);
    const client = await loginByOtp(app!);
    const [clientRow] = await database.update(schema.clients).set({ organizationId: org.id }).where(eq(schema.clients.userId, client.user.id)).returning({ id: schema.clients.id });
    const clientId = clientRow!.id;
    const [spare] = await database.insert(schema.users).values({ phone: testPhone(), firstName: 'Sans', lastName: 'Profil' }).returning({ id: schema.users.id });
    trackUser(spare!.id);
    const [document] = await database.select({ id: schema.driverDocuments.id }).from(schema.driverDocuments).where(eq(schema.driverDocuments.driverId, driver.driverId)).limit(1);
    const [method] = await database.select({ id: schema.clientPaymentMethods.id }).from(schema.clientPaymentMethods).where(eq(schema.clientPaymentMethods.clientId, clientId)).limit(1);
    const now = new Date();
    const [quote] = await database.insert(schema.quotes).values({
      clientId, organizationId: org.id, cityCode: 'montreal', category: 'neo_premium', originAddress: PLATEAU.address, originPosition: PLATEAU.coordinates, destinationAddress: CENTRE.address, destinationPosition: CENTRE.coordinates,
      distanceMeters: 8_000, durationSeconds: 1_080, lines: [], fareCents: 2_455, serviceFeeCents: 200, regulatoryFeeCents: 90, gstCents: 137, qstCents: 274, totalCents: 3_156, maxConsentedCents: 3_500,
      validUntil: new Date(now.getTime() + 3_600_000), fingerprint: hex(32), pricingRulesVersion: 'iso-test',
    }).returning({ id: schema.quotes.id });
    const [ride] = await database.insert(schema.rides).values({
      publicNumber: `ISO-${RUN}-${label}`, cityCode: 'montreal', clientId, driverId: driver.driverId, vehicleId: driver.vehicleId, quoteId: quote!.id, organizationId: org.id,
      reservedCategory: 'neo_premium', state: 'completed', type: 'scheduled', originAddress: PLATEAU.address, originPosition: PLATEAU.coordinates, destinationAddress: CENTRE.address, destinationPosition: CENTRE.coordinates,
      paymentMethod: 'card_app', paymentChoice: 'prepaid', maxConsentedCents: 3_500, quotedTotalCents: 3_156, finalPriceCents: 3_156, fareCents: 2_455, serviceFeeCents: 200, regulatoryFeeCents: 90, gstCents: 137, qstCents: 274,
      distanceMeters: 8_000, durationSeconds: 1_080, stateTimestamps: { completed: '2026-06-02T15:00:00Z' },
    }).returning({ id: schema.rides.id });
    const rideId = ride!.id;
    const [event] = await database.insert(schema.rideEvents).values({ rideId, type: 'iso_test', fromState: 'completed', toState: 'completed', actorKind: 'system' }).returning({ id: schema.rideEvents.id });
    const [offer] = await database.insert(schema.rideOffers).values({ rideId, driverId: driver.driverId, driverFareCents: 2_000, expiresAt: now, state: 'expired' }).returning({ id: schema.rideOffers.id });
    await database.insert(schema.rideDispatches).values({ rideId, status: 'assigned' });
    const [rating] = await database.insert(schema.rideRatings).values({ rideId, authorKind: 'client', authorUserId: client.user.id, score: 5 }).returning({ id: schema.rideRatings.id });
    await database.insert(schema.rideTracks).values({ rideId, track: LINE, measuredDistanceMeters: 8_000, measuredDurationSeconds: 1_080, pointCount: 2 });
    const [message] = await database.insert(schema.rideMessages).values({ rideId, senderUserId: client.user.id, senderKind: 'client', body: 'Je suis devant la porte' }).returning({ id: schema.rideMessages.id });
    const [assignment] = await database.insert(schema.scheduledAssignments).values({ rideId, driverId: driver.driverId, confirmedAt: now }).returning({ id: schema.scheduledAssignments.id });
    const [payment] = await database.insert(schema.payments).values({ rideId, clientId, method: 'card_app', kind: 'ride', status: 'captured', authorizedCents: 3_500, capturedCents: 3_156, idempotencyKey: `iso:${randomUUID()}` }).returning({ id: schema.payments.id });
    const [credit] = await database.insert(schema.credits).values({ userId: client.user.id, organizationId: org.id, amountCents: 1_000, remainingCents: 900, origin: 'goodwill', note: 'Geste commercial' }).returning({ id: schema.credits.id });
    const [refund] = await database.insert(schema.refunds).values({ paymentId: payment!.id, mode: 'credit', amountCents: 500, reason: 'Retard', creditId: credit!.id, status: 'succeeded', idempotencyKey: `iso:${randomUUID()}` }).returning({ id: schema.refunds.id });
    const [invoice] = await database.insert(schema.invoices).values({
      rideId, driverId: driver.driverId, number: `ISO-${RUN}-${label}`, supplierSequence: 1, supplierName: 'Chauffeur de test', lines: { version: 1 }, fareCents: 2_455, serviceFeeCents: 200, regulatoryFeeCents: 90, gstCents: 137, qstCents: 274, totalCents: 3_156, paymentMethod: 'card_app',
    }).returning({ id: schema.invoices.id });
    const [sev] = await database.insert(schema.sevTransmissions).values({ invoiceId: invoice!.id, adapter: 'mock', status: 'sent', attempt: 1 }).returning({ id: schema.sevTransmissions.id });
    const [redevance] = await database.insert(schema.redevanceLedger).values({ rideId, amountCents: 90, remittancePeriod: '2026-06' }).returning({ id: schema.redevanceLedger.id });
    const [tax] = await database.insert(schema.taxLedger).values({ rideId, driverId: driver.driverId, fareGstCents: 123, fareQstCents: 245, feeGstCents: 14, feeQstCents: 29, period: '2026-06' }).returning({ id: schema.taxLedger.id });
    const [pack] = await database.insert(schema.packPurchases).values({ driverId: driver.driverId, packCode: 'essential', pricePaidCents: 5_900, ridesIncluded: 30, ridesRemaining: 29, activatedAt: now, expiresAt: new Date(now.getTime() + 30 * 86_400_000), status: 'active', billing: 'to_bill' }).returning({ id: schema.packPurchases.id });
    const [consumption] = await database.insert(schema.packConsumptions).values({ packPurchaseId: pack!.id, rideId }).returning({ id: schema.packConsumptions.id });
    const [creditUse] = await database.insert(schema.creditUses).values({ creditId: credit!.id, rideId, amountCents: 100 }).returning({ id: schema.creditUses.id });
    const [promotionUse] = await database.insert(schema.promotionUses).values({ promotionId, clientId, rideId, discountCents: 500 }).returning({ id: schema.promotionUses.id });
    const [statement] = await database.insert(schema.weeklyStatements).values({ driverId: driver.driverId, organizationId: org.id, periodStart: '2026-06-01', periodEnd: '2026-06-07', status: 'issued', creditsCents: 2_455, netCents: 2_455, issuedAt: now }).returning({ id: schema.weeklyStatements.id });
    const [line] = await database.insert(schema.statementLines).values({ statementId: statement!.id, kind: 'ride_fare_platform', amountCents: 2_455, rideId, label: 'Tarif de la course', occurredAt: now }).returning({ id: schema.statementLines.id });
    await database.insert(schema.driverBalances).values({ driverId: driver.driverId, balanceCents: 0, lastStatementId: statement!.id });
    await database.insert(schema.driverLocations).values({ driverId: driver.driverId, position: PLATEAU.coordinates, rideId, recordedAt: now });
    await database.insert(schema.driverPresence).values({ driverId: driver.driverId, position: PLATEAU.coordinates, vehicleId: driver.vehicleId, category: 'neo_premium', isAvailable: true });
    const [score] = await database.insert(schema.driverScores).values({ driverId: driver.driverId, periodStart: '2026-09-07', periodEnd: '2026-09-13', completedRides: 12 }).returning({ id: schema.driverScores.id });
    const [shift] = await database.insert(schema.driverShifts).values({ driverId: driver.driverId, startedAt: now, rideCount: 1 }).returning({ id: schema.driverShifts.id });
    const [training] = await database.insert(schema.driverTrainingResults).values({ driverId: driver.driverId, moduleCode: 'accueil', scorePct: 100, passed: true }).returning({ id: schema.driverTrainingResults.id });
    const [incident] = await database.insert(schema.incidents).values({ rideId, organizationId: org.id, type: 'complaint', severity: 'medium', reportedByUserId: client.user.id, reportedByKind: 'client', description: 'Conduite brusque' }).returning({ id: schema.incidents.id });
    const [sanction] = await database.insert(schema.sanctions).values({ driverId: driver.driverId, incidentId: incident!.id, type: 'warning', reason: 'Qualité : avertissement', startsAt: now }).returning({ id: schema.sanctions.id });
    const [appeal] = await database.insert(schema.sanctionAppeals).values({ sanctionId: sanction!.id, driverId: driver.driverId, kind: 'response', message: 'Le client était pressé.' }).returning({ id: schema.sanctionAppeals.id });
    const [conversation] = await database.insert(schema.conversations).values({ channel: 'app', userId: client.user.id, organizationId: org.id, rideId }).returning({ id: schema.conversations.id });
    const [conversationMessage] = await database.insert(schema.conversationMessages).values({ conversationId: conversation!.id, direction: 'inbound', author: 'client', body: 'Où est mon reçu ?' }).returning({ id: schema.conversationMessages.id });
    const [notification] = await database.insert(schema.notifications).values({ recipientUserId: client.user.id, organizationId: org.id, channel: 'in_app', template: 'iso.test', sentAt: now, providerMessageId: 'in_app' }).returning({ id: schema.notifications.id });
    const [lead] = await database.insert(schema.leads).values({ kind: 'business', firstName: 'Prospect', phone: testPhone(), source: 'iso-test', organizationId: org.id, consentAt: now }).returning({ id: schema.leads.id });
    const [audit] = await database.insert(schema.auditLog).values({ action: 'iso.test', entity: 'organizations', entityId: org.id, organizationId: org.id, after: { label } }).returning({ id: schema.auditLog.id });
    const [membership] = await database.insert(schema.memberships).values({ userId: client.user.id, organizationId: org.id, roleId: systemRoleId }).returning({ id: schema.memberships.id });
    const [invitation] = await database.insert(schema.invitations).values({ organizationId: org.id, roleId: systemRoleId, email: testEmail('invite'), tokenHash: hex(32), expiresAt: new Date(now.getTime() + 86_400_000), invitedByUserId: client.user.id }).returning({ id: schema.invitations.id });
    await database.insert(schema.organizationFeatures).values({ organizationId: org.id, module: 'rides' });
    const [role] = await database.insert(schema.roles).values({ organizationId: org.id, code: 'iso_reader', name: 'Lecture des courses', level: 2 }).returning({ id: schema.roles.id });
    await database.insert(schema.rolePermissions).values({ roleId: role!.id, permissionCode: permissionCode });
    await database.insert(schema.settings).values({ key: 'iso.test', scope: org.id, value: { label }, organizationId: org.id });
    const [place] = await database.insert(schema.savedPlaces).values({ clientId, label: 'Maison', address: PLATEAU.address, position: PLATEAU.coordinates }).returning({ id: schema.savedPlaces.id });
    await database.insert(schema.favoriteDrivers).values({ clientId, driverId: driver.driverId });
    await database.insert(schema.clientDriverLinks).values({ clientId, driverId: driver.driverId, ridesCount: 1, lastRideAt: now });
    const [investor] = await database.insert(schema.investors).values({ userId: client.user.id, status: 'active' }).returning({ id: schema.investors.id });
    const [financing] = await database.insert(schema.vehicleFinancings).values({ investorId: investor!.id, vehicleId: driver.vehicleId, principalCents: 1_000_000, rateBps: 500, termMonths: 36 }).returning({ id: schema.vehicleFinancings.id });
    const [check] = await database.insert(schema.complianceChecks).values({ entityType: 'driver', entityId: driver.driverId, type: 'document:licence', dueOn: '2030-01-01', status: 'pending' }).returning({ id: schema.complianceChecks.id });
    const [device] = await database.insert(schema.devices).values({ userId: client.user.id, platform: 'ios', pushToken: `ExponentPushToken[iso-${randomUUID()}]` }).returning({ id: schema.devices.id });
    const [consent] = await database.insert(schema.consents).values({ userId: client.user.id, purpose: 'marketing', version: '2026-09', source: 'app' }).returning({ id: schema.consents.id });
    return {
      org, driver, client, clientId, spareUserId: spare!.id, documentId: document!.id, paymentMethodId: method!.id, quoteId: quote!.id, rideId, rideEventId: event!.id, offerId: offer!.id, ratingId: rating!.id, messageId: message!.id,
      assignmentId: assignment!.id, paymentId: payment!.id, refundId: refund!.id, invoiceId: invoice!.id, sevId: sev!.id, redevanceId: redevance!.id, taxId: tax!.id, packPurchaseId: pack!.id, packConsumptionId: consumption!.id,
      creditId: credit!.id, creditUseId: creditUse!.id, promotionUseId: promotionUse!.id, statementId: statement!.id, statementLineId: line!.id, scoreId: score!.id, shiftId: shift!.id, trainingId: training!.id,
      sanctionId: sanction!.id, appealId: appeal!.id, incidentId: incident!.id, conversationId: conversation!.id, conversationMessageId: conversationMessage!.id, notificationId: notification!.id, leadId: lead!.id,
      auditId: audit!.id, membershipId: membership!.id, invitationId: invitation!.id, roleId: role!.id, placeId: place!.id, investorId: investor!.id, financingId: financing!.id, checkId: check!.id, deviceId: device!.id, consentId: consent!.id,
    };
  }

  beforeAll(async () => {
    app = await startTestApp();
    if (!app) return;
    scope = app.get(OrgScopeService);
    const [rootRow] = await db(app).select({ id: schema.organizations.id, path: schema.organizations.path }).from(schema.organizations).where(isNull(schema.organizations.parentId)).limit(1);
    root = rootRow!;
    const [role] = await db(app).select({ id: schema.roles.id }).from(schema.roles).where(and(eq(schema.roles.code, 'org_admin'), isNull(schema.roles.organizationId))).limit(1);
    systemRoleId = role!.id;
    const [permission] = await db(app).select({ code: schema.permissions.code }).from(schema.permissions).limit(1);
    permissionCode = permission!.code;
    const [promotion] = await db(app).insert(schema.promotions).values({ code: `ISO${RUN}`, name: 'Promotion de test', type: 'fixed', value: 500, validFrom: new Date(Date.now() - 86_400_000), active: false }).returning({ id: schema.promotions.id });
    promotionId = promotion!.id;
    const [orgA, orgB] = await Promise.all([createOrganization('A', root), createOrganization('B', root)]);
    A = await dataset(orgA, 'A');
    B = await dataset(orgB, 'B');
    orgA1 = await createOrganization('A1', orgA, 'sub_org');
    driverA1 = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    await attach(driverA1, orgA1);
  });

  afterAll(async () => {
    if (app) {
      const database = db(app);
      const orgIds = [A?.org.id, B?.org.id, orgA1?.id].filter((id): id is string => Boolean(id));
      const driverIds = [A?.driver.driverId, B?.driver.driverId, driverA1?.driverId].filter((id): id is string => Boolean(id));
      if (orgIds.length) {
        await database.delete(schema.vehicleFinancings).where(inArray(schema.vehicleFinancings.investorId, [A.investorId, B.investorId]));
        await database.delete(schema.investors).where(inArray(schema.investors.id, [A.investorId, B.investorId]));
        await database.delete(schema.complianceChecks).where(inArray(schema.complianceChecks.entityId, driverIds));
        await database.delete(schema.settings).where(eq(schema.settings.key, 'iso.test'));
        await database.delete(schema.roles).where(inArray(schema.roles.organizationId, orgIds));
        await database.delete(schema.organizationFeatures).where(inArray(schema.organizationFeatures.organizationId, orgIds));
        await database.delete(schema.leads).where(inArray(schema.leads.organizationId, orgIds));
        await database.delete(schema.notifications).where(inArray(schema.notifications.organizationId, orgIds));
      }
      await cleanupTestData(app);
      if (orgIds.length) await database.delete(schema.organizations).where(inArray(schema.organizations.id, orgIds)).catch(() => undefined);
      if (promotionId) await database.delete(schema.promotions).where(eq(schema.promotions.id, promotionId));
    }
    await app?.close();
  });

  /** Les trois vérifications sous le contexte de A, puis la vue de la plateforme. */
  async function check(c: TableCase): Promise<void> {
    await scope.run(A.org.path, async (tx) => {
      expect(keys(await tx.select({ k: c.key }).from(c.table).where(inArray(c.key, [c.a, c.b]))), `${c.name} : lecture sous A`).toEqual([c.a]);
      const updated = await tx.execute(sql`UPDATE ${c.table} SET ${sql.identifier(c.key.name)} = ${sql.identifier(c.key.name)} WHERE ${sql.identifier(c.key.name)} = ${c.b}::uuid RETURNING 1`);
      expect([...updated].length, `${c.name} : modification d'une ligne de B sous A`).toBe(0);
      // Point de sauvegarde : le refus n'annule pas la transaction restreinte.
      let refusal: unknown = null;
      await tx.transaction(async (sp) => { await sp.insert(c.table).values(c.insertForB() as never); }).catch((error: unknown) => { refusal = error; });
      expect(refusal, `${c.name} : création d'une ligne rattachée à B sous A`).toSatisfy(isRlsRefusal);
    });
    expect(keys(await db(app!).select({ k: c.key }).from(c.table).where(inArray(c.key, [c.a, c.b]))), `${c.name} : plateforme`).toEqual([c.a, c.b].sort());
  }

  async function checkAll(cases: TableCase[]): Promise<void> {
    for (const c of cases) await check(c);
  }

  it('colonne directe : chauffeurs, véhicules, courses, clients, devis, relevés, adhésions, invitations, modules, journal, conversations, avis, incidents, crédits, prospects', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const now = new Date();
    await checkAll([
      { name: 'drivers', table: schema.drivers, key: schema.drivers.id, a: A.driver.driverId, b: B.driver.driverId, insertForB: () => ({ userId: B.spareUserId, publicNumber: `CH-ISO${hex(3)}`, organizationId: B.org.id }) },
      { name: 'vehicles', table: schema.vehicles, key: schema.vehicles.id, a: A.driver.vehicleId, b: B.driver.vehicleId, insertForB: () => ({ driverId: B.driver.driverId, organizationId: B.org.id, category: 'neo_premium', make: 'Tesla', model: 'Model 3', year: 2024, colour: 'noire', plate: `ISO${hex(3)}`.toUpperCase().slice(0, 9), seats: 4 }) },
      { name: 'rides', table: schema.rides, key: schema.rides.id, a: A.rideId, b: B.rideId, insertForB: () => ({ publicNumber: `ISO-${RUN}-X${hex(2)}`, cityCode: 'montreal', clientId: B.clientId, organizationId: B.org.id, reservedCategory: 'neo_premium', state: 'requested', originAddress: PLATEAU.address, originPosition: PLATEAU.coordinates, destinationAddress: CENTRE.address, destinationPosition: CENTRE.coordinates, paymentMethod: 'cash', paymentChoice: 'pay_driver_after', maxConsentedCents: 3_500, quotedTotalCents: 3_156 }) },
      { name: 'clients', table: schema.clients, key: schema.clients.id, a: A.clientId, b: B.clientId, insertForB: () => ({ userId: B.spareUserId, organizationId: B.org.id }) },
      { name: 'quotes', table: schema.quotes, key: schema.quotes.id, a: A.quoteId, b: B.quoteId, insertForB: () => ({ clientId: B.clientId, organizationId: B.org.id, cityCode: 'montreal', category: 'neo_premium', originAddress: PLATEAU.address, originPosition: PLATEAU.coordinates, destinationAddress: CENTRE.address, destinationPosition: CENTRE.coordinates, distanceMeters: 1, durationSeconds: 1, lines: [], fareCents: 1, serviceFeeCents: 0, regulatoryFeeCents: 0, gstCents: 0, qstCents: 0, totalCents: 1, maxConsentedCents: 1, validUntil: now, fingerprint: hex(32), pricingRulesVersion: 'iso' }) },
      { name: 'weekly_statements', table: schema.weeklyStatements, key: schema.weeklyStatements.id, a: A.statementId, b: B.statementId, insertForB: () => ({ driverId: B.driver.driverId, organizationId: B.org.id, periodStart: '2026-05-04', periodEnd: '2026-05-10' }) },
      { name: 'memberships', table: schema.memberships, key: schema.memberships.id, a: A.membershipId, b: B.membershipId, insertForB: () => ({ userId: B.spareUserId, organizationId: B.org.id, roleId: systemRoleId }) },
      { name: 'invitations', table: schema.invitations, key: schema.invitations.id, a: A.invitationId, b: B.invitationId, insertForB: () => ({ organizationId: B.org.id, roleId: systemRoleId, email: testEmail('iso'), tokenHash: hex(32), expiresAt: now, invitedByUserId: B.client.user.id }) },
      { name: 'organization_features', table: schema.organizationFeatures, key: schema.organizationFeatures.organizationId, a: A.org.id, b: B.org.id, insertForB: () => ({ organizationId: B.org.id, module: 'iso_test' }) },
      { name: 'audit_log', table: schema.auditLog, key: schema.auditLog.id, a: A.auditId, b: B.auditId, insertForB: () => ({ action: 'iso.test', entity: 'organizations', entityId: B.org.id, organizationId: B.org.id }) },
      { name: 'conversations', table: schema.conversations, key: schema.conversations.id, a: A.conversationId, b: B.conversationId, insertForB: () => ({ channel: 'app', userId: B.client.user.id, organizationId: B.org.id }) },
      { name: 'notifications', table: schema.notifications, key: schema.notifications.id, a: A.notificationId, b: B.notificationId, insertForB: () => ({ recipientUserId: B.client.user.id, organizationId: B.org.id, channel: 'in_app', template: 'iso.test' }) },
      { name: 'incidents', table: schema.incidents, key: schema.incidents.id, a: A.incidentId, b: B.incidentId, insertForB: () => ({ rideId: B.rideId, organizationId: B.org.id, type: 'other', reportedByKind: 'system', description: 'Test' }) },
      { name: 'credits', table: schema.credits, key: schema.credits.id, a: A.creditId, b: B.creditId, insertForB: () => ({ userId: B.client.user.id, organizationId: B.org.id, amountCents: 100, remainingCents: 100, origin: 'goodwill' }) },
      { name: 'leads', table: schema.leads, key: schema.leads.id, a: A.leadId, b: B.leadId, insertForB: () => ({ kind: 'business', firstName: 'Test', phone: testPhone(), source: 'iso-test', organizationId: B.org.id, consentAt: now }) },
    ]);
  });

  it('par course : journal, messages, notes, offres, répartition, trace, factures, paiements, attributions, consommations de pack, crédits utilisés, redevance, promotions, taxes', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const now = new Date();
    await checkAll([
      { name: 'ride_events', table: schema.rideEvents, key: schema.rideEvents.id, a: A.rideEventId, b: B.rideEventId, insertForB: () => ({ rideId: B.rideId, type: 'iso_test', actorKind: 'system' }) },
      { name: 'ride_messages', table: schema.rideMessages, key: schema.rideMessages.id, a: A.messageId, b: B.messageId, insertForB: () => ({ rideId: B.rideId, senderKind: 'client', body: 'Test' }) },
      { name: 'ride_ratings', table: schema.rideRatings, key: schema.rideRatings.id, a: A.ratingId, b: B.ratingId, insertForB: () => ({ rideId: B.rideId, authorKind: 'driver', authorUserId: B.driver.userId, score: 5 }) },
      { name: 'ride_offers', table: schema.rideOffers, key: schema.rideOffers.id, a: A.offerId, b: B.offerId, insertForB: () => ({ rideId: B.rideId, driverId: B.driver.driverId, driverFareCents: 1, expiresAt: now, state: 'expired' }) },
      { name: 'ride_dispatches', table: schema.rideDispatches, key: schema.rideDispatches.rideId, a: A.rideId, b: B.rideId, insertForB: () => ({ rideId: B.rideId }) },
      { name: 'ride_tracks', table: schema.rideTracks, key: schema.rideTracks.rideId, a: A.rideId, b: B.rideId, insertForB: () => ({ rideId: B.rideId, track: LINE, measuredDistanceMeters: 1, measuredDurationSeconds: 1, pointCount: 2 }) },
      { name: 'invoices', table: schema.invoices, key: schema.invoices.id, a: A.invoiceId, b: B.invoiceId, insertForB: () => ({ rideId: B.rideId, driverId: B.driver.driverId, number: `ISO-${RUN}-X${hex(2)}`, supplierSequence: 2, supplierName: 'Test', lines: {}, fareCents: 0, serviceFeeCents: 0, regulatoryFeeCents: 0, gstCents: 0, qstCents: 0, totalCents: 0, paymentMethod: 'cash', kind: 'credit_note', creditNoteOfId: B.invoiceId }) },
      { name: 'payments', table: schema.payments, key: schema.payments.id, a: A.paymentId, b: B.paymentId, insertForB: () => ({ rideId: B.rideId, method: 'cash', kind: 'tip', idempotencyKey: `iso:${randomUUID()}` }) },
      { name: 'scheduled_assignments', table: schema.scheduledAssignments, key: schema.scheduledAssignments.id, a: A.assignmentId, b: B.assignmentId, insertForB: () => ({ rideId: B.rideId, driverId: B.driver.driverId }) },
      { name: 'pack_consumptions', table: schema.packConsumptions, key: schema.packConsumptions.id, a: A.packConsumptionId, b: B.packConsumptionId, insertForB: () => ({ packPurchaseId: B.packPurchaseId, rideId: B.rideId }) },
      { name: 'credit_uses', table: schema.creditUses, key: schema.creditUses.id, a: A.creditUseId, b: B.creditUseId, insertForB: () => ({ creditId: B.creditId, rideId: B.rideId, amountCents: 1 }) },
      { name: 'redevance_ledger', table: schema.redevanceLedger, key: schema.redevanceLedger.id, a: A.redevanceId, b: B.redevanceId, insertForB: () => ({ rideId: B.rideId, amountCents: 1, remittancePeriod: '2026-06' }) },
      { name: 'promotion_uses', table: schema.promotionUses, key: schema.promotionUses.id, a: A.promotionUseId, b: B.promotionUseId, insertForB: () => ({ promotionId, clientId: B.clientId, rideId: B.rideId, discountCents: 1 }) },
      { name: 'tax_ledger', table: schema.taxLedger, key: schema.taxLedger.id, a: A.taxId, b: B.taxId, insertForB: () => ({ rideId: B.rideId, driverId: B.driver.driverId, fareGstCents: 0, fareQstCents: 0, feeGstCents: 0, feeQstCents: 0, period: '2026-06' }) },
    ]);
  });

  it('par chauffeur : documents, positions (table partitionnée), présence, tableau de conduite, quarts, formation, soldes, packs, sanctions, appels, échéances de conformité', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const now = new Date();
    await checkAll([
      { name: 'driver_documents', table: schema.driverDocuments, key: schema.driverDocuments.id, a: A.documentId, b: B.documentId, insertForB: () => ({ driverId: B.driver.driverId, type: 'training', fileKey: 'iso/test', status: 'pending' }) },
      { name: 'driver_locations', table: schema.driverLocations, key: schema.driverLocations.driverId, a: A.driver.driverId, b: B.driver.driverId, insertForB: () => ({ driverId: B.driver.driverId, position: PLATEAU.coordinates, recordedAt: now }) },
      { name: 'driver_presence', table: schema.driverPresence, key: schema.driverPresence.driverId, a: A.driver.driverId, b: B.driver.driverId, insertForB: () => ({ driverId: B.driver.driverId, position: PLATEAU.coordinates }) },
      { name: 'driver_scores', table: schema.driverScores, key: schema.driverScores.id, a: A.scoreId, b: B.scoreId, insertForB: () => ({ driverId: B.driver.driverId, periodStart: '2026-08-03', periodEnd: '2026-08-09' }) },
      { name: 'driver_shifts', table: schema.driverShifts, key: schema.driverShifts.id, a: A.shiftId, b: B.shiftId, insertForB: () => ({ driverId: B.driver.driverId, startedAt: now }) },
      { name: 'driver_training_results', table: schema.driverTrainingResults, key: schema.driverTrainingResults.id, a: A.trainingId, b: B.trainingId, insertForB: () => ({ driverId: B.driver.driverId, moduleCode: 'iso', scorePct: 1, passed: false }) },
      { name: 'driver_balances', table: schema.driverBalances, key: schema.driverBalances.driverId, a: A.driver.driverId, b: B.driver.driverId, insertForB: () => ({ driverId: B.driver.driverId }) },
      { name: 'pack_purchases', table: schema.packPurchases, key: schema.packPurchases.id, a: A.packPurchaseId, b: B.packPurchaseId, insertForB: () => ({ driverId: B.driver.driverId, packCode: 'essential', pricePaidCents: 1, activatedAt: now, expiresAt: now }) },
      { name: 'sanctions', table: schema.sanctions, key: schema.sanctions.id, a: A.sanctionId, b: B.sanctionId, insertForB: () => ({ driverId: B.driver.driverId, type: 'warning', reason: 'Test' }) },
      { name: 'sanction_appeals', table: schema.sanctionAppeals, key: schema.sanctionAppeals.id, a: A.appealId, b: B.appealId, insertForB: () => ({ sanctionId: B.sanctionId, driverId: B.driver.driverId, kind: 'appeal', message: 'Test' }) },
      { name: 'compliance_checks', table: schema.complianceChecks, key: schema.complianceChecks.id, a: A.checkId, b: B.checkId, insertForB: () => ({ entityType: 'driver', entityId: B.driver.driverId, type: 'iso', dueOn: '2030-01-01' }) },
    ]);
  });

  it('par client et par personne : cartes, favoris, liens client-chauffeur, lieux, comptes, appareils, consentements', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    await checkAll([
      { name: 'client_payment_methods', table: schema.clientPaymentMethods, key: schema.clientPaymentMethods.id, a: A.paymentMethodId, b: B.paymentMethodId, insertForB: () => ({ clientId: B.clientId, stripePaymentMethodId: `pm_iso_${hex(6)}`, brand: 'visa', last4: '4242' }) },
      { name: 'favorite_drivers', table: schema.favoriteDrivers, key: schema.favoriteDrivers.clientId, a: A.clientId, b: B.clientId, insertForB: () => ({ clientId: B.clientId, driverId: A.driver.driverId }) },
      { name: 'client_driver_links', table: schema.clientDriverLinks, key: schema.clientDriverLinks.clientId, a: A.clientId, b: B.clientId, insertForB: () => ({ clientId: B.clientId, driverId: A.driver.driverId }) },
      { name: 'saved_places', table: schema.savedPlaces, key: schema.savedPlaces.id, a: A.placeId, b: B.placeId, insertForB: () => ({ clientId: B.clientId, label: 'Test', address: CENTRE.address, position: CENTRE.coordinates }) },
      // Comptes : lecture seule (les comptes sont gérés par la plateforme) ; une création est refusée, même pour A.
      { name: 'users', table: schema.users, key: schema.users.id, a: A.driver.userId, b: B.driver.userId, insertForB: () => ({ phone: testPhone() }) },
      { name: 'devices', table: schema.devices, key: schema.devices.id, a: A.deviceId, b: B.deviceId, insertForB: () => ({ userId: B.client.user.id, platform: 'ios', pushToken: `ExponentPushToken[iso-${randomUUID()}]` }) },
      { name: 'consents', table: schema.consents, key: schema.consents.id, a: A.consentId, b: B.consentId, insertForB: () => ({ userId: B.client.user.id, purpose: 'marketing', version: 'iso', source: 'app' }) },
    ]);
    // Les comptes de A sont tous visibles (chauffeur, client, sous-organisation), aucun de B ni de la plateforme.
    const ids = [A.driver.userId, A.client.user.id, driverA1.userId, B.driver.userId, B.client.user.id, B.spareUserId];
    const seen = await scope.run(A.org.path, async (tx) => keys(await tx.select({ k: schema.users.id }).from(schema.users).where(inArray(schema.users.id, ids))));
    expect(seen).toEqual([A.driver.userId, A.client.user.id, driverA1.userId].sort());
  });

  it('par paiement, relevé, conversation, véhicule et facture : remboursements, lignes de relevé, messages, financements, transmissions au SEV', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const now = new Date();
    await checkAll([
      { name: 'refunds', table: schema.refunds, key: schema.refunds.id, a: A.refundId, b: B.refundId, insertForB: () => ({ paymentId: B.paymentId, mode: 'credit', amountCents: 1, reason: 'Test', status: 'succeeded', idempotencyKey: `iso:${randomUUID()}` }) },
      { name: 'statement_lines', table: schema.statementLines, key: schema.statementLines.id, a: A.statementLineId, b: B.statementLineId, insertForB: () => ({ statementId: B.statementId, kind: 'bonus', amountCents: 1, label: 'Test', occurredAt: now }) },
      { name: 'conversation_messages', table: schema.conversationMessages, key: schema.conversationMessages.id, a: A.conversationMessageId, b: B.conversationMessageId, insertForB: () => ({ conversationId: B.conversationId, direction: 'inbound', author: 'client', body: 'Test' }) },
      { name: 'vehicle_financings', table: schema.vehicleFinancings, key: schema.vehicleFinancings.id, a: A.financingId, b: B.financingId, insertForB: () => ({ investorId: B.investorId, vehicleId: B.driver.vehicleId, principalCents: 1, rateBps: 1, termMonths: 1 }) },
      { name: 'sev_transmissions', table: schema.sevTransmissions, key: schema.sevTransmissions.id, a: A.sevId, b: B.sevId, insertForB: () => ({ invoiceId: B.invoiceId, adapter: 'mock', status: 'sent' }) },
    ]);
  });

  it('organisations, rôles et réglages : le sous-arbre de A, jamais B ni la racine ; sous-organisation créée seulement sous A', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const created = randomUUID();
    await scope.run(A.org.path, async (tx) => {
      expect(keys(await tx.select({ k: schema.organizations.id }).from(schema.organizations).where(inArray(schema.organizations.id, [root.id, A.org.id, orgA1.id, B.org.id])))).toEqual([A.org.id, orgA1.id].sort());
      expect(await tx.update(schema.organizations).set({ name: 'Piratée' }).where(eq(schema.organizations.id, B.org.id)).returning({ id: schema.organizations.id })).toHaveLength(0);
      // Sous-organisation de A : admise (politique org_insert de 0022) ; sous B : refusée.
      await tx.insert(schema.organizations).values({ id: created, code: `iso-a2-${created.slice(0, 8)}`, name: 'Isolation A2', type: 'sub_org', parentId: A.org.id, path: `${A.org.path}${created}/` });
      let refusal: unknown = null;
      const other = randomUUID();
      await tx.transaction(async (sp) => { await sp.insert(schema.organizations).values({ id: other, code: `iso-b2-${other.slice(0, 8)}`, name: 'Isolation B2', type: 'sub_org', parentId: B.org.id, path: `${B.org.path}${other}/` }); }).catch((error: unknown) => { refusal = error; });
      expect(refusal).toSatisfy(isRlsRefusal);
      // Rôles : les rôles système et ceux de A, pas ceux de B ; leurs permissions de même.
      expect(keys(await tx.select({ k: schema.roles.id }).from(schema.roles).where(inArray(schema.roles.id, [systemRoleId, A.roleId, B.roleId])))).toEqual([systemRoleId, A.roleId].sort());
      expect(keys(await tx.select({ k: schema.rolePermissions.roleId }).from(schema.rolePermissions).where(inArray(schema.rolePermissions.roleId, [A.roleId, B.roleId])))).toEqual([A.roleId]);
      refusal = null;
      await tx.transaction(async (sp) => { await sp.insert(schema.roles).values({ organizationId: B.org.id, code: 'iso_pirate', name: 'Pirate', level: 2 }); }).catch((error: unknown) => { refusal = error; });
      expect(refusal).toSatisfy(isRlsRefusal);
      // Réglages : ceux de la plateforme (sans organisation) et ceux de A ; jamais ceux de B.
      const settings = await tx.select({ organizationId: schema.settings.organizationId }).from(schema.settings).where(eq(schema.settings.key, 'iso.test'));
      expect(settings.map((s) => s.organizationId)).toEqual([A.org.id]);
      expect((await tx.select({ key: schema.settings.key }).from(schema.settings).where(isNull(schema.settings.organizationId)).limit(1)).length).toBe(1);
      refusal = null;
      await tx.transaction(async (sp) => { await sp.insert(schema.settings).values({ key: 'iso.pirate', scope: B.org.id, value: {}, organizationId: B.org.id }); }).catch((error: unknown) => { refusal = error; });
      expect(refusal).toSatisfy(isRlsRefusal);
    });
    expect(await db(app).delete(schema.organizations).where(eq(schema.organizations.id, created)).returning({ id: schema.organizations.id })).toHaveLength(1);
    // Sous-arbre : A voit les chauffeurs de A et de A1 ; A1 ne voit que le sien.
    const drivers = [A.driver.driverId, driverA1.driverId, B.driver.driverId];
    expect(await scope.run(A.org.path, async (tx) => keys(await tx.select({ k: schema.drivers.id }).from(schema.drivers).where(inArray(schema.drivers.id, drivers))))).toEqual([A.driver.driverId, driverA1.driverId].sort());
    expect(await scope.run(orgA1.path, async (tx) => keys(await tx.select({ k: schema.drivers.id }).from(schema.drivers).where(inArray(schema.drivers.id, drivers))))).toEqual([driverA1.driverId]);
  });

  it('tables partagées en lecture (catalogue) et tables réservées à la plateforme (aucune ligne)', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    await scope.run(A.org.path, async (tx) => {
      for (const table of [schema.cities, schema.vehicleCategories, schema.permissions, schema.pricingRules]) {
        expect((await tx.select({ n: sql<number>`count(*)::int` }).from(table))[0]!.n, 'catalogue lisible').toBeGreaterThan(0);
      }
      let refusal: unknown = null;
      await tx.transaction(async (sp) => { await sp.insert(schema.featureFlags).values({ code: `iso_${RUN}` }); }).catch((error: unknown) => { refusal = error; });
      expect(refusal, 'catalogue non modifiable').toSatisfy(isRlsRefusal);
      for (const table of [schema.sessions, schema.otpCodes, schema.apiKeys, schema.staffCredentials, schema.approvals, schema.agentRuns, schema.userRoles, schema.webhookEvents, schema.staffNotes, schema.referrals]) {
        expect((await tx.select({ n: sql<number>`count(*)::int` }).from(table))[0]!.n, 'table réservée à la plateforme').toBe(0);
      }
      const [counters] = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM counters`);
      expect(counters!.n).toBe(0);
    });
    // Les mêmes tables ont bien des lignes pour la plateforme (sessions et rôles des comptes de ce test).
    expect((await db(app).select({ n: sql<number>`count(*)::int` }).from(schema.sessions))[0]!.n).toBeGreaterThan(0);
    expect((await db(app).select({ n: sql<number>`count(*)::int` }).from(schema.userRoles))[0]!.n).toBeGreaterThan(0);
  });
});
