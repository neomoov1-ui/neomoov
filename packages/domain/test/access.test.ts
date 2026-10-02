import { describe, expect, it } from 'vitest';
import {
  childPath, effectivePermissions, hasAnyPermission, inScope, isPermission, legacyPermissions, LEGACY_ROLE_PERMISSIONS, PERMISSION_CODES, PERMISSIONS,
  refusedGrants, SYSTEM_ROLES, systemRole, type Permission,
} from '../src/index.js';

const NOW = new Date('2026-09-27T12:00:00Z');

describe('catalogue des permissions (étape 19)', () => {
  it('codes uniques, modules connus, espace chauffeur hors du personnel', () => {
    expect(new Set(PERMISSION_CODES).size).toBe(PERMISSION_CODES.length);
    expect(isPermission('rides.read')).toBe(true);
    expect(isPermission('rides.fly')).toBe(false);
    expect(isPermission('toString')).toBe(false);
    expect(LEGACY_ROLE_PERMISSIONS['admin']).not.toContain('driver.app');
    expect(PERMISSIONS['staff.manage']).toMatchObject({ sensitive: true, platformOnly: true });
  });

  it('anciens rôles : mêmes accès qu\'avant la bascule (tailles dérivées des routes)', () => {
    // Phase 1 « entreprise autonome » : `sales.read` dans la lecture commune, `sales.manage` pour l'opérateur.
    expect(LEGACY_ROLE_PERMISSIONS['operator']).toHaveLength(59);
    expect(LEGACY_ROLE_PERMISSIONS['finance']).toHaveLength(30);
    expect(LEGACY_ROLE_PERMISSIONS['readonly']).toHaveLength(24);
    expect(LEGACY_ROLE_PERMISSIONS['agent']).toEqual(['agents.run', 'agents.runs.read', 'agents.tools']);
    for (const role of ['operator', 'finance', 'readonly']) for (const code of LEGACY_ROLE_PERMISSIONS[role]!) expect(LEGACY_ROLE_PERMISSIONS['admin']).toContain(code);
    expect(legacyPermissions(['readonly', 'inconnu']).has('rides.read')).toBe(true);
    expect(legacyPermissions(['readonly']).has('rides.cancel')).toBe(false);
  });

  it('rôles système : les organisations clientes ne reçoivent aucune permission de la plateforme', () => {
    for (const role of SYSTEM_ROLES.filter((r) => r.level > 0)) for (const code of role.permissions) expect(PERMISSIONS[code].platformOnly, `${role.code} ${code}`).toBe(false);
    expect(systemRole('org_owner')!.permissions).toContain('roles.manage');
    expect(systemRole('org_admin')!.permissions).not.toContain('roles.manage');
    expect(systemRole('platform_dispatcher')!.permissions).toBe(LEGACY_ROLE_PERMISSIONS['operator']);
    expect(systemRole('inconnu')).toBeNull();
  });
});

describe('droits effectifs', () => {
  const member = (permissions: string[], over: Partial<{ status: 'active' | 'suspended'; expiresAt: Date | null; modules: string[] | null }> = {}) => ({ permissions, status: 'active' as const, expiresAt: null, modules: null, ...over });
  it('union des anciens rôles et des adhésions actives, non expirées, dans les modules de la formule', () => {
    const held = effectivePermissions(['driver'], [
      member(['rides.read', 'inconnue']),
      member(['rides.cancel'], { status: 'suspended' }),
      member(['rides.assign'], { expiresAt: new Date('2026-09-27T11:00:00Z') }),
      member(['rides.hold'], { expiresAt: new Date('2026-10-01T00:00:00Z') }),
      member(['drivers.read', 'rides.create'], { modules: ['rides'] }),
    ], NOW);
    expect([...held].sort()).toEqual(['driver.app', 'rides.create', 'rides.hold', 'rides.read']);
    expect(hasAnyPermission(held, ['rides.assign', 'rides.read'])).toBe(true);
    expect(hasAnyPermission(held, ['rides.assign'])).toBe(false);
  });

  it('pas d\'escalade ; jamais de permission de la plateforme pour une organisation cliente', () => {
    const held = new Set<Permission>(['rides.read', 'rides.create', 'staff.manage']);
    expect(refusedGrants(held, ['rides.read', 'rides.cancel', 'faux'], false)).toEqual(['rides.cancel', 'faux']);
    expect(refusedGrants(held, ['rides.read', 'staff.manage'], true)).toEqual(['staff.manage']);
    expect(refusedGrants(held, ['staff.manage'], false)).toEqual([]);
  });

  it('portée : organisation seule ou sous-arbre', () => {
    const root = '/a/';
    const child = childPath(root, 'b');
    expect(child).toBe('/a/b/');
    expect(inScope(child, root, 'subtree')).toBe(true);
    expect(inScope(child, root, 'organization')).toBe(false);
    expect(inScope(root, root, 'organization')).toBe(true);
    expect(inScope('/c/', root, 'subtree')).toBe(false);
  });
});
