/**
 * Revue du 2 octobre 2026, finalisation U6 (logique métier, base de développement) :
 * - constat 18 : passes quotidiennes de la conformité et de la conservation gardées en base (redémarrage, deux
 *   processus, reprise après un échec ou une passe interrompue) ;
 * - constat 20 : purge du journal d'audit sans désactiver le déclencheur « ajout seul » (migration 0039) ;
 * - constat 17 : index partiel du rattrapage des factures (migration 0039) choisi pour sa requête.
 * Les dates simulées sont en 2031 : la garde de la vraie journée de développement n'est jamais touchée.
 */
import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { claimDailyRun, DAILY_RUN_SCOPE, dailyRunState } from '../src/common/daily-run.js';
import { DB, type Database } from '../src/infra/db.module.js';
import { ComplianceJobsService } from '../src/modules/compliance/compliance-jobs.service.js';
import { InvoicingService } from '../src/modules/invoicing/invoicing.service.js';
import { RetentionJobsService } from '../src/modules/retention/retention-jobs.service.js';
import { RetentionService } from '../src/modules/retention/retention.service.js';
import { cleanupTestData, db, startTestApp } from './helpers.js';

const MINUTE = 60_000;
const EMPTY_REPORT = { synced: 0, reminders: 0, suspended: 0, lifted: 0 };

