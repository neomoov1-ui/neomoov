/**
 * Cycle de vie des packs de courses (section 5.7, prompt 08) : une course terminée consomme une unité du pack actif
 * (courses reportées d'abord), avec l'alerte `pack.low` au seuil et le renouvellement automatique à l'épuisement ; une
 * passe horaire expire les packs échus, renouvelle Illimité et les packs à renouvellement automatique, et reporte une
 * seule fois les courses non utilisées sur le pack suivant activé dans le délai. Chaque opération prend le verrou du
 * chauffeur (le même que l'activation) ; la consommation est unique par course (index de `pack_consumptions`), ce qui
 * la rend sûre quand plusieurs processus reçoivent le même événement de course.
 */
import { randomUUID } from 'node:crypto';
import { schema } from '@neomoov/db';
import {
  activatePack, activationPriceCents, canReceiveOffers, consumeRide, expirePacks, isUsable, remainingRides, renewalPackCode, rolloverOnExpiry, shouldAutoRenew,
  type PackDefinition, type PackPurchase, type PackSettings,
} from '@neomoov/domain';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq, inArray, lte, or, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { DomainEventsService } from '../../common/domain-events.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { DB, type Database } from '../../infra/db.module.js';
import { QueueService } from '../../infra/queue.module.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsOutbox } from './notifications-outbox.js';

type Executor = Pick<Database['db'], 'insert' | 'update' | 'select' | 'execute'>;
type PurchaseRow = typeof schema.packPurchases.$inferSelect;
type PackRow = typeof schema.packs.$inferSelect;

/** Motif de refus des offres lié aux packs, repris tel quel par `status.update` et le tableau de bord du chauffeur. */
export type PackBlocker = 'pack_required' | 'pack_exhausted' | 'pack_expired';

export interface PackDriver {
  id: string;
  userId: string;
  createdAt: Date;
  isRLuxeEvTenant: boolean;
}

interface Notice {
  userId: string;
  template: 'pack.low' | 'pack.exhausted' | 'pack.expired' | 'pack.renewed' | 'pack.renewal_failed';
  data: Record<string, unknown>;
}

export interface PackMaintenanceReport {
  drivers: number;
  expired: number;
  renewed: number;
  rolledOver: number;
}

const DAY_MS = 86_400_000;
/** États d'une course terminée : seuls ceux-là consomment une unité de pack. */
const FINISHED_STATES = new Set<string>(['completed', 'rated', 'disputed']);

export function packDefinitionOf(row: PackRow): PackDefinition {
  return { code: row.code, ridesIncluded: row.ridesIncluded, priceCents: row.priceCents, validityDays: row.validityDays, discovery: row.code === 'discovery', priorityBonus: row.code === 'unlimited' };
}

export function purchaseOf(row: PurchaseRow): PackPurchase {
  return {
    id: row.id, driverId: row.driverId, packCode: row.packCode, ridesIncluded: row.ridesIncluded, ridesRemaining: row.ridesRemaining ?? 0, carriedOverRemaining: row.carriedOverRemaining,
    activatedAt: row.activatedAt, expiresAt: row.expiresAt, status: row.status, autoRenew: row.autoRenew, nextPackCode: row.nextPackCode, rolloverDone: row.rolloverDone, billing: row.billing,
  };
}

