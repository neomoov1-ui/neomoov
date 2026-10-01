import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isPlatformOnlyTable, PLATFORM_ONLY_TABLES } from '../src/modules/organizations/isolation-catalog.js';
import { db, startTestApp } from './helpers.js';

/**
 * Étape 20 : couverture de l'isolation. Lit le catalogue PostgreSQL et exige, pour toute table du schéma `public`
 * appartenant au rôle de l'API (partitions exclues) : sécurité au niveau des lignes activée, droits du rôle restreint,
 * et une politique pour ce rôle OU une entrée dans `PLATFORM_ONLY_TABLES` (avec sa raison). Une table nouvelle sans
 * politique ni entrée fait échouer ce test : c'est voulu (marche à suivre dans `docs/isolation.md`).
 */
type TableRow = {
  table: string;
  rls: boolean;
  policies: number;
  grants: string[] | null;
};

const REQUIRED_GRANTS = ['DELETE', 'INSERT', 'SELECT', 'UPDATE'];

describe('isolation par organisation : couverture des tables (intégration)', () => {
  let app: NestExpressApplication | null = null;
  let rows: TableRow[] = [];

  beforeAll(async () => {
    app = await startTestApp();
    if (!app) return;
    rows = [
      ...(await db(app).execute<TableRow>(sql`
        SELECT c.relname AS "table", c.relrowsecurity AS rls,
          (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname AND 'neomoov_scoped' = ANY(p.roles)) AS policies,
          (SELECT array_agg(g.privilege_type::text ORDER BY g.privilege_type) FROM information_schema.role_table_grants g
            WHERE g.table_schema = 'public' AND g.table_name = c.relname AND g.grantee = 'neomoov_scoped') AS grants
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition AND pg_get_userbyid(c.relowner) = current_user
        ORDER BY c.relname`)),
    ];
  });
  afterAll(async () => {
    await app?.close();
  });

  it('le rôle restreint, les fonctions de portée et la numérotation sous rôle restreint sont en place', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const [role] = await db(app).execute<{ rolbypassrls: boolean; rolcanlogin: boolean }>(sql`SELECT rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = 'neomoov_scoped'`);
    expect(role).toEqual({ rolbypassrls: false, rolcanlogin: false });
    const functions = await db(app).execute<{ proname: string; prosecdef: boolean }>(sql`
      SELECT proname, prosecdef FROM pg_proc WHERE proname IN ('app_scope_allows', 'app_scope_organization_id', 'app_scope_allows_user', 'next_counter', 'ensure_driver_locations_partition') ORDER BY proname`);
    expect(Object.fromEntries([...functions].map((f) => [f.proname, f.prosecdef]))).toEqual({
      app_scope_allows: false, app_scope_allows_user: false, app_scope_organization_id: false, ensure_driver_locations_partition: true, next_counter: true,
    });
    // Défaut d'organisation (0022) sur les tables de données : une ligne créée sous contexte appartient à l'organisation du contexte.
    const defaults = await db(app).execute<{ table_name: string }>(sql`
      SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'organization_id' AND column_default LIKE 'app_scope_organization_id()%' ORDER BY table_name`);
    expect([...defaults].map((d) => d.table_name)).toEqual(['clients', 'conversations', 'credits', 'drivers', 'incidents', 'leads', 'notifications', 'quotes', 'rides', 'vehicles', 'weekly_statements']);
  });

  it('toute table de l\'API a la sécurité au niveau des lignes activée et les droits du rôle restreint', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    expect(rows.length).toBeGreaterThan(60);
    const withoutRls = rows.filter((r) => !r.rls).map((r) => r.table);
    expect(withoutRls, 'tables sans sécurité au niveau des lignes').toEqual([]);
    const withoutGrants = rows.filter((r) => !REQUIRED_GRANTS.every((g) => r.grants?.includes(g))).map((r) => `${r.table} (${(r.grants ?? []).join(', ') || 'aucun droit'})`);
    expect(withoutGrants, 'tables sans droits complets pour neomoov_scoped').toEqual([]);
  });

  it('toute table porte une politique pour le rôle restreint, ou figure dans la liste des tables réservées à la plateforme', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const unprotected = rows.filter((r) => r.policies === 0 && !isPlatformOnlyTable(r.table)).map((r) => r.table);
    expect(unprotected, 'tables sans politique ni entrée dans PLATFORM_ONLY_TABLES (docs/isolation.md)').toEqual([]);
    // La liste ne doit pas vieillir : une table listée qui a reçu une politique, ou qui n\'existe plus, en sort.
    const stale = Object.keys(PLATFORM_ONLY_TABLES).filter((table) => {
      const row = rows.find((r) => r.table === table);
      return !row || row.policies > 0;
    });
    expect(stale, 'entrées de PLATFORM_ONLY_TABLES à retirer (table protégée ou disparue)').toEqual([]);
  });

  it('les politiques ne visent que le rôle restreint et le journal des migrations n\'est pas exposé', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const others = await db(app).execute<{ tablename: string; policyname: string; roles: string[] }>(sql`
      SELECT tablename, policyname, roles::text[] AS roles FROM pg_policies WHERE schemaname = 'public' AND NOT ('neomoov_scoped' = ANY(roles))`);
    expect([...others], 'politiques posées pour un autre rôle que neomoov_scoped').toEqual([]);
    // Le schéma `drizzle` (journal des migrations) n'est pas accessible au rôle restreint.
    const [usage] = await db(app).execute<{ allowed: boolean }>(sql`SELECT has_schema_privilege('neomoov_scoped', 'drizzle', 'USAGE') AS allowed`);
    expect(usage?.allowed).toBe(false);
  });
});