describe('revue du 2 octobre 2026, finalisation U6 (intégration)', () => {
  let app: NestExpressApplication | null = null;

  beforeAll(async () => {
    app = await startTestApp();
  });
  afterAll(async () => {
    if (app) {
      await db(app).delete(schema.settings).where(sql`${schema.settings.scope} = ${DAILY_RUN_SCOPE} AND ${schema.settings.key} IN ('daily.compliance', 'daily.retention')`);
      await cleanupTestData(app);
    }
    await app?.close();
  });

  const database = () => app!.get<Database>(DB);
  /** Un « autre processus » : même dépendances, aucune mémoire partagée avec l'instance de l'application. */
  const otherProcess = <T extends object>(instance: T): T => Object.assign(Object.create(Object.getPrototypeOf(instance) as object) as T, instance);

  it('constat 18, conformité : une passe par jour civil, même après un redémarrage ou avec deux processus ; reprise après un échec ou une passe interrompue', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    await db(app).delete(schema.settings).where(sql`${schema.settings.scope} = ${DAILY_RUN_SCOPE} AND ${schema.settings.key} = 'daily.compliance'`);
    const base = app.get(ComplianceJobsService);
    const first = otherProcess(base);
    const second = otherProcess(base);
    const firstRun = vi.spyOn(first, 'runGrouped').mockResolvedValue(EMPTY_REPORT);
    const secondRun = vi.spyOn(second, 'runGrouped').mockResolvedValue(EMPTY_REPORT);

    // Jour 1 (1 h à Montréal) : deux processus en même temps, une seule passe.
    const day1 = new Date('2031-05-14T05:00:00Z');
    const results = await Promise.all([first.tick(day1), second.tick(day1)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(firstRun.mock.calls.length + secondRun.mock.calls.length).toBe(1);
    expect(await dailyRunState(database(), 'compliance')).toMatchObject({ day: '2031-05-14', finishedAt: expect.any(String) });
    // Battement suivant, puis « redémarrage » (nouvelle instance) : rien de plus ce jour-là.
    expect(await first.tick(new Date(day1.getTime() + 15 * MINUTE))).toBe(false);
    const restarted = otherProcess(base);
    const restartedRun = vi.spyOn(restarted, 'runGrouped').mockResolvedValue(EMPTY_REPORT);
    expect(await restarted.tick(new Date(day1.getTime() + 30 * MINUTE))).toBe(false);
    expect(restartedRun).not.toHaveBeenCalled();

    // Jour 2 : la passe échoue, elle est reprise au battement suivant (par n'importe quel processus).
    const day2 = new Date('2031-05-15T05:00:00Z');
    secondRun.mockRejectedValueOnce(new Error('panne simulée'));
    await expect(second.tick(day2)).rejects.toThrow('panne simulée');
    expect(await dailyRunState(database(), 'compliance')).toMatchObject({ day: '2031-05-15', finishedAt: null });
    expect(await first.tick(new Date(day2.getTime() + 15 * MINUTE))).toBe(true);
    expect(await dailyRunState(database(), 'compliance')).toMatchObject({ day: '2031-05-15', finishedAt: expect.any(String) });

    // Jour 3 : une passe commencée puis abandonnée (processus tué) n'est reprise qu'après deux heures.
    const day3 = new Date('2031-05-16T05:00:00Z');
    expect(await claimDailyRun(database(), 'compliance', '2031-05-16', day3)).toBe(true);
    expect(await first.tick(new Date(day3.getTime() + 60 * MINUTE))).toBe(false);
    expect(await first.tick(new Date(day3.getTime() + 121 * MINUTE))).toBe(true);
  });

  it('constat 18, conservation : une passe par nuit à partir de 3 h, gardée en base', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    await db(app).delete(schema.settings).where(sql`${schema.settings.scope} = ${DAILY_RUN_SCOPE} AND ${schema.settings.key} = 'daily.retention'`);
    const purge = vi.spyOn(app.get(RetentionService), 'run').mockResolvedValue([]);
    try {
      const base = app.get(RetentionJobsService);
      const night = new Date('2031-05-14T08:00:00Z'); // 4 h à Montréal
      expect(await otherProcess(base).tick(new Date('2031-05-14T06:00:00Z'))).toBe(false); // 2 h : trop tôt, rien de réservé
      expect(await dailyRunState(database(), 'retention')).toBeNull();
      const results = await Promise.all([otherProcess(base).tick(night), otherProcess(base).tick(night)]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await otherProcess(base).tick(new Date(night.getTime() + 15 * MINUTE))).toBe(false);
      expect(purge).toHaveBeenCalledTimes(1);
      expect(await dailyRunState(database(), 'retention')).toMatchObject({ day: '2031-05-14', finishedAt: expect.any(String) });
      // La garde technique ne fait pas partie des réglages de My Hub (portée `global` seulement).
      const listed = await db(app).select().from(schema.settings).where(eq(schema.settings.key, 'daily.retention'));
      expect(listed.map((r) => r.scope)).toEqual([DAILY_RUN_SCOPE]);
    } finally {
      purge.mockRestore();
    }
  });

  it('constat 20 : purge du journal d\'audit sans désactiver le déclencheur ; hors purge déclarée, tout reste refusé', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const now = new Date();
    const [old] = await db(app).insert(schema.auditLog).values({ action: 'test.revue_u6', entity: 'tests', occurredAt: new Date(now.getTime() - 8 * 366 * 86_400_000) }).returning();
    const [recent] = await db(app).insert(schema.auditLog).values({ action: 'test.revue_u6', entity: 'tests', occurredAt: new Date(now.getTime() - 180 * 86_400_000) }).returning();
    const refused = async (statement: ReturnType<typeof sql>, declare: boolean) => {
      try {
        await db(app!).transaction(async (tx) => {
          if (declare) await tx.execute(sql`SELECT set_config('neomoov.audit_purge', 'on', true)`);
          await tx.execute(statement);
        });
        return false;
      } catch (error) {
        return /ajout seul/.test(String((error as { cause?: unknown }).cause ?? error)) || /ajout seul/.test(String(error));
      }
    };
    // Sans déclaration : ni suppression ni modification, même d'une ligne de 8 ans.
    expect(await refused(sql`DELETE FROM audit_log WHERE id = ${old!.id}::uuid`, false)).toBe(true);
    // Purge déclarée : jamais une ligne de moins d'un an, jamais une modification.
    expect(await refused(sql`DELETE FROM audit_log WHERE id = ${recent!.id}::uuid`, true)).toBe(true);
    expect(await refused(sql`UPDATE audit_log SET action = 'altere' WHERE id = ${old!.id}::uuid`, true)).toBe(true);
    // La déclaration ne survit pas à sa transaction.
    expect(await refused(sql`DELETE FROM audit_log WHERE id = ${old!.id}::uuid`, false)).toBe(true);

    const result = await app.get(RetentionService)['auditLog'](now);
    expect(result).toMatchObject({ type: 'audit_log', details: { retentionYears: 7 } });
    expect(result.rowsProcessed).toBeGreaterThanOrEqual(1);
    expect(await db(app).select().from(schema.auditLog).where(eq(schema.auditLog.id, old!.id))).toHaveLength(0);
    expect(await db(app).select().from(schema.auditLog).where(eq(schema.auditLog.id, recent!.id))).toHaveLength(1);
    // Le déclencheur est resté actif, sur la nouvelle fonction de garde.
    const [trigger] = await db(app).execute<{ enabled: string; fn: string }>(sql`
      SELECT t.tgenabled AS enabled, p.proname AS fn FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE t.tgname = 'audit_log_append_only' AND t.tgrelid = 'audit_log'::regclass`);
    expect(trigger).toEqual({ enabled: 'O', fn: 'audit_log_guard' });
  });

  it('constat 17 : le rattrapage des factures lit l\'index partiel des courses facturables', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const [index] = await db(app).execute<{ indexdef: string }>(sql`SELECT indexdef FROM pg_indexes WHERE indexname = 'rides_invoice_catchup_idx'`);
    expect(index?.indexdef).toMatch(/\(updated_at\) WHERE \(\(driver_id IS NOT NULL\) AND/);
    // Même requête que InvoicingService.ridesMissingInvoice ; balayage séquentiel interdit le temps du plan pour vérifier
    // que la condition de l'index est bien démontrée par la requête (sinon PostgreSQL ne pourrait pas l'utiliser).
    const plan = await db(app).transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan = off`);
      const rows = await tx.execute<{ 'QUERY PLAN': string }>(sql`EXPLAIN
        SELECT r.id FROM rides r
        WHERE r.driver_id IS NOT NULL
          AND r.state IN ('completed', 'rated', 'disputed', 'cancelled_by_client', 'no_show')
          AND (r.state IN ('completed', 'rated', 'disputed') OR (r.state IN ('cancelled_by_client', 'no_show') AND r.cancellation_fee_cents > 0 AND r.payment_choice = 'prepaid'))
          AND r.updated_at > now() - make_interval(days => 2) AND r.updated_at < now() - interval '2 minutes'
          AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.ride_id = r.id AND i.credit_note_of_id IS NULL)
        ORDER BY r.updated_at LIMIT 50`);
      return [...rows].map((r) => r['QUERY PLAN']).join('\n');
    });
    expect(plan).toContain('rides_invoice_catchup_idx');
    expect(Array.isArray(await app.get(InvoicingService).ridesMissingInvoice(5))).toBe(true);
  });
});