/** Verrou transactionnel par chauffeur, partagé par l'activation, la consommation et la maintenance. */
export async function lockDriverPacks(tx: Executor, driverId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${driverId}))`);
}

@Injectable()
export class PackLifecycleService implements OnModuleInit {
  private registered = false;

  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly settingsService: SettingsService,
    private readonly events: DomainEventsService,
    private readonly outbox: NotificationsOutbox,
    private readonly audit: AuditService,
    private readonly queues: QueueService,
  ) {}

  private get db() {
    return this.database.db;
  }

  onModuleInit() {
    this.events.on('ride.completed', (p) => {
      this.consume(p.rideId).catch((error: unknown) => this.logger.error({ err: error, rideId: p.rideId }, 'Consommation de pack non enregistrée'));
    });
    // Avec Redis, c'est le worker qui porte la passe horaire ; sans Redis, l'API (hors tests, qui l'appellent directement).
    if (this.queues.mode === 'memory' && this.env.NODE_ENV !== 'test') this.register({ everyMs: 3_600_000 });
  }

  /** Enregistre la passe de maintenance (file `packs`). */
  register(options: { everyMs?: number } = {}): void {
    if (this.registered) return;
    this.registered = true;
    this.queues.process(
      'packs',
      async () => {
        const report = await this.maintenance(new Date());
        if (report.expired || report.renewed || report.rolledOver) this.logger.info(report, 'packs : passe de maintenance');
      },
      { concurrency: 1, ...(options.everyMs ? { everyMs: options.everyMs, jobName: 'maintenance' } : {}) },
    );
  }

  async packSettings(): Promise<PackSettings> {
    const [lowThreshold, rolloverWindowDays, discoveryFirstDrivers] = await Promise.all([
      this.settingsService.number('packs.low_threshold', 3), this.settingsService.number('packs.rollover_window_days', 7), this.settingsService.number('packs.discovery_free_first_drivers', 100),
    ]);
    return { lowThreshold, rolloverWindowDays, discoveryFirstDrivers };
  }

  /** Rang d'inscription (à partir de 1) : Découverte est offert aux premiers chauffeurs inscrits. */
  async signupRank(tx: Executor, createdAt: Date): Promise<number> {
    const [rank] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.drivers).where(lte(schema.drivers.createdAt, createdAt));
    return rank?.n ?? Number.MAX_SAFE_INTEGER;
  }

  /** Motif de refus des offres (passage en ligne, tableau de bord), `null` si le chauffeur peut en recevoir. */
  async blocker(driverId: string, now = new Date()): Promise<PackBlocker | null> {
    const rows = await this.db.select().from(schema.packPurchases).where(eq(schema.packPurchases.driverId, driverId));
    const result = canReceiveOffers(rows.map(purchaseOf), now);
    if (result.ok) return null;
    return result.reason === 'expired' ? 'pack_expired' : result.reason === 'exhausted' ? 'pack_exhausted' : 'pack_required';
  }

  /** Consommation d'une course terminée ; sans effet la seconde fois, sans pack actif ou pour une course non terminée. */
  async consume(rideId: string, now = new Date()): Promise<{ consumedFromId: string | null; remaining: number | null; renewedId: string | null }> {
    const none = { consumedFromId: null, remaining: null, renewedId: null };
    const [ride] = await this.db.select({ driverId: schema.rides.driverId, state: schema.rides.state }).from(schema.rides).where(eq(schema.rides.id, rideId)).limit(1);
    // Une course terminée peut déjà être notée ou contestée quand l'événement est traité (worker, reprise).
    if (!ride?.driverId || !FINISHED_STATES.has(ride.state)) return none;
    const driver = await this.driverOf(ride.driverId);
    if (!driver) return none;
    const settings = await this.packSettings();
    const notices: Notice[] = [];
    const result = await this.db.transaction(async (tx) => {
      await lockDriverPacks(tx, driver.id);
      const [already] = await tx.select({ id: schema.packConsumptions.id }).from(schema.packConsumptions).where(eq(schema.packConsumptions.rideId, rideId)).limit(1);
      if (already) return none;
      const purchases = (await tx.select().from(schema.packPurchases).where(eq(schema.packPurchases.driverId, driver.id))).map(purchaseOf);
      const consumed = consumeRide(purchases, 'completed', now, settings);
      if (!consumed.consumedFromId) return none;
      const before = purchases.find((p) => p.id === consumed.consumedFromId)!;
      const after = consumed.purchases.find((p) => p.id === consumed.consumedFromId)!;
      await tx.insert(schema.packConsumptions).values({ packPurchaseId: after.id, rideId, fromCarriedOver: after.carriedOverRemaining < before.carriedOverRemaining });
      await tx
        .update(schema.packPurchases)
        .set({ ridesRemaining: after.ridesIncluded === null ? null : after.ridesRemaining, carriedOverRemaining: after.carriedOverRemaining, status: after.status })
        .where(eq(schema.packPurchases.id, after.id));
      const remaining = remainingRides(after);
      if (consumed.events.includes('pack.low')) notices.push({ userId: driver.userId, template: 'pack.low', data: { packCode: after.packCode, remaining } });
      let renewedId: string | null = null;
      if (consumed.events.includes('pack.exhausted')) {
        const renewal = await this.renewIfDue(tx, driver, consumed.purchases, after, now, settings, notices);
        renewedId = renewal?.id ?? null;
        if (!renewal && !notices.some((n) => n.template === 'pack.renewal_failed')) notices.push({ userId: driver.userId, template: 'pack.exhausted', data: { packCode: after.packCode } });
      }
      return { consumedFromId: after.id, remaining, renewedId };
    });
    await this.outbox.queue(notices.map((n) => ({ recipientUserId: n.userId, template: n.template, data: n.data })));
    return result;
  }

  /**
   * Passe de maintenance : packs échus passés en `expired`, renouvellements dus, reports dans le délai. Idempotente,
   * lancée chaque heure ; ne traite que les chauffeurs qui ont quelque chose à faire (500 au plus par passe).
   */
  async maintenance(now = new Date(), onlyDriverIds?: string[]): Promise<PackMaintenanceReport> {
    const p = schema.packPurchases;
    const due = or(
      and(eq(p.status, 'active'), lte(p.expiresAt, now)),
      and(inArray(p.status, ['exhausted', 'expired']), eq(p.autoRenew, true)),
      and(eq(p.status, 'expired'), eq(p.rolloverDone, false), sql`${p.ridesIncluded} IS NOT NULL`),
    );
    const rows = await this.db
      .selectDistinct({ driverId: p.driverId })
      .from(p)
      .where(onlyDriverIds?.length ? and(due, inArray(p.driverId, onlyDriverIds)) : due)
      .limit(500);
    const report: PackMaintenanceReport = { drivers: 0, expired: 0, renewed: 0, rolledOver: 0 };
    const settings = await this.packSettings();
    for (const { driverId } of rows) {
      try {
        const one = await this.settleDriver(driverId, now, settings);
        report.drivers += 1;
        report.expired += one.expired;
        report.renewed += one.renewed;
        report.rolledOver += one.rolledOver;
      } catch (error) {
        this.logger.error({ err: error, driverId }, 'Maintenance des packs en échec pour ce chauffeur');
      }
    }
    return report;
  }

  /**
   * Après une activation manuelle (dans la transaction de l'activation) : report des courses d'un pack expiré dans le
   * délai, et fin du renouvellement automatique des packs échus, remplacés par ce nouveau pack.
   */
  async afterActivation(tx: Executor, driverId: string, now: Date, settings: PackSettings): Promise<number> {
    const purchases = await this.expireInTx(tx, driverId, now);
    const superseded = purchases.filter((p) => p.status !== 'active' && p.status !== 'cancelled' && p.autoRenew);
    if (superseded.length) await tx.update(schema.packPurchases).set({ autoRenew: false, nextPackCode: null }).where(inArray(schema.packPurchases.id, superseded.map((s) => s.id)));
    return this.applyRollovers(tx, purchases, now, settings);
  }

  private async settleDriver(driverId: string, now: Date, settings: PackSettings) {
    const driver = await this.driverOf(driverId);
    if (!driver) return { expired: 0, renewed: 0, rolledOver: 0 };
    const notices: Notice[] = [];
    const counts = await this.db.transaction(async (tx) => {
      await lockDriverPacks(tx, driver.id);
      const before = (await tx.select().from(schema.packPurchases).where(eq(schema.packPurchases.driverId, driver.id))).map(purchaseOf);
      let purchases = await this.expireInTx(tx, driver.id, now, before);
      const newlyExpired = purchases.filter((p) => p.status === 'expired' && before.find((b) => b.id === p.id)?.status === 'active');
      let renewed = 0;
      for (const candidate of purchases.filter((p) => shouldAutoRenew(p, now) && p.status !== 'active')) {
        const renewal = await this.renewIfDue(tx, driver, purchases, candidate, now, settings, notices);
        if (renewal) renewed += 1;
        purchases = (await tx.select().from(schema.packPurchases).where(eq(schema.packPurchases.driverId, driver.id))).map(purchaseOf);
      }
      for (const expired of newlyExpired) {
        if (!notices.some((n) => n.data['previousPackCode'] === expired.packCode)) notices.push({ userId: driver.userId, template: 'pack.expired', data: { packCode: expired.packCode, unusedRides: remainingRides(expired) } });
      }
      const rolledOver = await this.applyRollovers(tx, purchases, now, settings);
      return { expired: newlyExpired.length, renewed, rolledOver };
    });
    await this.outbox.queue(notices.map((n) => ({ recipientUserId: n.userId, template: n.template, data: n.data })));
    return counts;
  }

  /** Passe en `expired` les packs échus de ce chauffeur et renvoie ses achats à jour. */
  private async expireInTx(tx: Executor, driverId: string, now: Date, loaded?: PackPurchase[]): Promise<PackPurchase[]> {
    const purchases = loaded ?? (await tx.select().from(schema.packPurchases).where(eq(schema.packPurchases.driverId, driverId))).map(purchaseOf);
    const updated = expirePacks(purchases, now);
    const changed = updated.filter((p, i) => p.status !== purchases[i]!.status).map((p) => p.id);
    if (changed.length) await tx.update(schema.packPurchases).set({ status: 'expired' }).where(inArray(schema.packPurchases.id, changed));
    return updated;
  }

  /**
   * Renouvellement automatique (épuisement, ou échéance) : le pack demandé en changement, sinon le même, activé
   * aussitôt et facturé au relevé suivant. Découverte ne se renouvelle pas (une seule fois par chauffeur). Un pack déjà
   * utilisable (activé à la main entre-temps) rend le renouvellement inutile. Dans tous les cas, l'option passe au
   * nouveau pack : l'ancien ne se renouvelle jamais deux fois.
   */
  private async renewIfDue(tx: Executor, driver: PackDriver, purchases: PackPurchase[], old: PackPurchase, now: Date, settings: PackSettings, notices: Notice[]): Promise<{ id: string; packCode: string } | null> {
    if (!shouldAutoRenew(old, now)) return null;
    const usable = purchases.some((p) => p.id !== old.id && isUsable(p, now));
    let created: PackPurchase | null = null;
    let priceCents = 0;
    if (!usable) {
      const code = renewalPackCode(old);
      const [pack] = await tx.select().from(schema.packs).where(and(eq(schema.packs.code, code as PackRow['code']), eq(schema.packs.active, true))).limit(1);
      if (pack) {
        const definition = packDefinitionOf(pack);
        const price = activationPriceCents(
          definition,
          { driverId: driver.id, isRLuxeEvTenant: driver.isRLuxeEvTenant, discoveryUsed: purchases.some((p) => p.packCode === 'discovery'), signupRank: await this.signupRank(tx, driver.createdAt) },
          settings,
        );
        if (price.allowed) {
          created = activatePack(randomUUID(), driver.id, definition, price.priceCents, now, true);
          priceCents = price.priceCents;
          await tx.insert(schema.packPurchases).values({
            id: created.id, driverId: driver.id, packCode: pack.code, pricePaidCents: priceCents, ridesIncluded: created.ridesIncluded, ridesRemaining: created.ridesIncluded === null ? null : created.ridesRemaining,
            carriedOverRemaining: 0, activatedAt: created.activatedAt, expiresAt: created.expiresAt, status: 'active', autoRenew: true, billing: created.billing,
          });
        }
      }
      if (!created) notices.push({ userId: driver.userId, template: 'pack.renewal_failed', data: { packCode: code, previousPackCode: old.packCode } });
    }
    await tx.update(schema.packPurchases).set({ autoRenew: false, nextPackCode: null }).where(eq(schema.packPurchases.id, old.id));
    if (!created) return null;
    notices.push({ userId: driver.userId, template: 'pack.renewed', data: { packCode: created.packCode, previousPackCode: old.packCode, priceCents } });
    this.audit.record({ action: 'driver.pack_renewed', entity: 'pack_purchases', entityId: created.id, after: { packCode: created.packCode, priceCents, previousId: old.id } });
    return { id: created.id, packCode: created.packCode };
  }

  /**
   * Report, une seule fois, des courses non utilisées d'un pack expiré sur le premier pack activé après son échéance
   * dans le délai ; passé le délai sans pack suivant, le report est clos (les courses sont perdues).
   */
  private async applyRollovers(tx: Executor, purchases: PackPurchase[], now: Date, settings: PackSettings): Promise<number> {
    let moved = 0;
    const current = new Map(purchases.map((p) => [p.id, p]));
    const pending = purchases.filter((p) => p.status === 'expired' && !p.rolloverDone && p.ridesIncluded !== null);
    if (!pending.length) return 0;
    const allowed = new Map((await tx.select({ code: schema.packs.code, rolloverAllowed: schema.packs.rolloverAllowed }).from(schema.packs)).map((r) => [r.code as string, r.rolloverAllowed]));
    for (const expired of pending) {
      if (allowed.get(expired.packCode) === false) {
        await tx.update(schema.packPurchases).set({ rolloverDone: true }).where(eq(schema.packPurchases.id, expired.id));
        continue;
      }
      const next = [...current.values()]
        .filter((p) => p.id !== expired.id && p.status === 'active' && p.ridesIncluded !== null && p.activatedAt.getTime() >= expired.expiresAt.getTime())
        .sort((a, b) => a.activatedAt.getTime() - b.activatedAt.getTime())[0];
      const windowClosed = now.getTime() - expired.expiresAt.getTime() > settings.rolloverWindowDays * DAY_MS;
      if (!next) {
        if (windowClosed) await tx.update(schema.packPurchases).set({ rolloverDone: true }).where(eq(schema.packPurchases.id, expired.id));
        continue;
      }
      const result = rolloverOnExpiry(expired, next, settings);
      if (!result.expired.rolloverDone) {
        // Pack suivant hors délai : le report n'aura jamais lieu.
        if (windowClosed) await tx.update(schema.packPurchases).set({ rolloverDone: true }).where(eq(schema.packPurchases.id, expired.id));
        continue;
      }
      await tx.update(schema.packPurchases).set({ ridesRemaining: result.expired.ridesRemaining, rolloverDone: true }).where(eq(schema.packPurchases.id, expired.id));
      if (result.rolledOver) {
        await tx.update(schema.packPurchases).set({ carriedOverRemaining: result.next.carriedOverRemaining }).where(eq(schema.packPurchases.id, next.id));
        current.set(next.id, result.next);
        moved += result.rolledOver;
      }
    }
    return moved;
  }

  private async driverOf(driverId: string): Promise<PackDriver | null> {
    const [driver] = await this.db
      .select({ id: schema.drivers.id, userId: schema.drivers.userId, createdAt: schema.drivers.createdAt, isRLuxeEvTenant: schema.drivers.isRLuxeEvTenant })
      .from(schema.drivers)
      .where(eq(schema.drivers.id, driverId))
      .limit(1);
    return driver ?? null;
  }
}
