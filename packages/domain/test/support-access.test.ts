import { describe, expect, it } from 'vitest';
import {
  invitationCreatedSchema, LEGACY_ROLE_PERMISSIONS, orgOrganizationCreateSchema, PERMISSIONS, removesLastOwner, SUPPORT_ACCESS_EXCLUDED_PERMISSIONS, supportAccessPermissions, supportAccessRequestSchema,
  supportGrantActive, supportGrantStatus, supportGrantTransition, SYSTEM_ROLES, type Permission, type SupportGrantState,
} from '../src/index.js';

const NOW = new Date('2026-10-01T12:00:00Z');
const HOUR = 3_600_000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);
const grant = (over: Partial<SupportGrantState> = {}): SupportGrantState => ({ status: 'requested', createdAt: at(-HOUR), startsAt: null, endsAt: null, ...over });

describe('accès temporaire du support (étape 21)', () => {
  it('permission sensible, réservée à la plateforme, détenue par l\'administrateur seulement', () => {
    expect(PERMISSIONS['support.access']).toMatchObject({ module: 'platform', sensitive: true, platformOnly: true });
    expect(LEGACY_ROLE_PERMISSIONS['admin']).toContain('support.access');
    for (const role of ['operator', 'finance', 'readonly']) expect(LEGACY_ROLE_PERMISSIONS[role]).not.toContain('support.access');
    for (const role of SYSTEM_ROLES.filter((r) => r.level > 0)) expect(role.permissions).not.toContain('support.access');
  });

  it('statut effectif : échéance d\'un accès approuvé, délai d\'une demande sans réponse', () => {
    const ttl = 24 * HOUR;
    expect(supportGrantStatus(grant(), NOW, ttl)).toBe('requested');
    expect(supportGrantStatus(grant({ createdAt: at(-25 * HOUR) }), NOW, ttl)).toBe('expired');
    expect(supportGrantStatus(grant({ status: 'approved', startsAt: at(-HOUR), endsAt: at(HOUR) }), NOW, ttl)).toBe('approved');
    expect(supportGrantStatus(grant({ status: 'approved', startsAt: at(-2 * HOUR), endsAt: NOW }), NOW, ttl)).toBe('expired');
    expect(supportGrantStatus(grant({ status: 'approved', startsAt: null, endsAt: null }), NOW, ttl)).toBe('approved');
    expect(supportGrantStatus(grant({ status: 'denied', createdAt: at(-48 * HOUR) }), NOW, ttl)).toBe('denied');
    expect(supportGrantStatus(grant({ status: 'revoked' }), NOW, ttl)).toBe('revoked');
  });

  it('accès en cours seulement entre l\'approbation et l\'échéance', () => {
    expect(supportGrantActive(grant({ status: 'approved', startsAt: at(-HOUR), endsAt: at(HOUR) }), NOW)).toBe(true);
    expect(supportGrantActive(grant({ status: 'approved', startsAt: at(HOUR), endsAt: at(2 * HOUR) }), NOW)).toBe(false);
    expect(supportGrantActive(grant({ status: 'approved', startsAt: at(-HOUR), endsAt: NOW }), NOW)).toBe(false);
    expect(supportGrantActive(grant({ status: 'approved', startsAt: null, endsAt: at(HOUR) }), NOW)).toBe(false);
    expect(supportGrantActive(grant({ status: 'approved', startsAt: at(-HOUR), endsAt: null }), NOW)).toBe(false);
    expect(supportGrantActive(grant({ status: 'revoked', startsAt: at(-HOUR), endsAt: at(HOUR) }), NOW)).toBe(false);
  });

  it('décisions : approuver ou refuser une demande, révoquer une demande ou un accès ; rien après', () => {
    expect(supportGrantTransition('requested', 'approve')).toBe('approved');
    expect(supportGrantTransition('requested', 'deny')).toBe('denied');
    expect(supportGrantTransition('requested', 'revoke')).toBe('revoked');
    expect(supportGrantTransition('approved', 'revoke')).toBe('revoked');
    expect(supportGrantTransition('approved', 'approve')).toBeNull();
    expect(supportGrantTransition('denied', 'approve')).toBeNull();
    expect(supportGrantTransition('expired', 'revoke')).toBeNull();
    expect(supportGrantTransition('revoked', 'deny')).toBeNull();
  });

  it('permissions pendant l\'accès : celles du support, sans la plateforme ni la gestion des membres, rôles, organisations et domaines, dans les modules de la formule', () => {
    const platform = new Set<Permission>(['rides.read', 'drivers.read', 'members.read', 'members.manage', 'staff.manage', 'support.access', 'metrics.read']);
    expect([...supportAccessPermissions(platform, null)].sort()).toEqual(['drivers.read', 'members.read', 'rides.read']);
    expect([...supportAccessPermissions(platform, ['rides'])]).toEqual(['rides.read']);
    // Revue du 2 octobre 2026 (sécurité 5) : même un administrateur complet ne peut ni s'inviter ni se rendre permanent pendant un accès.
    const everything = new Set<Permission>(LEGACY_ROLE_PERMISSIONS['admin']!);
    const granted = supportAccessPermissions(everything, null);
    for (const code of SUPPORT_ACCESS_EXCLUDED_PERMISSIONS) expect(granted.has(code), code).toBe(false);
    expect(SUPPORT_ACCESS_EXCLUDED_PERMISSIONS).toEqual(['members.invite', 'members.manage', 'roles.manage', 'organizations.manage', 'domains.manage']);
    expect(granted.has('rides.read')).toBe(true);
    expect(granted.has('audit.read')).toBe(true);
  });

  it('dernier propriétaire : seul propriétaire actif visé', () => {
    expect(removesLastOwner([{ id: 'a', status: 'active' }], 'a')).toBe(true);
    expect(removesLastOwner([{ id: 'a', status: 'active' }, { id: 'b', status: 'active' }], 'a')).toBe(false);
    expect(removesLastOwner([{ id: 'a', status: 'active' }, { id: 'b', status: 'suspended' }], 'a')).toBe(true);
    expect(removesLastOwner([{ id: 'a', status: 'active' }], 'b')).toBe(false);
    expect(removesLastOwner([], 'a')).toBe(false);
  });

  it('schémas : demande d\'accès bornée, invitation sans jeton, sous-organisation sous la route par défaut', () => {
    expect(supportAccessRequestSchema.parse({ reason: 'Vérification d\'un relevé contesté' })).toMatchObject({ durationMinutes: 60 });
    expect(supportAccessRequestSchema.safeParse({ reason: 'court' }).success).toBe(false);
    expect(supportAccessRequestSchema.safeParse({ reason: 'Vérification d\'un relevé contesté', durationMinutes: 1441 }).success).toBe(false);
    expect(invitationCreatedSchema.parse({ id: '00000000-0000-4000-8000-000000000001', expiresAt: NOW.toISOString(), channel: 'sms' }).token).toBeUndefined();
    const sub = orgOrganizationCreateSchema.parse({ code: 'Succursale-Nord', name: 'Succursale Nord', type: 'sub_org' });
    expect(sub.code).toBe('succursale-nord');
    expect(sub.parentId).toBeUndefined();
  });
});
