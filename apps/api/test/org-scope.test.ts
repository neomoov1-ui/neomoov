import 'reflect-metadata';
import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { orgScopeStorage, type OrgScopeContext } from '../src/common/org-scope.context.js';
import type { Database } from '../src/infra/db.module.js';
import { AccessService } from '../src/modules/auth/access.service.js';
import { ORG_SCOPED_KEY, OrgScoped, type OrgScopedOptions, type UserActor } from '../src/modules/auth/actor.js';
import { OrgScopeGuard } from '../src/modules/auth/guards.js';

/** Étape 20 : résolution de l'organisation d'une route `@OrgScoped` (paramètre de route, sinon en-tête), sans base. */
const fakeRequest = (params: Record<string, string>, headers: Record<string, string> = {}) =>
  ({ params, header: (name: string) => headers[name.toLowerCase()] } as unknown as Request);

describe('routes d\'organisation : décorateur et résolution de l\'organisation', () => {
  it('@OrgScoped() : paramètre organizationId et en-tête X-Organization-Id par défaut, surcharge possible', () => {
    class Sample {
      @OrgScoped()
      byDefault() {}
      @OrgScoped({ param: 'orgId' })
      custom() {}
    }
    expect(Reflect.getMetadata(ORG_SCOPED_KEY, Sample.prototype.byDefault)).toEqual({ param: 'organizationId', header: 'x-organization-id' });
    expect(Reflect.getMetadata(ORG_SCOPED_KEY, Sample.prototype.custom)).toEqual({ param: 'orgId', header: 'x-organization-id' });
  });

  it('l\'identifiant vient du paramètre de route, sinon de l\'en-tête, sinon rien', () => {
    const options: OrgScopedOptions = { param: 'organizationId', header: 'x-organization-id' };
    expect(OrgScopeGuard.organizationIdOf(fakeRequest({ organizationId: 'org-param' }, { 'x-organization-id': 'org-header' }), options)).toBe('org-param');
    expect(OrgScopeGuard.organizationIdOf(fakeRequest({}, { 'x-organization-id': '  org-header  ' }), options)).toBe('org-header');
    expect(OrgScopeGuard.organizationIdOf(fakeRequest({ id: 'autre' }, {}), options)).toBeNull();
    expect(OrgScopeGuard.organizationIdOf(fakeRequest({}, { 'x-organization-id': '   ' }), options)).toBeNull();
  });
});

/**
 * Base simulée : chaque `select()` rend une chaîne dont le résultat est lu au moment de l'attente ; le premier appel d'une
 * paire (adhésions) rend `state.rows`, le second (modules de la cible) rend `state.features`.
 */
function fakeDatabase(state: { rows: unknown[]; features: unknown[] }): Database {
  let calls = 0;
  const chain = (result: () => unknown[]): unknown =>
    new Proxy({}, { get: (_target, prop) => (prop === 'then' ? (resolve: (v: unknown) => void, reject: (e: unknown) => void) => Promise.resolve(result()).then(resolve, reject) : () => chain(result)) });
  return { db: { select: () => chain(calls++ % 2 === 0 ? () => state.rows : () => state.features) } } as unknown as Database;
}

describe('droits dans une organisation : cache revidé après la validation d\'une transaction restreinte', () => {
  const actor: UserActor = { kind: 'user', userId: 'u1', sessionId: 's1', primaryRole: 'client', roles: [], amr: ['otp'] };
  const active = { membershipId: 'm1', status: 'active', expiresAt: null, scope: 'organization', path: '/r/a/', permission: 'rides.read' };

  it('modules de la cible, portée, permissions sensibles sans double authentification', async () => {
    const state = { rows: [active, { ...active, permission: 'members.manage' }, { ...active, permission: 'drivers.read' }, { ...active, membershipId: 'm2', path: '/r/b/' }], features: [{ module: 'rides', enabled: true }, { module: 'drivers', enabled: false }] };
    const access = new AccessService(fakeDatabase(state));
    expect([...(await access.permissionsIn(actor, '/r/a/'))]).toEqual(['rides.read']);
  });

  it('une requête concurrente qui remet en cache l\'état d\'avant la validation est effacée par afterScopedCommit', async () => {
    const state = { rows: [active] as unknown[], features: [] as unknown[] };
    const access = new AccessService(fakeDatabase(state));
    expect([...(await access.permissionsIn(actor, '/r/a/'))]).toEqual(['rides.read']);
    const scope: OrgScopeContext = { organizationId: 'a', path: '/r/a/', tx: null };
    // Suspension par une route d'organisation : cache vidé dans la transaction, encore non validée.
    orgScopeStorage.run(scope, () => access.invalidate('u1'));
    // Une requête concurrente lit l'état d'avant (transaction non validée) et le remet en cache.
    expect([...(await access.permissionsIn(actor, '/r/a/'))]).toEqual(['rides.read']);
    // Validation : l'adhésion n'est plus active ; le cache est revidé, l'état validé est relu.
    state.rows = [{ ...active, status: 'suspended' }];
    access.afterScopedCommit(scope);
    expect([...(await access.permissionsIn(actor, '/r/a/'))]).toEqual([]);
    // Hors transaction restreinte, rien n'est différé ; un second appel est sans effet.
    access.invalidate('u1');
    access.afterScopedCommit(scope);
  });
});
