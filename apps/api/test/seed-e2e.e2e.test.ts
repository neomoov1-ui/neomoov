import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { markedIds } from '../src/scripts/seed-e2e/marked-accounts.js';
import type { SeedMarker } from '../src/scripts/seed-e2e/plan.js';
import { SeedE2e } from '../src/scripts/seed-e2e/runner.js';
import { db, startTestApp } from './helpers.js';

/**
 * `pnpm seed:e2e` en petit (étape 15, tâche 2) : même code que le jeu complet, avec un marqueur propre à ce fichier
 * (téléphones `+19995X…` à 12 chiffres, jamais ceux du jeu ni des autres tests) et 3 chauffeurs, 4 clients, 12 courses
 * sur 2 semaines. Vérifie la cohérence (registres, factures sans trou par fournisseur, relevés réglés), l'idempotence,
 * la présence retirable et le retrait exact.
 */
describe('jeu de données de bout en bout (intégration)', () => {
  let app: NestExpressApplication | null = null;
  const tag = String(7 + Math.floor(Math.random() * 3));
  const run = Math.random().toString(36).slice(2, 6).toUpperCase();
  const marker: SeedMarker = { key: `seed-test-${run.toLowerCase()}`, phonePrefix: `+19995${tag}`, emailDomain: `seed-${run.toLowerCase()}.test.neomoov.local`, plateTag: `S${run}`, rideTag: `S${tag}` };
  const sizes = { drivers: 3, clients: 4, rides: 12, weeks: 2 };

  beforeAll(async () => {
    app = await startTestApp({ DATABASE_POOL_MAX: '4' });
    // Un reste d'une exécution interrompue avec le même préfixe est retiré d'abord.
    if (app) await new SeedE2e(app, { marker }).reset();
  });
  afterAll(async () => {
    if (app) await new SeedE2e(app, { marker }).reset();
    await app?.close();
  });

  it('crée un état cohérent, idempotent, dont la présence et les données se retirent exactement', { timeout: 300_000 }, async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const seed = new SeedE2e(app, { marker, sizes, concurrency: 2 });
    const plan = await seed.plan();
    const first = await seed.run();
    expect(first.created).toMatchObject({ users: 7, clients: 4, drivers: 3, rides: 12, client_payment_methods: 4 });
    const completed = plan.rides.filter((r) => r.outcome === 'completed').length;
    expect(first.totals).toMatchObject({ users: 7, drivers: 3, clients: 4, rides: 12, rides_completed: completed, redevance_ledger: completed, tax_ledger: completed, invoices: 12, invoices_acknowledged: 12, online: 3 });
    expect(first.totals['statements_settled']).toBe(first.totals['weekly_statements']);
    expect(first.totals['weekly_statements']).toBeGreaterThanOrEqual(3);

    const ids = await markedIds(db(app), marker);
    // Factures : séquence de chaque fournisseur continue (1..n) et dans l'ordre chronologique des courses.
    const invoices = await db(app).execute<{ driver_id: string; supplier_sequence: number; issued_at: string }>(sql`
      SELECT driver_id, supplier_sequence, issued_at FROM invoices WHERE ride_id IN ${ids.rideIds} ORDER BY driver_id, supplier_sequence`);
    const byDriver = new Map<string, Array<{ seq: number; at: number }>>();
    for (const i of invoices) byDriver.set(i.driver_id, [...(byDriver.get(i.driver_id) ?? []), { seq: Number(i.supplier_sequence), at: new Date(i.issued_at).getTime() }]);
    for (const list of byDriver.values()) {
      expect(list.map((x) => x.seq)).toEqual(list.map((_, k) => k + 1));
      expect([...list].sort((a, b) => a.at - b.at).map((x) => x.seq)).toEqual(list.map((x) => x.seq));
    }
    // Dates réelles : factures émises à la fin de chaque course, dans le passé ; relevés émis et réglés.
    const [dates] = await db(app).execute<{ future: number; mismatched: number }>(sql`
      SELECT count(*) FILTER (WHERE i.issued_at > now())::int AS future,
             count(*) FILTER (WHERE abs(extract(epoch from i.issued_at - COALESCE(r.state_timestamps->>'completed', r.state_timestamps->>'no_show', r.state_timestamps->>'cancelled_by_client')::timestamptz)) > 60)::int AS mismatched
      FROM invoices i JOIN rides r ON r.id = i.ride_id WHERE r.id IN ${ids.rideIds}`);
    expect(dates).toEqual({ future: 0, mismatched: 0 });
    // Relevé = somme de ses lignes : chaque course terminée ou facturée figure sur exactement un relevé.
    const [lines] = await db(app).execute<{ on_statements: number; distinct_rides: number }>(sql`
      SELECT count(DISTINCT sl.ride_id)::int AS distinct_rides, count(*) FILTER (WHERE sl.ride_id IS NOT NULL)::int AS on_statements
      FROM statement_lines sl JOIN weekly_statements ws ON ws.id = sl.statement_id WHERE ws.driver_id IN ${ids.driverIds}`);
    expect(lines!.distinct_rides).toBe(12);
    const [payments] = await db(app).execute<{ captured_rides: number; direct: number }>(sql`
      SELECT count(*) FILTER (WHERE kind IN ('ride', 'no_show_fee', 'cancellation_fee') AND status = 'captured')::int AS captured_rides, count(*) FILTER (WHERE status = 'paid_direct')::int AS direct
      FROM payments WHERE ride_id IN ${ids.rideIds}`);
    expect(payments!.captured_rides + payments!.direct).toBe(12);

    // Idempotence : une seconde exécution ne crée rien et laisse le même état.
    const second = await seed.run();
    expect(Object.keys(second.created).filter((k) => k !== 'driver_presence')).toEqual([]);
    expect(second.totals).toEqual(first.totals);

    // Présence retirable, puis retrait exact.
    expect(await seed.setOnline(false)).toBe(3);
    expect((await seed.totals())['online']).toBe(0);
    const removed = await seed.reset();
    expect(removed).toMatchObject({ rides: 12, invoices: 12, users: 7, drivers: 3, clients: 4 });
    expect(await seed.totals()).toEqual({ users: 0, drivers: 0, clients: 0, rides: 0 });
    const [left] = await db(app).execute<{ counters: number; notifications: number }>(sql`
      SELECT (SELECT count(*) FROM counters WHERE scope IN ${ids.driverIds.map((id) => `invoice:driver:${id}`)})::int AS counters,
             (SELECT count(*) FROM notifications WHERE recipient_user_id IN ${ids.userIds})::int AS notifications`);
    expect(left).toEqual({ counters: 0, notifications: 0 });
  });
});
