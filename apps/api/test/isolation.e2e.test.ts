import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OrgScopeService } from '../src/modules/organizations/org-scope.service.js';
import { cleanupTestData, createDriver, db, startTestApp, type TestDriver } from './helpers.js';

/**
 * Étape 20 : isolation par organisation au niveau de la base. Deux organisations sœurs (A et B) sous la racine : dans
 * une transaction restreinte à A, rien de B ni de la plateforme n'est visible, et aucune écriture ne peut viser B.
 */
describe('isolation par organisation (intégration)', () => {
  let app: NestExpressApplication | null = null;
  let scope: OrgScopeService;
  const orgs: Array<{ id: string; path: string }> = [];
  let driverA: TestDriver;
  let driverB: TestDriver;
  let driverRoot: TestDriver;

  beforeAll(async () => {
    app = await startTestApp();
    if (!app) return;
    scope = app.get(OrgScopeService);
    const [root] = await db(app).select().from(schema.organizations).where(sql`${schema.organizations.parentId} IS NULL`).limit(1);
    for (const name of ['A', 'B']) {
      const id = randomUUID();
      const path = `${root!.path}${id}/`;
      await db(app).insert(schema.organizations).values({ id, code: `iso-${name.toLowerCase()}-${id.slice(0, 8)}`, name: `Isolation ${name}`, type: 'fleet', parentId: root!.id, path });
      orgs.push({ id, path });
    }
    [driverA, driverB, driverRoot] = await Promise.all([createDriver(app), createDriver(app), createDriver(app)]);
    await db(app).update(schema.drivers).set({ organizationId: orgs[0]!.id }).where(eq(schema.drivers.id, driverA.driverId));
    await db(app).update(schema.drivers).set({ organizationId: orgs[1]!.id }).where(eq(schema.drivers.id, driverB.driverId));
    await db(app).update(schema.vehicles).set({ organizationId: orgs[0]!.id }).where(eq(schema.vehicles.id, driverA.vehicleId));
    await db(app).update(schema.vehicles).set({ organizationId: orgs[1]!.id }).where(eq(schema.vehicles.id, driverB.vehicleId));
  });
  afterAll(async () => {
    if (app) {
      await cleanupTestData(app);
      if (orgs.length) await db(app).delete(schema.organizations).where(inArray(schema.organizations.id, orgs.map((o) => o.id)));
    }
    await app?.close();
  });

  it('lecture : seulement les données de l\'organisation (et de ses descendantes), jamais celles de la sœur ni de la plateforme', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const ids = [driverA.driverId, driverB.driverId, driverRoot.driverId];
    const seen = await scope.run(orgs[0]!.path, async (tx) => (await tx.select({ id: schema.drivers.id }).from(schema.drivers).where(inArray(schema.drivers.id, ids))).map((r) => r.id));
    expect(seen).toEqual([driverA.driverId]);
    const vehicles = await scope.run(orgs[0]!.path, async (tx) => (await tx.select({ id: schema.vehicles.id }).from(schema.vehicles).where(inArray(schema.vehicles.id, [driverA.vehicleId, driverB.vehicleId]))).map((r) => r.id));
    expect(vehicles).toEqual([driverA.vehicleId]);
    // Le compte du chauffeur de A est visible ; ceux de B et de la plateforme non.
    const users = await scope.run(orgs[0]!.path, async (tx) => (await tx.select({ id: schema.users.id }).from(schema.users).where(inArray(schema.users.id, [driverA.userId, driverB.userId, driverRoot.userId]))).map((r) => r.id));
    expect(users).toEqual([driverA.userId]);
    // Tables sans politique pour le rôle restreint : aucune ligne.
    const sessions = await scope.run(orgs[0]!.path, async (tx) => tx.select({ id: schema.sessions.id }).from(schema.sessions).limit(1));
    expect(sessions).toHaveLength(0);
    // Hors transaction restreinte, la plateforme voit tout.
    expect(await db(app).select({ id: schema.drivers.id }).from(schema.drivers).where(inArray(schema.drivers.id, ids))).toHaveLength(3);
  });

  it('écriture : aucune modification ni création ne peut viser une autre organisation', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const updated = await scope.run(orgs[0]!.path, async (tx) => tx.update(schema.drivers).set({ status: 'suspended' }).where(eq(schema.drivers.id, driverB.driverId)).returning({ id: schema.drivers.id }));
    expect(updated).toHaveLength(0);
    await expect(scope.run(orgs[0]!.path, async (tx) => tx.update(schema.drivers).set({ organizationId: orgs[1]!.id }).where(eq(schema.drivers.id, driverA.driverId)))).rejects.toThrow();
    const [row] = await db(app).select({ organizationId: schema.drivers.organizationId }).from(schema.drivers).where(eq(schema.drivers.id, driverA.driverId));
    expect(row!.organizationId).toBe(orgs[0]!.id);
    // Le réglage et le rôle meurent avec la transaction : la connexion suivante retrouve le rôle de l'API.
    const [who] = await db(app).execute<{ role: string; scope: string | null }>(sql`SELECT current_user AS role, nullif(current_setting('app.scope_path', true), '') AS scope`);
    expect(who).toMatchObject({ scope: null });
    expect(who!.role).not.toBe('neomoov_scoped');
  });

  it('portée d\'un membre : organisation couverte par une adhésion active, sinon refus', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const [role] = await db(app).select({ id: schema.roles.id }).from(schema.roles).where(eq(schema.roles.code, 'org_admin')).limit(1);
    await db(app).insert(schema.memberships).values({ userId: driverA.userId, organizationId: orgs[0]!.id, roleId: role!.id });
    expect(await scope.scopeFor(driverA.userId, orgs[0]!.id)).toEqual({ path: orgs[0]!.path, organizationId: orgs[0]!.id });
    await expect(scope.scopeFor(driverA.userId, orgs[1]!.id)).rejects.toMatchObject({ code: 'NOT_A_MEMBER' });
    await expect(scope.scopeFor(driverA.userId, randomUUID())).rejects.toMatchObject({ code: 'ORGANIZATION_NOT_FOUND' });
    await expect(scope.run('/pas-un-chemin/', async () => null)).rejects.toMatchObject({ code: 'INVALID_ORGANIZATION_SCOPE' });
  });
});
