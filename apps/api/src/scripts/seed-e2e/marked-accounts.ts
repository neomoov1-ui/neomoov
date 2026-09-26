/**
 * Comptes marqués (jeu de bout en bout, comptes des tests de charge) : sélection par préfixe de téléphone et retrait
 * complet de tout ce qui s'y rattache, dans l'ordre des clés étrangères (même ordre que `cleanupTestData` des tests).
 * Le journal d'audit, en ajout seul, reste ; les numéros déjà tirés des compteurs (factures, chauffeurs) ne reviennent pas.
 */
import { schema } from '@neomoov/db';
import { and, inArray, isNull, like, or, sql } from 'drizzle-orm';
import type { Database } from '../../infra/db.module.js';
import { markedPhonePattern, type SeedMarker } from './plan.js';

type Db = Database['db'];

export interface MarkedIds {
  userIds: string[];
  clientIds: string[];
  driverIds: string[];
  rideIds: string[];
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Comptes, profils et courses d'un marqueur (courses marquées, ou d'un client ou d'un chauffeur marqué). */
export async function markedIds(db: Db, marker: Pick<SeedMarker, 'phonePrefix' | 'key'>): Promise<MarkedIds> {
  const users = await db.select({ id: schema.users.id }).from(schema.users).where(like(schema.users.phone, markedPhonePattern(marker)));
  const userIds = users.map((u) => u.id);
  const clientIds: string[] = [];
  const driverIds: string[] = [];
  for (const part of chunks(userIds, 500)) {
    clientIds.push(...(await db.select({ id: schema.clients.id }).from(schema.clients).where(inArray(schema.clients.userId, part))).map((c) => c.id));
    driverIds.push(...(await db.select({ id: schema.drivers.id }).from(schema.drivers).where(inArray(schema.drivers.userId, part))).map((d) => d.id));
  }
  const rideIds = new Set<string>((await db.select({ id: schema.rides.id }).from(schema.rides).where(like(schema.rides.idempotencyKey, `${marker.key}-ride-%`))).map((r) => r.id));
  for (const part of chunks(clientIds, 500)) for (const r of await db.select({ id: schema.rides.id }).from(schema.rides).where(inArray(schema.rides.clientId, part))) rideIds.add(r.id);
  for (const part of chunks(driverIds, 500)) for (const r of await db.select({ id: schema.rides.id }).from(schema.rides).where(inArray(schema.rides.driverId, part))) rideIds.add(r.id);
  return { userIds, clientIds, driverIds, rideIds: [...rideIds] };
}

/** Retire la présence en ligne des chauffeurs marqués (hors ligne, quart fermé) ; renvoie le nombre de présences retirées. */
export async function takeOffline(db: Db, driverIds: string[], now = new Date()): Promise<number> {
  let removed = 0;
  for (const part of chunks(driverIds, 500)) {
    removed += (await db.delete(schema.driverPresence).where(inArray(schema.driverPresence.driverId, part)).returning({ id: schema.driverPresence.driverId })).length;
    await db.update(schema.drivers).set({ isOnline: false }).where(inArray(schema.drivers.id, part));
    await db
      .update(schema.driverShifts)
      .set({ endedAt: now, onlineSeconds: sql`greatest(0, extract(epoch from (${now.toISOString()}::timestamptz - ${schema.driverShifts.startedAt}))::int)` })
      .where(and(inArray(schema.driverShifts.driverId, part), isNull(schema.driverShifts.endedAt)));
  }
  return removed;
}

/**
 * Retire tout ce qui appartient aux comptes d'un marqueur. Renvoie le nombre de lignes retirées par table (courses,
 * factures, relevés, comptes…). Rejouable : un second appel ne trouve plus rien.
 */
export async function removeMarked(db: Db, marker: Pick<SeedMarker, 'phonePrefix' | 'key'>): Promise<Record<string, number>> {
  const ids = await markedIds(db, marker);
  const removed: Record<string, number> = {};
  const note = (table: string, n: number) => {
    if (n) removed[table] = (removed[table] ?? 0) + n;
  };
  const count = async (query: Promise<unknown[]>) => (await query).length;

  for (const rideIds of chunks(ids.rideIds, 200)) {
    // Usages de promotions (courses faites pendant une démonstration) : rendus au budget de la promotion.
    await db.execute(sql`WITH removed AS (DELETE FROM promotion_uses WHERE ride_id IN ${rideIds} RETURNING promotion_id, discount_cents)
      UPDATE promotions p SET spent_cents = GREATEST(0, p.spent_cents - r.total) FROM (SELECT promotion_id, sum(discount_cents)::int AS total FROM removed GROUP BY promotion_id) r WHERE p.id = r.promotion_id`);
    await db.execute(sql`DELETE FROM sanctions WHERE incident_id IN (SELECT id FROM incidents WHERE ride_id IN ${rideIds})`);
    note('incidents', await count(db.delete(schema.incidents).where(inArray(schema.incidents.rideId, rideIds)).returning({ id: schema.incidents.id })));
    await db.delete(schema.packConsumptions).where(inArray(schema.packConsumptions.rideId, rideIds));
    await db.delete(schema.creditUses).where(inArray(schema.creditUses.rideId, rideIds));
    await db.execute(sql`DELETE FROM refunds WHERE payment_id IN (SELECT id FROM payments WHERE ride_id IN ${rideIds})`);
    note('payments', await count(db.delete(schema.payments).where(inArray(schema.payments.rideId, rideIds)).returning({ id: schema.payments.id })));
    // Même transaction que la suppression des courses : `ride_events` est en ajout seul (déclencheur suspendu le temps
    // de la transaction, comme le nettoyage des tests) et une facture émise entre-temps bloquerait la suppression.
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM rides WHERE id IN ${rideIds} FOR UPDATE`);
      await tx.execute(sql`SELECT id FROM invoices WHERE ride_id IN ${rideIds} FOR UPDATE`);
      await tx.execute(sql`DELETE FROM sev_transmissions WHERE invoice_id IN (SELECT id FROM invoices WHERE ride_id IN ${rideIds})`);
      note('invoices', (await tx.execute(sql`DELETE FROM invoices WHERE ride_id IN ${rideIds} AND credit_note_of_id IS NOT NULL RETURNING id`)).length);
      note('invoices', (await tx.execute(sql`DELETE FROM invoices WHERE ride_id IN ${rideIds} RETURNING id`)).length);
      note('redevance_ledger', (await tx.delete(schema.redevanceLedger).where(inArray(schema.redevanceLedger.rideId, rideIds)).returning({ id: schema.redevanceLedger.id })).length);
      note('tax_ledger', (await tx.delete(schema.taxLedger).where(inArray(schema.taxLedger.rideId, rideIds)).returning({ id: schema.taxLedger.id })).length);
      await tx.execute(sql`ALTER TABLE ride_events DISABLE TRIGGER ride_events_append_only`);
      note('rides', (await tx.delete(schema.rides).where(inArray(schema.rides.id, rideIds)).returning({ id: schema.rides.id })).length);
      await tx.execute(sql`ALTER TABLE ride_events ENABLE TRIGGER ride_events_append_only`);
    });
  }

  for (const driverIds of chunks(ids.driverIds, 500)) {
    note('driver_presence', await takeOffline(db, driverIds));
    await db.execute(sql`DELETE FROM driver_locations WHERE driver_id IN ${driverIds}`);
    // Une course d'un autre fichier a pu solliciter un chauffeur marqué : ses offres bloqueraient la suppression.
    await db.execute(sql`DELETE FROM ride_offers WHERE driver_id IN ${driverIds}`);
    await db.execute(sql`DELETE FROM scheduled_assignments WHERE driver_id IN ${driverIds}`);
    await db.delete(schema.packPurchases).where(inArray(schema.packPurchases.driverId, driverIds));
    note('weekly_statements', await count(db.delete(schema.weeklyStatements).where(inArray(schema.weeklyStatements.driverId, driverIds)).returning({ id: schema.weeklyStatements.id })));
    await db.delete(schema.sanctions).where(inArray(schema.sanctions.driverId, driverIds));
    await db.delete(schema.staffNotes).where(inArray(schema.staffNotes.entityId, driverIds));
    await db.execute(sql`DELETE FROM favorite_drivers WHERE driver_id IN ${driverIds}`);
    await db.execute(sql`DELETE FROM client_driver_links WHERE driver_id IN ${driverIds}`);
    // Compteur de la séquence de factures de chaque fournisseur retiré (le compteur global, lui, garde son rang).
    await db.execute(sql`DELETE FROM counters WHERE scope IN ${driverIds.map((id) => `invoice:driver:${id}`)}`);
  }

  for (const clientIds of chunks(ids.clientIds, 500)) {
    await db.execute(sql`WITH removed AS (DELETE FROM promotion_uses WHERE client_id IN ${clientIds} RETURNING promotion_id, discount_cents)
      UPDATE promotions p SET spent_cents = GREATEST(0, p.spent_cents - r.total) FROM (SELECT promotion_id, sum(discount_cents)::int AS total FROM removed GROUP BY promotion_id) r WHERE p.id = r.promotion_id`);
    await db.delete(schema.quotes).where(inArray(schema.quotes.clientId, clientIds));
  }

  for (const userIds of chunks(ids.userIds, 500)) {
    note('notifications', await count(db.delete(schema.notifications).where(inArray(schema.notifications.recipientUserId, userIds)).returning({ id: schema.notifications.id })));
    await db.delete(schema.incidents).where(and(inArray(schema.incidents.reportedByUserId, userIds), isNull(schema.incidents.rideId)));
    await db.delete(schema.competitorBenchmarks).where(inArray(schema.competitorBenchmarks.recordedByUserId, userIds));
    await db.delete(schema.apiKeys).where(inArray(schema.apiKeys.createdByUserId, userIds));
    await db.delete(schema.dataRequests).where(inArray(schema.dataRequests.userId, userIds));
    await db.execute(sql`DELETE FROM credit_uses WHERE credit_id IN (SELECT id FROM credits WHERE user_id IN ${userIds})`);
    await db.delete(schema.referrals).where(or(inArray(schema.referrals.referrerUserId, userIds), inArray(schema.referrals.referredUserId, userIds)));
    await db.delete(schema.credits).where(inArray(schema.credits.userId, userIds));
    note('users', await count(db.delete(schema.users).where(inArray(schema.users.id, userIds)).returning({ id: schema.users.id })));
  }
  note('otp_codes', await count(db.delete(schema.otpCodes).where(like(schema.otpCodes.phone, markedPhonePattern(marker))).returning({ id: schema.otpCodes.id })));
  note('drivers', ids.driverIds.length);
  note('clients', ids.clientIds.length);
  return removed;
}
